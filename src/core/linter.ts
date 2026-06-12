/**
 * core/linter.ts — Static checks for SP formatter trees.
 *
 * Encodes field-tested quirks of the SharePoint formatting engine (most fail
 * SILENTLY in production — these rules come from the TwFw knowledge base and
 * years of community samples in pnp/List-Formatting):
 *
 *  - Zero Whitespace Rule: spaces in expressions outside quoted literals
 *  - there is NO logical NOT: neither not() nor a standalone '!' —
 *    '!=' (not-equals) is fine; negate inside the expression
 *    (== ↔ !=, < ↔ >=, swap if() branches)
 *  - forEach + split() outside customCardProps kills the formatter
 *  - forEach iterators should be underscore-prefixed (convention)
 *  - _comment only safe inside style objects
 *  - unsupported CSS properties (silently dropped)
 *  - customCardProps trigger: div with children hijacks click registration
 *  - columnFormatterReference inside customCardProps renders blank
 *  - non-ASCII characters garble through CSOM deployment
 *  - nested if() depth > 10 may silently fail
 *  - className instead of attributes.class
 */

import type { SPElement, NodePath, FormatterDocument } from './types';
import { ELM_TYPES, KNOWN_UNSUPPORTED_STYLES, ALLOWED_STYLES } from './schema';
import { parseExpression, parseForEach } from './expressions';

export type Severity = 'error' | 'warning' | 'info';

export interface LintIssue {
  severity: Severity;
  rule: string;
  message: string;
  path: NodePath;
}

interface WalkState {
  insideCard: boolean;
  /** Field internal names known to the mock schema (undefined = skip the check). */
  knownFields?: Set<string>;
  /** Field name → type, for type-aware rules (e.g. empty-date comparisons). */
  fieldTypes?: Record<string, string>;
  /** forEach iterator names in scope. */
  iterators: Set<string>;
}

export function lintDocument(
  doc: FormatterDocument,
  knownFields?: string[],
  fieldTypes?: Record<string, string>,
): LintIssue[] {
  const issues: LintIssue[] = [];
  walk(doc.root, [], {
    insideCard: false,
    knownFields: knownFields ? new Set(knownFields) : undefined,
    fieldTypes,
    iterators: new Set(),
  }, issues);
  return issues;
}

function expressionStrings(el: SPElement): Array<{ where: string; value: string }> {
  const out: Array<{ where: string; value: string }> = [];
  if (typeof el.txtContent === 'string') out.push({ where: 'txtContent', value: el.txtContent });
  for (const [k, v] of Object.entries(el.style ?? {})) {
    if (typeof v === 'string') out.push({ where: `style.${k}`, value: v });
  }
  for (const [k, v] of Object.entries(el.attributes ?? {})) {
    if (typeof v === 'string') out.push({ where: `attributes.${k}`, value: v });
  }
  return out;
}

/** Spaces outside single-quoted literals in an =expression. */
export function hasUnsafeWhitespace(expr: string): boolean {
  if (!expr.startsWith('=')) return false;
  let inQuote = false;
  for (let i = 1; i < expr.length; i++) {
    const c = expr[i];
    if (c === "'") inQuote = !inQuote;
    else if (!inQuote && (c === ' ' || c === '\t' || c === '\n')) return true;
  }
  return false;
}

/** Strip spaces outside quoted literals (the sanitizeForCSOM treatment). */
export function stripExpressionWhitespace(expr: string): string {
  if (!expr.startsWith('=')) return expr;
  let out = '', inQuote = false;
  for (const c of expr) {
    if (c === "'") inQuote = !inQuote;
    if (!inQuote && (c === ' ' || c === '\t' || c === '\n' || c === '\r')) continue;
    out += c;
  }
  return out;
}

/** Show where in the expression a problem sits: 20 chars either side, ▶ marks the spot. */
export function excerptAt(expr: string, pos: number): string {
  const start = Math.max(0, pos - 20);
  const end = Math.min(expr.length, pos + 20);
  return `${start > 0 ? '…' : ''}${expr.slice(start, pos)}▶${expr.slice(pos, end)}${end < expr.length ? '…' : ''}`;
}

/** Find a stray '=' inside an expression (outside quoted literals, after the leading one). */
export function findNestedEquals(expr: string): number {
  if (!expr.startsWith('=')) return -1;
  let inQuote = false;
  for (let i = 1; i < expr.length; i++) {
    const c = expr[i];
    if (c === "'") inQuote = !inQuote;
    else if (!inQuote && c === '=' && expr[i - 1] !== '=' && expr[i - 1] !== '!' &&
             expr[i - 1] !== '<' && expr[i - 1] !== '>' && expr[i + 1] !== '=') {
      return i;
    }
  }
  return -1;
}

