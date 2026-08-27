/**
 * JSON pane COMPONENT MODE — while a ⬡ workshop tab is active the pane shows
 * (and edits) the workshop's STAGED def JSON instead of the surface doc:
 *   · the buffer is the staged def, live-refreshed on workshop edits;
 *   · Apply parses + validates and STAGES via ctx.applyDef — never a save
 *     (the workshop's Save stays the one publish step);
 *   · refusals teach: bad JSON, non-def shapes, id changes;
 *   · the surface machinery stands down: no caret→canvas selection, no lint
 *     rows, deploy disabled — and the SHARED fold set is never pruned (the
 *     Structure tree resolves it against the staged tree in workshop mode);
 *   · a dirty surface buffer is never clobbered by entering the mode.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountJsonPanel } from './jsonPanel';
import { mountComponentWorkshop, type WorkshopHandle } from './componentEditor';
import { componentById } from './componentLibrary';
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

  it('never prunes the SHARED fold set (the Structure tree owns it against the staged tree)', () => {
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

describe('surface machinery stands down', () => {
  it('a caret click never drives the surface selection', () => {
    const { textEl } = mountPanel();
    openWorkshop();
    const before = state.selection;
    textEl.setSelectionRange(5, 5);
    textEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(state.selection).toEqual(before);
  });

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
    // the fold commands are inert in component mode — disabled, not dead buttons
    expect((host.querySelector('#wb-json-fold-others') as HTMLButtonElement).disabled).toBe(true);
    expect((host.querySelector('#wb-json-expand-all') as HTMLButtonElement).disabled).toBe(true);
    state.minimizeView();
    expect(sanitize.disabled).toBe(false);
    expect(names.disabled).toBe(false);
    expect((host.querySelector('#wb-json-fold-others') as HTMLButtonElement).disabled).toBe(false);
    expect((host.querySelector('#wb-json-expand-all') as HTMLButtonElement).disabled).toBe(false);
  });

  it('lint rows hide and the deploy action disables', () => {
    const { host } = mountPanel();
    const deployBtn = document.getElementById('wb-json-deploy') as HTMLButtonElement
      ?? host.querySelector('#wb-json-deploy') as HTMLButtonElement;
    openWorkshop();
    expect((host.querySelector('#wb-lint') as HTMLElement).hidden).toBe(true);
    expect(deployBtn.disabled).toBe(true);
    state.minimizeView();
    expect((host.querySelector('#wb-lint') as HTMLElement).hidden).toBe(false);
    expect(deployBtn.disabled).toBe(false);
  });
});
