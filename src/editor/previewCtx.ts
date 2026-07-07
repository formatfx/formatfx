// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0 (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * editor/previewCtx.ts — the shared preview eval context + CFR resolver so a
 * "live preview" outside the canvas (the template modal) uses the identical
 * resolution/eval path. Mirrors the pair currently inlined in canvas.ts; new
 * preview surfaces import from here rather than re-deriving ctx assembly.
 */
import { state } from './state';
import { cfrFieldName } from '../core/refs';
import type { SPElement } from '../core/types';
import type { EvalContext } from '../core/expressions';

export function resolveColumnRef(fieldRef: string): SPElement | null {
  return state.columnRefs[cfrFieldName(fieldRef)] ?? null;
}

export function ctxForRow(rowIndex: number): EvalContext {
  return {
    row: state.rows[rowIndex] ?? {},
    rowIndex,
    currentFieldName: state.currentFieldName,
    me: state.me,
    iterators: {},
    iteratorIndex: {},
    displayNames: Object.fromEntries(state.fields.map((f) => [f.name, f.displayName ?? f.name])),
    now: new Date(),
  };
}
