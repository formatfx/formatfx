import { describe, it, expect, vi, beforeEach } from 'vitest';
import { state } from './state';
import { openTemplateModal } from './templateModal';
import { dropPos } from './templateUi';

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  state.fields = [{ name: 'Title', type: 'text' }, { name: 'Status', type: 'choice' }, { name: 'Due', type: 'date' }];
  state.loadDocument({ kind: 'grid', root: { elmType: 'div', children: [] } });
});

/** Build a synthetic chip/item drop carrying one of the builder MIMEs. */
function drop(mime: string, payload: string): Event {
  const ev = new Event('drop', { bubbles: true, cancelable: true });
  (ev as unknown as { dataTransfer: unknown }).dataTransfer = {
    getData: (t: string) => (t === mime ? payload : ''),
    types: [mime],
  };
  return ev;
}
const fieldDrop = (name: string): Event => drop('application/x-wb-field', name);
const componentDrop = (id: string): Event => drop('application/x-wb-component', id);
const nodeDrop = (path: number[]): Event => drop('application/x-wb-node', JSON.stringify(path));

/** Open the builder and pick a wireframe (default: Lead + details → 2 zones). */
function enterEditor(id = 'lead-detail'): void {
  openTemplateModal(() => {});
  (document.querySelector(`[data-wireframe="${id}"]`) as HTMLElement).click();
}

const zone = (zi: number): HTMLElement => document.querySelector(`[data-edit-zone="${zi}"]`) as HTMLElement;

describe('dropPos — the one positional-drop rule (edges = between, body = into)', () => {
  it('containers: edges insert before/after, the middle drops into', () => {
    expect(dropPos(10, 100, true)).toBe('before');   // < 30%
    expect(dropPos(50, 100, true)).toBe('into');
    expect(dropPos(90, 100, true)).toBe('after');    // > 70%
  });

  it('non-containers split at the midpoint (no into)', () => {
    expect(dropPos(49, 100, false)).toBe('before');
    expect(dropPos(51, 100, false)).toBe('after');
  });

  it('degenerate rects (jsdom, collapsed nodes) fall back to a containing drop', () => {
    expect(dropPos(0, 0, true)).toBe('into');
    expect(dropPos(0, 0, false)).toBe('after');
  });
});

describe('row view builder — gallery + shell', () => {
  it('opens on the wireframe gallery (visual cards, no dropdowns)', () => {
    openTemplateModal(() => {});
    expect(document.querySelector('.wb-template-modal')?.getAttribute('data-stage')).toBe('pick');
    expect(document.querySelectorAll('.wb-wf-card').length).toBeGreaterThanOrEqual(5);
    expect(document.querySelector('.wb-wf-thumb')).toBeTruthy(); // drawn thumbnails, not names alone
    expect(document.querySelector('select')).toBeNull();
  });

  it('picking a wireframe enters the editor with its zones seeded', () => {
    enterEditor();
    expect(document.querySelector('.wb-template-modal')?.getAttribute('data-stage')).toBe('edit');
    expect(document.querySelectorAll('.wb-edit-zone').length).toBe(2); // Lead + Details
    // the seeded Lead zone holds the text field
    expect((document.querySelector('[data-edit-item="0:0"]') as HTMLElement).dataset.fieldName).toBe('Title');
  });

  it('the Layouts button returns to the gallery', () => {
    enterEditor();
    (document.querySelector('.wb-template-layouts') as HTMLElement).click();
    expect(document.querySelector('.wb-template-modal')?.getAttribute('data-stage')).toBe('pick');
  });

  it('Escape closes the modal (shared overlay teardown)', () => {
    openTemplateModal(() => {});
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.wb-template-modal')).toBeNull();
  });
});

describe('row view builder — row style inspector', () => {
  it('greys a control when composeRowStyle disables it, showing the reason', () => {
    enterEditor();
    (document.querySelector('[data-rowstyle="card"]') as HTMLElement).click();
    const border = document.querySelector('[data-toggle="border"]') as HTMLElement;
    expect(border.classList.contains('wb-disabled')).toBe(true);
    expect(border.title).toContain('Card style manages its own border');
  });
});

