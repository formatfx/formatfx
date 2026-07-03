/**
 * snapshots.ts is the store contract (issue #140): scope partitioning,
 * per-scope caps with oldest-first eviction, corrupt-store tolerance.
 * The state integration tests below are the RESTORE contract: every apply is
 * ONE undoable step, including "restore everything" (doc + registry together),
 * and capture always deep-copies (no aliasing into the live document).
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

function snap(scopeKind: 'view' | 'all', minute: number): Snapshot;
function snap(scopeKind: 'column', minute: number, field: string): Snapshot;
function snap(scopeKind: 'view' | 'column' | 'all', minute: number, field?: string): Snapshot {
  const scope = scopeKind === 'column' ? { kind: 'column' as const, field: field! } : { kind: scopeKind };
  return {
    id: snapshotId(at(minute)),
    takenAt: at(minute).toISOString(),
    label: 'test',
    scope,
    payload: scopeKind === 'column' ? { root: { elmType: 'div' } } : scopeKind === 'view'
      ? { doc: { kind: 'grid', root: { elmType: 'div' } } }
      : { all: { doc: { kind: 'grid', root: { elmType: 'div' } }, columnRefs: {}, viewName: 'V' } },
  };
}

describe('snapshot store (pure)', () => {
  it('round-trips through serialize/load and tolerates corrupt input', () => {
    let store: SnapshotStore = loadStore(null);
    store = addSnapshot(store, snap('view', 1));
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

  it('drops entries whose scope is not one we write (unknown kind, fieldless column)', () => {
    const good = snap('view', 1);
    const bad = (scope: unknown): unknown => ({ ...snap('view', 2), scope });
    const raw = JSON.stringify({
      version: 1,
      snapshots: [good, bad({ kind: 'universe' }), bad({ kind: 'column' }), bad({ kind: 'column', field: '' }), bad('view')],
    });
    // an unknown kind must never survive to applySnapshot (it would read as 'all')
    expect(loadStore(raw).snapshots).toHaveLength(1);
  });

  it('partitions by scope key and lists newest-first', () => {
    let store = loadStore(null);
    store = addSnapshot(store, snap('view', 1));
    store = addSnapshot(store, snap('column', 2, 'Status'));
    store = addSnapshot(store, snap('column', 3, 'Progress'));
    store = addSnapshot(store, snap('view', 4));
    store = addSnapshot(store, snap('all', 5));
    expect(scopeKeyOf({ kind: 'column', field: 'Status' })).toBe('col:Status');
    expect(snapshotsFor(store, { kind: 'view' }).map((s) => s.takenAt))
      .toEqual([at(4).toISOString(), at(1).toISOString()]);
    expect(snapshotsFor(store, { kind: 'column', field: 'Status' })).toHaveLength(1);
    expect(snapshotsFor(store, { kind: 'all' })).toHaveLength(1);
  });

  it('caps per scope, evicting that scope\'s oldest only', () => {
    let store = loadStore(null);
    store = addSnapshot(store, snap('column', 0, 'Status')); // other scope — must survive
    for (let m = 1; m <= CAP + 2; m++) store = addSnapshot(store, snap('view', m));
    const views = snapshotsFor(store, { kind: 'view' });
    expect(views).toHaveLength(CAP);
    // the two oldest view snapshots (minutes 1, 2) were evicted
    expect(views[views.length - 1].takenAt).toBe(at(3).toISOString());
    expect(snapshotsFor(store, { kind: 'column', field: 'Status' })).toHaveLength(1);
  });

  it('removes by id; labels and relative times read sensibly', () => {
    let store = loadStore(null);
    const s = snap('view', 1);
    store = addSnapshot(store, s);
    expect(removeSnapshot(store, s.id).snapshots).toEqual([]);
    expect(defaultLabel({ kind: 'view' }, 'View 1', 'grid')).toBe('View 1 — grid view');
    expect(defaultLabel({ kind: 'column', field: 'Status' }, 'View 1', 'grid')).toBe('Status column');
    expect(defaultLabel({ kind: 'all' }, 'View 1', 'grid')).toBe('View 1 + column formatters');
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

  it('captures the view while drilled into a column (stash-aware)', () => {
    const gridKids = state.doc.root.children?.length ?? 0;
    state.openColumnRef('Status');
    const taken = state.captureSnapshot({ kind: 'view' })!;
    expect(taken.payload.doc?.kind).toBe('grid');
    expect(taken.payload.doc?.root.children?.length).toBe(gridKids);
  });

  it('restores a view snapshot from a drilled column, one undo step', () => {
    const taken = state.captureSnapshot({ kind: 'view' })!;
    state.mutateDocument(() => { state.doc.root.children?.pop(); });
    const mutatedCount = state.doc.root.children?.length ?? 0;
    state.openColumnRef('Status');
    expect(state.applySnapshot(taken)).toBe(true);
    // landed back on main with the captured structure
    expect(state.activeDocKey).toBe('main');
    expect(state.doc.root.children?.length).toBe((taken.payload.doc?.root.children ?? []).length);
    state.undo();
    expect(state.doc.root.children?.length).toBe(mutatedCount);
  });

  it('"everything": restores doc + registry + view name; doc/registry revert on ONE undo', () => {
    state.setViewName('Before');
    const taken = state.captureSnapshot({ kind: 'all' })!;
    // mutate all three: the view structure, a column formatter, the name
    state.mutateDocument(() => {
      state.doc.root.children?.pop();
      state.columnRefs['Status'].txtContent = 'MUTATED';
    });
    state.setViewName('After');
    expect(state.applySnapshot(taken)).toBe(true);
    expect(state.viewName).toBe('Before');
    expect(state.columnRefs['Status'].txtContent).toBe("=if([$Status]=='','None',[$Status])");
    expect(state.doc.root.children?.length).toBe((taken.payload.all?.doc.root.children ?? []).length);
    // ONE undo reverts doc + registry (view name is metadata, off the stack)
    state.undo();
    expect(state.columnRefs['Status'].txtContent).toBe('MUTATED');
    expect(state.doc.root.children?.length).toBe((taken.payload.all?.doc.root.children ?? []).length - 1);
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
      scope: { kind: 'view' }, payload: {},
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
