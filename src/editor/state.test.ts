/**
 * Editor state contracts (FLOOR-AND-SHEETS + COLUMNS-COMPONENTS-VIEWS):
 *   · the workspace is a FLOOR (columns-only grid document) plus named
 *     SHEETS (row/tile view documents) — separate documents, no relabeling;
 *   · a column's LOOK is a component applied to it: `columnLooks` stores the
 *     baked bound instance (root stamped `_component`, explicit-[$Field]
 *     dialect); the floor's grid cells EMBED clones of the look — no
 *     columnFormatterReference, no drill-in surface (activeDocKey is always
 *     'main'); every look gesture rewrites the store AND the floor cell
 *     together as ONE undoable step;
 *   · leaving/opening a view is NAVIGATION — it never mutates and never
 *     pushes an undo step;
 *   · undo is ONE GLOBAL app-level stack across the floor, every sheet and
 *     the column looks — and it navigates back to the surface it changes;
 *   · autosave format v3 (same frozen key) with a strict load guard: a v2
 *     `columnRefs` payload — or anything older — throws, and restore()
 *     falls back to a fresh default. No migration code.
 * Plus: customCardProps content stays addressable via CARD_SEGMENT paths.
 */
import { describe, it, expect } from 'vitest';
import { EditorState, CARD_SEGMENT } from './state';
import { foldState } from './foldState';
import { gridColumnField } from './gridScaffold';
import type { ComponentDef } from './components';
import type { Snapshot } from './snapshots';
import type { SPElement, FormatterDocument } from '../core/types';

function withCard(): EditorState {
  const s = new EditorState();
  s.doc.root.children = [{
    elmType: 'button',
    txtContent: 'Open',
    customCardProps: {
      openOnEvent: 'click',
      formatter: { elmType: 'div', children: [{ elmType: 'span', txtContent: 'inside' }] },
    },
  }];
  return s;
}

const rowDoc = (children: SPElement[] = []): FormatterDocument =>
  ({ kind: 'row', root: { elmType: 'div', children } });

/** A minimal single-slot component def — the apply-gesture test double. */
const chipDef: ComponentDef = {
  id: 'test-chip',
  name: 'Chip',
  description: 'single-slot test component',
  slots: [{ key: 'Value', label: 'The value to show', types: ['text', 'note'] }],
  root: { elmType: 'div', txtContent: '[$Value]', style: { 'font-weight': '600' } },
};

/** Index of a field's column among the floor grid's root children (-1 = unplaced). */
function floorIndexOf(s: EditorState, field: string): number {
  return (s.floorDoc.root.children ?? []).findIndex((c) => gridColumnField(c) === field);
}

/** The floor grid cell embedding (or plainly rendering) a field's column. */
function floorCellOf(s: EditorState, field: string): SPElement {
  return s.floorDoc.root.children![floorIndexOf(s, field)];
}

function undoDepth(s: EditorState): number {
  return (s as unknown as { undoStack: string[] }).undoStack.length;
}

describe('card-segment paths', () => {
  it('nodeAt descends into customCardProps.formatter', () => {
    const s = withCard();
    expect(s.nodeAt([0, CARD_SEGMENT])?.elmType).toBe('div');
    expect(s.nodeAt([0, CARD_SEGMENT, 0])?.txtContent).toBe('inside');
  });

  it('insertNode targets containers inside the card', () => {
    const s = withCard();
    const path = s.insertNode({ elmType: 'span', txtContent: 'new' }, [0, CARD_SEGMENT]);
    expect(path).toEqual([0, CARD_SEGMENT, 1]);
    expect(s.nodeAt(path)?.txtContent).toBe('new');
  });

  it('removeNode works on card children; card root itself is protected', () => {
    const s = withCard();
    s.removeNode([0, CARD_SEGMENT, 0]);
    expect(s.nodeAt([0, CARD_SEGMENT])?.children).toHaveLength(0);
    s.removeNode([0, CARD_SEGMENT]); // no-op — no sibling list to splice
    expect(s.nodeAt([0, CARD_SEGMENT])).not.toBeNull();
  });

  it('wrapNode adds a parent — including around the root and card roots', () => {
    const s = withCard();
    const oldRoot = s.doc.root;
    s.wrapNode([]);
    expect(s.doc.root.children?.[0]).toBe(oldRoot);
    expect(s.doc.root.style?.display).toBe('flex');
    // wrap a card formatter root
    const cardRoot = s.nodeAt([0, 0, CARD_SEGMENT]);
    s.wrapNode([0, 0, CARD_SEGMENT]);
    expect(s.nodeAt([0, 0, CARD_SEGMENT])?.children?.[0]).toBe(cardRoot);
  });
});

describe('the workspace: floor + named sheets', () => {
  it('a fresh workspace is the floor grid with no sheets', () => {
    const s = new EditorState();
    expect(s.onFloor).toBe(true);
    expect(s.activeViewId).toBeNull();
    expect(s.views).toEqual([]);
    expect(s.doc).toBe(s.floorDoc);
    expect(s.doc.kind).toBe('grid');
    expect(s.mainDocLabel()).toBe('View formatter — grid');
  });

  it('createView registers a named sheet, opens it, and is ONE undo step', () => {
    const s = new EditorState();
    const floorBefore = JSON.stringify(s.floorDoc);
    const sheet = s.createView(rowDoc())!;
    expect(sheet.name).toBe('View 1');
    expect(s.views).toHaveLength(1);
    expect(s.activeViewId).toBe(sheet.id);
    expect(s.onFloor).toBe(false);
    expect(s.doc).toBe(sheet.doc);
    expect(JSON.stringify(s.floorDoc)).toBe(floorBefore); // the floor is untouched

    s.undo(); // ONE Ctrl+Z removes the sheet and lands back on the floor
    expect(s.views).toEqual([]);
    expect(s.onFloor).toBe(true);
    expect(s.doc).toBe(s.floorDoc);
    expect(JSON.stringify(s.floorDoc)).toBe(floorBefore);

    s.redo(); // and redo brings the sheet back, reopened
    expect(s.views).toHaveLength(1);
    expect(s.activeViewId).toBe(s.views[0].id);
  });

  it('createView emits \'load\' — it navigates onto the new sheet like any doc switch', () => {
    const s = new EditorState();
    const reasons: string[] = [];
    s.subscribe((r) => reasons.push(r));
    s.createView(rowDoc());
    // load-scoped UI state (e.g. the left pane's library browser) resets on
    // 'load' only, and the canvas surface really did change
    expect(reasons).toContain('load');
  });

  it('createView refuses non-view kinds and defaults tile dimensions', () => {
    const s = new EditorState();
    expect(s.createView({ kind: 'grid', root: { elmType: 'div' } })).toBeNull();
    expect(s.createView({ kind: 'column', root: { elmType: 'div' } })).toBeNull();
    const tile = s.createView({ kind: 'tile', root: { elmType: 'div' } })!;
    expect(tile.doc.tileWidth).toBe(254);
    expect(tile.doc.tileHeight).toBe(220);
  });

  it('default names count up and skip taken ones; ids stay unique', () => {
    const s = new EditorState();
    const a = s.createView(rowDoc())!;
    const b = s.createView(rowDoc())!;
    expect(a.name).toBe('View 1');
    expect(b.name).toBe('View 2');
    expect(a.id).not.toBe(b.id);
    s.renameView(b.id, 'View 3');
    const c = s.createView(rowDoc())!;
    expect(c.name).toBe('View 4'); // 'View 3' is taken
  });

  it('renameView is project metadata: trims, keeps the old name on blank, off the undo stack', () => {
    const s = new EditorState();
    const sheet = s.createView(rowDoc())!;
    s.mutateDocument(() => { s.doc.root._elmName = 'Probe'; }); // one real doc step
    s.renameView(sheet.id, '  Sprint board  ');
    expect(s.viewById(sheet.id)?.name).toBe('Sprint board');
    s.renameView(sheet.id, '   ');
    expect(s.viewById(sheet.id)?.name).toBe('Sprint board');
    s.undo(); // reverts the doc step, not the rename
    expect(s.doc.root._elmName).toBeUndefined();
    expect(s.viewById(sheet.id)?.name).toBe('Sprint board');
  });
});