describe('row view builder — direct manipulation on the preview', () => {
  it('dropping a field chip on a zone appends an item there', () => {
    enterEditor();
    const before = document.querySelectorAll('[data-edit-item^="0:"]').length;
    zone(0).dispatchEvent(fieldDrop('Status'));
    const items = document.querySelectorAll('[data-edit-item^="0:"]');
    expect(items.length).toBe(before + 1);
    expect((items[items.length - 1] as HTMLElement).dataset.fieldName).toBe('Status');
  });

  it('＋ Zone adds an EMPTY zone (no drop required) and selects it for naming', () => {
    enterEditor();
    const before = document.querySelectorAll('.wb-edit-zone').length;
    (document.querySelector('.wb-template-addzone') as HTMLButtonElement).click();
    expect(document.querySelectorAll('.wb-edit-zone').length).toBe(before + 1);
    expect(document.querySelector('.wb-template-insp-title')?.textContent).toContain('Zone 3 zone');
    // the empty zone is a live drop target on the canvas
    (document.querySelector(`[data-edit-zone="${before}"]`) as HTMLElement).dispatchEvent(fieldDrop('Due'));
    expect((document.querySelector(`[data-edit-item="${before}:0"]`) as HTMLElement).dataset.fieldName).toBe('Due');
  });

  it('the end-gap is gone — Edit and Preview render the same row shape', () => {
    enterEditor();
    expect(document.querySelector('.wb-edit-endgap')).toBeNull();
  });

  it('selecting a zone shows its behavior controls (width, wrap-when-tight, stacked)', () => {
    enterEditor();
    zone(1).click();
    expect(document.querySelector('.wb-template-insp-title')?.textContent).toContain('Details zone');
    expect(document.querySelector('[data-zonesize="hug"]')).toBeTruthy();
    expect(document.querySelector('[data-zoneflow="wrap"]')).toBeTruthy();
    expect(document.querySelector('[data-zoneflow="stack"]')).toBeTruthy();
    expect(document.querySelector('.wb-template-remove')).toBeTruthy();
  });

  it('click selects the ZONE first; the second click drills into the item', () => {
    enterEditor();
    (document.querySelector('[data-edit-item="0:0"]') as HTMLElement).click();
    // zone-first: even a click ON the item selects its zone while unselected
    expect(document.querySelector('.wb-template-insp-title')?.textContent).toContain('Lead zone');
    (document.querySelector('[data-edit-item="0:0"]') as HTMLElement).click();
    expect(document.querySelector('.wb-template-insp-title')?.textContent).toContain('Title');
    expect(document.querySelector('[data-itemwidth="natural"]')).toBeTruthy();
    expect(document.querySelector('[data-wrap="truncate"]')).toBeTruthy();
  });

  it('Remove zone drops the zone from the config', () => {
    enterEditor();
    const before = document.querySelectorAll('.wb-edit-zone').length;
    zone(0).click();
    (document.querySelector('.wb-template-remove') as HTMLButtonElement).click();
    expect(document.querySelectorAll('.wb-edit-zone').length).toBe(before - 1);
  });

  it('a divider click cycles the left zone size (visible in its tag)', () => {
    enterEditor();
    const tag = (): string => (zone(0).querySelector('.wb-edit-zone-tag') as HTMLElement).textContent ?? '';
    expect(tag()).toContain('Fill 2×');   // Lead seeds wide
    (document.querySelector('.wb-edit-divider') as HTMLElement).click();
    expect(tag()).toContain('Fill 3×');   // wide → widest
    (document.querySelector('.wb-edit-divider') as HTMLElement).click();
    expect(tag()).toContain('Hug');       // widest → hug
  });
});

describe('row view builder — the zone tree + name-first tags', () => {
  it('the tree lists every zone with its items nested, and selects deterministically', () => {
    enterEditor();
    const labels = [...document.querySelectorAll('.wb-ztree-row .wb-ztree-label')].map((n) => n.textContent);
    expect(labels).toEqual(['Lead', 'Title', 'Details', 'Status', 'Due']);
    (document.querySelector('[data-tree-zone="1"]') as HTMLElement).click();
    expect(document.querySelector('.wb-template-insp-title')?.textContent).toContain('Details zone');
    (document.querySelector('[data-tree-item="0:0"]') as HTMLElement).click();
    expect(document.querySelector('.wb-template-insp-title')?.textContent).toContain('Title');
  });

  it('zone tags lead with the NAME; hovering an inspector section peeks that setting', () => {
    enterEditor();
    const tag = document.querySelector('.wb-edit-zone-tag') as HTMLElement;
    expect(tag.querySelector('.wb-zt-name')?.textContent).toBe('Lead');
    expect(tag.querySelector('.wb-zt-size')?.textContent).toBe('Fill 2×'); // rendered, CSS-hidden until peeked
    const modal = document.querySelector('.wb-template-modal') as HTMLElement;
    expect(modal.dataset.peek).toBe('');
    (document.querySelector('[data-tree-zone="0"]') as HTMLElement).click(); // zone inspector open
    const widthSec = document.querySelector('[data-peek-section="size"]') as HTMLElement;
    widthSec.dispatchEvent(new Event('mouseenter'));
    expect(modal.dataset.peek).toBe('size');
    widthSec.dispatchEvent(new Event('mouseleave'));
    expect(modal.dataset.peek).toBe('');
  });

  it('the Layouts button sits beside the ZONES header in the tree', () => {
    enterEditor();
    const headrow = document.querySelector('.wb-template-tree-headrow') as HTMLElement;
    expect(headrow.querySelector('.wb-template-tree-head')?.textContent).toBe('Zones');
    expect(headrow.querySelector('.wb-template-layouts')).toBeTruthy();
  });
});

