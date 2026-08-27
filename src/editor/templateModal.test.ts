import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { state } from './state';
import { openTemplateModal } from './templateModal';
import { resetPickMemory } from './templatePreview';
import { dropPos } from './templateUi';

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  resetPickMemory(); // recents/fold memory is session-scoped — isolate tests
  state.resetAll(); // every test starts standing on the FLOOR
  state.fields = [{ name: 'Title', type: 'text' }, { name: 'Status', type: 'choice' }, { name: 'Due', type: 'date' }];
  state.loadDocument({ kind: 'grid', root: { elmType: 'div', children: [] } });
});

afterEach(() => {
  // force-close any modal a test left open (accepting the discard confirm) so
  // its document-level key handlers never leak into the next test
  vi.unstubAllGlobals();
  vi.stubGlobal('confirm', vi.fn(() => true));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  vi.unstubAllGlobals();
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

/** Open the builder, select a layout in the list and go Next (default:
 *  Lead + details → 2 zones). */
function enterEditor(id = 'lead-detail'): void {
  openTemplateModal(() => {});
  (document.querySelector(`[data-wireframe="${id}"]`) as HTMLElement).click();
  (document.querySelector('.wb-template-next') as HTMLElement).click();
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

describe('row view builder — the layout selector (stage pick)', () => {
  it('opens on the selector: a stacked layout list left, a quiet prompt right, Next waiting', () => {
    openTemplateModal(() => {});
    expect(document.querySelector('.wb-template-modal')?.getAttribute('data-stage')).toBe('pick');
    expect(document.querySelectorAll('.wb-lay-row').length).toBeGreaterThanOrEqual(5);
    expect(document.querySelector('.wb-lay-row .wb-wf-thumb')).toBeTruthy(); // drawn thumbnails, not names alone
    expect(document.querySelector('select')).toBeNull();
    // nothing selected yet: the right pane prompts, the journey buttons wait
    expect(document.querySelector('.wb-lay-placeholder')).toBeTruthy();
    expect((document.querySelector('.wb-template-next') as HTMLButtonElement).disabled).toBe(true);
    expect((document.querySelector('.wb-template-back') as HTMLButtonElement).disabled).toBe(true);
    // no drag chips and no undo/redo in the selector — nothing to edit yet
    expect(document.querySelector('.wb-template-field-chip')).toBeNull();
    expect(document.querySelector('.wb-template-undo')).toBeNull();
  });

  it('selecting a layout live-previews it with real data and drills the left pane into details', () => {
    openTemplateModal(() => {});
    (document.querySelector('[data-wireframe="lead-detail"]') as HTMLElement).click();
    // right pane: LIVE rows rendered from the maker's sample data
    expect(document.querySelector('.wb-lay-placeholder')).toBeNull();
    expect(document.querySelectorAll('.wb-template-preview .wb-template-prow').length).toBeGreaterThanOrEqual(1);
    expect(document.querySelector('.wb-lay-preview-title')?.textContent).toBe('Lead + details');
    // left pane: the drilled-in details with a back affordance
    const detail = document.querySelector('.wb-lay-detail') as HTMLElement;
    expect(detail).toBeTruthy();
    expect(detail.querySelector('.wb-lay-back')).toBeTruthy();
    expect(detail.querySelector('.wb-lay-detail-name')?.textContent).toBe('Lead + details');
    expect(detail.textContent).toContain('Title'); // the columns it seeds, by name
    expect(detail.textContent).toContain('Zones');
    expect((document.querySelector('.wb-template-next') as HTMLButtonElement).disabled).toBe(false);
  });

  it('a tile selection previews a live tile deck', () => {
    openTemplateModal(() => {});
    (document.querySelector('[data-wireframe="tile-headline"]') as HTMLElement).click();
    expect(document.querySelector('.wb-template-preview .wb-template-tiledeck')).toBeTruthy();
    expect(document.querySelector('.wb-lay-preview-kind')?.textContent).toBe('Tile layout');
  });

  it('Back un-drills to the list, keeping the selection highlighted and the preview up', () => {
    openTemplateModal(() => {});
    (document.querySelector('[data-wireframe="equal"]') as HTMLElement).click();
    (document.querySelector('.wb-lay-back') as HTMLElement).click();
    expect(document.querySelector('.wb-lay-detail')).toBeNull();
    expect((document.querySelector('[data-wireframe="equal"]') as HTMLElement).classList.contains('wb-lay-on')).toBe(true);
    // browsing must never lose the maker's place: preview and Next stay live
    expect(document.querySelectorAll('.wb-template-preview .wb-template-prow').length).toBeGreaterThanOrEqual(1);
    expect((document.querySelector('.wb-template-next') as HTMLButtonElement).disabled).toBe(false);
    // Back's ladder continues: un-drilled with a selection, it CLEARS it
    (document.querySelector('.wb-template-back') as HTMLElement).click();
    expect(document.querySelector('.wb-lay-placeholder')).toBeTruthy();
    expect(document.querySelector('.wb-lay-on')).toBeNull();
    expect((document.querySelector('.wb-template-next') as HTMLButtonElement).disabled).toBe(true);
    expect((document.querySelector('.wb-template-back') as HTMLButtonElement).disabled).toBe(true); // ladder's floor
  });

  it('browsing over a reopened sheet never strands it: Back clears the selection, Resume returns', () => {
    enterEditor();
    (document.querySelector('.wb-template-apply') as HTMLButtonElement).click();
    openTemplateModal(() => {}); // reopened
    (document.querySelector('.wb-template-layouts') as HTMLElement).click(); // list + Resume
    (document.querySelector('[data-wireframe="equal"]') as HTMLElement).click(); // browse
    expect(document.querySelector('.wb-template-next')?.textContent).toBe('Next'); // now destructive
    (document.querySelector('.wb-lay-back') as HTMLElement).click();   // un-drill
    (document.querySelector('.wb-template-back') as HTMLElement).click(); // clear selection
    const next = document.querySelector('.wb-template-next') as HTMLButtonElement;
    expect(next.textContent).toBe('Resume'); // the way home is back
    next.click();
    expect(document.querySelector('.wb-template-modal')?.getAttribute('data-stage')).toBe('edit');
  });

  it('Next enters the editor with the selected layout\'s zones seeded', () => {
    enterEditor();
    expect(document.querySelector('.wb-template-modal')?.getAttribute('data-stage')).toBe('edit');
    expect(document.querySelectorAll('.wb-edit-zone').length).toBe(2); // Lead + Details
    // the seeded Lead zone holds the text field
    expect((document.querySelector('[data-edit-item="0:0"]') as HTMLElement).dataset.fieldName).toBe('Title');
  });

  it('the editor\'s back arrow returns to the selector, drilled into the current layout', () => {
    enterEditor();
    (document.querySelector('.wb-template-layouts') as HTMLElement).click();
    expect(document.querySelector('.wb-template-modal')?.getAttribute('data-stage')).toBe('pick');
    expect(document.querySelector('.wb-lay-detail-name')?.textContent).toBe('Lead + details');
    // untouched seed → no "edits in progress" marker (Next resumes either way)
    expect(document.querySelector('.wb-lay-detail-resume')).toBeNull();
  });

  it('Back then Next on the SAME layout resumes the config — browsing costs nothing', () => {
    enterEditor();
    zone(0).dispatchEvent(fieldDrop('Status')); // real work
    const confirmSpy = vi.fn(() => false);
    vi.stubGlobal('confirm', confirmSpy);
    (document.querySelector('.wb-template-layouts') as HTMLElement).click();
    (document.querySelector('.wb-template-next') as HTMLElement).click();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(document.querySelector('.wb-template-modal')?.getAttribute('data-stage')).toBe('edit');
    // the dropped Status is still there — nothing was reseeded
    expect(document.querySelectorAll('[data-edit-item^="0:"]').length).toBe(2);
    vi.unstubAllGlobals();
  });

  it('selected layouts collect under a Recent group (newest first) for re-finding', () => {
    openTemplateModal(() => {});
    (document.querySelector('[data-wireframe="equal"]') as HTMLElement).click();
    (document.querySelector('.wb-lay-back') as HTMLElement).click();
    (document.querySelector('[data-wireframe="dashboard"]') as HTMLElement).click();
    (document.querySelector('.wb-lay-back') as HTMLElement).click();
    const recents = [...document.querySelectorAll<HTMLElement>('[data-wireframe-recent]')]
      .map((r) => r.dataset.wireframeRecent);
    expect(recents).toEqual(['dashboard', 'equal']);
    expect(document.querySelector('[data-laygroup="recent"]')?.textContent).toBe('Recent');
  });

  it('group heads fold and unfold their layouts', () => {
    openTemplateModal(() => {});
    const rowCount = (): number => document.querySelectorAll('.wb-lay-row').length;
    const all = rowCount();
    (document.querySelector('[data-laygroup="row"]') as HTMLElement).click();
    expect(rowCount()).toBeLessThan(all);
    (document.querySelector('[data-laygroup="row"]') as HTMLElement).click();
    expect(rowCount()).toBe(all);
  });

  it('Escape closes the modal (shared overlay teardown)', () => {
    openTemplateModal(() => {});
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.wb-template-modal')).toBeNull();
  });

  it('closing over touched work confirms first — refused keeps the builder open', () => {
    enterEditor();
    zone(0).dispatchEvent(fieldDrop('Status'));
    const confirmSpy = vi.fn(() => false);
    vi.stubGlobal('confirm', confirmSpy);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.wb-template-modal')).toBeTruthy();
    // accepted → it closes
    confirmSpy.mockReturnValue(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.wb-template-modal')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('an untouched editor closes without nagging (seeding is not touching)', () => {
    enterEditor();
    const confirmSpy = vi.fn(() => false);
    vi.stubGlobal('confirm', confirmSpy);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(document.querySelector('.wb-template-modal')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('a SECOND re-pick still confirms and keeps the whole undo trail (no silent wipe)', () => {
    enterEditor();
    zone(0).dispatchEvent(fieldDrop('Status')); // past=1
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmSpy);
    (document.querySelector('.wb-template-layouts') as HTMLElement).click();
    (document.querySelector('.wb-lay-back') as HTMLElement).click();
    (document.querySelector('[data-wireframe="equal"]') as HTMLElement).click();
    (document.querySelector('.wb-template-next') as HTMLElement).click(); // re-pick 1: confirms, undoable
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    (document.querySelector('.wb-template-layouts') as HTMLElement).click();
    (document.querySelector('.wb-lay-back') as HTMLElement).click();
    (document.querySelector('[data-wireframe="dashboard"]') as HTMLElement).click();
    (document.querySelector('.wb-template-next') as HTMLElement).click(); // re-pick 2: MUST still confirm
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    // the trail survived: undo is live, and the close gate is still armed
    expect((document.querySelector('.wb-template-undo') as HTMLButtonElement).disabled).toBe(false);
    confirmSpy.mockReturnValue(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(confirmSpy).toHaveBeenCalledTimes(3); // discard confirm fired
    expect(document.querySelector('.wb-template-modal')).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it('an accepted re-pick keeps its promise: one undo brings the replaced zones back', () => {
    enterEditor();
    zone(0).dispatchEvent(fieldDrop('Status'));
    vi.stubGlobal('confirm', vi.fn(() => true));
    (document.querySelector('.wb-template-layouts') as HTMLElement).click();
    (document.querySelector('.wb-lay-back') as HTMLElement).click();
    (document.querySelector('[data-wireframe="equal"]') as HTMLElement).click();
    (document.querySelector('.wb-template-next') as HTMLElement).click();
    expect(document.querySelectorAll('.wb-edit-zone').length).toBe(3); // Equal columns seeded
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
    expect(document.querySelectorAll('.wb-edit-zone').length).toBe(2); // lead-detail is back…
    expect(document.querySelectorAll('[data-edit-item^="0:"]').length).toBe(2); // …with the dropped Status
    vi.unstubAllGlobals();
  });

  it('Ctrl+Z is CONSUMED but inert in the selector — no modal drain, no app undo behind it', () => {
    enterEditor();
    zone(0).dispatchEvent(fieldDrop('Status'));
    (document.querySelector('.wb-template-layouts') as HTMLElement).click();
    const ev = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, cancelable: true });
    const unconsumed = document.dispatchEvent(ev);
    // consumed (preventDefault) so the APP's own Ctrl+Z handler can't mutate
    // the document behind the modal — but the modal stack must not move either
    expect(unconsumed).toBe(false);
    (document.querySelector('.wb-template-next') as HTMLElement).click(); // resume
    expect(document.querySelectorAll('[data-edit-item^="0:"]').length).toBe(2); // Status survived
    expect((document.querySelector('.wb-template-undo') as HTMLButtonElement).disabled).toBe(false);
  });

  it('undo across a re-pick re-aims the selector at the config Next actually opens', () => {
    enterEditor(); // lead-detail (row)
    zone(0).dispatchEvent(fieldDrop('Status'));
    vi.stubGlobal('confirm', vi.fn(() => true));
    (document.querySelector('.wb-template-layouts') as HTMLElement).click();
    (document.querySelector('.wb-lay-back') as HTMLElement).click();
    (document.querySelector('[data-wireframe="tile-stat"]') as HTMLElement).click();
    (document.querySelector('.wb-template-next') as HTMLElement).click(); // now a tile
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true })); // back to the edited row
    (document.querySelector('.wb-template-layouts') as HTMLElement).click();
    // the drill-in must describe the CURRENT config, not the stale tile pick
    expect(document.querySelector('.wb-lay-detail-name')?.textContent).toBe('Lead + details');
    expect(document.querySelector('.wb-lay-preview-kind')?.textContent).toBe('Row layout');
    (document.querySelector('.wb-template-next') as HTMLElement).click();
    expect(document.querySelectorAll('[data-edit-item^="0:"]').length).toBe(2); // edited row resumed
    vi.unstubAllGlobals();
  });

  it('a reopened sheet backed out to the list gets a Resume button home (no reseed, no confirm)', () => {
    enterEditor();
    (document.querySelector('.wb-template-apply') as HTMLButtonElement).click(); // sheet created
    openTemplateModal(() => {}); // reopen as zones (editingExisting)
    (document.querySelector('[data-edit-zone="1"]') as HTMLElement).click();
    (document.querySelector('[data-zoneflow="stack"]') as HTMLElement).click(); // a real tweak
    (document.querySelector('.wb-template-layouts') as HTMLElement).click();
    // no source wireframe → the list, with the footer offering Resume
    expect(document.querySelector('.wb-lay-list')).toBeTruthy();
    const next = document.querySelector('.wb-template-next') as HTMLButtonElement;
    expect(next.textContent).toBe('Resume');
    expect(next.disabled).toBe(false);
    const confirmSpy = vi.fn(() => false);
    vi.stubGlobal('confirm', confirmSpy);
    next.click();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(document.querySelector('.wb-template-modal')?.getAttribute('data-stage')).toBe('edit');
    expect(document.querySelector('[data-zoneflow="stack"]')?.classList.contains('wb-seg-on')).toBe(true); // tweak kept
    vi.unstubAllGlobals();
  });

  it('backing out of an edited layout shows the EDITED config in the details and preview', () => {
    enterEditor();
    zone(0).dispatchEvent(fieldDrop('Status')); // Lead zone now also holds Status
    (document.querySelector('.wb-template-layouts') as HTMLElement).click();
    const detail = document.querySelector('.wb-lay-detail') as HTMLElement;
    expect(detail.querySelector('.wb-lay-detail-resume')).toBeTruthy(); // says edits are in progress
    // …and the preview renders the kept config live
    expect(document.querySelectorAll('.wb-template-preview .wb-template-prow').length).toBeGreaterThanOrEqual(1);
  });

  it('undoing a re-pick back to a REOPENED config never labels it "Blank" — the list + Resume instead', () => {
    enterEditor();
    (document.querySelector('.wb-template-apply') as HTMLButtonElement).click(); // sheet created
    openTemplateModal(() => {}); // reopen as zones (configFromView stamps 'blank')
    vi.stubGlobal('confirm', vi.fn(() => true));
    (document.querySelector('.wb-template-layouts') as HTMLElement).click();
    (document.querySelector('[data-wireframe="equal"]') as HTMLElement).click();
    (document.querySelector('.wb-template-next') as HTMLElement).click(); // re-pick over the reopened sheet
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true })); // back to the reopened config
    (document.querySelector('.wb-template-layouts') as HTMLElement).click();
    // the 'blank' stamp is a placeholder, not a pedigree: no drilled "Blank"
    expect(document.querySelector('.wb-lay-detail')).toBeNull();
    const next = document.querySelector('.wb-template-next') as HTMLButtonElement;
    expect(next.textContent).toBe('Resume');
    next.click();
    // Resume returns the reopened config, zones intact
    const tags = [...document.querySelectorAll('.wb-edit-zone-tag')].map((t) => t.textContent);
    expect(tags.some((t) => t?.startsWith('Lead'))).toBe(true);
    vi.unstubAllGlobals();
  });

  it('explicitly re-picking the real Blank over a reopened sheet IS trusted — Back drills in, Next resumes', () => {
    enterEditor();
    (document.querySelector('.wb-template-apply') as HTMLButtonElement).click();
    openTemplateModal(() => {}); // reopened — stamped 'blank', but NOT picked
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmSpy);
    (document.querySelector('.wb-template-layouts') as HTMLElement).click();
    (document.querySelector('[data-wireframe="blank"]') as HTMLElement).click();
    (document.querySelector('.wb-template-next') as HTMLElement).click(); // a REAL Blank pick (confirms once)
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    zone(0).dispatchEvent(fieldDrop('Status')); // real work on the picked Blank
    (document.querySelector('.wb-template-layouts') as HTMLElement).click();
    // the pick gave 'blank' a pedigree: drilled details, not the plain list
    expect(document.querySelector('.wb-lay-detail-name')?.textContent).toBe('Blank');
    (document.querySelector('.wb-template-next') as HTMLElement).click();
    expect(confirmSpy).toHaveBeenCalledTimes(1); // RESUME — no destructive re-pick
    // Blank's seed fallback placed Title; the dropped Status rode along
    expect(document.querySelectorAll('[data-edit-item^="0:"]').length).toBe(2);
    expect([...document.querySelectorAll<HTMLElement>('[data-edit-item^="0:"]')]
      .some((n) => n.dataset.fieldName === 'Status')).toBe(true);
    vi.unstubAllGlobals();
  });

  it('a re-pick that installed a PRISTINE seed shows no "edits in progress" marker despite undo history', () => {
    enterEditor();
    zone(0).dispatchEvent(fieldDrop('Status'));
    vi.stubGlobal('confirm', vi.fn(() => true));
    (document.querySelector('.wb-template-layouts') as HTMLElement).click();
    (document.querySelector('.wb-lay-back') as HTMLElement).click();
    (document.querySelector('[data-wireframe="equal"]') as HTMLElement).click();
    (document.querySelector('.wb-template-next') as HTMLElement).click(); // undoable re-pick → past > 0
    (document.querySelector('.wb-template-layouts') as HTMLElement).click();
    // the current config IS a fresh 'equal' seed — history alone must not cry edits
    expect(document.querySelector('.wb-lay-detail-name')?.textContent).toBe('Equal columns');
    expect(document.querySelector('.wb-lay-detail-resume')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('a row→tile→row target round trip leaves no phantom "edits in progress" marker', () => {
    enterEditor(); // lead-detail, row
    (document.querySelector('[data-target="tile"]') as HTMLElement).click();
    (document.querySelector('[data-target="row"]') as HTMLElement).click(); // back — output-equivalent
    (document.querySelector('.wb-template-layouts') as HTMLElement).click();
    // the leftover tile box is inert for row output — not an edit
    expect(document.querySelector('.wb-lay-detail-resume')).toBeNull();
  });

  it('redo-only history still earns the re-pick confirm (undone work lives in future)', () => {
    enterEditor();
    zone(0).dispatchEvent(fieldDrop('Status'));
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmSpy);
    (document.querySelector('.wb-template-layouts') as HTMLElement).click();
    (document.querySelector('.wb-lay-back') as HTMLElement).click();
    (document.querySelector('[data-wireframe="equal"]') as HTMLElement).click();
    (document.querySelector('.wb-template-next') as HTMLElement).click(); // re-pick (confirm 1)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true })); // back to baseline — work now in future only
    (document.querySelector('.wb-template-layouts') as HTMLElement).click();
    (document.querySelector('.wb-lay-back') as HTMLElement).click();
    (document.querySelector('[data-wireframe="dashboard"]') as HTMLElement).click();
    (document.querySelector('.wb-template-next') as HTMLElement).click();
    expect(confirmSpy).toHaveBeenCalledTimes(2); // the redo-able work was at stake
    vi.unstubAllGlobals();
  });

  it('recents survive closing and reopening the modal within the session', () => {
    openTemplateModal(() => {});
    (document.querySelector('[data-wireframe="equal"]') as HTMLElement).click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.wb-template-modal')).toBeNull();
    openTemplateModal(() => {});
    expect(document.querySelector('[data-laygroup="recent"]')?.textContent).toBe('Recent');
    expect((document.querySelector('[data-wireframe-recent]') as HTMLElement).dataset.wireframeRecent).toBe('equal');
  });

  it('undoing back to the baseline disarms the close confirm', () => {
    enterEditor();
    zone(0).dispatchEvent(fieldDrop('Status'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
    const confirmSpy = vi.fn(() => false);
    vi.stubGlobal('confirm', confirmSpy);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(document.querySelector('.wb-template-modal')).toBeNull();
    vi.unstubAllGlobals();
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

  it('a divider click is inert — zone size changes only in the inspector', () => {
    enterEditor();
    const tag = (): string => (zone(0).querySelector('.wb-edit-zone-tag') as HTMLElement).textContent ?? '';
    expect(tag()).toContain('Fill 2×');   // Lead seeds wide
    (document.querySelector('.wb-edit-divider') as HTMLElement).click();
    expect(tag()).toContain('Fill 2×');   // no click-to-cycle: still wide
  });
});

describe('row view builder — the zone tree + name-first tags', () => {
  it('the tree leads with the standing ROOT row, then every zone with its items nested', () => {
    enterEditor();
    const labels = [...document.querySelectorAll('.wb-ztree-row .wb-ztree-label')].map((n) => n.textContent);
    expect(labels).toEqual(['Row layout', 'Lead', 'Title', 'Details', 'Status', 'Due']);
    (document.querySelector('[data-tree-zone="1"]') as HTMLElement).click();
    expect(document.querySelector('.wb-template-insp-title')?.textContent).toContain('Details zone');
    (document.querySelector('[data-tree-item="0:0"]') as HTMLElement).click();
    expect(document.querySelector('.wb-template-insp-title')?.textContent).toContain('Title');
  });

  it('the ROOT is a first-class selection: highlighted when nothing deeper is, and the tree row/canvas tag select it', () => {
    enterEditor();
    // nothing selected = the row itself: the root tree row shows selected
    const rootRow = document.querySelector('[data-tree-root]') as HTMLElement;
    expect(rootRow.classList.contains('wb-ztree-on')).toBe(true);
    expect(document.querySelector('.wb-template-insp-title')?.textContent).toBe('Row');
    expect((document.querySelector('.wb-template-prow--edit') as HTMLElement).classList.contains('wb-edit-root-on')).toBe(true);
    // select a zone → the root row un-highlights…
    (document.querySelector('[data-tree-zone="0"]') as HTMLElement).click();
    expect((document.querySelector('[data-tree-root]') as HTMLElement).classList.contains('wb-ztree-on')).toBe(false);
    // …and BOTH root affordances bring the row back: the tree row…
    (document.querySelector('[data-tree-root]') as HTMLElement).click();
    expect(document.querySelector('.wb-template-insp-title')?.textContent).toBe('Row');
    // …and the canvas tag pill
    (document.querySelector('[data-tree-zone="0"]') as HTMLElement).click();
    (document.querySelector('.wb-edit-root-tag') as HTMLElement).click();
    expect(document.querySelector('.wb-template-insp-title')?.textContent).toBe('Row');
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

describe('row view builder — alignment editing (two axes, root + zone)', () => {
  it('the row inspector aligns the zones against each other: vertical incl. Fill height, horizontal packing', () => {
    enterEditor();
    // nothing selected = the Row inspector; its pads carry icon buttons
    expect(document.querySelectorAll('[data-rootvalign]').length).toBe(5); // top/middle/bottom/baseline/stretch
    expect(document.querySelector('[data-rootvalign="middle"]')?.classList.contains('wb-seg-on')).toBe(true);
    (document.querySelector('[data-rootvalign="stretch"]') as HTMLElement).click();
    const root = document.querySelector('.wb-edit-rowroot') as HTMLElement;
    expect(root.style.alignItems).toBe('stretch');
    expect(root.dataset.rootValign).toBe('stretch');
    (document.querySelector('[data-rootalign="center"]') as HTMLElement).click();
    expect((document.querySelector('.wb-edit-rowroot') as HTMLElement).style.justifyContent).toBe('center');
  });

  it('a zone gets both axes: vertical drives align-items on the real canvas zone', () => {
    enterEditor();
    zone(0).click(); // Lead — a side-flow zone
    expect(document.querySelectorAll('[data-valign]').length).toBe(4); // + baseline on row flows
    (document.querySelector('[data-valign="top"]') as HTMLElement).click();
    expect(zone(0).style.alignItems).toBe('flex-start');
    expect(zone(0).dataset.zoneValign).toBe('top');
    (document.querySelector('[data-valign="baseline"]') as HTMLElement).click();
    expect(zone(0).style.alignItems).toBe('baseline');
  });

  it('a stack zone offers no baseline, and crossing the stack boundary resets the vertical axis', () => {
    enterEditor('avatar-card');
    (document.querySelector('[data-tree-zone="1"]') as HTMLElement).click(); // Main — stacked
    expect(document.querySelectorAll('[data-valign]').length).toBe(3); // no baseline on a column axis
    (document.querySelector('[data-valign="bottom"]') as HTMLElement).click();
    expect(zone(1).style.justifyContent).toBe('flex-end');
    // stack → side flips what "vertical" means → back to the flow default
    (document.querySelector('[data-zoneflow="side"]') as HTMLElement).click();
    expect(document.querySelector('[data-valign="middle"]')?.classList.contains('wb-seg-on')).toBe(true);
    expect(zone(1).style.alignItems).toBe('center');
  });

  it('hovering an Align control peeks: tags show the value, zones carry their guide stamp', () => {
    enterEditor();
    zone(0).click();
    const modal = document.querySelector('.wb-template-modal') as HTMLElement;
    const vSec = document.querySelector('[data-peek-section="valign"]') as HTMLElement;
    vSec.dispatchEvent(new Event('mouseenter'));
    expect(modal.dataset.peek).toBe('valign');
    expect((zone(0).querySelector('.wb-zt-valign') as HTMLElement).textContent).toBe('Middle');
    vSec.dispatchEvent(new Event('mouseleave'));
    expect(modal.dataset.peek).toBe('');
  });

  it('a tile places its content vertically only (no stretch/baseline, no horizontal packing)', () => {
    enterEditor('tile-headline');
    expect(document.querySelectorAll('[data-rootvalign]').length).toBe(3);
    expect(document.querySelector('[data-rootalign]')).toBeNull();
    (document.querySelector('[data-rootvalign="bottom"]') as HTMLElement).click();
    expect((document.querySelector('.wb-edit-rowroot') as HTMLElement).style.justifyContent).toBe('flex-end');
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

  it('undo/redo sit centered in the top bar; Cancel/Create in the footer, bottom-right', () => {
    enterEditor();
    // the topbar-center spot makers already know from the canvas
    const actions = document.querySelector('.wb-template-top .wb-template-actions') as HTMLElement;
    expect(actions.querySelector('.wb-template-undo')).toBeTruthy();
    expect(actions.querySelector('.wb-template-redo')).toBeTruthy();
    expect(actions.querySelector('.wb-template-cancel')).toBeNull();
    // the journey buttons live in the footer — the same spots Back/Next held
    const foot = document.querySelector('.wb-template-foot') as HTMLElement;
    expect(foot.querySelector('.wb-template-cancel')).toBeTruthy();
    // from the floor the commit button CREATES a new named view — say so
    expect(foot.querySelector('.wb-template-apply')?.textContent).toBe('Create');
  });

  it('editing an existing builder-made view keeps the commit button as Save', () => {
    enterEditor();
    (document.querySelector('.wb-template-apply') as HTMLButtonElement).click(); // view created
    openTemplateModal(() => {}); // reopens the sheet as zones — an edit, not a create
    expect(document.querySelector('.wb-template-apply')?.textContent).toBe('Save');
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

  it('Save from the floor calls state.createView once — a NEW named row view opens', () => {
    const spy = vi.spyOn(state, 'createView');
    enterEditor();
    (document.querySelector('.wb-template-apply') as HTMLButtonElement).click();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(state.doc.kind).toBe('row');
    expect(state.views).toHaveLength(1);
    expect(state.onFloor).toBe(false);
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

  it('a look-wearing column reopens as a FIELD item — its baked _component stamp never reads as a component drop', () => {
    // state.resetAll() leaves Status wearing a STAMPED look (a baked component
    // instance); lead-detail seeds Status into Details. The built cell embeds
    // the look clone (stamped _component AND _field) — on reopen the _field
    // column identity must win, or the rebuild-verify gate refuses the layout.
    reopenAfterApply();
    expect(document.querySelector('.wb-template-modal')?.getAttribute('data-stage')).toBe('edit');
    const statusItem = [...document.querySelectorAll<HTMLElement>('[data-edit-item]')]
      .find((el) => el.dataset.fieldName === 'Status');
    expect(statusItem).toBeTruthy();
    expect(document.querySelector('[data-component-id]')).toBeNull(); // no phantom component items
  });

  it('Save from the floor NEVER asks an overwrite confirm — it creates a second view instead', () => {
    enterEditor();
    (document.querySelector('.wb-template-apply') as HTMLButtonElement).click(); // view 1 created
    const firstId = state.activeViewId!;
    const firstJson = JSON.stringify(state.viewById(firstId)!.doc);
    state.minimizeView(); // "Back to grid" is navigation — the view waits intact
    openTemplateModal(() => {});
    (document.querySelector('[data-wireframe="equal"]') as HTMLElement).click();
    (document.querySelector('.wb-template-next') as HTMLElement).click();
    const confirmSpy = vi.fn(() => false);
    vi.stubGlobal('confirm', confirmSpy);
    (document.querySelector('.wb-template-apply') as HTMLButtonElement).click();
    expect(confirmSpy).not.toHaveBeenCalled(); // nothing is overwritten, nothing to confirm
    expect(state.views).toHaveLength(2);
    expect(JSON.stringify(state.viewById(firstId)!.doc)).toBe(firstJson); // view 1 untouched
    vi.unstubAllGlobals();
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

  it('Next onto a different layout over a reopened one confirms first (real work is at stake)', () => {
    const confirmSpy = vi.fn(() => false); // maker says no
    vi.stubGlobal('confirm', confirmSpy);
    reopenAfterApply();
    (document.querySelector('.wb-template-layouts') as HTMLElement).click();
    // a reopened layout has no source wireframe → the selector opens on the list
    expect(document.querySelector('.wb-lay-list')).toBeTruthy();
    (document.querySelector('[data-wireframe="equal"]') as HTMLElement).click();
    expect(confirmSpy).not.toHaveBeenCalled(); // selecting is browsing, not committing
    (document.querySelector('.wb-template-next') as HTMLElement).click();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    // refused → still on the selector, reopened config untouched
    expect(document.querySelector('.wb-template-modal')?.getAttribute('data-stage')).toBe('pick');
    vi.unstubAllGlobals();
  });

  it('a hand-built row view falls back to the gallery with an honest note', () => {
    state.createView({ kind: 'row', root: { elmType: 'div', style: { 'display': 'flex' },
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

describe('tile target — the builder works for tiles too', () => {
  it('the gallery groups Row and Tile layouts (rows lead from a grid landing)', () => {
    openTemplateModal(() => {});
    const heads = [...document.querySelectorAll('.wb-template-gallery-head')].map((h) => h.textContent);
    expect(heads).toEqual(['Row layouts', 'Tile layouts']);
    expect(document.querySelector('[data-wireframe="tile-headline"]')).toBeTruthy();
  });

  it('both targets share the one selector — a tile picks through the same list', () => {
    openTemplateModal(() => {}, { createNew: true });
    (document.querySelector('[data-wireframe="tile-headline"]') as HTMLElement).click();
    expect(document.querySelector('.wb-lay-detail-kind')?.textContent).toBe('Tile');
    (document.querySelector('.wb-template-next') as HTMLElement).click();
    expect(document.querySelector('.wb-template-insp-title')?.textContent).toBe('Tile');
  });

  it('picking a tile wireframe enters the TILE editor: Tile inspector, size knobs, no width scrubber', () => {
    enterEditor('tile-headline');
    expect(document.querySelector('.wb-template-insp-title')?.textContent).toBe('Tile');
    expect(document.querySelector('input[data-tile="width"]')).toBeTruthy();
    expect(document.querySelector('input[data-tile="height"]')).toBeTruthy();
    expect(document.querySelector('[data-stagewidth="narrow"]')).toBeNull();
    expect(document.querySelector('.wb-template-widthhandle')).toBeNull();
  });

  it('zebra greys with the tile reason; the kebab section teaches instead of configuring', () => {
    enterEditor('tile-headline');
    const zebra = document.querySelector('[data-toggle="zebra"]') as HTMLElement;
    expect(zebra.classList.contains('wb-disabled')).toBe(true);
    expect(zebra.title).toContain('tiles sit in a grid');
    expect(document.querySelector('[data-toggle="kebab"]')).toBeNull();
    expect(document.querySelector('.wb-template-kebab-tilenote')?.textContent).toContain('row-layout feature');
  });

  it('the preview shows the edit tile and a live tile deck at the configured box', () => {
    enterEditor('tile-headline');
    const edit = document.querySelector('.wb-template-prow--edit.wb-template-ptile') as HTMLElement;
    expect(edit).toBeTruthy();
    expect(edit.style.width).toBe('254px');
    expect(document.querySelector('.wb-template-tiledeck')).toBeTruthy();
    expect(document.querySelectorAll('.wb-template-tiledeck .wb-template-ptile').length).toBeGreaterThanOrEqual(1);
  });

  it('the tile size knobs resize the preview; nonsense snaps back', () => {
    enterEditor('tile-headline');
    const width = document.querySelector('input[data-tile="width"]') as HTMLInputElement;
    width.value = '320';
    width.dispatchEvent(new Event('change'));
    const edit = document.querySelector('.wb-template-prow--edit.wb-template-ptile') as HTMLElement;
    expect(edit.style.width).toBe('320px');
    const w2 = document.querySelector('input[data-tile="width"]') as HTMLInputElement;
    w2.value = '7';
    w2.dispatchEvent(new Event('change'));
    expect(w2.value).toBe('320'); // refused, snapped back
  });

  it('Save from the floor creates a TILE view — kind, root and tile box land together', () => {
    const spy = vi.spyOn(state, 'createView');
    enterEditor('tile-headline');
    (document.querySelector('.wb-template-apply') as HTMLButtonElement).click();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(state.doc.kind).toBe('tile');
    expect(state.doc.tileWidth).toBe(254);
    expect(state.doc.root._elmName).toBe('Tile layout');
    spy.mockRestore();
  });

  it('reopening a builder-made tile lands in the TILE editor with zones intact', () => {
    enterEditor('tile-headline');
    (document.querySelector('.wb-template-apply') as HTMLButtonElement).click();
    openTemplateModal(() => {});
    expect(document.querySelector('.wb-template-modal')?.getAttribute('data-stage')).toBe('edit');
    expect(document.querySelector('.wb-template-insp-title')?.textContent).toBe('Tile');
    const tags = [...document.querySelectorAll('.wb-edit-zone-tag')].map((t) => t.textContent);
    expect(tags.some((t) => t?.startsWith('Headline'))).toBe(true);
  });

  it('a reopened tile remembers a custom tile box from the document', () => {
    enterEditor('tile-headline');
    const width = document.querySelector('input[data-tile="width"]') as HTMLInputElement;
    width.value = '400';
    width.dispatchEvent(new Event('change'));
    (document.querySelector('.wb-template-apply') as HTMLButtonElement).click();
    expect(state.doc.tileWidth).toBe(400);
    openTemplateModal(() => {});
    expect((document.querySelector('input[data-tile="width"]') as HTMLInputElement).value).toBe('400');
  });

  it('“Applies as” re-targets the same zones between row and tile', () => {
    enterEditor(); // lead-detail, a ROW layout
    (document.querySelector('[data-target="tile"]') as HTMLElement).click();
    expect(document.querySelector('.wb-template-insp-title')?.textContent).toBe('Tile');
    expect(document.querySelectorAll('.wb-edit-zone').length).toBe(2); // zones carried over
    (document.querySelector('.wb-template-apply') as HTMLButtonElement).click();
    expect(state.doc.kind).toBe('tile');
  });

  it('a hand-built tile falls back to the gallery, tiles first, with the honest note', () => {
    state.createView({ kind: 'tile', root: { elmType: 'div', style: { 'display': 'flex' },
      children: [{ elmType: 'div', txtContent: '=[$Title]+[$Status]' }] }, tileWidth: 254, tileHeight: 220 });
    openTemplateModal(() => {});
    expect(document.querySelector('.wb-template-modal')?.getAttribute('data-stage')).toBe('pick');
    expect(document.querySelector('.wb-template-foreign-note')?.textContent).toContain('outside this builder');
    expect(document.querySelector('.wb-template-gallery-head')?.textContent).toBe('Tile layouts');
  });

  it('“＋ New view” over an open builder-made sheet opens the selector and CREATES a second view', () => {
    enterEditor();
    (document.querySelector('.wb-template-apply') as HTMLButtonElement).click(); // sheet 1
    openTemplateModal(() => {}, { createNew: true });
    expect(document.querySelector('.wb-template-modal')?.getAttribute('data-stage')).toBe('pick');
    expect(document.querySelector('.wb-template-foreign-note')).toBeNull(); // creating: the sheet is not at stake
    (document.querySelector('[data-wireframe="tile-headline"]') as HTMLElement).click();
    (document.querySelector('.wb-template-next') as HTMLElement).click();
    (document.querySelector('.wb-template-apply') as HTMLButtonElement).click();
    expect(state.views).toHaveLength(2);
    expect(state.doc.kind).toBe('tile');
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