describe('the default workspace wears components (COLUMNS-COMPONENTS-VIEWS §1)', () => {
  it('showcase looks are REAL stamped palette instances; Owner is dressed but unplaced', () => {
    const s = new EditorState();
    expect(s.columnLooks['Status']._component?.id).toBe('palette-status-pill');
    expect(s.columnLooks['Progress']._component?.id).toBe('palette-data-bar');
    expect(s.columnLooks['Owner']._component?.id).toBe('palette-persona');
    // stored dialect is explicit [$Field] — a share link renders without the def
    expect(JSON.stringify(s.columnLooks['Status'])).toContain('[$Status]');
    expect(JSON.stringify(s.columnLooks['Owner'])).toContain('[$Owner.title]');
    // Owner's look is registered but its column is NOT on the floor, on
    // purpose — "+ column" demonstrates adding an already-dressed column
    expect(floorIndexOf(s, 'Owner')).toBe(-1);
  });

  it('floor cells EMBED clones of the looks (stamped _field) — no reference elements anywhere', () => {
    const s = new EditorState();
    const statusCell = floorCellOf(s, 'Status');
    expect(statusCell._component?.id).toBe('palette-status-pill');
    expect(statusCell._field).toBe('Status');
    expect(statusCell.style?.['flex']).toBe('1'); // the cell's layout merged on
    expect(statusCell.style?.['min-width']).toBe('0');
    expect(statusCell).not.toBe(s.columnLooks['Status']); // a clone, not an alias
    // a look-less column renders the plain value
    expect(floorCellOf(s, 'Title')._component).toBeUndefined();
    expect(floorCellOf(s, 'Title').txtContent).toBe('[$Title]');
    // § left the document model — nothing serialized carries a reference
    expect(s.serializeProject()).not.toContain('columnFormatterReference');
  });
});

describe('navigation is never a mutation', () => {
  it('openView / minimizeView push nothing onto the undo stack and touch no document', () => {
    const s = new EditorState();
    const sheet = s.createView(rowDoc([{ elmType: 'span', txtContent: 'x' }]))!;
    const sheetJson = JSON.stringify(sheet.doc);
    const floorJson = JSON.stringify(s.floorDoc);
    expect(s.canUndo).toBe(true); // the creation itself
    s.undo(); // clear the stack down to nothing
    s.redo(); // sheet back, open
    const depth = 1;

    s.minimizeView();
    expect(s.onFloor).toBe(true);
    s.openView(sheet.id);
    expect(s.activeViewId).toBe(sheet.id);
    s.minimizeView();

    expect(JSON.stringify(s.viewById(sheet.id)!.doc)).toBe(sheetJson);
    expect(JSON.stringify(s.floorDoc)).toBe(floorJson);
    expect(undoDepth(s)).toBe(depth);
  });

  it('minimize remembers the way back (lastOpenViewId feeds the VIEWS tab\'s return)', () => {
    const s = new EditorState();
    const sheet = s.createView(rowDoc())!;
    s.minimizeView();
    expect(s.lastOpenViewId).toBe(sheet.id);
    expect(s.onFloor).toBe(true);
    s.openView(sheet.id);
    expect(s.activeViewId).toBe(sheet.id);
  });

  it('openView on an unknown id and minimize on the floor are no-ops', () => {
    const s = new EditorState();
    s.openView('nope');
    expect(s.onFloor).toBe(true);
    s.minimizeView(); // already on the floor
    expect(s.onFloor).toBe(true);
  });

  it('goBack retraces surface switches', () => {
    const s = new EditorState();
    const a = s.createView(rowDoc())!; // floor → A
    s.createView(rowDoc());            // A → B
    expect(s.backTarget).toBe('main');
    s.goBack(); // back onto A
    expect(s.activeViewId).toBe(a.id);
    s.goBack(); // back to the floor, where it all started
    expect(s.onFloor).toBe(true);
    expect(s.goBack()).toBeNull(); // nowhere further to retrace
  });

  it('goBack skips entries whose sheet has since been removed', () => {
    const s = new EditorState();
    s.createView(rowDoc()); // nav: floor
    s.minimizeView();       // nav: the sheet
    s.undo();               // the sheet's creation is undone — it no longer exists
    expect(s.onFloor).toBe(true);
    expect(s.backTarget).toBeNull(); // dead sheet skipped; the floor is where we stand
  });
});

describe('the canvas doc key is always \'main\' (no drill-in surface)', () => {
  it('navigation never changes activeDocKey; openMain is a no-op guard', () => {
    const s = new EditorState();
    expect(s.activeDocKey).toBe('main');
    const sheet = s.createView(rowDoc())!;
    expect(s.activeDocKey).toBe('main');
    s.openMain(); // already there — must not disturb the surface
    expect(s.doc).toBe(sheet.doc);
    s.minimizeView();
    expect(s.activeDocKey).toBe('main');
    expect(s.doc).toBe(s.floorDoc);
  });

  it('mainRootForScope tracks the active surface', () => {
    const s = new EditorState();
    expect(s.mainRootForScope).toBe(s.floorDoc.root);
    const sheet = s.createView(rowDoc())!;
    expect(s.mainRootForScope).toBe(sheet.doc.root);
    s.minimizeView();
    expect(s.mainRootForScope).toBe(s.floorDoc.root);
  });
});

describe('global undo across floor + sheets (§2.3)', () => {
  it('one chronological stack: undo reverts the LAST change wherever it happened, navigating there', () => {
    const s = new EditorState();
    const floorLen = s.floorDoc.root.children!.length;
    s.insertNode({ elmType: 'span', txtContent: 'floor-edit' }); // step 1 (floor)
    const sheet = s.createView(rowDoc())!;                       // step 2 (create)
    s.insertNode({ elmType: 'span', txtContent: 'sheet-edit' }); // step 3 (sheet)
    s.minimizeView();                                            // navigation

    s.undo(); // step 3 reverts — and the canvas navigates back onto the sheet
    expect(s.activeViewId).toBe(sheet.id);
    expect(s.viewById(sheet.id)!.doc.root.children ?? []).toHaveLength(0);

    s.undo(); // step 2 reverts — the sheet disappears, we land on the floor
    expect(s.onFloor).toBe(true);
    expect(s.views).toEqual([]);
    expect(s.floorDoc.root.children).toHaveLength(floorLen + 1); // floor edit still live

    s.undo(); // step 1 reverts
    expect(s.floorDoc.root.children).toHaveLength(floorLen);

    s.redo(); s.redo(); s.redo(); // the whole chain replays
    expect(s.views).toHaveLength(1);
    expect(s.views[0].doc.root.children).toHaveLength(1);
    // redo lands where you STOOD when you undid — on the floor, post-minimize
    expect(s.onFloor).toBe(true);
  });

  it('look mutations ride the same one stack as document edits', () => {
    const s = new EditorState();
    const floorLen = s.floorDoc.root.children!.length;
    s.insertNode({ elmType: 'span', txtContent: 'floor-edit' }); // step 1 (doc)
    s.removeColumnLook('Status');                                // step 2 (look)
    expect(floorCellOf(s, 'Status')._component).toBeUndefined();

    s.undo(); // last change first: the look comes back, cell re-embedded
    expect(s.columnLooks['Status']._component?.id).toBe('palette-status-pill');
    expect(floorCellOf(s, 'Status')._component?.id).toBe('palette-status-pill');
    expect(s.floorDoc.root.children).toHaveLength(floorLen + 1); // step 1 still live

    s.undo(); // then the doc edit
    expect(s.floorDoc.root.children).toHaveLength(floorLen);
  });

  it('redo restores an undone mutation; a fresh mutation invalidates the redo', () => {
    const s = new EditorState();
    const before = JSON.stringify(s.doc);

    s.insertNode({ elmType: 'span', txtContent: 'new' });
    const afterInsert = JSON.stringify(s.doc);
    expect(afterInsert).not.toBe(before);

    s.undo();
    expect(JSON.stringify(s.doc)).toBe(before);

    s.redo();
    expect(JSON.stringify(s.doc)).toBe(afterInsert); // redo replays the mutation

    // undo again, then make a NEW mutation — the redo branch must be discarded
    s.undo();
    expect(JSON.stringify(s.doc)).toBe(before);
    s.insertNode({ elmType: 'div', txtContent: 'other' });
    const afterOther = JSON.stringify(s.doc);

    s.redo(); // no redo to do — must be a no-op, not resurrect the old branch
    expect(JSON.stringify(s.doc)).toBe(afterOther);
  });

  it('canUndo / canRedo track availability across the empty → mutate → undo → redo cycle', () => {
    const s = new EditorState();
    expect(s.canUndo).toBe(false);
    expect(s.canRedo).toBe(false);

    s.insertNode({ elmType: 'span', txtContent: 'x' });
    expect(s.canUndo).toBe(true);
    expect(s.canRedo).toBe(false);

    s.undo();
    expect(s.canUndo).toBe(false);
    expect(s.canRedo).toBe(true);

    s.redo();
    expect(s.canUndo).toBe(true);
    expect(s.canRedo).toBe(false);

    // a new mutation after undo clears the redo branch
    s.undo();
    s.insertNode({ elmType: 'div', txtContent: 'y' });
    expect(s.canUndo).toBe(true);
    expect(s.canRedo).toBe(false);
  });

  it('subscribe returns an unsubscribe function that removes the listener', () => {
    const s = new EditorState();
    let count = 0;
    const listener = () => { count++; };

    const unsub = s.subscribe(listener);
    s.emit('document');
    expect(count).toBe(1);

    unsub();
    s.emit('document');
    expect(count).toBe(1);
  });
});

