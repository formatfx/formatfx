/**
 * JSON pane COMPONENT MODE — while a ⬡ workshop tab is active the pane shows
 * (and edits) the workshop's STAGED def JSON instead of the surface doc:
 *   · the buffer is the staged def, live-refreshed on workshop edits;
 *   · Apply parses + validates and STAGES via ctx.applyDef — never a save
 *     (the workshop's Save stays the one publish step);
 *   · refusals teach: bad JSON, non-def shapes, id changes;
 *   · the surface machinery stands down: no caret→canvas selection, no lint
 *     rows, deploy disabled — and the SHARED fold set is never pruned (it
 *     still holds the underlying surface's folds for the return trip);
 *   · a dirty surface buffer is never clobbered by entering the mode.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountJsonPanel } from './jsonPanel';
import { mountComponentWorkshop, type WorkshopHandle } from './componentEditor';
import { componentById, rawComponentById } from './componentLibrary';
import { foldState } from './foldState';
import { state } from './state';

const DEF_ID = 'builtin-deadline-chip';

let handle: WorkshopHandle | null = null;

afterEach(() => {
  handle?.destroy();
  handle = null;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  document.querySelectorAll<HTMLElement>('body > *').forEach((el) => {
    (el as unknown as { _unsub?: () => void })._unsub?.();
    el.remove();
  });
  foldState.clear();
  state.resetAll();
  vi.restoreAllMocks();
});

beforeEach(() => {
  state.resetAll();
});

function mountPanel(onToast: (m: string) => void = () => {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  mountJsonPanel(host, onToast);
  return {
    host,
    textEl: host.querySelector('#wb-json-text') as HTMLTextAreaElement,
    applyBtn: host.querySelector('#wb-json-apply') as HTMLButtonElement,
    errEl: host.querySelector('#wb-json-import-error') as HTMLDivElement,
    compBar: host.querySelector('#wb-json-compbar') as HTMLDivElement,
  };
}

/** Activate the workshop tab AND mount its workshop (what the canvas strip
 *  does) — the pane needs both the active tab and the registered seam. */
function openWorkshop() {
  state.openComponentTab(DEF_ID);
  const whost = document.createElement('div');
  document.body.appendChild(whost);
  handle = mountComponentWorkshop(whost, componentById(DEF_ID)!, {
    onToast: () => {},
    onSaved: () => {},
    onDirtyChange: (d) => state.setWorkshopDirty(DEF_ID, d),
  });
  return state.workshopCtx!;
}

