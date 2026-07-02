/**
 * core/linter.ts — Static checks for SP formatter trees.
 *
 * Encodes field-tested quirks of the SharePoint formatting engine (most fail
 * SILENTLY in production — these rules come from the TwFw knowledge base,
 * years of community samples in pnp/List-Formatting, and the owner's canon
 * corrections logged in docs/HANDOFF.md §3b):
 *
 *  - Zero Whitespace Rule: verified fatal only inside split() expressions;
 *    flagged elsewhere as a precaution (sanitize-on-export strips it anyway)
 *  - there is NO logical NOT: neither not() nor a standalone '!' —
 *    '!=' (not-equals) is fine; negate inside the expression
 *    (== ↔ !=, < ↔ >=, swap if() branches)
 *  - forEach + split() on the ROOT element kills the formatter (children are fine)
 *  - forEach iterators should be underscore-prefixed (convention)
 *  - _comment outside style: remembered (unverified) breakage — annotations
 *    are safest inside style objects; SP ignores most non-schema keys
 *  - unsupported CSS properties (silently dropped; a couple are unverified)
 *  - customCardProps triggers: children have been seen to swallow the click —
 *    prefer an absolute overlay div, or a button with direct txtContent
 *  - non-ASCII characters garble through CSOM deployment
 *  - nested if() depth > 10 may silently fail
 *  - className instead of attributes.class
 *
 * Retracted (owner-verified in production, 2026-06-13 — do not re-add without
 * fresh evidence): "CFR inside customCardProps renders blank" and
 * "inlineEditField inside forEach is unreliable". Both work on real SP.
 */

import type { SPElement, NodePath, FormatterDocument } from './types';
import { ELM_TYPES, KNOWN_UNSUPPORTED_STYLES, ALLOWED_STYLES, SP_FUNCTIONS, SP_FUNCTION_DOCS } from './schema';
import { parseExpression, parseForEach, type AstNode } from './expressions';

export type Severity = 'error' | 'warning' | 'info';

export interface LintIssue {
  severity: Severity;
  rule: string;
  message: string;
  path: NodePath;
}