describe('reparentNode / insertNode: plain container semantics', () => {
  const seedSheet = (s: EditorState, root: SPElement): void => {
    // structural tests want an arbitrary tree on the canvas — a sheet is the
    // natural host for one (no drilled documents exist under this model)
    s.createView({ kind: 'row', root });
  };

  it('adjusts the destination index after the source removal shifts it', () => {
    const s = new EditorState();
    seedSheet(s, {
      elmType: 'div',
      children: [
        { elmType: 'span', _elmName: 'A' },
        { elmType: 'div', _elmName: 'B', children: [] },
        { elmType: 'div', _elmName: 'C', children: [] },
      ],
    });
    // move A (index 0) into C (index 2). Removing A shifts C to index 1, so the
    // destination path must be decremented or A lands in the wrong container.
    s.reparentNode([0], [2]);
    expect(s.doc.root.children!.map((c) => c._elmName)).toEqual(['B', 'C']);
    const c = s.doc.root.children![1];
    expect(c._elmName).toBe('C');
    expect(c.children!.map((x) => x._elmName)).toEqual(['A']);
  });

  it('refuses to drop a node into its own subtree (no-op)', () => {
    const s = new EditorState();
    seedSheet(s, {
      elmType: 'div',
      children: [
        { elmType: 'div', _elmName: 'A', children: [{ elmType: 'span', _elmName: 'B' }] },
      ],
    });
    const before = JSON.stringify(s.doc);
    s.reparentNode([0], [0, 0]); // try to move A into its own child B
    expect(JSON.stringify(s.doc)).toBe(before);
  });

  it('inserting into an embedded look cell just appends — CFR-host splitting is gone', () => {
    const s = new EditorState(); // the floor grid; Progress wears the data bar
    const i = floorIndexOf(s, 'Progress');
    const kidsBefore = floorCellOf(s, 'Progress').children!.length;
    const path = s.insertNode({ elmType: 'span', txtContent: 'extra' }, [i]);
    expect(path).toEqual([i, kidsBefore]); // a plain child, nothing extracted
    const cell = floorCellOf(s, 'Progress');
    expect(cell._component?.id).toBe('palette-data-bar'); // the stamp stays on the cell
    expect(cell._field).toBe('Progress');
    expect(cell.children).toHaveLength(kidsBefore + 1);
  });
});

describe('applyComponentToColumn: a column gets its look by wearing a component (§4)', () => {
  it('bakes a stamped instance into the store and EMBEDS it in the floor cell, in one gesture', () => {
    const s = new EditorState();
    const reasons: string[] = [];
    s.subscribe((r) => reasons.push(r));

    s.applyComponentToColumn('Title', chipDef, { Value: 'Title' });

    // the STORE: baked bound instance, [$Field] dialect, _component-stamped
    const look = s.columnLooks['Title'];
    expect(look.txtContent).toBe('[$Title]'); // slot key rewritten to the column
    expect(look._component).toEqual({ id: 'test-chip', map: { Value: 'Title' } });
    expect(look._elmName).toBe('Chip');

    // the FLOOR CELL: a clone of the look, stamped _field, cell layout merged
    const cell = floorCellOf(s, 'Title');
    expect(cell).not.toBe(look); // embedded clone, never an alias
    expect(cell._field).toBe('Title');
    expect(cell._component?.id).toBe('test-chip');
    expect(cell.txtContent).toBe('[$Title]');
    expect(cell.style?.['font-weight']).toBe('600'); // the component's styling…
    expect(cell.style?.['flex']).toBe('1');          // …plus the cell's layout
    expect(cell.style?.['min-width']).toBe('0');

    expect(reasons).toContain('document');
    expect(reasons).toContain('data'); // pickers/library refresh on look changes
  });

  it('ONE undo reverts the look AND the floor cell together; redo re-applies both', () => {
    const s = new EditorState();
    s.applyComponentToColumn('Title', chipDef, { Value: 'Title' });
    expect(undoDepth(s)).toBe(1);

    s.undo(); // single Ctrl+Z
    expect(Object.hasOwn(s.columnLooks, 'Title')).toBe(false);
    const plain = floorCellOf(s, 'Title');
    expect(plain._component).toBeUndefined();
    expect(plain.txtContent).toBe('[$Title]'); // back to the plain-value cell

    s.redo();
    expect(s.columnLooks['Title']._component?.id).toBe('test-chip');
    expect(floorCellOf(s, 'Title')._component?.id).toBe('test-chip');
  });

  it('re-applying the identical component is a no-op — no phantom undo step', () => {
    const s = new EditorState();
    s.applyComponentToColumn('Title', chipDef, { Value: 'Title' });
    s.applyComponentToColumn('Title', chipDef, { Value: 'Title' }); // same bake
    expect(undoDepth(s)).toBe(1);
    s.undo(); // one undo lands on the plain column, not a phantom
    expect(Object.hasOwn(s.columnLooks, 'Title')).toBe(false);
  });

  it('an unknown field is refused outright — nothing stored, nothing snapshotted', () => {
    const s = new EditorState();
    s.applyComponentToColumn('Ghost', chipDef, { Value: 'Ghost' });
    expect(Object.hasOwn(s.columnLooks, 'Ghost')).toBe(false);
    expect(s.canUndo).toBe(false);
  });
});

describe('removeColumnLook: undressing a column', () => {
  it('deletes the look and re-embeds the plain-value cell as ONE undoable step', () => {
    const s = new EditorState();
    const reasons: string[] = [];
    s.subscribe((r) => reasons.push(r));

    s.removeColumnLook('Status');
    expect(Object.hasOwn(s.columnLooks, 'Status')).toBe(false);
    const plain = floorCellOf(s, 'Status');
    expect(plain._component).toBeUndefined();
    expect(plain.txtContent).toBe('[$Status]');
    expect(plain._field).toBe('Status');
    expect(reasons).toContain('data');

    s.undo(); // single Ctrl+Z re-dresses the column, store AND cell
    expect(s.columnLooks['Status']._component?.id).toBe('palette-status-pill');
    expect(floorCellOf(s, 'Status')._component?.id).toBe('palette-status-pill');
  });

  it('a look-less column is a no-op — no phantom undo step', () => {
    const s = new EditorState();
    const before = s.serializeProject();
    s.removeColumnLook('DueDate'); // never had a look
    expect(s.canUndo).toBe(false);
    expect(s.serializeProject()).toBe(before);
  });
});

describe('registerImportedLook: imports become looks (§1)', () => {
  it('converts @currentField → [$Field] and stores UNSTAMPED; the floor cell embeds it', () => {
    const s = new EditorState();
    s.registerImportedLook('Title', {
      elmType: 'div',
      txtContent: '=toUpperCase(@currentField)',
    });
    const look = s.columnLooks['Title'];
    expect(look.txtContent).toBe('=toUpperCase([$Title])');
    expect(look._component).toBeUndefined(); // no def backs an import — not silently editable
    const cell = floorCellOf(s, 'Title');
    expect(cell.txtContent).toBe('=toUpperCase([$Title])');
    expect(cell._field).toBe('Title');
    expect(cell.style?.['flex']).toBe('1');

    s.undo(); // ONE step reverts the registration and the cell
    expect(Object.hasOwn(s.columnLooks, 'Title')).toBe(false);
    expect(floorCellOf(s, 'Title').txtContent).toBe('[$Title]'); // the plain-value cell again
  });

  it('dotted @currentField props carry the field binding through', () => {
    const s = new EditorState();
    s.registerImportedLook('AssignedTo', {
      elmType: 'div',
      txtContent: "=join(@currentField.title,', ')",
    });
    expect(s.columnLooks['AssignedTo'].txtContent).toBe("=join([$AssignedTo.title],', ')");
  });

  it('registering a look for an UNPLACED column touches the store only', () => {
    const s = new EditorState();
    expect(floorIndexOf(s, 'Tags')).toBe(-1); // Tags has no floor column
    const floorBefore = JSON.stringify(s.floorDoc);
    s.registerImportedLook('Tags', { elmType: 'div', txtContent: '@currentField' });
    expect(s.columnLooks['Tags'].txtContent).toBe('[$Tags]');
    expect(JSON.stringify(s.floorDoc)).toBe(floorBefore); // unplaced = floor untouched
  });
});