const typeInto = (textEl: HTMLTextAreaElement, value: string): void => {
  textEl.value = value;
  textEl.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('entering component mode', () => {
  it('shows the staged def JSON (minus workshop bookkeeping) and the component banner', () => {
    const { textEl, compBar } = mountPanel();
    expect(textEl.value).toContain('$schema'); // surface first
    const ctx = openWorkshop();
    const { builtin, ...content } = ctx.def();
    void builtin;
    expect(JSON.parse(textEl.value)).toEqual(content);
    // builtin is the save flow's bookkeeping, not component content — never
    // shown (and parseComponentDefJson strips it on the way back in anyway)
    expect(textEl.value).not.toContain('"builtin"');
    expect(compBar.hidden).toBe(false);
    expect(compBar.textContent).toContain('Deadline chip');
  });

  it('leaves component mode on surface navigation — the buffer shows the surface again', () => {
    const { textEl, applyBtn } = mountPanel();
    openWorkshop();
    expect(textEl.value).not.toContain('$schema');
    // the primary action NAMES its destination (Copilot review, PR #312)
    expect(applyBtn.textContent).toBe('⬅ Apply to workshop');
    state.minimizeView();
    expect(textEl.value).toContain('$schema');
    expect(applyBtn.textContent).toBe('⬅ Apply to canvas');
  });

  it('never prunes the SHARED fold set (it still holds the surface\'s folds for the return trip)', () => {
    mountPanel();
    foldState.update('tree', (set) => set.add('0'));
    openWorkshop();
    expect(foldState.keys()).toContain('0');
  });

  it('a dirty surface buffer is never clobbered — the banner explains instead', () => {
    const { textEl, compBar } = mountPanel();
    typeInto(textEl, '{"hand": "edит"}');
    const before = textEl.value;
    openWorkshop();
    expect(textEl.value).toBe(before); // the draft survives
    expect(compBar.hidden).toBe(false);
    expect(compBar.textContent?.toLowerCase()).toContain('unapplied');
  });
});

describe('editing + Apply-into-workshop', () => {
  it('Apply stages the hand-edited def via applyDef and cleans the buffer', () => {
    const toasts: string[] = [];
    const { textEl, applyBtn } = mountPanel((m) => toasts.push(m));
    const ctx = openWorkshop();
    const def = ctx.def();
    def.name = 'Hand-edited name';
    typeInto(textEl, JSON.stringify(def, null, 2));
    expect(textEl.classList.contains('wb-json-dirty')).toBe(true);
    applyBtn.click();
    expect(ctx.def().name).toBe('Hand-edited name');
    expect(textEl.classList.contains('wb-json-dirty')).toBe(false);
    expect(toasts.join(' ')).toContain('Save');
    // Apply staged — it did NOT publish: the workshop tab is dirty now
    expect(state.workshopDirty(DEF_ID)).toBe(true);
  });

  it('refuses invalid JSON with the parse error, staging nothing', () => {
    const { textEl, applyBtn, errEl } = mountPanel();
    const ctx = openWorkshop();
    const before = ctx.def();
    typeInto(textEl, '{ broken');
    applyBtn.click();
    expect(errEl.hidden).toBe(false);
    expect(errEl.textContent).toContain('Invalid JSON');
    expect(ctx.def()).toEqual(before);
  });

  it('refuses a slot-KEY change — saved instances\' mappings are bound to the key set', () => {
    const { textEl, applyBtn, errEl } = mountPanel();
    const ctx = openWorkshop();
    const def = ctx.def();
    def.slots = def.slots.map((s, i) => (i === 0 ? { ...s, key: 'Renamed' } : s));
    typeInto(textEl, JSON.stringify(def, null, 2));
    applyBtn.click();
    // Copilot review, PR #312: a renamed key would publish instances with
    // unresolved refs and a stale map at save time
    expect(errEl.hidden).toBe(false);
    expect(errEl.textContent?.toLowerCase()).toContain('slot key');
    expect(ctx.def().slots.map((s) => s.key)).not.toContain('Renamed');
  });

  it('the key-set guard compares element-wise — join-delimiter collisions don\'t slip through', () => {
    // keys ['A, B', 'C'] and ['A', 'B', 'C'] join to the same string — the
    // guard must still refuse (Copilot review, PR #312)
    localStorage.setItem('wb-components.v1', JSON.stringify({
      version: 1,
      components: [{
        id: 'c-collide', name: 'Collide', description: '',
        slots: [
          { key: 'A, B', label: 'ab', types: ['text'] },
          { key: 'C', label: 'c', types: ['text'] },
        ],
        root: { elmType: 'div', txtContent: 'x' },
      }],
    }));
    try {
      const { textEl, applyBtn, errEl } = mountPanel();
      state.openComponentTab('c-collide');
      const whost = document.createElement('div');
      document.body.appendChild(whost);
      handle = mountComponentWorkshop(whost, componentById('c-collide')!, {
        onToast: () => {}, onSaved: () => {}, onDirtyChange: () => {},
      });
      const ctx = state.workshopCtx!;
      const def = ctx.def();
      def.slots = [
        { key: 'A', label: 'a', types: ['text'] },
        { key: 'B', label: 'b', types: ['text'] },
        { key: 'C', label: 'c', types: ['text'] },
      ];
      typeInto(textEl, JSON.stringify(def, null, 2));
      applyBtn.click();
      expect(errEl.hidden).toBe(false);
      expect(ctx.def().slots.length).toBe(2); // nothing staged
    } finally {
      localStorage.removeItem('wb-components.v1');
    }
  });

  it('a refused Apply keeps the draft dirty — never cleaned first and then clobbered', () => {
    const { textEl, applyBtn, errEl } = mountPanel();
    const ctx = openWorkshop();
    const def = ctx.def();
    def.embeds = [{ ns: 'Self', of: DEF_ID, name: 'Self' }]; // applyDef throws on this
    typeInto(textEl, JSON.stringify(def, null, 2));
    applyBtn.click();
    expect(errEl.hidden).toBe(false);
    // Copilot review, PR #312: clearDirty ran before applyDef could throw,
    // stranding visible hand-edits with no dirty/Discard affordance — and the
    // next workshop event regenerated over them
    expect(textEl.classList.contains('wb-json-dirty')).toBe(true);
    ctx.commit(() => { ctx.root().txtContent = 'moved'; });
    expect(textEl.value).toContain('Self'); // the draft survived the workshop edit
  });

  it('refuses embed-record changes — namespaces key the flattened slot names instance maps use', () => {
    const { textEl, applyBtn, errEl } = mountPanel();
    const ctx = openWorkshop();
    const def = ctx.def();
    def.embeds = [{ ns: 'Part', of: 'c-any', name: 'p' }];
    def.root.children = [...(def.root.children ?? []), { elmType: 'div', _embed: 'Part' }];
    typeInto(textEl, JSON.stringify(def, null, 2));
    applyBtn.click();
    // Copilot review, PR #312: even a consistent ns rename would re-key the
    // flattened Part_* slots that saved instances' maps reference — embeds
    // are managed in the workshop, where the mapping flows live
    expect(errEl.hidden).toBe(false);
    expect(errEl.textContent?.toLowerCase()).toContain('workshop');
    expect(ctx.def().embeds).toBeUndefined();
  });

  it('a map-only embed change is refused too — the map decides which ns_* slots surface', () => {
    localStorage.setItem('wb-components.v1', JSON.stringify({
      version: 1,
      components: [
        {
          id: 'c-kid', name: 'Kid', description: '',
          slots: [{ key: 'X', label: 'x', types: ['text'] }],
          root: { elmType: 'div', txtContent: '[$X]' },
        },
        {
          id: 'c-par', name: 'Par', description: '', slots: [],
          root: { elmType: 'div', children: [{ elmType: 'div', _embed: 'Kid' }] },
          embeds: [{ ns: 'Kid', of: 'c-kid', name: 'Kid', map: { X: '[$Title]' } }],
        },
      ],
    }));
    try {
      const { textEl, applyBtn, errEl } = mountPanel();
      state.openComponentTab('c-par');
      const whost = document.createElement('div');
      document.body.appendChild(whost);
      handle = mountComponentWorkshop(whost, rawComponentById('c-par')!, {
        onToast: () => {}, onSaved: () => {}, onDirtyChange: () => {},
      });
      const ctx = state.workshopCtx!;
      const def = ctx.def();
      delete def.embeds![0].map; // unbinds X → the Kid_X slot would now surface
      typeInto(textEl, JSON.stringify(def, null, 2));
      applyBtn.click();
      // Copilot review, PR #312: recKey ignored the map, so a map-only edit
      // re-keyed the flattened slots under existing instances' mappings
      expect(errEl.hidden).toBe(false);
      expect(ctx.def().embeds?.[0].map).toEqual({ X: '[$Title]' });
    } finally {
      localStorage.removeItem('wb-components.v1');
    }
  });

  it('refuses an id change — the id is the tab\'s identity', () => {
    const { textEl, applyBtn, errEl } = mountPanel();
    const ctx = openWorkshop();
    const def = ctx.def();
    def.id = 'someone-else';
    typeInto(textEl, JSON.stringify(def, null, 2));
    applyBtn.click();
    expect(errEl.hidden).toBe(false);
    expect(errEl.textContent).toContain('id');
    expect(ctx.def().id).toBe(DEF_ID);
  });

  it('a clean buffer live-refreshes as the workshop edits', () => {
    const { textEl } = mountPanel();
    const ctx = openWorkshop();
    ctx.commit(() => {
      ctx.root().txtContent = 'workshop-edited';
    });
    expect(textEl.value).toContain('workshop-edited');
  });

  it('tab-switch churn never fakes divergence — register/unregister emits with no staged change', () => {
    const { textEl, applyBtn } = mountPanel();
    const ctx = openWorkshop();
    const def = ctx.def();
    def.name = 'Mine';
    typeInto(textEl, JSON.stringify(def, null, 2));
    // navigate away and back: unregister + 'load' + re-register all fire
    // while the draft is dirty, but A's staged def never moved
    handle!.destroy();
    handle = null;
    state.minimizeView();
    const ctx2 = openWorkshop();
    const confirmSpy = vi.fn().mockReturnValue(false);
    vi.stubGlobal('confirm', confirmSpy);
    applyBtn.click();
    expect(confirmSpy).not.toHaveBeenCalled(); // Copilot review, PR #312: no spurious scare
    expect(ctx2.def().name).toBe('Mine');      // the apply landed directly
    vi.unstubAllGlobals();
  });

  it('workshop edits under a dirty buffer mark divergence — Apply confirms first', () => {
    const { textEl, applyBtn } = mountPanel();
    const ctx = openWorkshop();
    const def = ctx.def();
    def.name = 'Mine';
    typeInto(textEl, JSON.stringify(def, null, 2));
    ctx.commit(() => {
      ctx.root().txtContent = 'theirs';
    });
    const confirmSpy = vi.fn().mockReturnValue(false);
    vi.stubGlobal('confirm', confirmSpy);
    applyBtn.click();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.mock.calls[0][0]).toContain('workshop changed');
    expect(ctx.def().name).not.toBe('Mine'); // declined — nothing staged
    confirmSpy.mockReturnValue(true);
    applyBtn.click();
    expect(ctx.def().name).toBe('Mine');
    vi.unstubAllGlobals();
  });
});

