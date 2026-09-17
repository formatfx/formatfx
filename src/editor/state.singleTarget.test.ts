/**
 * Single-target mode — the SPFx panel edits ONE target document (spec
 * 2026-09-16 §2.3). The web app never enters this mode; these are its
 * contract: any kind (column included) is the lone sheet, "Apply to canvas"
 * replaces it in place and never routes into looks or new sheets.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { state } from './state';
import type { FormatterDocument } from '../core/types';

const column: FormatterDocument = { kind: 'column', root: { elmType: 'div', txtContent: '@currentField' } };
const row: FormatterDocument = { kind: 'row', root: { elmType: 'div', children: [{ elmType: 'span' }] }, hideSelection: true };

beforeEach(() => { state.resetAll(); state.singleTargetKind = null; });

describe('openTargetDocument', () => {
  it('makes a column document the only sheet and the live doc', () => {
    state.openTargetDocument(column, 'Status (column)');
    expect(state.singleTargetKind).toBe('column');
    expect(state.views).toHaveLength(1);
    expect(state.views[0].name).toBe('Status (column)');
    expect(state.doc.kind).toBe('column');
    expect(state.doc.root.txtContent).toBe('@currentField');
    expect(state.canUndo).toBe(false);
    expect(state.isDirtySinceSave).toBe(false);
  });
  it('replaces a previous target entirely (no undo across targets)', () => {
    state.openTargetDocument(column, 'A');
    state.mutateDocument(() => { state.doc.root.txtContent = 'x'; });
    state.openTargetDocument(row, 'B');
    expect(state.views).toHaveLength(1);
    expect(state.doc.kind).toBe('row');
    expect(state.canUndo).toBe(false);
  });
});

describe('loadDocument in single-target mode', () => {
  it('replaces the column sheet in place as one undo step (never a look)', () => {
    state.openTargetDocument(column, 'A');
    state.loadDocument({ kind: 'column', root: { elmType: 'span' } });
    expect(state.views).toHaveLength(1);
    expect(state.doc.kind).toBe('column');
    expect(state.doc.root.elmType).toBe('span');
    expect(state.columnLooks.Status).toBeUndefined();
    expect(state.canUndo).toBe(true);
    state.undo();
    expect(state.doc.root.elmType).toBe('div');
  });
  it('coerces a pasted row payload to the column target kind', () => {
    state.openTargetDocument(column, 'A');
    state.loadDocument(row);
    expect(state.doc.kind).toBe('column');
    expect(state.doc.hideSelection).toBeUndefined();
  });
  it('keeps a view target a view: row ↔ tile follow the payload, column payloads become row', () => {
    state.openTargetDocument(row, 'V');
    state.loadDocument({ kind: 'tile', root: { elmType: 'div' }, tileWidth: 300 });
    expect(state.doc.kind).toBe('tile');
    expect(state.doc.tileWidth).toBe(300);
    expect(state.doc.tileHeight).toBe(220);
    state.loadDocument(column);
    expect(state.doc.kind).toBe('row');
    expect(state.views).toHaveLength(1);
  });
  it('is inert for the web app: without the mode, a column payload still becomes a look', () => {
    state.loadDocument(column);
    expect(state.columnLooks[state.currentFieldName]).toBeDefined();
  });
});