describe('batchProjectUpdate: the component editor\'s one-step apply', () => {
  it('view subtree replacement + look re-bakes revert on ONE undo', () => {
    const s = new EditorState();
    s.createView(rowDoc([{ elmType: 'div', txtContent: 'OLD-VIEW', _component: { id: 'c-x', map: {} } }]));
    const docBefore = JSON.stringify(s.doc);
    const lookBefore = JSON.stringify(s.columnLooks['Status']);

    s.batchProjectUpdate(['Status'], () => {
      s.doc.root.children![0] = { elmType: 'div', txtContent: 'NEW-VIEW', _component: { id: 'c-x', map: {} } };
      s.columnLooks['Status'] = { elmType: 'div', txtContent: 'NEW-LOOK', _component: { id: 'c-x', map: {} } };
    });
    expect(s.doc.root.children![0].txtContent).toBe('NEW-VIEW');
    expect(s.columnLooks['Status'].txtContent).toBe('NEW-LOOK');

    s.undo(); // ONE Ctrl+Z reverts BOTH together
    expect(JSON.stringify(s.doc)).toBe(docBefore);
    expect(JSON.stringify(s.columnLooks['Status'])).toBe(lookBefore);

    s.redo(); // and redo re-applies the whole batch
    expect(s.doc.root.children![0].txtContent).toBe('NEW-VIEW');
    expect(s.columnLooks['Status'].txtContent).toBe('NEW-LOOK');
  });

  it('a no-op fn leaves ZERO trace — no undo step', () => {
    const s = new EditorState();
    expect(s.canUndo).toBe(false);
    s.batchProjectUpdate(['Status'], () => { /* nothing */ });
    expect(s.canUndo).toBe(false);
  });
});

describe('autosave format v3 (same frozen key, strict load guard)', () => {
  it('serializeProject emits the workspace: floor, views, activeViewId, columnLooks', () => {
    const s = new EditorState();
    const sheet = s.createView(rowDoc([{ elmType: 'span', txtContent: 'x' }]), 'Sprint board')!;
    const p = JSON.parse(s.serializeProject());
    expect(p.version).toBe(3);
    expect(p.floor.kind).toBe('grid');
    expect(p.floor.root.elmType).toBe('div');
    expect(p.views).toHaveLength(1);
    expect(p.views[0]).toMatchObject({ id: sheet.id, name: 'Sprint board' });
    expect(p.views[0].doc.kind).toBe('row');
    expect(p.activeViewId).toBe(sheet.id);
    expect(p.columnLooks.Status._component.id).toBe('palette-status-pill');
    expect(p.columnRefs).toBeUndefined(); // the v2 registry key is GONE
    expect(p.doc).toBeUndefined();        // so is the pre-Stage-1 single-doc key
  });

  it('round-trips the whole workspace, including where you stood and every look', () => {
    const s = new EditorState();
    s.createView(rowDoc(), 'A');
    const b = s.createView({ kind: 'tile', root: { elmType: 'div' } }, 'B')!;
    s.registerImportedLook('DueDate', { elmType: 'div', txtContent: '=toLocaleDateString(@currentField)' });
    const text = s.serializeProject();

    const s2 = new EditorState();
    s2.loadProject(text);
    expect(s2.views.map((v) => v.name)).toEqual(['A', 'B']);
    expect(s2.activeViewId).toBe(b.id);
    expect(s2.doc).toBe(s2.viewById(b.id)!.doc); // reload lands where you left off
    expect(s2.doc.tileWidth).toBe(254);
    expect(s2.columnLooks['DueDate'].txtContent).toBe('=toLocaleDateString([$DueDate])');
    expect(s2.columnLooks['Status']._component?.id).toBe('palette-status-pill');
    expect(s2.serializeProject()).toBe(text);
  });

  it('REFUSES pre-Stage-1 payloads — the guard throws, restore() falls back to the default', () => {
    const legacy = JSON.stringify({
      version: 1,
      doc: { kind: 'grid', root: { elmType: 'div' } },
      fields: [], rows: [], columnRefs: {}, viewName: 'View 1',
    });
    const s = new EditorState();
    expect(() => s.loadProject(legacy)).toThrow(/workspace file/);

    localStorage.setItem(EditorState.STORAGE_KEY, legacy);
    const s2 = new EditorState();
    expect(s2.restore()).toBe(false); // no migration: unparseable → fresh default
    expect(s2.onFloor).toBe(true);
    expect(s2.views).toEqual([]);
    localStorage.removeItem(EditorState.STORAGE_KEY);
  });

  it('REFUSES the v2 columnRefs format — a load guard, not a converter', () => {
    const v2 = JSON.parse(new EditorState().serializeProject());
    v2.version = 2;
    delete v2.columnLooks;
    v2.columnRefs = { Status: { elmType: 'div', txtContent: '@currentField' } };
    expect(() => new EditorState().loadProject(JSON.stringify(v2))).toThrow(/columnLooks/);

    localStorage.setItem(EditorState.STORAGE_KEY, JSON.stringify(v2));
    const s = new EditorState();
    expect(s.restore()).toBe(false);
    // the fresh default workspace, showcase looks intact — nothing half-loaded
    expect(s.columnLooks['Status']._component?.id).toBe('palette-status-pill');
    localStorage.removeItem(EditorState.STORAGE_KEY);
  });

  it('rejects malformed views (wrong kind, missing id) rather than guessing', () => {
    const s = new EditorState();
    const good = JSON.parse(s.serializeProject());
    good.views = [{ id: 'v1', name: 'X', doc: { kind: 'grid', root: { elmType: 'div' } } }];
    expect(() => new EditorState().loadProject(JSON.stringify(good))).toThrow(/workspace file/);
    good.views = [{ name: 'X', doc: { kind: 'row', root: { elmType: 'div' } } }];
    expect(() => new EditorState().loadProject(JSON.stringify(good))).toThrow(/workspace file/);
  });

  it('rejects the reserved sheet id "floor" and duplicate ids (selection keys must be unambiguous)', () => {
    const template = JSON.parse(new EditorState().serializeProject());
    const row = (id: string) => ({ id, name: id, doc: { kind: 'row', root: { elmType: 'div' } } });
    template.views = [row('floor')]; // would collide with the floor's selection-memory key
    expect(() => new EditorState().loadProject(JSON.stringify(template))).toThrow(/workspace file/);
    template.views = [row('v1'), row('v1')]; // would make viewById/openView ambiguous
    expect(() => new EditorState().loadProject(JSON.stringify(template))).toThrow(/workspace file/);
    template.views = [row('v1'), row('v2')]; // distinct ids stay fine
    const s = new EditorState();
    s.loadProject(JSON.stringify(template));
    expect(s.views).toHaveLength(2);
  });

  it('an unknown activeViewId degrades to the floor instead of crashing', () => {
    const s = new EditorState();
    const p = JSON.parse(s.serializeProject());
    p.activeViewId = 'ghost';
    const s2 = new EditorState();
    s2.loadProject(JSON.stringify(p));
    expect(s2.onFloor).toBe(true);
    expect(s2.doc).toBe(s2.floorDoc);
  });

  it('resetAll returns to the fresh floor-only workspace, showcase looks included', () => {
    const s = new EditorState();
    s.createView(rowDoc(), 'Whatever');
    s.removeColumnLook('Status');
    s.resetAll();
    expect(s.views).toEqual([]);
    expect(s.onFloor).toBe(true);
    expect(s.doc).toBe(s.floorDoc);
    expect(s.columnLooks['Status']._component?.id).toBe('palette-status-pill');
  });
});

describe('column tab groups (owner brief 2026-07-05): project metadata, never a mutation', () => {
  it('groupColumns creates an exclusive group over schema-known fields only', () => {
    const s = new EditorState();
    const g = s.groupColumns(['Status', 'DueDate', 'NotAField'])!;
    expect(g.fields).toEqual(['Status', 'DueDate']);
    expect(s.floorGroups).toEqual([g]);
    expect(s.groupColumns(['NotAField'])).toBeNull(); // nothing groupable
  });

  it('group gestures live OFF the undo stack (the renameView rule) and never touch the floor', () => {
    const s = new EditorState();
    const floorBefore = JSON.stringify(s.floorDoc);
    const g = s.groupColumns(['Status'])!;
    s.renameGroup(g.id, 'People');
    s.setGroupColor(g.id, '#107c10');
    s.toggleGroupCollapsed(g.id);
    expect(s.canUndo).toBe(false); // presentational metadata, not document edits
    expect(JSON.stringify(s.floorDoc)).toBe(floorBefore);
    expect(s.floorGroups[0]).toMatchObject({ name: 'People', color: '#107c10', collapsed: true });
    s.ungroupColumns(g.id);
    expect(s.floorGroups).toEqual([]);
    expect(s.canUndo).toBe(false);
  });

  it('groups round-trip through the project file (additive key: absent → none, garbage → dropped)', () => {
    const s = new EditorState();
    const g = s.groupColumns(['Status', 'Progress'], 'Delivery')!;
    s.toggleGroupCollapsed(g.id);
    const s2 = new EditorState();
    s2.loadProject(s.serializeProject());
    expect(s2.floorGroups).toEqual(s.floorGroups);

    const p = JSON.parse(s.serializeProject());
    p.floorGroups = [{ bogus: true }, ...p.floorGroups];
    const s3 = new EditorState();
    s3.loadProject(JSON.stringify(p)); // garbage entries are dropped, not fatal
    expect(s3.floorGroups).toEqual(s.floorGroups);

    delete p.floorGroups;
    const s4 = new EditorState();
    s4.loadProject(JSON.stringify(p));
    expect(s4.floorGroups).toEqual([]);
  });

  it('the exported floor document is byte-identical with or without groups', () => {
    const s = new EditorState();
    const before = JSON.stringify(s.floorDoc);
    const g = s.groupColumns(['Status', 'DueDate'])!;
    s.toggleGroupCollapsed(g.id);
    expect(JSON.stringify(s.floorDoc)).toBe(before);
  });
});