describe('an orphaned component draft (navigated away while dirty)', () => {
  it('never exports another doc\'s JSON — Copy refuses and the size meter blanks', () => {
    const toasts: string[] = [];
    const { host, textEl } = mountPanel((m) => toasts.push(m));
    const ctx = openWorkshop();
    const def = ctx.def();
    def.name = 'My draft';
    typeInto(textEl, JSON.stringify(def, null, 2));
    state.minimizeView(); // the draft survives (never-clobber) but its workshop tab is gone
    expect(textEl.value).toContain('My draft');
    (host.querySelector('#wb-json-copy-btn') as HTMLButtonElement).click();
    // Copilot review, PR #312: this used to fall through and copy the SURFACE
    // formatter (or a different workshop's def) labeled as the component's
    expect(toasts.join(' ')).toContain('⬡');
    expect(toasts.join(' ')).not.toContain('copied');
    expect((host.querySelector('#wb-json-size') as HTMLElement).textContent).toBe('—');
  });
});

describe('Format document in component mode', () => {
  it('pretty-prints a valid def — never the "unrecognized formatter shape" error', () => {
    const toasts: string[] = [];
    const { host, textEl, errEl } = mountPanel((m) => toasts.push(m));
    const ctx = openWorkshop();
    const def = ctx.def();
    delete def.builtin;
    typeInto(textEl, JSON.stringify(def)); // minified but valid def JSON
    (host.querySelector('#wb-json-format') as HTMLButtonElement).click();
    expect(errEl.hidden).toBe(true); // Copilot review: importJson's shape error must not fire here
    expect(toasts.join(' ')).toContain('Formatted');
    expect(textEl.value).toBe(JSON.stringify(def, null, 2));
  });
});

