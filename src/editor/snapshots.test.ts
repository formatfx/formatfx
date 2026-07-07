/**
 * snapshots.ts is the store contract (issue #140): scope partitioning,
 * per-scope caps with oldest-first eviction, corrupt-store tolerance — and
 * the LOAD GUARD that drops old-shape captures instead of migrating them:
 * the retired 'view' scope, the pre-Stage-1 doc-shaped 'all' payload, and
 * the pre-model-B 'all' carrying `columnRefs` instead of `columnLooks`.
 * The state integration tests below are the RESTORE contract: every apply is
 * ONE undoable step, including "restore everything" (floor + sheets + column
 * looks together), a column restore re-embeds the floor cell (the grid never
 * goes stale), and capture always deep-copies (no aliasing into the live
 * documents).
 * The nav-back tests pin the "how did I get here" trail semantics.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadStore, serializeStore, addSnapshot, removeSnapshot, snapshotsFor,
  scopeKeyOf, snapshotId, defaultLabel, relativeTime, CAP,
  type Snapshot, type SnapshotStore,
} from './snapshots';
import { state } from './state';

const at = (minute: number): Date => new Date(Date.UTC(2026, 6, 2, 12, minute, 0));

function snap(scopeKind: 'all', minute: number): Snapshot;
function snap(scopeKind: 'column', minute: number, field: string): Snapshot;
function snap(scopeKind: 'column' | 'all', minute: number, field?: string): Snapshot {
  const scope = scopeKind === 'column' ? { kind: 'column' as const, field: field! } : { kind: scopeKind };
  return {
    id: snapshotId(at(minute)),
    takenAt: at(minute).toISOString(),
    label: 'test',
    scope,
    payload: scopeKind === 'column'
      ? { root: { elmType: 'div' } }
      : { all: { floor: { kind: 'grid', root: { elmType: 'div' } }, views: [], columnLooks: {} } },
  };
}

describe('snapshot store (pure)', () => {
  it('round-trips through serialize/load and tolerates corrupt input', () => {
    let store: SnapshotStore = loadStore(null);
    store = addSnapshot(store, snap('all', 1));
    const reloaded = loadStore(serializeStore(store));
    expect(reloaded.snapshots).toHaveLength(1);
    // corrupt / foreign / missing raw → a fresh store, never a throw
    expect(loadStore('{nope').snapshots).toEqual([]);
    expect(loadStore('{"version":9,"snapshots":"x"}').snapshots).toEqual([]);
    expect(loadStore('[]').snapshots).toEqual([]);
    // malformed entries are dropped, valid ones kept
    const mixed = JSON.stringify({ version: 1, snapshots: [reloaded.snapshots[0], { junk: true }, null] });
    expect(loadStore(mixed).snapshots).toHaveLength(1);
  });

  it('drops entries whose scope is not one we write (unknown kind, fieldless column, retired view)', () => {
    const good = snap('all', 1);
    const bad = (scope: unknown): unknown => ({ ...snap('all', 2), scope });
    const raw = JSON.stringify({
      version: 1,
      snapshots: [
        good,
        bad({ kind: 'universe' }), bad({ kind: 'column' }), bad({ kind: 'column', field: '' }), bad('all'),
        bad({ kind: 'view' }), // the retired pre-Stage-1 main-document scope
      ],
    });
    // an unknown kind must never survive to applySnapshot (it would read as 'all')
    expect(loadStore(raw).snapshots).toHaveLength(1);
  });

  it('drops old payload shapes — a load guard, not a converter', () => {
    const legacyAll = {
      ...snap('all', 3),
      // the pre-Stage-1 workspace shape: one main document + a view name
      payload: { all: { doc: { kind: 'grid', root: { elmType: 'div' } }, columnRefs: {}, viewName: 'V' } },
    };
    const legacyColumn = { ...snap('column', 4, 'Status'), payload: {} };
    const raw = JSON.stringify({ version: 1, snapshots: [snap('all', 1), legacyAll, legacyColumn] });
    expect(loadStore(raw).snapshots).toHaveLength(1);
  });

  it('drops a pre-model-B "all" carrying columnRefs instead of columnLooks', () => {
    const preModelB = {
      ...snap('all', 5),
      // shaped like today's payload EXCEPT the store key: the § era's registry
      payload: { all: { floor: { kind: 'grid', root: { elmType: 'div' } }, views: [], columnRefs: {} } },
    };
    const raw = JSON.stringify({ version: 1, snapshots: [snap('all', 1), preModelB] });
    const kept = loadStore(raw).snapshots;
    expect(kept).toHaveLength(1);
    expect(kept[0].payload.all?.columnLooks).toEqual({});
  });

  it('partitions by scope key and lists newest-first', () => {
    let store = loadStore(null);
    store = addSnapshot(store, snap('all', 1));
    store = addSnapshot(store, snap('column', 2, 'Status'));
    store = addSnapshot(store, snap('column', 3, 'Progress'));
    store = addSnapshot(store, snap('all', 4));
    expect(scopeKeyOf({ kind: 'column', field: 'Status' })).toBe('col:Status');
    expect(snapshotsFor(store, { kind: 'all' }).map((s) => s.takenAt))
      .toEqual([at(4).toISOString(), at(1).toISOString()]);
    expect(snapshotsFor(store, { kind: 'column', field: 'Status' })).toHaveLength(1);
  });

  it('caps per scope, evicting that scope\'s oldest only', () => {
    let store = loadStore(null);
    store = addSnapshot(store, snap('column', 0, 'Status')); // other scope — must survive
    for (let m = 1; m <= CAP + 2; m++) store = addSnapshot(store, snap('all', m));
    const all = snapshotsFor(store, { kind: 'all' });
    expect(all).toHaveLength(CAP);
    // the two oldest 'all' snapshots (minutes 1, 2) were evicted
    expect(all[all.length - 1].takenAt).toBe(at(3).toISOString());
    expect(snapshotsFor(store, { kind: 'column', field: 'Status' })).toHaveLength(1);
  });

  it('removes by id; labels and relative times read sensibly', () => {
    let store = loadStore(null);
    const s = snap('all', 1);
    store = addSnapshot(store, s);
    expect(removeSnapshot(store, s.id).snapshots).toEqual([]);
    expect(defaultLabel({ kind: 'column', field: 'Status' }, 0)).toBe('Status column');
    expect(defaultLabel({ kind: 'all' }, 0)).toBe('Grid + column looks');
    expect(defaultLabel({ kind: 'all' }, 1)).toBe('Grid + 1 view + column looks');
    expect(defaultLabel({ kind: 'all' }, 3)).toBe('Grid + 3 views + column looks');
    expect(relativeTime(at(0).toISOString(), at(0))).toBe('just now');
    expect(relativeTime(at(0).toISOString(), at(5))).toBe('5m ago');
    expect(relativeTime('garbage', at(5))).toBe('');
  });
});

describe('state snapshot capture/apply (one undoable step)', () => {
  beforeEach(() => state.resetAll());

  it('captures a column-look deep-copy and restores it as one Ctrl+Z step', () => {
    const taken = state.captureSnapshot({ kind: 'column', field: 'Status' })!;
    expect(taken.payload.root?._elmName).toBe('Status pill');
    // deep copy: mutating the live look store must not touch the snapshot
    state.mutateDocument(() => { state.columnLooks['Status'].txtContent = 'CHANGED'; });
    expect(taken.payload.root?.txtContent).not.toBe('CHANGED');
    // restore over the change, then a single undo brings the change back
    expect(state.applySnapshot(taken)).toBe(true);
    expect(state.columnLooks['Status'].txtContent).toBe(taken.payload.root?.txtContent);
    state.undo();
    expect(state.columnLooks['Status'].txtContent).toBe('CHANGED');
  });

  it('a column restore re-embeds the floor cell — the grid never goes stale', () => {
    const taken = state.captureSnapshot({ kind: 'column', field: 'Status' })!;
    state.removeColumnLook('Status'); // undressed: plain-value cell on the floor
    expect(state.floorDoc.root.children![1]._component).toBeUndefined();
    expect(state.applySnapshot(taken)).toBe(true);
    // look AND cell came back together
    expect(state.columnLooks['Status']._component?.id).toBe('palette-status-pill');
    const cell = state.floorDoc.root.children![1];
    expect(cell._component?.id).toBe('palette-status-pill');
    expect(cell._field).toBe('Status');
    expect(cell.txtContent).toBe(taken.payload.root?.txtContent);
  });

  it('capture is read-only — "everything" mutates nothing, yet holds the live looks', () => {
    const before = JSON.stringify({ doc: state.doc, looks: state.columnLooks });
    const taken = state.captureSnapshot({ kind: 'all' })!;
    expect(JSON.stringify({ doc: state.doc, looks: state.columnLooks })).toBe(before);
    expect(state.canUndo).toBe(false);
    expect(taken.payload.all?.columnLooks['Status']._elmName).toBe('Status pill');
  });

  it('prototype members never read as look-wearing columns (own-key checks)', () => {
    // 'toString' is inherited on every object — `in` would say it exists
    expect(state.captureSnapshot({ kind: 'column', field: 'toString' })).toBeNull();
  });

  it('"everything" captures the floor AND every sheet, deep-copied', () => {
    const sheet = state.createView({ kind: 'row', root: { elmType: 'div', _elmName: 'live' } }, 'Board')!;
    const taken = state.captureSnapshot({ kind: 'all' })!;
    expect(taken.payload.all?.floor.kind).toBe('grid');
    expect(taken.payload.all?.views).toHaveLength(1);
    expect(taken.payload.all?.views[0].name).toBe('Board');
    sheet.doc.root._elmName = 'mutated after capture';
    expect(taken.payload.all?.views[0].doc.root._elmName).toBe('live'); // deep copy
  });

  it('"everything": restores floor + sheets + looks as ONE undo step', () => {
    state.createView({ kind: 'row', root: { elmType: 'div', _elmName: 'keep-me' } }, 'Board');
    state.minimizeView();
    const taken = state.captureSnapshot({ kind: 'all' })!;
    // mutate all three: the floor, the sheet list, a column look
    state.mutateDocument(() => {
      state.floorDoc.root.children?.pop();
      state.columnLooks['Status'].txtContent = 'MUTATED';
    });
    state.createView({ kind: 'tile', root: { elmType: 'div' } }, 'Extra');
    expect(state.views).toHaveLength(2);

    expect(state.applySnapshot(taken)).toBe(true);
    expect(state.views).toHaveLength(1);
    expect(state.views[0].name).toBe('Board');
    expect(state.columnLooks['Status'].txtContent).toBe("=if([$Status]=='','None',[$Status])");
    expect(state.onFloor).toBe(true); // the sheet we stood on isn't in the capture → floor

    state.undo(); // ONE undo reverts the whole restore
    expect(state.views).toHaveLength(2);
    expect(state.columnLooks['Status'].txtContent).toBe('MUTATED');
  });

  it('column scope on a look-less column: capture refuses, apply registers', () => {
    expect(state.captureSnapshot({ kind: 'column', field: 'Tags' })).toBeNull();
    const foreign: ReturnType<typeof state.captureSnapshot> = {
      id: 'x', takenAt: new Date().toISOString(), label: 'Tags column',
      scope: { kind: 'column', field: 'Tags' },
      payload: { root: { elmType: 'div', txtContent: '[$Tags]' } },
    };
    expect(state.applySnapshot(foreign!)).toBe(true);
    expect(state.columnLooks['Tags']?.txtContent).toBe('[$Tags]');
    state.undo(); // one step removes the registration again
    expect(state.columnLooks['Tags']).toBeUndefined();
  });

  it('refuses a scope/payload mismatch without touching anything', () => {
    const bad: ReturnType<typeof state.captureSnapshot> = {
      id: 'y', takenAt: new Date().toISOString(), label: 'broken',
      scope: { kind: 'all' }, payload: {},
    };
    const before = JSON.stringify(state.doc);
    expect(state.applySnapshot(bad!)).toBe(false);
    expect(JSON.stringify(state.doc)).toBe(before);
    expect(state.canUndo).toBe(false);
  });
});

describe('navigation back (the "how did I get here" trail — not undo)', () => {
  beforeEach(() => state.resetAll());

  it('starts with nowhere to go and retraces sheet trips', () => {
    expect(state.backTarget).toBeNull();
    expect(state.goBack()).toBeNull();
    const sheet = state.createView({ kind: 'row', root: { elmType: 'div' } })!;
    state.minimizeView();
    expect(state.backTarget).toBe('main');
    expect(state.goBack()).toBe('main'); // back onto the sheet
    expect(state.activeViewId).toBe(sheet.id);
    expect(state.goBack()).toBe('main'); // back to the floor (pre-create)
    expect(state.onFloor).toBe(true);
    expect(state.goBack()).toBeNull();
  });

  it('going back does not push new history (no ping-pong)', () => {
    const sheet = state.createView({ kind: 'row', root: { elmType: 'div' } })!;
    state.minimizeView();
    state.openView(sheet.id);
    // trail: floor → sheet → floor → sheet; each goBack CONSUMES an entry
    expect(state.goBack()).toBe('main');
    expect(state.onFloor).toBe(true);
    expect(state.goBack()).toBe('main');
    expect(state.activeViewId).toBe(sheet.id);
    expect(state.goBack()).toBe('main');
    expect(state.onFloor).toBe(true);
    expect(state.goBack()).toBeNull();
  });

  it('skips entries whose sheet has been removed since', () => {
    const sheet = state.createView({ kind: 'row', root: { elmType: 'div' } })!;
    state.minimizeView();
    expect(state.backTarget).toBe('main'); // would land on the sheet
    state.views.splice(state.views.findIndex((v) => v.id === sheet.id), 1);
    // the sheet entry is dead; the floor entry equals where we stand — nothing left
    expect(state.backTarget).toBeNull();
  });

  it('a fresh project clears the trail', () => {
    state.createView({ kind: 'row', root: { elmType: 'div' } });
    state.minimizeView();
    state.resetAll();
    expect(state.backTarget).toBeNull();
  });
});