describe('STORAGE_KEY is frozen', () => {
  it('matches the literal that protects existing autosaved work', () => {
    // HANDOFF §1: these keys deliberately never change on rename — a rename
    // here would orphan every user's autosaved project. This test must fail.
    // (Frozen NAMES, not frozen formats — the payload is v3 now.)
    expect(EditorState.STORAGE_KEY).toBe('list-formatting-sandbox.project.v1');
  });
});

describe('undo integrity', () => {
  it('mutateDocument does not push an undo step for a no-op gesture', () => {
    const s = withCard();
    const original = JSON.stringify(s.doc);
    s.mutateDocument(() => { s.doc.root._elmName = 'NoOpProbe'; }); // real change
    s.mutateDocument(() => { s.doc.root._elmName = 'NoOpProbe'; }); // no-op (rename to same value)
    s.undo(); // a single undo should restore the original — no phantom step
    expect(JSON.stringify(s.doc)).toBe(original);
  });

  it('setKind on a sheet: row ⇄ tile is one undoable step; repeating the kind is a no-op', () => {
    const s = new EditorState();
    s.createView(rowDoc());
    s.mutateDocument(() => { s.doc.root._elmName = 'Probe'; }); // a real step to guard against phantoms
    s.setKind('row'); // unchanged kind → no-op
    s.setKind('tile');
    expect(s.doc.kind).toBe('tile');
    expect(s.doc.tileWidth).toBe(254);
    s.undo(); // reverts the kind flip only
    expect(s.doc.kind).toBe('row');
    s.undo(); // then the probe rename
    expect(s.doc.root._elmName).toBeUndefined();
  });

  it('setKind("grid") on a sheet MINIMIZES — navigation, not a mutation', () => {
    const s = new EditorState();
    const sheet = s.createView(rowDoc())!;
    const depth = undoDepth(s);
    s.setKind('grid');
    expect(s.onFloor).toBe(true);
    expect(s.views).toHaveLength(1); // the sheet survives, untouched
    expect(s.viewById(sheet.id)!.doc.kind).toBe('row');
    expect(undoDepth(s)).toBe(depth);
  });

  it('setKind("row") on the floor starts a NEW sheet carrying a copy of the floor tree', () => {
    const s = new EditorState();
    const floorJson = JSON.stringify(s.floorDoc);
    const floorChildren = s.floorDoc.root.children!.length;
    s.setKind('row');
    expect(s.onFloor).toBe(false);
    expect(s.doc.kind).toBe('row');
    expect(s.doc.root.children).toHaveLength(floorChildren); // the lossless relabel…
    expect(JSON.stringify(s.floorDoc)).toBe(floorJson);      // …into its OWN document
    s.doc.root.children!.pop(); // shaping the sheet…
    expect(JSON.stringify(s.floorDoc)).toBe(floorJson);      // …can never corrupt the floor
    expect(s.floorDoc.kind).toBe('grid');
  });

  it('setKind("column") is ignored — a look is a component instance, not a canvas document', () => {
    const s = new EditorState();
    s.setKind('column');
    expect(s.onFloor).toBe(true);
    expect(s.views).toEqual([]);
    expect(s.doc.kind).toBe('grid');
    expect(s.canUndo).toBe(false);
  });
});

describe('applyRowTemplate / applyTileTemplate', () => {
  it('on a sheet: one undo step that reverts root + kind together, preserving unrelated viewExtras', () => {
    const s = new EditorState();
    s.createView({
      kind: 'row',
      root: { elmType: 'div', _elmName: 'seed' },
      viewExtras: { footerFormatter: { elmType: 'div' } },
    });
    s.applyRowTemplate({ elmType: 'div', _elmName: 'Row layout' }, "=if(@rowIndex % 2 == 0,'ms-bgColor-themeLighter','')");
    expect(s.doc.kind).toBe('row');
    // the retired wrapper class FOLDS into the root's own class expression
    // (SP ignores additionalRowClass next to a rowFormatter) — the wrapper
    // key is never written
    expect(s.doc.viewExtras!.additionalRowClass).toBeUndefined();
    expect(s.doc.root.attributes!.class as string).toContain('@rowIndex');
    expect(s.doc.viewExtras!.footerFormatter).toBeDefined();
    s.undo(); // a single undo reverts the whole apply
    expect(s.doc.root._elmName).toBe('seed');
    expect(s.doc.viewExtras!.additionalRowClass).toBeUndefined();
  });

  it('does not push a phantom undo step when Apply reproduces the current sheet', () => {
    const s = new EditorState();
    s.createView({ kind: 'row', root: { elmType: 'div', _elmName: 'A', children: [] } });
    s.applyRowTemplate({ elmType: 'div', _elmName: 'B', children: [] }); // real change A→B (one undo)
    s.applyRowTemplate({ elmType: 'div', _elmName: 'B', children: [] }); // identical B→B (no undo)
    s.undo();                                                            // one undo must land on A, not a phantom B
    expect(s.doc.root._elmName).toBe('A');
  });

  it('from the floor: CREATES a new named sheet — the floor is never overwritten', () => {
    const s = new EditorState();
    const floorJson = JSON.stringify(s.floorDoc);
    s.applyRowTemplate({ elmType: 'div', _elmName: 'Row layout' }, 'zebra');
    expect(s.views).toHaveLength(1);
    expect(s.doc.kind).toBe('row');
    // static legacy class folds onto the root; no wrapper key is written
    expect(s.doc.viewExtras?.additionalRowClass).toBeUndefined();
    expect(s.doc.root.attributes!.class).toBe('zebra');
    expect(JSON.stringify(s.floorDoc)).toBe(floorJson);
    s.undo(); // removes the sheet, back on the intact floor
    expect(s.views).toEqual([]);
    expect(JSON.stringify(s.floorDoc)).toBe(floorJson);
  });

  it('applyTileTemplate on a sheet flips kind + tile box in one step; from the floor it creates', () => {
    const s = new EditorState();
    s.createView(rowDoc());
    s.applyTileTemplate({ elmType: 'div', _elmName: 'Tile layout' }, { width: 300, height: 240 });
    expect(s.doc.kind).toBe('tile');
    expect(s.doc.tileWidth).toBe(300);
    expect(s.doc.tileHeight).toBe(240);
    s.undo();
    expect(s.doc.kind).toBe('row');
    expect(s.doc.tileWidth).toBeUndefined();

    s.minimizeView();
    s.applyTileTemplate({ elmType: 'div', _elmName: 'T' });
    expect(s.views).toHaveLength(2);
    expect(s.doc.kind).toBe('tile');
    expect(s.doc.tileWidth).toBe(254); // the SP stock 254×220 default
    expect(s.doc.tileHeight).toBe(220);
  });
});