describe('row view builder — zones inside zones', () => {
  it('a zone dropped ONTO another zone nests inside it (canvas + tree agree)', () => {
    enterEditor();
    zone(0).dispatchEvent(nodeDrop([1])); // Details → into Lead
    const nested = document.querySelector('[data-edit-zone="0:1"]') as HTMLElement;
    expect(nested).toBeTruthy();
    expect(nested.classList.contains('wb-edit-zone--nested')).toBe(true);
    expect(document.querySelector('[data-tree-zone="0:1"]')).toBeTruthy();
    // its items came along
    expect(document.querySelector('[data-edit-item="0:1:0"]')).toBeTruthy();
  });

  it('＋ Nested zone (zone inspector) adds a zone inside the selected zone', () => {
    enterEditor();
    zone(0).click();
    (document.querySelector('.wb-template-addnested') as HTMLButtonElement).click();
    expect(document.querySelector('[data-edit-zone="0:1"]')).toBeTruthy();
    expect(document.querySelector('.wb-template-insp-title')?.textContent).toContain('Lead inner zone');
  });

  it('a nested zone dropped on a root seam (divider) un-nests back to a root zone', () => {
    enterEditor();
    zone(0).click();
    (document.querySelector('.wb-template-addnested') as HTMLButtonElement).click(); // Lead inner at 0:1
    expect(document.querySelector('[data-edit-zone="0:1"]')).toBeTruthy();
    // the divider between the two root zones is an explicit root seam
    (document.querySelector('.wb-edit-divider') as HTMLElement).dispatchEvent(nodeDrop([0, 1]));
    expect(document.querySelector('[data-edit-zone="0:1"]')).toBeNull();
    expect(document.querySelectorAll('.wb-edit-divider').length).toBe(2); // three root zones now
    expect(document.querySelector('.wb-template-insp-title')?.textContent).toContain('Lead inner zone');
  });

  it('a nested layout survives Apply → reopen (recursive round trip through the doc)', () => {
    enterEditor();
    zone(0).dispatchEvent(nodeDrop([1]));
    (document.querySelector('.wb-template-apply') as HTMLButtonElement).click();
    openTemplateModal(() => {});
    expect(document.querySelector('[data-tree-zone="0:1"]')).toBeTruthy();
    expect(document.querySelector('[data-edit-item="0:1:0"]')).toBeTruthy();
  });
});

describe('row view builder — components in zones', () => {
  it('dropping a component chip binds it best-guess and opens its slot mapping', () => {
    enterEditor();
    zone(1).dispatchEvent(componentDrop('builtin-deadline-chip'));
    const item = document.querySelector('[data-component-id="builtin-deadline-chip"]') as HTMLElement;
    expect(item).toBeTruthy();
    // the new item is selected and its slot picker is prefilled with the date column
    const slot = document.querySelector('select[data-slot="Due"]') as HTMLSelectElement;
    expect(slot).toBeTruthy();
    expect(slot.value).toBe('Due');
    expect((document.querySelector('.wb-template-apply') as HTMLButtonElement).disabled).toBe(false);
  });

  it('an unmapped component slot blocks Apply with a teaching reason', () => {
    enterEditor();
    zone(1).dispatchEvent(componentDrop('builtin-deadline-chip'));
    const slot = document.querySelector('select[data-slot="Due"]') as HTMLSelectElement;
    slot.value = '';
    slot.dispatchEvent(new Event('change'));
    const apply = document.querySelector('.wb-template-apply') as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    expect(apply.title).toContain('Map every slot');
  });
});

