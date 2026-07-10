// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * editor/jsonHover.ts — what to show at a buffer offset (spec
 * docs/superpowers/specs/2026-07-09-json-pane-ide-design.md §5). Pure: the
 * DOM shell owns geometry and the floating card.
 *
 * Priority: a decoration's message (squiggles explain themselves on hover),
 * then token intelligence — field refs (display name, type, sample-row value
 * via the real engine), function signatures (SP_FUNCTION_DOCS), @token docs
 * (fxSuggest catalog), style/attribute key docs, and for any formula string
 * the unescaped x-ray (the \" noise removed — the single most confusing
 * thing about formulas-in-JSON).
 */

import { tokenizeJson, scanString } from './jsonHighlight';
import { tokenizeExpr } from './exprTokens';
import { STYLE_PROP_DOCS, ATTRIBUTE_DOCS, SP_FUNCTION_DOCS } from '../core/schema';
import { systemTokenItems } from './fxSuggest';
import { unescapeJson } from './jsonComplete';
import { evaluate, toStr, type EvalContext } from '../core/expressions';
import type { MockField } from '../core/types';
import { decorationAt, type Decoration } from './jsonDecorations';
import { ICON_GROUPS } from './iconData';

/** Lazy set of every icon name verified to render on real SP (iconData). */
let ICON_SET: Set<string> | null = null;
const spIconSet = (): Set<string> => (ICON_SET ??= new Set(ICON_GROUPS.flatMap((g) => g.icons)));

export interface HoverInfo {
  title: string;
  body: string;
  /** Render the body monospace (the expression x-ray). */
  mono?: boolean;
  /** #PR-E: a Fluent icon name to draw beside the title (an ms-Icon--<name>
   *  class — dynamic over iconData's set, so CDN-font-backed like the canvas
   *  previews, per chromeIcons' doctrine). */
  icon?: string;
}

export interface HoverOpts {
  ctx?: EvalContext;
}

const KIND_LABEL: Record<string, string> = { err: 'Problem', warning: 'Warning', info: 'Note' };

/** The sample-row value of a live string (bare ref / @token), or ''. */
function sampleValue(raw: string, ctx: EvalContext | undefined): string {
  if (!ctx) return '';
  try {
    return ` · sample value: ${toStr(evaluate(raw, ctx))}`;
  } catch {
    return '';
  }
}

export function hoverAt(
  text: string,
  offset: number,
  decorations: Decoration[],
  fields: MockField[],
  opts?: HoverOpts,
): HoverInfo | null {
  const d = decorationAt(decorations, offset);
  if (d) return { title: KIND_LABEL[d.kind] ?? 'Note', body: d.message };

  // walk with the renderer's pendingKey convention — a str VALUE's meaning
  // can depend on its key (iconName)
  let pendingKey: string | null = null;
  let tok: ReturnType<typeof tokenizeJson>[number] | undefined;
  let tokKey: string | null = null;
  for (const t of tokenizeJson(text)) {
    if (t.start > offset) break;
    if (t.start <= offset && offset < t.end) { tok = t; tokKey = pendingKey; }
    if (t.kind === 'key') pendingKey = text.slice(t.start + 1, t.end - 1);
    else if (!(t.kind === 'punct' && text[t.start] === ':')) pendingKey = null;
  }
  if (!tok) return null;

  if (tok.kind === 'key') {
    const key = text.slice(tok.start + 1, tok.end - 1);
    const doc = STYLE_PROP_DOCS[key] ?? ATTRIBUTE_DOCS[key];
    return doc ? { title: key, body: doc } : null;
  }
  // #PR-E: an iconName VALUE shows its glyph and verifies the name against
  // the renders-on-real-SP set (iconData) — the live typo catch
  if (tok.kind === 'str' && tokKey === 'iconName') {
    const name = text.slice(tok.start + 1, scanString(text, tok.start).closed ? tok.end - 1 : tok.end);
    if (!name) return null;
    return spIconSet().has(name)
      ? { title: name, body: 'Fluent (MDL2) icon — verified to render on SharePoint', icon: name }
      : { title: name, body: 'not in the verified SP icon set — check the spelling (names are case-sensitive)' };
  }
  if (tok.kind !== 'expr') return null;

  const { closed } = scanString(text, tok.start);
  const cs = tok.start + 1;
  const ce = closed ? tok.end - 1 : tok.end;

  const sub = tokenizeExpr(text, cs, ce).find((t) => t.start <= offset && offset < t.end);
  if (sub) {
    const s = text.slice(sub.start, sub.end);
    if (sub.kind === 'xfield') {
      const name = s.replace(/^\[[$!]/, '').replace(/\]$/, '').split('.')[0];
      const field = fields.find((f) => f.name === name);
      const value = sampleValue(s, opts?.ctx);
      return field
        ? { title: s, body: `${field.displayName ?? field.name} — ${field.type}${value}` }
        : { title: s, body: `not in the mock schema (add the column, or pull the real list)${value}` };
    }
    if (sub.kind === 'xfn' || sub.kind === 'xfn-unknown') {
      const doc = SP_FUNCTION_DOCS[s];
      return doc
        ? { title: doc.signature, body: doc.summary }
        : { title: `${s}(…)`, body: 'not a formatter-engine function — check the spelling' };
    }
    if (sub.kind === 'xtoken') {
      const items = systemTokenItems();
      const item = items.find((i) => i.insert === s) ?? items.find((i) => s.startsWith(i.insert));
      return { title: s, body: item?.doc ?? 'context token' };
    }
  }
  // anywhere else in a formula: the unescaped x-ray
  return { title: 'expression', body: unescapeJson(text.slice(cs, ce)), mono: true };
}