describe('loadDocument: the Apply-to-canvas routing', () => {
  it('on the floor, a PURE-GRID row payload replaces the FLOOR ROOT — kind stays grid (lossless round-trip)', () => {
    const s = new EditorState();
    s.loadDocument({
      kind: 'row',
      root: {
        elmType: 'div', _elmName: 'pasted',
        children: [
          { elmType: 'div', txtContent: '[$Title]' },
          { elmType: 'div', txtContent: '[$Status]' },
        ],
      },
    });
    expect(s.onFloor).toBe(true);
    expect(s.doc.kind).toBe('grid');
    expect(s.doc.root._elmName).toBe('pasted');
    s.undo();
    expect(s.doc.root._elmName).toBe('Row layout'); // the default floor scaffold
  });

  it('on the floor, a row LAYOUT (zones/composites) becomes a NEW sheet — the floor never renders pseudo-columns (Stage 2)', () => {
    const s = new EditorState();
    const floorBefore = JSON.stringify(s.floorDoc);
    s.loadDocument({
      kind: 'row',
      root: {
        elmType: 'div', _elmName: 'Row layout',
        children: [{
          elmType: 'div', _elmName: 'Lead zone',
          children: [
            { elmType: 'span', txtContent: '[$Title]' },
            { elmType: 'span', txtContent: '[$Status]' },
          ],
        }],
      },
    });
    expect(s.views).toHaveLength(1);
    expect(s.activeViewId).toBe(s.views[0].id); // opened as its own sheet
    expect(s.doc.kind).toBe('row');
    expect(JSON.stringify(s.floorDoc)).toBe(floorBefore); // the floor is untouched
    s.undo(); // sheet registration is ONE undoable step
    expect(s.views).toHaveLength(0);
    expect(s.onFloor).toBe(true);
  });

  it('on the floor, a tile payload becomes a NEW sheet (a tile can never be a floor)', () => {
    const s = new EditorState();
    s.loadDocument({ kind: 'tile', root: { elmType: 'div', _elmName: 'tile' } });
    expect(s.views).toHaveLength(1);
    expect(s.doc.kind).toBe('tile');
  });

  it('a COLUMN payload registers as the current field\'s look and selects that grid column — no drill', () => {
    const s = new EditorState();
    s.currentFieldName = 'DueDate';
    const reasons: string[] = [];
    s.subscribe((r) => reasons.push(r));
    s.loadDocument({ kind: 'column', root: { elmType: 'div', txtContent: '@currentField' } });
    expect(s.activeDocKey).toBe('main'); // no drill surface exists
    expect(s.onFloor).toBe(true);
    expect(s.columnLooks['DueDate'].txtContent).toBe('[$DueDate]'); // store dialect
    expect(s.columnLooks['DueDate']._component).toBeUndefined();    // imports are unstamped
    expect(floorCellOf(s, 'DueDate').txtContent).toBe('[$DueDate]');
    expect(s.selection).toEqual([floorIndexOf(s, 'DueDate')]);
    expect(reasons).toContain('load');
  });

  it('a COLUMN payload from a sheet minimizes to the floor; ONE undo unregisters AND navigates back', () => {
    const s = new EditorState();
    const sheet = s.createView(rowDoc())!;
    s.currentFieldName = 'Title';
    s.loadDocument({ kind: 'column', root: { elmType: 'div', txtContent: '@currentField' } });
    expect(s.onFloor).toBe(true); // the look lives on the grid — navigation rode along
    expect(s.columnLooks['Title'].txtContent).toBe('[$Title]');
    expect(s.selection).toEqual([floorIndexOf(s, 'Title')]);

    s.undo(); // the registration was the one mutation — undo returns to its surface
    expect(Object.hasOwn(s.columnLooks, 'Title')).toBe(false);
    expect(floorCellOf(s, 'Title')._component).toBeUndefined();
    expect(s.activeViewId).toBe(sheet.id);
  });

  it('on a sheet, a row/tile payload replaces the sheet document (kind follows the payload)', () => {
    const s = new EditorState();
    const sheet = s.createView(rowDoc())!;
    s.loadDocument({ kind: 'tile', root: { elmType: 'div', _elmName: 'T' } });
    expect(s.activeViewId).toBe(sheet.id);
    expect(s.viewById(sheet.id)!.doc.kind).toBe('tile');
    expect(s.viewById(sheet.id)!.doc.root._elmName).toBe('T');
    expect(s.doc).toBe(s.viewById(sheet.id)!.doc);
  });
});

describe('snapshots: capture & apply as ONE undoable step (issue #140)', () => {
  it('column capture: null for a look-less column; a CLONE of the look otherwise (own keys only)', () => {
    const s = new EditorState();
    expect(s.captureSnapshot({ kind: 'column', field: 'DueDate' })).toBeNull();
    expect(s.captureSnapshot({ kind: 'column', field: 'toString' })).toBeNull(); // prototype keys never read as looks
    const snap = s.captureSnapshot({ kind: 'column', field: 'Status' })!;
    expect(snap.scope).toEqual({ kind: 'column', field: 'Status' });
    expect(snap.payload.root).toEqual(s.columnLooks['Status']);
    expect(snap.payload.root).not.toBe(s.columnLooks['Status']); // a capture, not an alias
  });

  it('\'all\' capture carries the whole workspace: floor + views + columnLooks', () => {
    const s = new EditorState();
    s.createView(rowDoc(), 'A');
    const snap = s.captureSnapshot({ kind: 'all' })!;
    expect(snap.payload.all!.floor.kind).toBe('grid');
    expect(snap.payload.all!.views.map((v) => v.name)).toEqual(['A']);
    expect(snap.payload.all!.columnLooks['Status']).toEqual(s.columnLooks['Status']);
    expect(snap.payload.all!.columnLooks['Status']).not.toBe(s.columnLooks['Status']);
  });

  it('column apply rewrites the look AND the floor cell — the grid never goes stale; one undo reverts both', () => {
    const s = new EditorState();
    const snap = s.captureSnapshot({ kind: 'column', field: 'Status' })!;
    s.removeColumnLook('Status');
    expect(floorCellOf(s, 'Status')._component).toBeUndefined();

    expect(s.applySnapshot(snap)).toBe(true);
    expect(s.columnLooks['Status']._component?.id).toBe('palette-status-pill');
    expect(floorCellOf(s, 'Status')._component?.id).toBe('palette-status-pill');

    s.undo(); // single Ctrl+Z back to the undressed column, store AND cell
    expect(Object.hasOwn(s.columnLooks, 'Status')).toBe(false);
    expect(floorCellOf(s, 'Status')._component).toBeUndefined();
  });

  it('a payload that does not match its scope is refused wholesale — nothing touched', () => {
    const s = new EditorState();
    const before = s.serializeProject();
    const corrupt = (scope: Snapshot['scope']): Snapshot =>
      ({ id: 'x', takenAt: '2026-07-06T00:00:00Z', label: 'corrupt', scope, payload: {} });
    expect(s.applySnapshot(corrupt({ kind: 'column', field: 'Status' }))).toBe(false);
    expect(s.applySnapshot(corrupt({ kind: 'all' }))).toBe(false);
    expect(s.serializeProject()).toBe(before);
    expect(s.canUndo).toBe(false);
  });

  it('\'all\' apply restores floor + sheets + looks; one undo reverts the whole restore', () => {
    const s = new EditorState();
    const snap = s.captureSnapshot({ kind: 'all' })!;
    s.removeColumnLook('Status');
    s.createView(rowDoc(), 'Later');

    expect(s.applySnapshot(snap)).toBe(true);
    expect(s.views).toEqual([]); // the capture predates the sheet
    expect(s.onFloor).toBe(true); // the sheet you stood on isn't in this capture
    expect(s.columnLooks['Status']._component?.id).toBe('palette-status-pill');
    expect(floorCellOf(s, 'Status')._component?.id).toBe('palette-status-pill');

    s.undo(); // ONE Ctrl+Z brings back the sheet and the undressed column
    expect(s.views.map((v) => v.name)).toEqual(['Later']);
    expect(Object.hasOwn(s.columnLooks, 'Status')).toBe(false);
  });
});

describe('multi-select', () => {
  function threeChildren(): EditorState {
    const s = new EditorState();
    s.doc.root.children = [
      { elmType: 'span', txtContent: 'a' },
      { elmType: 'span', txtContent: 'b' },
      { elmType: 'span', txtContent: 'c' },
    ];
    return s;
  }

  it('selection is the primary of the multi-selection (backward compatible)', () => {
    const s = threeChildren();
    s.select([0]);
    expect(s.selection).toEqual([0]);
    expect(s.selections).toEqual([[0]]);
    expect(s.selectedNode?.txtContent).toBe('a');
  });

  it('selectMulti / selectedNodes resolve every selected node', () => {
    const s = threeChildren();
    s.selectMulti([[0], [2]]);
    expect(s.selections).toEqual([[0], [2]]);
    expect(s.selectedNodes.map((n) => n.txtContent)).toEqual(['a', 'c']);
    expect(s.selection).toEqual([0]); // primary stays the first
  });

  it('toggleSelect adds and removes paths; isSelected reflects membership', () => {
    const s = threeChildren();
    s.select([0]);
    s.toggleSelect([1]);
    expect(s.isSelected([0])).toBe(true);
    expect(s.isSelected([1])).toBe(true);
    s.toggleSelect([0]);
    expect(s.isSelected([0])).toBe(false);
    expect(s.selections).toEqual([[1]]);
  });

  it('assigning selection = null clears it (old single-select contract)', () => {
    const s = threeChildren();
    s.select([0]);
    s.selection = null;
    expect(s.selection).toBeNull();
    expect(s.selections).toEqual([]);
    expect(s.selectedNodes).toEqual([]);
  });

  it('structural mutations collapse multi-select to the affected node', () => {
    const s = threeChildren();
    s.selectMulti([[0], [1], [2]]);
    s.removeNode([1]);
    expect(s.selections).toEqual([[]]); // removeNode sets selection to the parent
  });

  it('each surface remembers its own selection across navigation', () => {
    const s = threeChildren();
    s.select([1]);
    const sheet = s.createView(rowDoc([{ elmType: 'span' }]))!;
    s.select([0]);
    s.minimizeView();
    expect(s.selection).toEqual([1]); // the floor's selection came back
    s.openView(sheet.id);
    expect(s.selection).toEqual([0]); // and the sheet's
  });
});