describe('row view builder — always-live preview, squeeze & save', () => {
  it('the Edit/Preview toggle is gone — the live rows render below the edit row', () => {
    enterEditor();
    expect(document.querySelector('[data-mode]')).toBeNull();
    expect(document.querySelector('.wb-template-prow--edit')).toBeTruthy();
    expect(document.querySelector('.wb-template-livehead')).toBeTruthy();
    // at least one live row follows the caption
    expect(document.querySelectorAll('.wb-template-prow:not(.wb-template-prow--edit)').length).toBeGreaterThanOrEqual(1);
  });

  it('the 2×2 action grid sits top-left: undo, redo, cancel, Save', () => {
    enterEditor();
    const actions = document.querySelector('.wb-template-top .wb-template-actions') as HTMLElement;
    expect(actions.querySelector('.wb-template-undo')).toBeTruthy();
    expect(actions.querySelector('.wb-template-redo')).toBeTruthy();
    expect(actions.querySelector('.wb-template-cancel')).toBeTruthy();
    expect(actions.querySelector('.wb-template-apply')?.textContent).toBe('Save');
  });

  it('an empty zone\'s hint is a zero-footprint overlay, and the live rows never show it', () => {
    enterEditor();
    (document.querySelector('.wb-template-addzone') as HTMLButtonElement).click();
    const empty = document.querySelector('.wb-edit-zone--empty') as HTMLElement;
    expect(empty).toBeTruthy();
    expect(empty.querySelector('.wb-edit-zone-hint')).toBeTruthy();
    // the live rows render the PRUNED layout — no empty zone, no hint
    const live = document.querySelectorAll('.wb-template-prow:not(.wb-template-prow--edit) .wb-edit-zone-hint');
    expect(live.length).toBe(0);
  });

  it('the width presets squeeze the stage so wrap behavior can be WATCHED', () => {
    enterEditor();
    (document.querySelector('[data-stagewidth="narrow"]') as HTMLElement).click();
    expect((document.querySelector('.wb-template-stage') as HTMLElement).style.width).toBe('360px');
    (document.querySelector('[data-stagewidth="full"]') as HTMLElement).click();
    expect((document.querySelector('.wb-template-stage') as HTMLElement).style.width).toBe('');
  });

  it('Apply calls state.applyRowTemplate once and switches to a row view', () => {
    const spy = vi.spyOn(state, 'applyRowTemplate');
    enterEditor();
    (document.querySelector('.wb-template-apply') as HTMLButtonElement).click();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(state.doc.kind).toBe('row');
    spy.mockRestore();
  });

  it('empty zones are pruned from the applied layout', () => {
    enterEditor('dashboard'); // no number/person columns → Progress + People zones stay empty
    (document.querySelector('.wb-template-apply') as HTMLButtonElement).click();
    expect(state.doc.root.children!.length).toBe(2); // Title + Status only
  });

  it('Apply is disabled when no zone has an item', () => {
    enterEditor();
    for (const zi of [1, 0]) {
      zone(zi).click();
      (document.querySelector('.wb-template-remove') as HTMLButtonElement).click();
    }
    const apply = document.querySelector('.wb-template-apply') as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    expect(apply.title).toContain('at least one');
  });
});