describe('component-mode IDE (PR 2): caret ⇄ workshop selection', () => {
  /** Stage a two-node tree so caret/crumb/fold tests have a child to hit
   *  (the deadline chip's own root is a single leaf). */
  function stageTree(ctx: NonNullable<typeof state.workshopCtx>): void {
    const def = ctx.def();
    def.root = {
      elmType: 'div', _elmName: 'Wrap',
      children: [{ elmType: 'span', txtContent: '[$Due]' }],
    };
    ctx.applyDef(def); // the pane is clean — its regenerate follows the emit
  }

  it('a caret inside an element\'s JSON selects it in the WORKSHOP, never the surface', () => {
    const { textEl } = mountPanel();
    const ctx = openWorkshop();
    stageTree(ctx);
    const surfaceSel = state.selection;
    const off = textEl.value.indexOf('"elmType"', textEl.value.indexOf('"children"'));
    textEl.setSelectionRange(off + 2, off + 2);
    textEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(ctx.selection()).toEqual([0]);
    expect(state.selection).toEqual(surfaceSel); // the surface never hears it
  });

  it('def wrapper chrome (the slots block) selects nothing', () => {
    const { textEl } = mountPanel();
    const ctx = openWorkshop();
    stageTree(ctx);
    ctx.select([0]);
    const off = textEl.value.indexOf('"slots"') + 2;
    textEl.setSelectionRange(off, off);
    textEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(ctx.selection()).toEqual([0]); // unchanged
  });

  it('crumbs follow the caret with staged labels, and a crumb click selects in the workshop', () => {
    const { host, textEl } = mountPanel();
    const ctx = openWorkshop();
    stageTree(ctx);
    const off = textEl.value.indexOf('"elmType"', textEl.value.indexOf('"children"'));
    textEl.setSelectionRange(off + 2, off + 2);
    textEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const crumbs = host.querySelector('#wb-json-crumbs') as HTMLElement;
    expect(crumbs.hidden).toBe(false);
    const btns = [...crumbs.querySelectorAll<HTMLButtonElement>('.wb-crumb')];
    expect(btns.length).toBeGreaterThanOrEqual(2);
    expect(btns[0].textContent).toBe('Wrap'); // the staged label, not a surface name
    btns[0].click(); // the root crumb
    expect(ctx.selection()).toEqual([]);
  });
});