describe('lens + save checkpoint', () => {
  it('setLens changes the lens and is off the undo stack', () => {
    const s = new EditorState();
    expect(s.activeLens).toBe('pro');
    let reason = '';
    s.subscribe((r) => { reason = r; });
    s.setLens('code');
    expect(s.activeLens).toBe('code');
    expect(reason).toBe('lens');
    expect(s.canUndo).toBe(false);
    s.setLens('code'); // no-op when unchanged
  });

  it('discardToSavepoint reverts every mutation since the checkpoint', () => {
    const s = new EditorState();
    s.markSavepoint();
    expect(s.isDirtySinceSave).toBe(false);
    s.insertNode({ elmType: 'span', txtContent: 'x' });
    s.insertNode({ elmType: 'span', txtContent: 'y' });
    expect(s.isDirtySinceSave).toBe(true);
    s.discardToSavepoint();
    expect(s.isDirtySinceSave).toBe(false);
  });

  it('the discard itself is undoable', () => {
    const s = new EditorState();
    s.markSavepoint();
    const before = JSON.stringify(s.doc);
    s.insertNode({ elmType: 'span', _elmName: 'inserted', txtContent: 'x' });
    s.discardToSavepoint();
    expect(JSON.stringify(s.doc)).toBe(before);
    s.undo(); // un-discard
    expect(JSON.stringify(s.doc)).not.toBe(before);
  });

  it('discard with no checkpoint is a no-op', () => {
    const s = new EditorState();
    s.insertNode({ elmType: 'span', txtContent: 'x' });
    const snap = JSON.stringify(s.doc);
    s.discardToSavepoint(); // _savepoint null → nothing happens
    expect(JSON.stringify(s.doc)).toBe(snap);
  });

  it('the savepoint is workspace-wide: a look change counts as dirt, navigation does not', () => {
    const s = new EditorState();
    const sheet = s.createView(rowDoc())!;
    s.markSavepoint();
    s.minimizeView();
    s.openView(sheet.id);
    expect(s.isDirtySinceSave).toBe(false); // pure navigation — not dirt
    s.minimizeView();
    s.removeColumnLook('Status');
    expect(s.isDirtySinceSave).toBe(true); // the look store changed
    s.discardToSavepoint();
    expect(s.isDirtySinceSave).toBe(false);
    expect(s.columnLooks['Status']._component?.id).toBe('palette-status-pill');
    expect(floorCellOf(s, 'Status')._component?.id).toBe('palette-status-pill');
  });

  it('undo/redo/discard restore the selection focus state', () => {
    const s = new EditorState();
    s.select([0]);
    s.markSavepoint();
    expect(s.selection).toEqual([0]);

    const newPath = s.insertNode({ elmType: 'span', txtContent: 'x' });
    s.select(newPath);
    expect(s.selection).toEqual(newPath);

    // Undo restores the previous selection state [0]
    s.undo();
    expect(s.selection).toEqual([0]);

    // Redo restores selection newPath
    s.redo();
    expect(s.selection).toEqual(newPath);

    // Discard restores the checkpoint selection [0]
    s.discardToSavepoint();
    expect(s.selection).toEqual([0]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CANVAS TABS (COLUMNS-COMPONENTS-VIEWS §2, Phase B) — appended test group.
// state owns tab BOOKKEEPING only: openTabs (grid always present, open
// order, rearrangeable), activeComponentTab (UI state — the workshop cover),
// and the sanitize/persistence rules. All tab gestures follow the renameView
// rule: OFF the undo stack, but autosaved ('data').
// ─────────────────────────────────────────────────────────────────────────────
import { tabKey, type CanvasTab } from './state';

describe('canvas tabs (§2): openTabs bookkeeping', () => {
  it('a fresh workspace has the standing Grid tab, active, no workshop cover', () => {
    const s = new EditorState();
    expect(s.openTabs).toEqual([{ kind: 'grid' }]);
    expect(s.activeComponentTab).toBeNull();
    expect(s.activeTabKey).toBe('grid');
  });

  it('tabKey is the stable identity: grid | view:id | component:defId', () => {
    expect(tabKey({ kind: 'grid' })).toBe('grid');
    expect(tabKey({ kind: 'view', id: 'v1' })).toBe('view:v1');
    expect(tabKey({ kind: 'component', defId: 'c-x' })).toBe('component:c-x');
  });

  it('createView appends the sheet\'s tab (sheets are born open); openView re-ensures a closed one', () => {
    const s = new EditorState();
    const a = s.createView(rowDoc())!;
    const b = s.createView(rowDoc())!;
    expect(s.openTabs).toEqual([
      { kind: 'grid' },
      { kind: 'view', id: a.id },
      { kind: 'view', id: b.id },
    ]);
    // reopening never duplicates
    s.openView(a.id);
    s.openView(b.id);
    expect(s.openTabs).toHaveLength(3);
    // close a's tab, then navigate to it — the chokepoint re-appends in open order
    s.closeTab(`view:${a.id}`);
    expect(s.openTabs.map(tabKey)).toEqual(['grid', `view:${b.id}`]);
    s.openView(a.id);
    expect(s.openTabs.map(tabKey)).toEqual(['grid', `view:${b.id}`, `view:${a.id}`]);
  });

  it('activeTabKey derives from existing state — no duplicated active-tab field for surfaces', () => {
    const s = new EditorState();
    const sheet = s.createView(rowDoc())!;
    expect(s.activeTabKey).toBe(`view:${sheet.id}`);
    s.minimizeView();
    expect(s.activeTabKey).toBe('grid');
    s.openComponentTab('c-x');
    expect(s.activeTabKey).toBe('component:c-x');
    expect(s.onFloor).toBe(true); // the surface waits untouched underneath
  });

  it('openComponentTab appends once and re-activates on focus; the doc keeps aliasing the surface', () => {
    const s = new EditorState();
    const docBefore = s.doc;
    s.openComponentTab('c-a');
    s.openComponentTab('c-b');
    s.openComponentTab('c-a'); // focus, not a new tab
    expect(s.openTabs.map(tabKey)).toEqual(['grid', 'component:c-a', 'component:c-b']);
    expect(s.activeComponentTab).toBe('c-a');
    expect(s.doc).toBe(docBefore); // activeDocKey stays 'main'; doc never re-aliases
    expect(s.activeDocKey).toBe('main');
  });

  it('surface navigation always clears the workshop cover (openView / minimizeView / deactivate)', () => {
    const s = new EditorState();
    const sheet = s.createView(rowDoc())!;
    s.openComponentTab('c-a');
    s.openView(sheet.id); // already the active surface — just uncovers it
    expect(s.activeComponentTab).toBeNull();
    expect(s.openTabs.map(tabKey)).toContain('component:c-a'); // the tab stays open

    s.openComponentTab('c-a');
    s.minimizeView(); // real navigation to the floor
    expect(s.activeComponentTab).toBeNull();
    expect(s.onFloor).toBe(true);

    s.openComponentTab('c-a');
    s.deactivateComponentTab();
    expect(s.activeComponentTab).toBeNull();
    expect(s.openTabs.map(tabKey)).toContain('component:c-a');
  });

  it('closing the ACTIVE view tab minimizes to the grid — navigation, never deletion, no undo step', () => {
    const s = new EditorState();
    const sheet = s.createView(rowDoc())!;
    const depth = undoDepth(s); // the creation only
    expect(s.closeTab(`view:${sheet.id}`)).toBe(true);
    expect(s.onFloor).toBe(true);
    expect(s.views).toHaveLength(1); // the view itself waits in the list
    expect(s.openTabs).toEqual([{ kind: 'grid' }]);
    expect(undoDepth(s)).toBe(depth);
  });

  it('closing an INACTIVE view tab never navigates', () => {
    const s = new EditorState();
    const a = s.createView(rowDoc())!;
    const b = s.createView(rowDoc())!;
    expect(s.closeTab(`view:${a.id}`)).toBe(true);
    expect(s.activeViewId).toBe(b.id); // still standing on b
    expect(s.openTabs.map(tabKey)).toEqual(['grid', `view:${b.id}`]);
  });

  it('closing the grid tab is refused; unknown keys report false', () => {
    const s = new EditorState();
    expect(s.closeTab('grid')).toBe(false);
    expect(s.closeTab('view:ghost')).toBe(false);
    expect(s.openTabs).toEqual([{ kind: 'grid' }]);
  });

  it('closing the active component tab clears activeComponentTab (the surface uncovers)', () => {
    const s = new EditorState();
    s.openComponentTab('c-a');
    s.openComponentTab('c-b');
    expect(s.closeTab('component:c-b')).toBe(true);
    expect(s.activeComponentTab).toBeNull();
    expect(s.activeTabKey).toBe('grid');
    // closing an INACTIVE component tab leaves the active one covering
    s.openComponentTab('c-a');
    s.openComponentTab('c-c');
    s.closeTab('component:c-a');
    expect(s.activeComponentTab).toBe('c-c');
  });

  it('moveTab rearranges (any tab, the Grid included); out-of-range is a no-op', () => {
    const s = new EditorState();
    const a = s.createView(rowDoc())!;
    s.openComponentTab('c-x');
    s.moveTab(2, 0); // the component tab to the front
    expect(s.openTabs.map(tabKey)).toEqual(['component:c-x', 'grid', `view:${a.id}`]);
    s.moveTab(0, 99); // clamped to the end
    expect(s.openTabs.map(tabKey)).toEqual(['grid', `view:${a.id}`, 'component:c-x']);
    const before = s.openTabs.map(tabKey);
    s.moveTab(-1, 0);
    s.moveTab(99, 0);
    s.moveTab(1, 1);
    expect(s.openTabs.map(tabKey)).toEqual(before);
  });

  it('tab gestures follow the renameView rule: OFF the undo stack, but they emit \'data\' (autosave)', () => {
    const s = new EditorState();
    const reasons: string[] = [];
    s.subscribe((r) => reasons.push(r));
    s.openComponentTab('c-a');
    s.openComponentTab('c-b');
    s.moveTab(2, 1);
    s.closeTab('component:c-a');
    s.deactivateComponentTab();
    expect(s.canUndo).toBe(false); // presentational metadata, not document edits
    expect(reasons).toContain('data');
    expect(reasons).not.toContain('document');
  });

  it('undoing a createView drops its now-dangling tab (restore-side sanitize)', () => {
    const s = new EditorState();
    s.createView(rowDoc());
    expect(s.openTabs).toHaveLength(2);
    s.undo(); // the sheet is gone — its tab must not survive as a ghost
    expect(s.openTabs).toEqual([{ kind: 'grid' }]);
    s.redo(); // the sheet returns open — openView-side ensure re-tabs it
    expect(s.views).toHaveLength(1);
  });

  it('an undo emits \'data\' even when it never moves the canvas — the list surfaces must hear it', () => {
    // undo a floor-side createView from the floor itself: no navigation
    // happens (floor → floor), but the views/tabs collections change — the
    // tab strip and views list re-render on 'data', so it must fire anyway
    const s = new EditorState();
    s.createView(rowDoc());
    s.minimizeView(); // wander back to the floor before undoing
    const reasons: string[] = [];
    s.subscribe((r) => reasons.push(r));
    s.undo(); // the sheet (and its tab) disappear; the canvas stays put
    expect(s.onFloor).toBe(true);
    expect(s.views).toHaveLength(0);
    expect(s.openTabs).toEqual([{ kind: 'grid' }]);
    expect(reasons).toContain('data');
  });

  it('persists ADDITIVELY: no openTabs key while only the Grid tab is open', () => {
    const p = JSON.parse(new EditorState().serializeProject());
    expect(p.openTabs).toBeUndefined();
    const s = new EditorState();
    const sheet = s.createView(rowDoc())!;
    const p2 = JSON.parse(s.serializeProject());
    expect(p2.openTabs).toEqual([{ kind: 'grid' }, { kind: 'view', id: sheet.id }]);
  });

  it('round-trips openTabs (order included) through serialize/load; the cover never persists', () => {
    const s = new EditorState();
    const a = s.createView(rowDoc())!;
    // a component tab for a def the stores KNOW (a palette derivation)
    s.openComponentTab('palette-status-pill');
    s.moveTab(2, 1); // rearranged order is project metadata — it round-trips
    const text = s.serializeProject();
    const s2 = new EditorState();
    s2.loadProject(text);
    expect(s2.openTabs.map(tabKey)).toEqual(['grid', 'component:palette-status-pill', `view:${a.id}`]);
    expect(s2.activeComponentTab).toBeNull(); // UI state — a reload lands on the surface
    expect(s2.serializeProject()).toBe(text);
  });

  it('sanitize-on-load: garbage entries, dangling views and unknown defs drop; grid + active view re-assert', () => {
    const s = new EditorState();
    const sheet = s.createView(rowDoc())!;
    const p = JSON.parse(s.serializeProject());
    p.openTabs = [
      { bogus: true },
      { kind: 'view', id: 'ghost' },          // no such view
      { kind: 'component', defId: 'c-ghost' }, // no such def in any store
      { kind: 'view', id: sheet.id },
      { kind: 'view', id: sheet.id },          // duplicate — deduped
    ];
    const s2 = new EditorState();
    s2.loadProject(JSON.stringify(p));
    expect(s2.openTabs).toEqual([{ kind: 'grid' }, { kind: 'view', id: sheet.id }]);
  });

  it('sanitize-on-load: an ABSENT openTabs key seeds the Grid tab plus the active view\'s', () => {
    const s = new EditorState();
    const sheet = s.createView(rowDoc())!;
    const p = JSON.parse(s.serializeProject());
    delete p.openTabs;
    const s2 = new EditorState();
    s2.loadProject(JSON.stringify(p));
    expect(s2.openTabs).toEqual([{ kind: 'grid' }, { kind: 'view', id: sheet.id }]);
    expect(s2.activeViewId).toBe(sheet.id);
  });

  it('a MALFORMED openTabs value never fails the strict guard — it is outside it', () => {
    const s = new EditorState();
    const p = JSON.parse(s.serializeProject());
    p.openTabs = 'not-an-array';
    const s2 = new EditorState();
    s2.loadProject(JSON.stringify(p)); // must not throw
    expect(s2.openTabs).toEqual([{ kind: 'grid' }]);
  });

  it('resetAll returns to the lone Grid tab with no cover', () => {
    const s = new EditorState();
    s.createView(rowDoc());
    s.openComponentTab('c-a');
    s.resetAll();
    expect(s.openTabs).toEqual([{ kind: 'grid' }]);
    expect(s.activeComponentTab).toBeNull();
  });

  it('applySnapshot(\'all\') sanitizes tabs against the restored view list', () => {
    const s = new EditorState();
    const snap = s.captureSnapshot({ kind: 'all' })!; // captured with NO views
    const sheet = s.createView(rowDoc())!;
    expect(s.openTabs.map(tabKey)).toContain(`view:${sheet.id}`);
    expect(s.applySnapshot(snap)).toBe(true);
    expect(s.views).toEqual([]);
    expect(s.openTabs).toEqual([{ kind: 'grid' }]); // the dead view's tab dropped
  });

  it('openTabs entries are plain CanvasTab data (the type round-trips as JSON)', () => {
    const tabs: CanvasTab[] = [
      { kind: 'grid' },
      { kind: 'view', id: 'v1' },
      { kind: 'component', defId: 'c-20260706-abc' },
    ];
    expect(JSON.parse(JSON.stringify(tabs))).toEqual(tabs);
    expect(tabs.map(tabKey)).toEqual(['grid', 'view:v1', 'component:c-20260706-abc']);
  });
});

describe('per-surface fold memory (PR #290 review)', () => {
  it('folds stash on navigation and restore on return — never bleeding across surfaces', () => {
    foldState.clear();
    const s = new EditorState();
    foldState.update('tree', (set) => set.add('#c/0')); // fold something on the floor
    const sheet = s.createView(rowDoc([{ elmType: 'div', children: [{ elmType: 'span', txtContent: 'x' }] }]))!;
    expect(foldState.keys()).toEqual([]); // the new sheet starts unfolded — no path bleed
    foldState.update('tree', (set) => set.add('0')); // fold on the sheet
    s.minimizeView();
    expect(foldState.keys()).toEqual(['#c/0']); // the floor's folds came back
    s.openView(sheet.id);
    expect(foldState.keys()).toEqual(['0']); // and the sheet's folds survived the round trip
    foldState.clear();
  });
});
