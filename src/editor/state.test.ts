/**
 * Editor state: customCardProps content is addressable via the CARD_SEGMENT
 * path segment, so the tree/inspector/palette can edit card formatters.
 */
import { describe, it, expect } from 'vitest';
import { EditorState, CARD_SEGMENT } from './state';
import { gridColumnField } from './gridScaffold';
import type { SPElement } from '../core/types';

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

  it('mainDocLabel describes the document, even while a ref is open', () => {
    const s = withCard();
    expect(s.mainDocLabel()).toBe('View formatter — grid'); // grid-first showcase default
    s.doc.kind = 'column';
    expect(s.mainDocLabel()).toContain('Column formatter on [$Status]');
    s.doc.kind = 'row';
    s.columnRefs['StatusUI'] = { elmType: 'span', txtContent: '[$Status]' };
    s.openColumnRef('StatusUI');
    expect(s.mainDocLabel()).toBe('View formatter — row layout'); // still describes MAIN
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
    // scans the MAIN doc even while a column formatter is open
    s.columnRefs['StatusUI'] = { elmType: 'span', txtContent: 'x' };
    s.openColumnRef('StatusUI');
    expect(s.referencedColumns().has('StatusUI')).toBe(true);
  });

  it('workspace switching: edit a column formatter, CFR registry updates live, main is restored', () => {
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

  it('serializeProject stores the MAIN doc even while a column formatter is open', () => {
    const s = withCard();
    s.columnRefs['StatusUI'] = { elmType: 'span', txtContent: '[$Status]' };
    s.openColumnRef('StatusUI');
    const p = JSON.parse(s.serializeProject());
    expect(p.doc.root.children[0].elmType).toBe('button'); // main tree, not the ref
    expect(p.columnRefs.StatusUI.txtContent).toBe('[$Status]');
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

  it('project save/load round-trips columnRefs', () => {
    const s = withCard();
    s.columnRefs['StatusUI'] = { elmType: 'span', txtContent: '[$Status]' };
    const text = s.serializeProject();
    const s2 = new EditorState();
    s2.loadProject(text);
    expect(s2.columnRefs['StatusUI'].txtContent).toBe('[$Status]');
  });
});

describe('undo/redo', () => {
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
});

describe('reparentNode', () => {
  it('adjusts the destination index after the source removal shifts it', () => {
    const s = new EditorState();
    s.doc = {
      kind: 'column',
      root: {
        elmType: 'div',
        children: [
          { elmType: 'span', _elmName: 'A' },
          { elmType: 'div', _elmName: 'B', children: [] },
          { elmType: 'div', _elmName: 'C', children: [] },
        ],
      },
    };
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
    s.doc = {
      kind: 'column',
      root: {
        elmType: 'div',
        children: [
          { elmType: 'div', _elmName: 'A', children: [{ elmType: 'span', _elmName: 'B' }] },
        ],
      },
    };
    const before = JSON.stringify(s.doc);
    s.reparentNode([0], [0, 0]); // try to move A into its own child B
    expect(JSON.stringify(s.doc)).toBe(before);
  });
});

describe('applyColumnSubtype: snapshot apply as ONE undoable mutation (US-3)', () => {
  function colPath(s: EditorState, fieldName: string): number[] {
    const kids = s.doc.root.children ?? [];
    return [kids.findIndex((c) => gridColumnField(c) === fieldName)];
  }

  it('registers the formatter, CFR-wires the cell, tags the field — and one undo reverts all three', () => {
    const s = new EditorState(); // grid-first default doc
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

describe('view name (project metadata)', () => {
  it('defaults to "View 1"', () => {
    expect(new EditorState().viewName).toBe('View 1');
  });

  it('setViewName assigns and is NOT an undoable document mutation', () => {
    const s = withCard();
    const original = JSON.stringify(s.doc);
    s.mutateDocument(() => { s.doc.root._elmName = 'Probe'; }); // one real doc step
    s.setViewName('Sprint board');
    expect(s.viewName).toBe('Sprint board');
    s.undo(); // the single undo reverts the doc step, untouched by setViewName
    expect(JSON.stringify(s.doc)).toBe(original);
    expect(s.viewName).toBe('Sprint board'); // name survives undo — it's metadata
  });

  it('blank/whitespace names fall back to "View 1"', () => {
    const s = new EditorState();
    s.setViewName('   ');
    expect(s.viewName).toBe('View 1');
  });

  it('serialize/load round-trips the name; a payload without it loads as "View 1"', () => {
    const s = new EditorState();
    s.setViewName('Roadmap');
    const s2 = new EditorState();
    s2.loadProject(s.serializeProject());
    expect(s2.viewName).toBe('Roadmap');

    // an older payload (no viewName field) defaults rather than throwing
    const legacy = JSON.parse(s.serializeProject());
    delete legacy.viewName;
    const s3 = new EditorState();
    s3.loadProject(JSON.stringify(legacy));
    expect(s3.viewName).toBe('View 1');
  });

  it('loadProject normalizes a blank/whitespace stored name to "View 1"', () => {
    const legacy = JSON.parse(new EditorState().serializeProject());
    legacy.viewName = '   ';
    const s = new EditorState();
    s.loadProject(JSON.stringify(legacy));
    expect(s.viewName).toBe('View 1');
    // and trims a padded name on load, like setViewName does
    legacy.viewName = '  Roadmap  ';
    const s2 = new EditorState();
    s2.loadProject(JSON.stringify(legacy));
    expect(s2.viewName).toBe('Roadmap');
  });

  it('resetAll restores "View 1"', () => {
    const s = new EditorState();
    s.setViewName('Whatever');
    s.resetAll();
    expect(s.viewName).toBe('View 1');
  });
});

describe('STORAGE_KEY is frozen', () => {
  it('matches the literal that protects existing autosaved work', () => {
    // HANDOFF §1: these keys deliberately never change on rename — a rename
    // here would orphan every user's autosaved project. This test must fail.
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

  it('setKind does not push an undo step when the kind is unchanged', () => {
    const s = withCard();
    const original = JSON.stringify(s.doc);
    s.mutateDocument(() => { s.doc.root._elmName = 'NoOpProbe'; }); // real change
    s.setKind(s.doc.kind); // same kind → no-op
    s.undo(); // a single undo should restore the original
    expect(JSON.stringify(s.doc)).toBe(original);
  });

  it('setKind still snapshots a real kind change so undo reverts it', () => {
    const s = withCard();
    const k0 = s.doc.kind;
    s.setKind('tile');
    expect(s.doc.kind).toBe('tile');
    s.undo();
    expect(s.doc.kind).toBe(k0);
  });
});

describe('applyRowTemplate', () => {
  it('is one undo step that reverts root + kind together', () => {
    const s = new EditorState();
    s.loadDocument({ kind: 'grid', root: { elmType: 'div', _elmName: 'grid', children: [] } });
    const newRoot: SPElement = { elmType: 'div', _elmName: 'Row layout', children: [] };
    s.applyRowTemplate(newRoot, "=if(@rowIndex % 2 == 0,'ms-bgColor-themeLighter','')");
    expect(s.doc.kind).toBe('row');
    expect(s.doc.viewExtras!.additionalRowClass as string).toContain('@rowIndex');
    s.undo();                                   // a single undo reverts BOTH
    expect(s.doc.kind).toBe('grid');
    expect(s.doc.root._elmName).toBe('grid');
  });

  it('preserves unrelated viewExtras (footerFormatter etc.)', () => {
    const s = new EditorState();
    s.loadDocument({ kind: 'row', root: { elmType: 'div' }, viewExtras: { footerFormatter: { elmType: 'div' } } });
    s.applyRowTemplate({ elmType: 'div', _elmName: 'Row layout' });
    expect(s.doc.viewExtras!.footerFormatter).toBeDefined();
  });

  it('does not push a phantom undo step when Apply reproduces the current doc', () => {
    const s = new EditorState();
    s.loadDocument({ kind: 'row', root: { elmType: 'div', _elmName: 'A', children: [] } });
    s.applyRowTemplate({ elmType: 'div', _elmName: 'B', children: [] }); // real change A→B (one undo)
    s.applyRowTemplate({ elmType: 'div', _elmName: 'B', children: [] }); // identical B→B (no undo)
    s.undo();                                                            // one undo must land on A, not a phantom B
    expect(s.doc.root._elmName).toBe('A');
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
});

describe('view switching stashes and selection recovery', () => {
  it('transitioning between views preserves undo/redo stacks, savepoint, and dirty state', () => {
    const s = new EditorState();
    s.columnRefs['StatusUI'] = { elmType: 'span', txtContent: '[$Status]' };
    s.markSavepoint();
    expect(s.isDirtySinceSave).toBe(false);

    // Make an edit in main
    s.insertNode({ elmType: 'span', txtContent: 'main-edit' });
    expect(s.isDirtySinceSave).toBe(true);
    expect(s.canUndo).toBe(true);

    // Switch to column ref
    s.openColumnRef('StatusUI');
    expect(s.activeDocKey).toBe('StatusUI');
    // Column ref has a fresh/empty undo stack & savepoint when opened
    expect(s.canUndo).toBe(false);
    expect(s.isDirtySinceSave).toBe(false);

    // Make an edit in column ref
    s.insertNode({ elmType: 'span', txtContent: 'col-edit' });
    expect(s.isDirtySinceSave).toBe(true);
    expect(s.canUndo).toBe(true);

    // Switch back to main
    s.openMain();
    expect(s.activeDocKey).toBe('main');
    // Main's undo stack, savepoint, and dirty state are stashed and restored!
    expect(s.canUndo).toBe(true);
    expect(s.isDirtySinceSave).toBe(true);

    // Undo should work and revert the main edit
    s.undo();
    expect(s.isDirtySinceSave).toBe(false);
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

describe('adversarial state robustness challenges', () => {
  it('challenge: main view undo clobbers column formatter edits due to shared columnRefs stashing', () => {
    const s = new EditorState();
    s.columnRefs['StatusUI'] = { elmType: 'span', txtContent: 'original' };
    
    // 1. Edit main view. This pushes a snapshot to main's undo stack capturing columnRefs.StatusUI as 'original'
    s.insertNode({ elmType: 'span', txtContent: 'main-edit' });
    
    // 2. Switch to column ref StatusUI
    s.openColumnRef('StatusUI');
    
    // 3. Edit StatusUI. This updates columnRefs.StatusUI to 'col-edit'
    s.insertNode({ elmType: 'span', txtContent: 'col-edit' });
    expect(s.columnRefs['StatusUI'].children?.[0]?.txtContent).toBe('col-edit');
    
    // 4. Return to main view
    s.openMain();
    expect(s.columnRefs['StatusUI'].children?.[0]?.txtContent).toBe('col-edit');
    
    // 5. Undo in main view. This pops the snapshot from step 1, restoring its columnRefs
    s.undo();
    
    // 6. Check if StatusUI edit survived the main view undo
    expect(s.columnRefs['StatusUI'].children?.[0]?.txtContent).toBe('col-edit'); // Should fail if clobbered!
  });

  it('challenge: editing a column ref makes the main view dirty since save', () => {
    const s = new EditorState();
    s.columnRefs['StatusUI'] = { elmType: 'span', txtContent: 'original' };
    s.markSavepoint();
    expect(s.isDirtySinceSave).toBe(false);

    // 1. Switch to StatusUI
    s.openColumnRef('StatusUI');
    
    // 2. Edit StatusUI
    s.insertNode({ elmType: 'span', txtContent: 'col-edit' });
    
    // 3. Switch back to main
    s.openMain();
    
    // 4. Main document was never mutated, but is it dirty since save?
    // Expect: false (main view itself should be clean because we only edited StatusUI, which has its own savepoint/history)
    expect(s.isDirtySinceSave).toBe(false); // Should fail if main is considered dirty!
  });

  it('challenge: multi-view selection stashing and restore', () => {
    const s = new EditorState();
    s.columnRefs['StatusUI'] = { elmType: 'span', txtContent: 'original' };
    s.select([0]); // select in main
    expect(s.selection).toEqual([0]);

    s.openColumnRef('StatusUI');
    // expect column selection to start empty/root
    expect(s.selection).toEqual([]);
    
    // select in StatusUI
    s.select([0, 0]);
    expect(s.selection).toEqual([0, 0]);

    s.openMain();
    // Challenge: does it restore main's selection?
    expect(s.selection).toEqual([0]); // Should fail if lost/reset to []!
  });

  it('challenge: mixed gestures and heavy switching stress test', () => {
    const s = new EditorState();
    s.columnRefs['StatusUI'] = { elmType: 'span', txtContent: 'StatusOriginal' };
    s.columnRefs['OwnerUI'] = { elmType: 'span', txtContent: 'OwnerOriginal' };
    
    // Edit main
    s.insertNode({ elmType: 'span', txtContent: 'main-1' });
    
    // Switch to StatusUI and edit
    s.openColumnRef('StatusUI');
    s.insertNode({ elmType: 'span', txtContent: 'status-1' });
    
    // Switch to OwnerUI and edit
    s.openColumnRef('OwnerUI');
    s.insertNode({ elmType: 'span', txtContent: 'owner-1' });
    
    // Undo in OwnerUI
    s.undo();
    expect(s.doc.root.children).toBeUndefined(); // reverted to original (no children)
    
    // Switch to StatusUI
    s.openColumnRef('StatusUI');
    // StatusUI should still have status-1
    expect(s.doc.root.children?.[0]?.txtContent).toBe('status-1');
    
    // Redo in StatusUI? There is no redo left because we didn't undo in StatusUI
    expect(s.canRedo).toBe(false);
    
    // Switch to main
    s.openMain();
    expect(s.doc.root.children?.[s.doc.root.children.length - 1]?.txtContent).toBe('main-1');
  });

  it('subscribe returns an unsubscribe function that removes the listener', () => {
    const s = new EditorState();
    let count = 0;
    const listener = () => { count++; };

    const unsub = s.subscribe(listener);
    s.emit('document');
    expect(count).toBe(1);

    // Calling the returned unsubscribe stops further notifications: emitting
    // again must not increase the count, and the listener is gone from the list.
    unsub();
    s.emit('document');
    expect(count).toBe(1);
    expect((s as any).listeners).not.toContain(listener);
  });

  it('challenge: undoing in one column ref view clobbers edits made in another column ref view', () => {
    const s = new EditorState();
    s.columnRefs['StatusUI'] = { elmType: 'span', txtContent: 'StatusOriginal' };
    s.columnRefs['OwnerUI'] = { elmType: 'span', txtContent: 'OwnerOriginal' };

    // 1. Open StatusUI and edit it.
    s.openColumnRef('StatusUI');
    s.insertNode({ elmType: 'span', txtContent: 'status-edited' });
    expect(s.columnRefs['StatusUI'].children?.[0]?.txtContent).toBe('status-edited');

    // 2. Open OwnerUI and edit it.
    s.openColumnRef('OwnerUI');
    s.insertNode({ elmType: 'span', txtContent: 'owner-edited' });
    expect(s.columnRefs['OwnerUI'].children?.[0]?.txtContent).toBe('owner-edited');

    // 3. Switch back to StatusUI
    s.openColumnRef('StatusUI');

    // 4. Undo in StatusUI.
    s.undo();

    // 5. Verify StatusUI was reverted
    expect(s.doc.root.children).toBeUndefined();

    // 6. Verify OwnerUI still has 'owner-edited'
    expect(s.columnRefs['OwnerUI'].children?.[0]?.txtContent).toBe('owner-edited');
  });
});