interface WalkState {
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
    else if (!inQuote && (c === ' ' || c === '\t' || c === '\n' || c === '\r')) return true;
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

/** Visit every function-call node in a parsed expression AST. */
function forEachCall(node: AstNode, visit: (call: { fn: string; args: AstNode[] }) => void): void {
  switch (node.kind) {
    case 'call':
      visit(node);
      node.args.forEach((a) => forEachCall(a, visit));
      break;
    case 'unary':
      forEachCall(node.operand, visit);
      break;
    case 'binary':
      forEachCall(node.left, visit);
      forEachCall(node.right, visit);
      break;
    case 'ternary':
      forEachCall(node.cond, visit);
      forEachCall(node.yes, visit);
      forEachCall(node.no, visit);
      break;
    // num / str / field / token / ident are leaves
  }
}

/**
 * Check every call in a parsed expression against SP_FUNCTION_DOCS: unknown
 * names and wrong argument counts both render BLANK on real SP with no error,
 * so we catch them statically. (Excel-style strings only — the AST-object form
 * carries its own operand arrays and is validated by the engine at eval time.)
 */
function checkCalls(ast: AstNode, where: string, push: (s: Severity, r: string, m: string) => void): void {
  forEachCall(ast, ({ fn, args }) => {
    // not() has its own dedicated, more specific rule (no-not-function)
    if (fn === 'not') return;
    const doc = SP_FUNCTION_DOCS[fn];
    if (!doc) {
      push('error', 'fn-unknown', `${where}: ${fn}() is not a SharePoint formatting function — names are case-sensitive, so check spelling and capitalization (e.g. toUpperCase, not upper). The full set is: ${SP_FUNCTIONS.join(', ')}. SP shows no error for this — the element just renders blank.`);
      return;
    }
    const n = args.length;
    if (n < doc.minArgs || n > doc.maxArgs) {
      const want = doc.minArgs === doc.maxArgs
        ? `${doc.minArgs}`
        : `${doc.minArgs}–${doc.maxArgs}`;
      const plural = doc.maxArgs === 1 ? 'argument' : 'arguments';
      push('error', 'fn-arg-count', `${where}: ${doc.signature} takes ${want} ${plural}, but got ${n}. ${doc.summary} SP shows no error for this — the element just renders blank.`);
    }
  });
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
    issues.push({ severity, rule, message, path: [...path] });

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

  // _comment outside style: a remembered breakage, pending re-verification —
  // SP ignores most non-schema keys (_elmName ships in exports unharmed)
  for (const key of Object.keys(el)) {
    if (key === '_comment') {
      push('warning', 'comment-placement', '_comment as a sibling of elmType has been seen to break rendering (unverified — SP ignores most non-schema keys, e.g. _elmName). Safest home for annotations is inside a style object.');
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
      if (/split\s*\(/.test(value)) {
        push('warning', 'zero-whitespace', `${where}: spaces outside quoted literals inside a split() expression cause silent render failure (the verified case of the Zero Whitespace Rule). Use "Sanitize" on export.`);
      } else {
        push('info', 'zero-whitespace', `${where}: spaces outside quoted literals — only split() expressions are verified to break on real SP; flagged as a precaution, and "Sanitize" on export strips them either way.`);
      }
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
      let ast: AstNode | null = null;
      try {
        ast = parseExpression(stripExpressionWhitespace(value).slice(1));
      } catch (e) {
        const raw = (e as Error).message;
        const stripped = stripExpressionWhitespace(value);
        const posMatch = raw.match(/at (\d+)$/);
        // +1 maps parser position (after the '=' was sliced off) back to the string
        const near = posMatch ? ` Here: ${excerptAt(stripped, Number(posMatch[1]) + 1)} (▶ marks the spot).` : '';
        push('error', 'expr-syntax', `${where}: SharePoint can't read this formula — ${raw}.${near} A formula is built from 'quoted text', numbers, [$FieldName] references, @tokens (like @now or @currentField) and functions like if(), joined with operators (+ - * / == != && || ? :). Check for a missing quote, comma or closing parenthesis around the marker. SP gives no error for this — the element just renders blank.`);
      }
      // a parseable formula can still call a misspelled function or pass the
      // wrong number of arguments — both render blank with no SP error
      if (ast) checkCalls(ast, where, push);
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
      if (/split\s*\(/.test(binding.listExpr) && path.length === 0) {
        push('error', 'foreach-split-scope', 'forEach + split() on the ROOT element kills the entire formatter — wrap it in a parent div and loop on a child instead (children handle it fine).');
      }
    }
  }

  // customCardProps checks
  if (el.customCardProps) {
    if (el.elmType !== 'button' && el.children?.length) {
      push('info', 'card-trigger-button', 'customCardProps on an element with children: the children have been seen to swallow the click so the card never opens (field observation). The robust trigger patterns: an absolutely-positioned overlay div, or a button with direct txtContent.');
    }
    const f = el.customCardProps.formatter;
    if (f) {
      const cardIssues: LintIssue[] = [];
      path.push(-1);
      walk(f, path, state, cardIssues);
      path.pop();
      for (const issue of cardIssues) {
        // keep each issue's walk-computed path (host path + -1 CARD_SEGMENT +
        // card-internal indices) — overriding it with the host path here broke
        // click-to-select on card-internal issues (#76)
        issues.push({ ...issue, message: `[customCardProps] ${issue.message}` });
      }
    }
  }

  // customRowAction completeness — a blank-param action is schema-shaped but
  // does nothing on real SP. Refuse-and-teach (deploys are lint-gated).
  if (el.customRowAction) {
    const a = el.customRowAction;
    if (a.action === 'executeFlow') {
      const hasId = typeof a.actionParams === 'string' && /"id"\s*:\s*"[^"]+"/.test(a.actionParams);
      if (!hasId) push('error', 'flow-missing-id', 'executeFlow needs actionParams \'{"id":"<FLOWID>"}\' — pick a flow, or the action does nothing on the list.');
    }
    if (a.action === 'setValue') {
      const ok = a.actionInput && typeof a.actionInput === 'object' && Object.keys(a.actionInput).length > 0;
      if (!ok) push('error', 'setvalue-missing-target', 'setValue needs actionInput keyed by the column internal name (e.g. {"Status":"Done"}) — set a field and value.');
    }
  }

  if (el.children) {
    for (let i = 0; i < el.children.length; i++) {
      path.push(i);
      walk(el.children[i], path, state, issues);
      path.pop();
    }
  }
}