function maxIfDepth(expr: string): number {
  let depth = 0, max = 0;
  for (let i = 0; i < expr.length - 2; i++) {
    if (expr.slice(i, i + 3).toLowerCase() === 'if(' && !/[a-z0-9_]/i.test(expr[i - 1] ?? '')) {
      depth++;
      max = Math.max(max, depth);
    }
    if (expr[i] === ')') depth = Math.max(0, depth - 1);
  }
  return max;
}

function walk(el: SPElement, path: NodePath, state: WalkState, issues: LintIssue[]): void {
  const push = (severity: Severity, rule: string, message: string) =>
    issues.push({ severity, rule, message, path });

  // bring this element's own iterator into scope for it and its subtree
  if (el.forEach) {
    const b = parseForEach(el.forEach);
    if (b) state = { ...state, iterators: new Set([...state.iterators, b.iterator]) };
  }

  if (!el.elmType) {
    push('error', 'elmType-required', 'Element is missing elmType — SP will not render it.');
  } else if (!ELM_TYPES.includes(el.elmType)) {
    push('error', 'elmType-invalid', `"${el.elmType}" is not a valid elmType (${ELM_TYPES.join(', ')}).`);
  }

  // _comment placement (only safe inside style)
  for (const key of Object.keys(el)) {
    if (key === '_comment') {
      push('error', 'comment-placement', '_comment as a sibling of elmType breaks rendering — it is only safe inside style objects.');
    }
  }

  // attributes checks
  if (el.attributes) {
    if ('className' in el.attributes) {
      push('error', 'class-not-classname', 'Use attributes.class, not className — the schema uses the HTML attribute name.');
    }
    if (el.attributes.iconName && !el.attributes.title) {
      push('info', 'icon-tooltip', 'Icon without a title tooltip — every iconName should carry a human tooltip (design-language rule).');
    }
  }

  // style checks
  for (const prop of Object.keys(el.style ?? {})) {
    if (prop === '_comment') continue;
    if (KNOWN_UNSUPPORTED_STYLES[prop]) {
      push('warning', 'css-unsupported', `style.${prop}: ${KNOWN_UNSUPPORTED_STYLES[prop]}.`);
    } else if (!ALLOWED_STYLES.has(prop) && !prop.startsWith('--inline-editor')) {
      push('warning', 'css-unknown', `style.${prop} is not on the SP style allow-list — it will be silently dropped.`);
    }
    if (prop === 'transform') {
      const v = el.style?.[prop];
      if (typeof v === 'string' && !/^=?.*translate/.test(v)) {
        push('warning', 'css-transform', 'Only translate(...) is honored in transform — other functions are dropped.');
      }
    }
  }

  // expression-level checks
  for (const { where, value } of expressionStrings(el)) {
    if (hasUnsafeWhitespace(value)) {
      push('warning', 'zero-whitespace', `${where}: spaces outside quoted literals cause silent render failure (Zero Whitespace Rule). Use "Sanitize" on export.`);
    }
    let preciseSyntaxIssue = false;
    if (/(^|[^a-zA-Z0-9_])not\s*\(/.test(value)) {
      push('error', 'no-not-function', `${where}: not() does not exist in SP formatting — and neither does a '!' prefix. Negate inside the expression: turn == into !=, < into >=, or swap the if() branches.`);
    }
    // standalone '!' before a (, [$Field] or @token — '!=' stays legal
    if (/!(?=\s*[([@])/.test(value)) {
      push('error', 'no-bang-operator', `${where}: SP formatting has no standalone '!' — only '!=' (not-equals) uses that character. Negate inside the expression instead: turn == into !=, < into >=, swap the if() branches, or compare a yes/no field with == false.`);
      preciseSyntaxIssue = true;
    }
    // XML-entity escapes survive deployment literally and silently break the
    // formatter at render time (e.g. && parsed instead of &&)
    if (/&(amp|lt|gt|quot);/.test(value)) {
      push('error', 'xml-entity-escape', `${where}: contains an XML entity (&amp;/&lt;) — SP stores it literally and the formatter silently breaks. Use the raw character; escape as \\u0026/\\u003c only at CSOM deploy time.`);
      preciseSyntaxIssue = true;
    }
    const nestedEq = findNestedEquals(value);
    if (nestedEq >= 0) {
      push('error', 'nested-equals', `${where}: extra '=' inside the expression, here: ${excerptAt(value, nestedEq)} — The '=' prefix means "this whole string is a formula" and only goes at the very start. When you nest a function inside another, write it without the '=' (correct: =if(a,b,if(c,d,e)) — wrong: =if(a,b,=if(c,d,e))). SharePoint won't show an error for this; the element just renders blank.`);
      preciseSyntaxIssue = true;
    }
    const ifDepth = maxIfDepth(value);
    if (ifDepth > 10) {
      push('warning', 'if-depth', `${where}: nested if() depth ${ifDepth} exceeds the proven-stable limit of 10 — SP may silently fail.`);
    }
    // parse =expressions to surface syntax errors early (skip when a more
    // precise rule already explains the problem)
    if (value.startsWith('=') && !preciseSyntaxIssue) {
      try {
        parseExpression(stripExpressionWhitespace(value).slice(1));
      } catch (e) {
        const raw = (e as Error).message;
        const stripped = stripExpressionWhitespace(value);
        const posMatch = raw.match(/at (\d+)$/);
        // +1 maps parser position (after the '=' was sliced off) back to the string
        const near = posMatch ? ` Here: ${excerptAt(stripped, Number(posMatch[1]) + 1)} (▶ marks the spot).` : '';
        push('error', 'expr-syntax', `${where}: SharePoint can't read this formula — ${raw}.${near} A formula is built from 'quoted text', numbers, [$FieldName] references, @tokens (like @now or @currentField) and functions like if(), joined with operators (+ - * / == != && || ? :). Check for a missing quote, comma or closing parenthesis around the marker. SP gives no error for this — the element just renders blank.`);
      }
    }
    // CSOM / encoding hazard
    for (const ch of value) {
      if (ch.charCodeAt(0) > 126) {
        push('info', 'ascii-only', `${where}: non-ASCII character "${ch}" — garbles via CSOM deployment; prefer ASCII or an icon.`);
        break;
      }
    }
    // unknown field references (checked against the mock schema)
    if (state.knownFields) {
      const seen = new Set<string>();
      for (const m of value.matchAll(/\[[$!]([A-Za-z0-9_]+)/g)) {
        const name = m[1];
        if (seen.has(name)) continue;
        seen.add(name);
        if (!state.knownFields.has(name) && !state.iterators.has(name)) {
          push('warning', 'unknown-field', `${where}: [$${name}] is not in the mock schema — add the field in the Data tab or import your list schema.`);
        }
      }
    }
    // date fields compared to '' — empty dates are null on real SP
    if (state.fieldTypes) {
      for (const m of value.matchAll(/\[\$([A-Za-z0-9_]+)\]\s*[!=]=\s*''/g)) {
        if (state.fieldTypes[m[1]] === 'date') {
          push('info', 'empty-date-compare', `${where}: [$${m[1]}] is a Date field — a truly EMPTY date is null on real SP, and null == '' is FALSE, so this comparison won't detect blanks the way it does for text fields. The preview here matches real SP.`);
        }
      }
    }
  }

  // forEach list expression also references fields
  if (el.forEach && state.knownFields) {
    for (const m of el.forEach.matchAll(/\[\$([A-Za-z0-9_]+)/g)) {
      if (!state.knownFields.has(m[1]) && !state.iterators.has(m[1])) {
        push('warning', 'unknown-field', `forEach: [$${m[1]}] is not in the mock schema — add the field in the Data tab or import your list schema.`);
      }
    }
  }

  // forEach checks
  if (el.forEach) {
    const binding = parseForEach(el.forEach);
    if (!binding) {
      push('error', 'foreach-syntax', `forEach must be "iterator in expression" — got "${el.forEach}".`);
    } else {
      if (!binding.iterator.startsWith('_')) {
        push('warning', 'foreach-iterator-underscore', `forEach iterator "${binding.iterator}" should be underscore-prefixed (e.g. "_${binding.iterator}") to distinguish it from field references.`);
      }
      if (/split\s*\(/.test(binding.listExpr) && !state.insideCard) {
        push('error', 'foreach-split-scope', 'forEach + split() outside customCardProps kills the entire formatter — it only works inside customCardProps.');
      }
    }
  }

  // customCardProps checks
  if (el.customCardProps) {
    if (el.elmType !== 'button' && el.children?.length) {
      push('warning', 'card-trigger-button', 'customCardProps on a div with children: child spans hijack click registration and the card never opens. Use elmType "button" with txtContent directly, or an absolute overlay div.');
    }
    const f = el.customCardProps.formatter;
    if (f) {
      const cardIssues: LintIssue[] = [];
      walk(f, [...path, -1], { ...state, insideCard: true }, cardIssues);
      for (const issue of cardIssues) {
        issues.push({ ...issue, message: `[customCardProps] ${issue.message}`, path });
      }
      forEachNode(f, (n) => {
        if (n.columnFormatterReference) {
          push('error', 'cfr-in-card', 'columnFormatterReference inside a customCardProps formatter renders blank — inline the markup instead.');
        }
      });
    }
  }

  if (el.inlineEditField && state.insideCard === false && el.forEach) {
    push('warning', 'inline-edit-foreach', 'inlineEditField inside forEach is unreliable.');
  }

  el.children?.forEach((child, i) => walk(child, [...path, i], state, issues));
}

function forEachNode(el: SPElement, fn: (n: SPElement) => void): void {
  fn(el);
  el.children?.forEach((c) => forEachNode(c, fn));
}
