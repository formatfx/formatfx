/**
 * Editor state contracts (FLOOR-AND-SHEETS Stage 1):
 *   · the workspace is a FLOOR (columns-only grid document) plus named
 *     SHEETS (row/tile view documents) — separate documents, no relabeling;
 *   · leaving/opening a view is NAVIGATION — it never mutates and never
 *     pushes an undo step;
 *   · undo is ONE GLOBAL app-level stack across the floor, every sheet, and
 *     the column drill-in — and it navigates back to the surface it changes;
 *   · autosave format v2 (same frozen key) with a strict load guard: an old
 *     or garbled blob falls back to a fresh default — no migration code.
 * Plus: customCardProps content stays addressable via CARD_SEGMENT paths.
 */
import { describe, it, expect } from 'vitest';
import { EditorState, CARD_SEGMENT } from './state';
import { gridColumnField } from './gridScaffold';
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

  it('referencedColumns finds CFRs in children and inside customCardProps', () => {
    const s = withCard();
    s.doc.root.children!.push({ elmType: 'div', columnFormatterReference: '[$StatusUI]' });
    s.doc.root.children![0].customCardProps!.formatter.children!.push(
      { elmType: 'div', columnFormatterReference: '[$ProgressUI]' },
    );
    const refs = s.referencedColumns();
    expect(refs.has('StatusUI')).toBe(true);
    expect(refs.has('ProgressUI')).toBe(true);
    // scans the active SURFACE even while a column formatter is drilled open
    s.columnRefs['StatusUI'] = { elmType: 'span', txtContent: 'x' };
    s.openColumnRef('StatusUI');
    expect(s.referencedColumns().has('StatusUI')).toBe(true);
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

describe('navigation is never a mutation', () => {
  it('openView / minimizeView push nothing onto the undo stack and touch no document', () => {
    const s = new EditorState();
    const sheet = s.createView(rowDoc([{ elmType: 'span', txtContent: 'x' }]))!;
    const sheetJson = JSON.stringify(sheet.doc);
    const floorJson = JSON.stringify(s.floorDoc);
    expect(s.canUndo).toBe(true); // the creation itself
    s.undo(); // clear the stack down to nothing
    s.redo(); // sheet back, open
    const undoDepth = 1;

    s.minimizeView();
    expect(s.onFloor).toBe(true);
    s.openView(sheet.id);
    expect(s.activeViewId).toBe(sheet.id);
    s.minimizeView();

    expect(JSON.stringify(s.viewById(sheet.id)!.doc)).toBe(sheetJson);
    expect(JSON.stringify(s.floorDoc)).toBe(floorJson);
    expect((s as unknown as { undoStack: string[] }).undoStack).toHaveLength(undoDepth);
  });

  it('minimize remembers the way back (lastOpenViewId feeds the ⟳ Reopen bar)', () => {
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

  it('surface flips stay available while drilled into a column formatter', () => {
    const s = new EditorState();
    const sheet = s.createView(rowDoc())!;
    s.openColumnRef('Status');
    expect(s.activeDocKey).toBe('Status');
    s.minimizeView(); // the surface under the drill switches to the floor
    expect(s.onFloor).toBe(true);
    expect(s.activeDocKey).toBe('Status'); // the drill stays put
    expect(s.doc.kind).toBe('column');
    s.openView(sheet.id);
    expect(s.activeViewId).toBe(sheet.id);
    expect(s.activeDocKey).toBe('Status');
    s.openMain(); // Done lands on the surface that's up: the sheet
    expect(s.doc).toBe(s.viewById(sheet.id)!.doc);
  });

  it('goBack retraces surface and drill switches', () => {
    const s = new EditorState();
    const sheet = s.createView(rowDoc())!; // now on the sheet
    s.openColumnRef('Status');
    expect(s.backTarget).toBe('main');
    s.goBack();
    expect(s.activeDocKey).toBe('main');
    expect(s.activeViewId).toBe(sheet.id);
    s.goBack(); // back to the floor (where createView started from)
    expect(s.onFloor).toBe(true);
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

  it('column drill-in edits are app-level steps on the same stack', () => {
    const s = new EditorState();
    s.columnRefs['StatusUI'] = { elmType: 'span', txtContent: 'original' };
    const floorLen = s.floorDoc.root.children!.length;
    s.insertNode({ elmType: 'span', txtContent: 'floor-edit' }); // step 1 (floor)
    s.openColumnRef('StatusUI');                                 // navigation
    s.insertNode({ elmType: 'span', txtContent: 'col-edit' });   // step 2 (column)
    s.openMain();                                                // navigation
    expect(s.columnRefs['StatusUI'].children?.[0]?.txtContent).toBe('col-edit');

    s.undo(); // step 2 reverts — undo re-drills into the column it changes
    expect(s.activeDocKey).toBe('StatusUI');
    expect(s.columnRefs['StatusUI'].children).toBeUndefined();

    s.undo(); // step 1 reverts — back out to the floor
    expect(s.activeDocKey).toBe('main');
    expect(s.onFloor).toBe(true);
    expect(s.floorDoc.root.children).toHaveLength(floorLen);
  });

  it('two drill-ins interleave chronologically without clobbering each other', () => {
    const s = new EditorState();
    s.columnRefs['StatusUI'] = { elmType: 'span', txtContent: 'StatusOriginal' };
    s.columnRefs['OwnerUI'] = { elmType: 'span', txtContent: 'OwnerOriginal' };
    s.openColumnRef('StatusUI');
    s.insertNode({ elmType: 'span', txtContent: 'status-edited' });
    s.openColumnRef('OwnerUI');
    s.insertNode({ elmType: 'span', txtContent: 'owner-edited' });

    s.undo(); // last change first: the OwnerUI edit
    expect(s.columnRefs['OwnerUI'].children).toBeUndefined();
    expect(s.columnRefs['StatusUI'].children?.[0]?.txtContent).toBe('status-edited');

    s.undo(); // then the StatusUI edit — and the canvas re-drills there
    expect(s.activeDocKey).toBe('StatusUI');
    expect(s.columnRefs['StatusUI'].children).toBeUndefined();
    expect(s.columnRefs['OwnerUI'].children).toBeUndefined();
  });

  it('editing while drilled live-syncs the registry; the surface object survives the trip', () => {
    const s = withCard();
    s.columnRefs['StatusUI'] = { elmType: 'span', txtContent: '[$Status]' };
    const mainRoot = s.doc.root;

    s.openColumnRef('StatusUI');
    expect(s.activeDocKey).toBe('StatusUI');
    expect(s.doc.kind).toBe('column');
    expect(s.doc.root.txtContent).toBe('[$Status]');

    // edit while open — registry must reflect it immediately
    s.mutateDocument(() => { s.doc.root.txtContent = '=toUpperCase([$Status])'; });
    expect(s.columnRefs['StatusUI'].txtContent).toBe('=toUpperCase([$Status])');

    s.openMain();
    expect(s.activeDocKey).toBe('main');
    expect(s.doc.root).toBe(mainRoot);
    expect(s.columnRefs['StatusUI'].txtContent).toBe('=toUpperCase([$Status])');
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

describe('reparentNode', () => {
  const seedColumnDrill = (s: EditorState, root: SPElement): void => {
    // structural tests want an arbitrary tree on the canvas — a drilled
    // column doc is the simplest host for one under the new model
    s.columnRefs['Probe'] = root;
    s.openColumnRef('Probe');
  };

  it('adjusts the destination index after the source removal shifts it', () => {
    const s = new EditorState();
    seedColumnDrill(s, {
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
    seedColumnDrill(s, {
      elmType: 'div',
      children: [
        { elmType: 'div', _elmName: 'A', children: [{ elmType: 'span', _elmName: 'B' }] },
      ],
    });
    const before = JSON.stringify(s.doc);
    s.reparentNode([0], [0, 0]); // try to move A into its own child B
    expect(JSON.stringify(s.doc)).toBe(before);
  });

  it('dropping onto a solo-CFR host splits the reference into its own child (no absorption)', () => {
    const s = new EditorState();
    const sheet = s.createView(rowDoc([
      { elmType: 'span', _elmName: 'Extra', txtContent: '[$Title]' },
      {
        elmType: 'div',
        _elmName: 'Status',
        columnFormatterReference: '[$Status]',
        style: { 'flex': '1', 'min-width': '0' },
      },
    ]))!;
    // drop Extra (index 0) onto the Status CFR host (index 1)
    s.reparentNode([0], [1]);
    // removing Extra shifts the host to index 0; it is now a plain container
    const host = sheet.doc.root.children![0];
    expect(host.columnFormatterReference).toBeUndefined(); // no longer absorbs
    expect(host._elmName).toBeUndefined(); // the column name went down with the ref
    expect(host.style).toEqual({ 'flex': '1', 'min-width': '0' }); // slot styles stay put
    // the div now HOSTS the reference and the dropped node as siblings
    expect(host.children!.map((c) => c.columnFormatterReference)).toEqual(['[$Status]', undefined]);
    expect(host.children![0]._elmName).toBe('Status'); // ref cell keeps the column name
    expect(host.children![1]._elmName).toBe('Extra');
    // one undo reverts the whole restructure
    s.undo();
    expect(s.doc.root.children![1].columnFormatterReference).toBe('[$Status]');
    expect(s.doc.root.children![1].children).toBeUndefined();
  });

  it('inserting into a solo-CFR host splits the reference out too', () => {
    const s = new EditorState();
    s.createView(rowDoc([
      { elmType: 'div', _elmName: 'Status', columnFormatterReference: '[$Status]' },
    ]));
    const path = s.insertNode({ elmType: 'span', txtContent: 'new' }, [0]);
    expect(path).toEqual([0, 1]); // beside the extracted ref, not swallowed
    const host = s.doc.root.children![0];
    expect(host.columnFormatterReference).toBeUndefined();
    expect(host.children!.map((c) => c.columnFormatterReference)).toEqual(['[$Status]', undefined]);
    expect(s.nodeAt(path)?.txtContent).toBe('new');
  });
});

describe('applyColumnSubtype: snapshot apply as ONE undoable mutation (US-3)', () => {
  function colPath(s: EditorState, fieldName: string): number[] {
    const kids = s.doc.root.children ?? [];
    return [kids.findIndex((c) => gridColumnField(c) === fieldName)];
  }

  it('registers the formatter, CFR-wires the cell, tags the field — and one undo reverts all three', () => {
    const s = new EditorState(); // the floor grid
    const field = s.fields.find((f) => f.name === 'DueDate')!; // an unformatted column
    const path = colPath(s, 'DueDate');
    const baked: SPElement = { elmType: 'div', txtContent: '=toLocaleDateString(@currentField)' };

    s.applyColumnSubtype('DueDate', baked, 'date-badge', {}, path);

    expect(field.subtype).toBe('date-badge');
    expect(field.subtypeArgs).toEqual({});
    expect(s.columnRefs['DueDate']).toBe(baked);
    expect(s.nodeAt(path)?.columnFormatterReference).toBeTruthy();

    s.undo(); // single Ctrl+Z
    expect(s.nodeAt(path)?.columnFormatterReference).toBeFalsy();
    expect(field.subtype).toBeUndefined();
    expect(field.subtypeArgs).toBeUndefined();
  });

  it('redo re-applies the tag and the formatter together', () => {
    const s = new EditorState();
    const field = s.fields.find((f) => f.name === 'DueDate')!;
    const path = colPath(s, 'DueDate');
    s.applyColumnSubtype('DueDate', { elmType: 'div', txtContent: 'x' }, 'date-badge', {}, path);
    s.undo();
    s.redo();
    expect(field.subtype).toBe('date-badge');
    expect(s.nodeAt(path)?.columnFormatterReference).toBeTruthy();
  });

  it('does not entangle structural field edits with the doc undo (no regression)', () => {
    const s = new EditorState();
    const path = colPath(s, 'DueDate');
    s.applyColumnSubtype('DueDate', { elmType: 'div', txtContent: 'x' }, 'date-badge', {}, path);
    s.fields.push({ name: 'Extra', type: 'text' }); // a later, non-snapshotting edit
    s.undo(); // undoing the apply must NOT remove the field added afterwards
    expect(s.fields.some((f) => f.name === 'Extra')).toBe(true);
    expect(s.fields.find((f) => f.name === 'DueDate')!.subtype).toBeUndefined();
  });
});

describe('pushSubtypeUpdate: batched re-bake, one undo reverts all columns (US-7)', () => {
  it('re-bakes every column tagged with the subtype from its stored args', () => {
    const s = new EditorState();
    const a = s.fields.find((f) => f.name === 'DueDate')!;
    const b = s.fields.find((f) => f.name === 'Title')!;
    a.subtype = 'cc'; a.subtypeArgs = {};
    b.subtype = 'cc'; b.subtypeArgs = {};
    s.columnRefs['DueDate'] = { elmType: 'div', txtContent: 'OLD' };
    s.columnRefs['Title'] = { elmType: 'div', txtContent: 'OLD' };

    const n = s.pushSubtypeUpdate('cc', () => ({ elmType: 'div', txtContent: 'NEW' }));
    expect(n).toBe(2);
    expect(s.columnRefs['DueDate'].txtContent).toBe('NEW');
    expect(s.columnRefs['Title'].txtContent).toBe('NEW');

    s.undo(); // ONE Ctrl+Z reverts BOTH columns
    expect(s.columnRefs['DueDate'].txtContent).toBe('OLD');
    expect(s.columnRefs['Title'].txtContent).toBe('OLD');

    s.redo(); // and redo re-applies the whole batch
    expect(s.columnRefs['DueDate'].txtContent).toBe('NEW');
    expect(s.columnRefs['Title'].txtContent).toBe('NEW');
  });

  it('overwrites a hand-edited column and Ctrl+Z recovers it (spec edge case)', () => {
    const s = new EditorState();
    const a = s.fields.find((f) => f.name === 'DueDate')!;
    a.subtype = 'cc'; a.subtypeArgs = {};
    s.columnRefs['DueDate'] = { elmType: 'div', txtContent: 'HAND-EDITED' }; // a maker's hand-edit
    s.pushSubtypeUpdate('cc', () => ({ elmType: 'div', txtContent: 'REBAKED' }));
    expect(s.columnRefs['DueDate'].txtContent).toBe('REBAKED'); // hand-edit overwritten
    s.undo();
    expect(s.columnRefs['DueDate'].txtContent).toBe('HAND-EDITED'); // recovered
  });

  it('a push and a prior doc edit unwind in order (interleaved)', () => {
    const s = new EditorState();
    const a = s.fields.find((f) => f.name === 'DueDate')!;
    a.subtype = 'cc'; a.subtypeArgs = {};
    s.columnRefs['DueDate'] = { elmType: 'div', txtContent: 'OLD' };
    s.insertNode({ elmType: 'span', txtContent: 'x' });   // a doc mutation
    const docAfterInsert = JSON.stringify(s.doc);
    s.pushSubtypeUpdate('cc', () => ({ elmType: 'div', txtContent: 'NEW' }));
    s.undo(); // undo the push only
    expect(s.columnRefs['DueDate'].txtContent).toBe('OLD');
    expect(JSON.stringify(s.doc)).toBe(docAfterInsert);   // the insert survived
    s.undo(); // undo the doc edit
    expect(JSON.stringify(s.doc)).not.toBe(docAfterInsert);
  });

  it('re-bakes from each column\'s own stored subtypeArgs', () => {
    const s = new EditorState();
    const a = s.fields.find((f) => f.name === 'DueDate')!;
    a.subtype = 'cc'; a.subtypeArgs = { Symbol: '€' };
    s.columnRefs['DueDate'] = { elmType: 'div', txtContent: 'x' };
    s.pushSubtypeUpdate('cc', (args) => ({ elmType: 'div', txtContent: String(args.Symbol ?? '?') }));
    expect(s.columnRefs['DueDate'].txtContent).toBe('€');
  });

  it('returns 0 and snapshots nothing when no column uses the subtype', () => {
    const s = new EditorState();
    const n = s.pushSubtypeUpdate('nobody', () => ({ elmType: 'div' }));
    expect(n).toBe(0);
    s.undo(); // nothing to undo — no throw, no change
  });
});

describe('batchProjectUpdate: the component editor\'s one-step apply', () => {
  it('doc replacement + registry re-bake + tag restamp revert on ONE undo', () => {
    const s = new EditorState();
    s.doc.root.children = [{ elmType: 'div', txtContent: 'OLD-VIEW', _component: { id: 'c-x', map: {} } }];
    s.columnRefs['DueDate'] = { elmType: 'div', txtContent: 'OLD-COL' };
    const due = s.fields.find((f) => f.name === 'DueDate')!;
    due.subtype = 'c-x';
    const before = JSON.stringify(s.doc);

    s.batchProjectUpdate(['DueDate'], () => {
      s.doc.root.children![0] = { elmType: 'div', txtContent: 'NEW-VIEW', _component: { id: 'c-x', map: {} } };
      s.columnRefs['DueDate'] = { elmType: 'div', txtContent: 'NEW-COL' };
      due.subtype = 'c-x-variant';
    });
    expect(s.doc.root.children![0].txtContent).toBe('NEW-VIEW');
    expect(s.columnRefs['DueDate'].txtContent).toBe('NEW-COL');
    expect(due.subtype).toBe('c-x-variant');

    s.undo(); // ONE Ctrl+Z reverts ALL THREE together
    expect(JSON.stringify(s.doc)).toBe(before);
    expect(s.columnRefs['DueDate'].txtContent).toBe('OLD-COL');
    expect(s.fields.find((f) => f.name === 'DueDate')!.subtype).toBe('c-x');

    s.redo(); // and redo re-applies the whole batch
    expect(s.doc.root.children![0].txtContent).toBe('NEW-VIEW');
    expect(s.columnRefs['DueDate'].txtContent).toBe('NEW-COL');
    expect(s.fields.find((f) => f.name === 'DueDate')!.subtype).toBe('c-x-variant');
  });

  it('leaves a drilled column first, so the SURFACE is live inside the snapshot', () => {
    const s = new EditorState();
    s.openColumnRef('Status');
    expect(s.activeDocKey).toBe('Status');
    s.batchProjectUpdate([], () => {
      s.doc.root.children![0]._elmName = 'Renamed by the apply';
    });
    expect(s.activeDocKey).toBe('main'); // navigation happened before the mutate
    expect(s.doc.root.children![0]._elmName).toBe('Renamed by the apply');
    s.undo();
    expect(s.doc.root.children![0]._elmName).not.toBe('Renamed by the apply');
  });

  it('a no-op fn leaves ZERO trace — no undo step', () => {
    const s = new EditorState();
    s.columnRefs['DueDate'] = { elmType: 'div', txtContent: 'OLD' };
    expect(s.canUndo).toBe(false);
    s.batchProjectUpdate(['DueDate'], () => { /* nothing */ });
    expect(s.canUndo).toBe(false);
    expect(s.columnRefs['DueDate'].txtContent).toBe('OLD');
  });
});

describe('autosave format v2 (same frozen key, strict load guard)', () => {
  it('serializeProject emits the workspace: floor, views, activeViewId', () => {
    const s = new EditorState();
    const sheet = s.createView(rowDoc([{ elmType: 'span', txtContent: 'x' }]), 'Sprint board')!;
    const p = JSON.parse(s.serializeProject());
    expect(p.version).toBe(2);
    expect(p.floor.kind).toBe('grid');
    expect(p.floor.root.elmType).toBe('div');
    expect(p.views).toHaveLength(1);
    expect(p.views[0]).toMatchObject({ id: sheet.id, name: 'Sprint board' });
    expect(p.views[0].doc.kind).toBe('row');
    expect(p.activeViewId).toBe(sheet.id);
    expect(p.doc).toBeUndefined(); // the old single-document key is GONE
  });

  it('round-trips the whole workspace, including where you stood', () => {
    const s = new EditorState();
    s.createView(rowDoc(), 'A');
    const b = s.createView({ kind: 'tile', root: { elmType: 'div' } }, 'B')!;
    s.columnRefs['StatusUI'] = { elmType: 'span', txtContent: '[$Status]' };
    const text = s.serializeProject();

    const s2 = new EditorState();
    s2.loadProject(text);
    expect(s2.views.map((v) => v.name)).toEqual(['A', 'B']);
    expect(s2.activeViewId).toBe(b.id);
    expect(s2.doc).toBe(s2.viewById(b.id)!.doc); // reload lands where you left off
    expect(s2.doc.tileWidth).toBe(254);
    expect(s2.columnRefs['StatusUI'].txtContent).toBe('[$Status]');
    expect(s2.serializeProject()).toBe(text);
  });

  it('serializeProject stores the drilled column\'s live tree in the registry', () => {
    const s = withCard();
    s.columnRefs['StatusUI'] = { elmType: 'span', txtContent: '[$Status]' };
    s.openColumnRef('StatusUI');
    s.mutateDocument(() => { s.doc.root.txtContent = 'edited'; });
    const p = JSON.parse(s.serializeProject());
    expect(p.floor.root.children[0].elmType).toBe('button'); // the floor, not the drill
    expect(p.columnRefs.StatusUI.txtContent).toBe('edited');
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

  it('rejects malformed views (wrong kind, missing id) rather than guessing', () => {
    const s = new EditorState();
    const good = JSON.parse(s.serializeProject());
    good.views = [{ id: 'v1', name: 'X', doc: { kind: 'grid', root: { elmType: 'div' } } }];
    expect(() => new EditorState().loadProject(JSON.stringify(good))).toThrow(/workspace file/);
    good.views = [{ name: 'X', doc: { kind: 'row', root: { elmType: 'div' } } }];
    expect(() => new EditorState().loadProject(JSON.stringify(good))).toThrow(/workspace file/);
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

  it('resetAll returns to the fresh floor-only workspace', () => {
    const s = new EditorState();
    s.createView(rowDoc(), 'Whatever');
    s.resetAll();
    expect(s.views).toEqual([]);
    expect(s.onFloor).toBe(true);
    expect(s.doc).toBe(s.floorDoc);
  });
});

describe('STORAGE_KEY is frozen', () => {
  it('matches the literal that protects existing autosaved work', () => {
    // HANDOFF §1: these keys deliberately never change on rename — a rename
    // here would orphan every user's autosaved project. This test must fail.
    // (Frozen NAMES, not frozen formats — the payload is v2 now.)
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
    const undoDepth = (s as unknown as { undoStack: string[] }).undoStack.length;
    s.setKind('grid');
    expect(s.onFloor).toBe(true);
    expect(s.views).toHaveLength(1); // the sheet survives, untouched
    expect(s.viewById(sheet.id)!.doc.kind).toBe('row');
    expect((s as unknown as { undoStack: string[] }).undoStack).toHaveLength(undoDepth);
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
    expect(s.doc.viewExtras!.additionalRowClass as string).toContain('@rowIndex');
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
    expect(s.doc.viewExtras!.additionalRowClass).toBe('zebra');
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
  it('on the floor, a row payload replaces the FLOOR ROOT — kind stays grid (lossless round-trip)', () => {
    const s = new EditorState();
    s.loadDocument({ kind: 'row', root: { elmType: 'div', _elmName: 'pasted', children: [] } });
    expect(s.onFloor).toBe(true);
    expect(s.doc.kind).toBe('grid');
    expect(s.doc.root._elmName).toBe('pasted');
    s.undo();
    expect(s.doc.root._elmName).toBe('Row layout'); // the default floor scaffold
  });

  it('on the floor, a tile payload becomes a NEW sheet (a tile can never be a floor)', () => {
    const s = new EditorState();
    s.loadDocument({ kind: 'tile', root: { elmType: 'div', _elmName: 'tile' } });
    expect(s.views).toHaveLength(1);
    expect(s.doc.kind).toBe('tile');
  });

  it('on the floor, a column payload registers to the current field and drills in', () => {
    const s = new EditorState();
    s.currentFieldName = 'DueDate';
    s.loadDocument({ kind: 'column', root: { elmType: 'div', txtContent: '@currentField' } });
    expect(s.activeDocKey).toBe('DueDate');
    expect(s.doc.kind).toBe('column');
    expect(s.columnRefs['DueDate'].txtContent).toBe('@currentField');
  });

  it('on a sheet, the payload replaces the sheet document (kind follows the payload)', () => {
    const s = new EditorState();
    const sheet = s.createView(rowDoc())!;
    s.loadDocument({ kind: 'tile', root: { elmType: 'div', _elmName: 'T' } });
    expect(s.activeViewId).toBe(sheet.id);
    expect(s.viewById(sheet.id)!.doc.kind).toBe('tile');
    expect(s.viewById(sheet.id)!.doc.root._elmName).toBe('T');
    expect(s.doc).toBe(s.viewById(sheet.id)!.doc);
  });

  it('while drilled, the payload replaces the column tree and live-syncs the registry', () => {
    const s = new EditorState();
    s.openColumnRef('Status');
    s.loadDocument({ kind: 'column', root: { elmType: 'div', txtContent: 'replaced' } });
    expect(s.activeDocKey).toBe('Status');
    expect(s.columnRefs['Status'].txtContent).toBe('replaced');
    s.undo();
    expect(s.columnRefs['Status'].txtContent).not.toBe('replaced');
  });

  it('loadColumnDocument is one undoable step; undo unregisters the format', () => {
    const s = new EditorState();
    expect('Tags' in s.columnRefs).toBe(false);
    s.loadColumnDocument({ elmType: 'div', txtContent: '@currentField' }, 'Tags');
    expect(s.activeDocKey).toBe('Tags');
    s.undo();
    expect('Tags' in s.columnRefs).toBe(false);
    expect(s.activeDocKey).toBe('main');
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

  it('the savepoint is workspace-wide: a column edit counts as dirt, navigation does not', () => {
    const s = new EditorState();
    const sheet = s.createView(rowDoc())!;
    s.markSavepoint();
    s.minimizeView();
    s.openView(sheet.id);
    expect(s.isDirtySinceSave).toBe(false); // pure navigation — not dirt
    s.openColumnRef('Status');
    s.insertNode({ elmType: 'span', txtContent: 'col-edit' });
    expect(s.isDirtySinceSave).toBe(true); // the registry changed
    s.discardToSavepoint();
    expect(s.isDirtySinceSave).toBe(false);
    expect(s.columnRefs['Status'].children).toBeUndefined();
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

describe('mainRootForScope', () => {
  it('returns the live root on the surface, and the surface root while drilled', () => {
    const s = new EditorState();
    const floorRoot = s.doc.root;
    s.columnRefs['Status'] = { elmType: 'div', txtContent: '@currentField' };
    s.openColumnRef('Status');
    expect(s.activeDocKey).toBe('Status');
    expect(s.mainRootForScope).toBe(floorRoot);
    s.openMain();
    expect(s.mainRootForScope).toBe(s.doc.root);
  });

  it('tracks the sheet when one is up', () => {
    const s = new EditorState();
    const sheet = s.createView(rowDoc())!;
    s.openColumnRef('Status');
    expect(s.mainRootForScope).toBe(sheet.doc.root);
  });
});