describe('row view builder — reopen as zones (the round trip)', () => {
  const reopenAfterApply = (): void => {
    enterEditor();
    (document.querySelector('.wb-template-apply') as HTMLButtonElement).click();
    openTemplateModal(() => {});
  };

  it('reopening after Apply lands in the editor with the zones intact — not the gallery', () => {
    reopenAfterApply();
    expect(document.querySelector('.wb-template-modal')?.getAttribute('data-stage')).toBe('edit');
    const tags = [...document.querySelectorAll('.wb-edit-zone-tag')].map((t) => t.textContent);
    expect(tags.some((t) => t?.startsWith('Lead'))).toBe(true);
    expect(tags.some((t) => t?.startsWith('Details'))).toBe(true);
    expect((document.querySelector('[data-edit-item="0:0"]') as HTMLElement).dataset.fieldName).toBe('Title');
  });

  it('re-Apply on a reopened layout never asks the overwrite confirm (it IS the edit flow)', () => {
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmSpy);
    reopenAfterApply();
    // tweak a zone, then re-apply
    (document.querySelector('[data-edit-zone="1"]') as HTMLElement).click();
    (document.querySelector('[data-zoneflow="stack"]') as HTMLElement).click();
    (document.querySelector('.wb-template-apply') as HTMLButtonElement).click();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(state.doc.kind).toBe('row');
    vi.unstubAllGlobals();
  });

  it('a reopened tweak round-trips through the doc (flow change survives a second reopen)', () => {
    reopenAfterApply();
    (document.querySelector('[data-edit-zone="1"]') as HTMLElement).click();
    (document.querySelector('[data-zoneflow="stack"]') as HTMLElement).click();
    (document.querySelector('.wb-template-apply') as HTMLButtonElement).click();
    openTemplateModal(() => {});
    (document.querySelector('[data-edit-zone="1"]') as HTMLElement).click();
    expect(document.querySelector('[data-zoneflow="stack"]')?.classList.contains('wb-seg-on')).toBe(true);
  });

  it('picking a wireframe over a reopened layout confirms first (real work is at stake)', () => {
    const confirmSpy = vi.fn(() => false); // maker says no
    vi.stubGlobal('confirm', confirmSpy);
    reopenAfterApply();
    (document.querySelector('.wb-template-layouts') as HTMLElement).click();
    (document.querySelector('[data-wireframe="equal"]') as HTMLElement).click();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    // refused → still on the gallery, reopened config untouched
    expect(document.querySelector('.wb-template-modal')?.getAttribute('data-stage')).toBe('pick');
    vi.unstubAllGlobals();
  });

  it('a hand-built row view falls back to the gallery with an honest note', () => {
    state.loadDocument({ kind: 'row', root: { elmType: 'div', style: { 'display': 'flex' },
      children: [{ elmType: 'div', txtContent: '=[$Title]+[$Status]' }] } });
    openTemplateModal(() => {});
    expect(document.querySelector('.wb-template-modal')?.getAttribute('data-stage')).toBe('pick');
    expect(document.querySelector('.wb-template-foreign-note')?.textContent).toContain('outside this builder');
  });

  it('a grid landing still opens on the gallery with no foreign-row note', () => {
    openTemplateModal(() => {});
    expect(document.querySelector('.wb-template-modal')?.getAttribute('data-stage')).toBe('pick');
    expect(document.querySelector('.wb-template-foreign-note')).toBeNull();
  });
});

describe('row view builder — modal-local undo/redo', () => {
  const ctrlZ = (shift = false): void => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: shift }));
  };

  it('Ctrl+Z undoes the last gesture inside the builder; Ctrl+Shift+Z redoes', () => {
    enterEditor();
    const items = (): number => document.querySelectorAll('[data-edit-item^="0:"]').length;
    const before = items();
    zone(0).dispatchEvent(fieldDrop('Status'));
    expect(items()).toBe(before + 1);
    ctrlZ();
    expect(items()).toBe(before);
    ctrlZ(true);
    expect(items()).toBe(before + 1);
  });

  it('the ↶/↷ buttons mirror the stack and disable at the ends', () => {
    enterEditor();
    const un = (): HTMLButtonElement => document.querySelector('.wb-template-undo') as HTMLButtonElement;
    const re = (): HTMLButtonElement => document.querySelector('.wb-template-redo') as HTMLButtonElement;
    expect(un().disabled).toBe(true);   // nothing to undo after a fresh pick
    expect(re().disabled).toBe(true);
    zone(0).dispatchEvent(fieldDrop('Status'));
    expect(un().disabled).toBe(false);
    un().click();
    expect(re().disabled).toBe(false);
    re().click();
    expect((document.querySelectorAll('[data-edit-item^="0:"]').length)).toBe(2);
  });

  it('an in-builder undo never touches the document (Apply is still the only write)', () => {
    enterEditor();
    const snap = JSON.stringify(state.doc.root);
    zone(0).dispatchEvent(fieldDrop('Status'));
    ctrlZ();
    ctrlZ(); // stack empty — extra presses are harmless
    expect(JSON.stringify(state.doc.root)).toBe(snap);
  });
});

describe('row view builder — kebab refusal hints', () => {
  it('a custom kebab action with a blank param shows an inline refusal hint (mirrors buildKebab)', () => {
    enterEditor();
    const check = (sel: string): void => {
      const cb = document.querySelector(`${sel} input`) as HTMLInputElement;
      cb.checked = true;
      cb.dispatchEvent(new Event('change'));
    };
    check('[data-toggle="kebab"]');             // enable the kebab (defaults to custom behavior)
    check('[data-toggle="kebab-executeFlow"]'); // Run-flow action, but no flow id yet
    expect(document.querySelector('.wb-template-hint')?.textContent).toContain('flow ID');
  });
});
