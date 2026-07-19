// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Sam Yost

/**
 * editor/previewCtx.ts — the shared preview eval context so a "live preview"
 * outside the canvas (the template modal) uses the identical eval path.
 * Mirrors the ctx assembly inlined in canvas.ts; new preview surfaces import
 * from here rather than re-deriving it.
 */
import { state } from './state';
import type { EvalContext } from '../core/expressions';

export function ctxForRow(rowIndex: number): EvalContext {
  return {
    row: state.rows[rowIndex] ?? {},
    rowIndex,
    currentFieldName: state.currentFieldName,
    me: state.me,
    iterators: {},
    iteratorIndex: {},
    displayNames: Object.fromEntries(state.fields.map((f) => [f.name, f.displayName ?? f.name])),
    fieldTypes: Object.fromEntries(state.fields.map((f) => [f.name, f.type])),
    now: new Date(),
  };
}
