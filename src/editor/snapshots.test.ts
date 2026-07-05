/**
 * snapshots.ts is the store contract (issue #140): scope partitioning,
 * per-scope caps with oldest-first eviction, corrupt-store tolerance — and,
 * since FLOOR-AND-SHEETS Stage 1, the LOAD GUARD that drops pre-Stage-1
 * captures (the retired 'view' scope, the old doc-shaped 'all' payload)
 * instead of migrating them.
 * The state integration tests below are the RESTORE contract: every apply is
 * ONE undoable step, including "restore everything" (floor + sheets +
 * registry together), and capture always deep-copies (no aliasing into the
 * live documents).
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
      : { all: { floor: { kind: 'grid', root: { elmType: 'div' } }, views: [], columnRefs: {} } },
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

  it('drops pre-Stage-1 payload shapes — a load guard, not a converter', () => {
    const legacyAll = {
      ...snap('all', 3),
      // the old workspace shape: one main document + a workspace-level view name
      payload: { all: { doc: { kind: 'grid', root: { elmType: 'div' } }, columnRefs: {}, viewName: 'V' } },
    };
    const legacyColumn = { ...snap('column', 4, 'Status'), payload: {} };
    const raw = JSON.stringify({ version: 1, snapshots: [snap('all', 1), legacyAll, legacyColumn] });
    expect(loadStore(raw).snapshots).toHaveLength(1);
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
    expect(defaultLabel({ kind: 'all' }, 0)).toBe('Grid + column formatters');
    expect(defaultLabel({ kind: 'all' }, 1)).toBe('Grid + 1 view + column formatters');
    expect(defaultLabel({ kind: 'all' }, 3)).toBe('Grid + 3 views + column formatters');
    expect(relativeTime(at(0).toISOString(), at(0))).toBe('just now');
    expect(relativeTime(at(0).toISOString(), at(5))).toBe('5m ago');
    expect(relativeTime('garbage', at(5))).toBe('');
  });
});

describe('state snapshot capture/apply (one undoable step)', () => {
  beforeEach(() => state.resetAll());

  it('captures a column deep-copy and restores it as one Ctrl+Z step', () => {
    const taken = state.captureSnapshot({ kind: 'column', field: 'Status' })!;
    expect(taken.payload.root?._elmName).toBe('Status pill');
    // deep copy: mutating the live registry must not touch the snapshot
    state.mutateDocument(() => { state.columnRefs['Status'].txtContent = 'CHANGED'; });
    expect(taken.payload.root?.txtContent).not.toBe('CHANGED');
    // restore over the change, then a single undo brings the change back
    expect(state.applySnapshot(taken)).toBe(true);
    expect(state.columnRefs['Status'].txtContent).toBe(taken.payload.root?.txtContent);
    state.undo();
    expect(state.columnRefs['Status'].txtContent).toBe('CHANGED');
  });

  it('captures the open column\'s LIVE tree (edits included)', () => {
    state.openColumnRef('Status');
    state.mutateDocument(() => { state.doc.root.txtContent = 'LIVE'; });
    const taken = state.captureSnapshot({ kind: 'column', field: 'Status' })!;
    expect(taken.payload.root?.txtContent).toBe('LIVE');
  });

  it('capture is read-only — "everything" while drilled mutates nothing, yet holds the live tree', () => {
    state.openColumnRef('Status');
    const before = JSON.stringify({ doc: state.doc, refs: state.columnRefs });
    const taken = state.captureSnapshot({ kind: 'all' })!;
    expect(JSON.stringify({ doc: state.doc, refs: state.columnRefs })).toBe(before);
    expect(state.canUndo).toBe(false);
    // …and the payload still carries the open column's live tree
    expect(taken.payload.all?.columnRefs['Status']._elmName).toBe('Status pill');
  });

  it('prototype members never read as registered columns (own-key checks)', () => {
    // 'toString' is inherited on every object — `in` would say it exists
    state.openColumnRef('toString');
    expect(state.activeDocKey).toBe('main');
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

  it('"everything": restores floor + sheets + registry as ONE undo step', () => {
    state.createView({ kind: 'row', root: { elmType: 'div', _elmName: 'keep-me' } }, 'Board');
    state.minimizeView();
    const taken = state.captureSnapshot({ kind: 'all' })!;
    // mutate all three: the floor, the sheet list, a column formatter
    state.mutateDocument(() => {
      state.floorDoc.root.children?.pop();
      state.columnRefs['Status'].txtContent = 'MUTATED';
    });
    state.createView({ kind: 'tile', root: { elmType: 'div' } }, 'Extra');
    expect(state.views).toHaveLength(2);

    expect(state.applySnapshot(taken)).toBe(true);
    expect(state.views).toHaveLength(1);
    expect(state.views[0].name).toBe('Board');
    expect(state.columnRefs['Status'].txtContent).toBe("=if([$Status]=='','None',[$Status])");
    expect(state.onFloor).toBe(true); // the sheet we stood on isn't in the capture → floor

    state.undo(); // ONE undo reverts the whole restore
    expect(state.views).toHaveLength(2);
    expect(state.columnRefs['Status'].txtContent).toBe('MUTATED');
  });

  it('restoring "everything" from a drilled column leaves the drill first (navigation, not mutation)', () => {
    const taken = state.captureSnapshot({ kind: 'all' })!;
    state.openColumnRef('Status');
    expect(state.applySnapshot(taken)).toBe(true);
    expect(state.activeDocKey).toBe('main');
  });

  it('column scope on an unregistered column: capture refuses, apply registers', () => {
    expect(state.captureSnapshot({ kind: 'column', field: 'Tags' })).toBeNull();
    const foreign: ReturnType<typeof state.captureSnapshot> = {
      id: 'x', takenAt: new Date().toISOString(), label: 'Tags column',
      scope: { kind: 'column', field: 'Tags' },
      payload: { root: { elmType: 'div', txtContent: '[$Tags]' } },
    };
    expect(state.applySnapshot(foreign!)).toBe(true);
    expect(state.columnRefs['Tags']?.txtContent).toBe('[$Tags]');
    state.undo(); // one step removes the registration again
    expect(state.columnRefs['Tags']).toBeUndefined();
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

  it('starts with nowhere to go, tracks doc switches, and retraces them', () => {
    expect(state.backTarget).toBeNull();
    state.openColumnRef('Status');
    expect(state.backTarget).toBe('main');
    state.openColumnRef('Progress'); // direct column→column switch
    expect(state.backTarget).toBe('Status');
    expect(state.goBack()).toBe('Status');
    expect(state.activeDocKey).toBe('Status');
    expect(state.goBack()).toBe('main');
    expect(state.activeDocKey).toBe('main');
    expect(state.backTarget).toBeNull();
    expect(state.goBack()).toBeNull();
  });

  it('going back does not push new history (no ping-pong)', () => {
    state.openColumnRef('Status');
    state.openMain();
    // trail: main → Status → main; back lands on Status, then main, then ends
    expect(state.goBack()).toBe('Status');
    expect(state.goBack()).toBe('main');
    expect(state.goBack()).toBeNull();
  });

  it('retraces surface switches too — a sheet trip and back', () => {
    const sheet = state.createView({ kind: 'row', root: { elmType: 'div' } })!;
    state.minimizeView();
    expect(state.goBack()).toBe('main'); // back onto the sheet
    expect(state.activeViewId).toBe(sheet.id);
    expect(state.goBack()).toBe('main'); // back to the floor (pre-create)
    expect(state.onFloor).toBe(true);
  });

  it('skips column keys that have been unregistered since', () => {
    state.openColumnRef('Status');
    state.openMain();
    delete state.columnRefs['Status'];
    expect(state.backTarget).toBeNull(); // Status is gone, main is current
  });

  it('a fresh project clears the trail', () => {
    state.openColumnRef('Status');
    state.resetAll();
    expect(state.backTarget).toBeNull();
  });
});
