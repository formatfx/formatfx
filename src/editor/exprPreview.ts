// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * editor/exprPreview.ts — the live evaluation chip (spec
 * docs/superpowers/specs/2026-07-09-json-pane-ide-design.md §6). Pure: the
 * caret's live string evaluated through the REAL engine against the sample
 * row, shaped for the signature strip. The DOM shell renders it.
 *
 * Same row source as completions today — ctxForRow(0); when the canvas grows
 * an "active row" notion, hand that ctx in here instead (upgrade hook).
 *
 * Works mid-edit by construction: the tolerant JSON lexer finds the string
 * around the caret in any half-typed buffer, and an engine throw IS the chip
 * (the ⚠ kind) — a formula that would render blank on SP announces itself
 * while it's being typed.
 */

import { tokenizeJson, scanString, type JsonToken } from './jsonHighlight';
import { unescapeJson } from './jsonComplete';
import {
  evaluate, toStr, parseForEach, evaluateForEachList,
  type EvalContext, type SPValue,
} from '../core/expressions';

export type EvalChipKind = 'value' | 'list' | 'error';
export interface EvalChip {
  /** Strip-ready text (WITHOUT the leading arrow — the shell owns glyphs). */
  text: string;
  kind: EvalChipKind;
  /** value chips: the engine value's type, for the little badge. */
  type?: 'text' | 'number' | 'boolean' | 'date' | 'list' | 'object' | 'empty';
}

/** Values longer than this truncate with an ellipsis — the chip is a glance,
 *  not a data view. */
const MAX_CHARS = 48;

const clip = (s: string): string => (s.length > MAX_CHARS ? `${s.slice(0, MAX_CHARS - 1)}…` : s);

/** Quoted-and-clipped list preview: `3 items: Red, Green, …`. */
function listChip(list: SPValue[]): EvalChip {
  const n = list.length;
  let preview = '';
  for (const v of list) {
    const next = preview ? `${preview}, ${toStr(v)}` : toStr(v);
    if (next.length > MAX_CHARS) { preview = `${preview}${preview ? ', ' : ''}…`; break; }
    preview = next;
  }
  return {
    text: `${n} item${n === 1 ? '' : 's'}${preview ? `: ${preview}` : ''}`,
    kind: 'list',
    type: 'list',
  };
}

function valueChip(v: SPValue): EvalChip {
  if (Array.isArray(v)) return listChip(v);
  if (v === null || v === undefined || v === '') return { text: 'empty', kind: 'value', type: 'empty' };
  if (v instanceof Date) return { text: clip(v.toLocaleDateString()), kind: 'value', type: 'date' };
  if (typeof v === 'number') return { text: clip(String(v)), kind: 'value', type: 'number' };
  if (typeof v === 'boolean') return { text: String(v), kind: 'value', type: 'boolean' };
  if (typeof v === 'object') return { text: clip(toStr(v)), kind: 'value', type: 'object' };
  return { text: clip(`"${v}"`), kind: 'value', type: 'text' };
}

/** The string value token whose CONTENT contains `caret`, with the key it
 *  hangs under (the renderer's pendingKey convention) — or null. */
function liveStringAt(
  text: string,
  tokens: JsonToken[],
  caret: number,
): { token: JsonToken; key: string | null } | null {
  let pendingKey: string | null = null;
  for (const t of tokens) {
    if (t.start > caret) break;
    if ((t.kind === 'expr' || t.kind === 'str') && caret > t.start) {
      const { closed } = scanString(text, t.start);
      const contentEnd = closed ? t.end - 1 : t.end;
      if (caret <= contentEnd) return { token: t, key: pendingKey };
    }
    if (t.kind === 'key') pendingKey = text.slice(t.start + 1, t.end - 1);
    else if (!(t.kind === 'punct' && text[t.start] === ':')) pendingKey = null;
  }
  return null;
}

/**
 * The chip for the caret's position, or null (not in a live string, or no
 * sample row to evaluate against). Plain data strings never chip — only
 * live strings (`=…`, bare refs, bare @tokens) and forEach specs resolve
 * on SP, so only those have a "result" to show.
 */
export function evalChipAt(text: string, caret: number, ctx: EvalContext | undefined): EvalChip | null {
  if (!ctx) return null;
  const hit = liveStringAt(text, tokenizeJson(text), caret);
  if (!hit) return null;
  const { closed } = scanString(text, hit.token.start);
  const raw = unescapeJson(text.slice(hit.token.start + 1, closed ? hit.token.end - 1 : hit.token.end));

  if (hit.key === 'forEach') {
    const binding = parseForEach(raw);
    if (!binding) return { text: 'forEach needs the "item in [$List]" shape', kind: 'error' };
    try {
      return listChip(evaluateForEachList(binding.listExpr, ctx));
    } catch (e) {
      return { text: clip((e as Error).message), kind: 'error' };
    }
  }

  if (hit.token.kind !== 'expr') return null; // plain data — nothing evaluates
  try {
    return valueChip(evaluate(raw, ctx));
  } catch (e) {
    return { text: clip((e as Error).message), kind: 'error' };
  }
}