describe('component-mode IDE (PR 2): folds on a pane-local set', () => {
  it('element folds work in component mode and the SHARED surface fold set stays untouched', () => {
    const { textEl } = mountPanel();
    foldState.update('tree', (s) => s.add('0')); // a surface fold, parked
    const ctx = openWorkshop();
    const def = ctx.def();
    def.root = {
      elmType: 'div', _elmName: 'Wrap',
      children: [{ elmType: 'span', txtContent: '[$Due]', style: { color: 'red' } }],
    };
    ctx.applyDef(def);
    const before = textEl.value;
    const off = before.indexOf('"elmType"', before.indexOf('"children"'));
    textEl.setSelectionRange(off, off);
    textEl.dispatchEvent(new KeyboardEvent('keydown', {
      key: '[', ctrlKey: true, shiftKey: true, bubbles: true,
    }));
    expect(textEl.value.length).toBeLessThan(before.length); // child 0 folded away
    expect(foldState.keys()).toEqual(['0']); // the surface's set never moved
    state.minimizeView(); // back to the surface — its folds are its own business
    expect(textEl.value).toContain('$schema');
  });
});

describe('component-mode IDE (PR 2): slot-aware lint', () => {
  it('lint reads the STAGED def with slot keys as fields — unknown refs flag, slot refs resolve, no create-column', () => {
    const { host, textEl, applyBtn } = mountPanel();
    const ctx = openWorkshop();
    const def = ctx.def();
    const slotKey = def.slots[0]?.key ?? 'Due';
    def.root = { elmType: 'div', txtContent: `=[$${slotKey}]+[$NotASlot]` };
    typeInto(textEl, JSON.stringify(def, null, 2));
    applyBtn.click();
    const lintEl = host.querySelector('#wb-lint') as HTMLElement;
    expect(lintEl.hidden).toBe(false); // lint runs against the def now
    const text = lintEl.textContent ?? '';
    expect(text).toContain('NotASlot'); // an unknown ref still flags
    expect(text).not.toContain(`[$${slotKey}] —`); // the slot ref resolves
    // never a "create column" into the surface's mock schema from a def
    expect(lintEl.querySelector('.wb-lint-create')).toBeNull();
  });
});

describe('surface machinery stands down', () => {

  it('the surface-only output toggles disable — an inert toggle must not be able to discard a draft', () => {
    const { host } = mountPanel();
    const sanitize = host.querySelector('#wb-json-sanitize') as HTMLInputElement;
    const names = host.querySelector('#wb-json-names') as HTMLInputElement;
    openWorkshop();
    // Copilot review, PR #312: sanitize's change handler clearDirty+regenerates —
    // on a dirty component draft that throws the draft away for a setting the
    // def serialization ignores
    expect(sanitize.disabled).toBe(true);
    expect(names.disabled).toBe(true);
    // fold commands are LIVE in component mode since PR 2 (pane-local set)
    expect((host.querySelector('#wb-json-fold-others') as HTMLButtonElement).disabled).toBe(false);
    expect((host.querySelector('#wb-json-expand-all') as HTMLButtonElement).disabled).toBe(false);
    state.minimizeView();
    expect(sanitize.disabled).toBe(false);
    expect(names.disabled).toBe(false);
  });

  it('the deploy action disables; lint stays VISIBLE (it lints the def since PR 2)', () => {
    const { host } = mountPanel();
    const deployBtn = document.getElementById('wb-json-deploy') as HTMLButtonElement
      ?? host.querySelector('#wb-json-deploy') as HTMLButtonElement;
    openWorkshop();
    expect((host.querySelector('#wb-lint') as HTMLElement).hidden).toBe(false);
    expect(deployBtn.disabled).toBe(true);
    state.minimizeView();
    expect(deployBtn.disabled).toBe(false);
  });
});
