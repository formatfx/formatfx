// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0 (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * editor/codeMode.ts — the Code lens declarations sheet (pure parse/serialize).
 *
 * The Code lens shows an element's style + attributes as newline-separated
 * declarations, one per line:
 *
 *     padding: 10px 14px;
 *     font-size: 11px;
 *     @class: sp-field-severity--good;
 *     @txtContent: Hello World;
 *
 * A `prop: value` line edits a style property; a leading `@name` edits an
 * attribute (or the special node fields txtContent / forEach). Expression values
 * (`color: =if(...);`) round-trip verbatim. This module is DOM-free and
 * state-free so it is unit-tested directly (codeMode.test.ts); the DOM/textarea
 * shell that drives it lives in the Code lens of the Left Edit Pane.
 *
 * Parsing never throws: malformed lines are collected as `errors` and skipped,
 * so a typo surfaces a validation banner instead of corrupting the node.
 */

import type { SPElement, SPExpr } from '../core/types';

/** Special `@name` declarations that map to node fields rather than attributes. */
const NODE_FIELD_NAMES = new Set(['txtContent', 'forEach']);

export interface ParseError {
  /** 1-based line number in the source text. */
  line: number;
  text: string;
  message: string;
}

export interface ParsedDeclarations {
  style: Record<string, SPExpr>;
  attributes: Record<string, SPExpr>;
  txtContent?: SPExpr;
  forEach?: string;
  errors: ParseError[];
}

/** The hint shown under the Code box (spec §2.C). */
export const CODE_HINT = 'One declaration per line; @name edits an attribute.';

/** Serialize one SP expression value to its declaration text. */
export function valueToText(value: SPExpr): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  // AST/object form round-trips as compact JSON
  return JSON.stringify(value);
}

/** Parse a declaration value back into an SP expression.
 *  Object-looking text (`{...}`) is parsed as an AST; everything else — literal
 *  strings AND `=…` formulas — is kept verbatim as a string. */
export function textToValue(raw: string): SPExpr {
  const t = raw.trim();
  if (t.startsWith('{')) {
    try { return JSON.parse(t) as SPExpr; } catch { /* keep as string */ }
  }
  return raw;
}

/** Render an element's style + attributes + txtContent/forEach as declarations. */
export function nodeToDeclarations(node: SPElement): string {
  const lines: string[] = [];
  if (node.style) {
    for (const [prop, value] of Object.entries(node.style)) {
      if (value === undefined) continue;
      lines.push(`${prop}: ${valueToText(value)};`);
    }
  }
  if (node.txtContent !== undefined) lines.push(`@txtContent: ${valueToText(node.txtContent)};`);
  if (node.forEach !== undefined) lines.push(`@forEach: ${node.forEach};`);
  if (node.attributes) {
    for (const [attr, value] of Object.entries(node.attributes)) {
      if (value === undefined) continue;
      lines.push(`@${attr}: ${valueToText(value)};`);
    }
  }
  return lines.join('\n');
}

/** Parse a declarations sheet. Never throws — bad lines become `errors`. */
export function parseDeclarations(text: string): ParsedDeclarations {
  const out: ParsedDeclarations = { style: {}, attributes: {}, errors: [] };
  const rawLines = text.split('\n');
  for (let i = 0; i < rawLines.length; i++) {
    const lineNo = i + 1;
    const line = rawLines[i].trim();
    if (!line || line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) continue;
    const colon = line.indexOf(':');
    if (colon === -1) {
      out.errors.push({ line: lineNo, text: rawLines[i], message: 'Expected "name: value"' });
      continue;
    }
    const name = line.slice(0, colon).trim();
    // strip a single trailing ';' (and surrounding whitespace) from the value
    const value = line.slice(colon + 1).replace(/;\s*$/, '').trim();
    if (!name) {
      out.errors.push({ line: lineNo, text: rawLines[i], message: 'Missing property name' });
      continue;
    }
    if (name.startsWith('@')) {
      const key = name.slice(1).trim();
      if (!key) {
        out.errors.push({ line: lineNo, text: rawLines[i], message: 'Missing attribute name after "@"' });
        continue;
      }
      if (value === '') continue; // empty value clears → simply omit
      if (key === 'txtContent') out.txtContent = textToValue(value);
      else if (key === 'forEach') out.forEach = value;
      else out.attributes[key] = textToValue(value);
    } else {
      if (value === '') continue; // empty value clears the prop
      out.style[name] = textToValue(value);
    }
  }
  return out;
}

/** Apply parsed declarations to a node IN PLACE, replacing only the four
 *  Code-lens-owned fields (style / attributes / txtContent / forEach). Children,
 *  customCardProps and the other superpower fields are left untouched — the
 *  Code lens never owns them, so it can never wipe them. */
export function applyDeclarations(node: SPElement, parsed: ParsedDeclarations): void {
  if (Object.keys(parsed.style).length) node.style = parsed.style;
  else delete node.style;

  if (Object.keys(parsed.attributes).length) node.attributes = parsed.attributes;
  else delete node.attributes;

  if (parsed.txtContent !== undefined) node.txtContent = parsed.txtContent;
  else delete node.txtContent;

  if (parsed.forEach !== undefined && parsed.forEach !== '') node.forEach = parsed.forEach;
  else delete node.forEach;
}

// re-export so callers can reference the reserved names if needed
export { NODE_FIELD_NAMES };
