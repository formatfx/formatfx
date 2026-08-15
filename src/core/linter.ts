// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Sam Yost

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
 *  - columnFormatterReference stands in for elmType (never demand elmType on
 *    one); the referenced column is checked against the mock schema, and an
 *    info row teaches that the preview can't resolve the reference
 *  - hover-reveal pairing: sp-card-showOnHoverChild with no
 *    sp-card-showOnHoverParent ancestor never appears (the reveal is a
 *    descendant :hover selector — HANDOFF §3); a parent with no child in its
 *    subtree is inert (info)
 *  - low-contrast: WCAG contrast between authored text and the fill behind it
 *    (core/contrast.ts is the brain — static color-outcome extraction over
 *    both expression syntaxes, SOUND pairings only). Below 3:1 = warning
 *    (fails WCAG even for large text); 3:1–4.5:1 = info (normal-size text
 *    needs 4.5:1). One-sided cases (authored text on the bare list surface,
 *    or an authored fill under the default text color) flag only when BOTH
 *    stock themes fail. Theme classes and unresolvable values mark the
 *    channel unknown and the check stays silent — teach, never guess.
 *
 * Retracted (owner-verified in production, 2026-06-13 — do not re-add without
 * fresh evidence): "CFR inside customCardProps renders blank" and
 * "inlineEditField inside forEach is unreliable". Both work on real SP.
 */

import type { SPElement, NodePath, FormatterDocument } from './types';
import { ELM_TYPES, KNOWN_UNSUPPORTED_STYLES, ALLOWED_STYLES, SP_FUNCTIONS, SP_FUNCTION_DOCS, LIBRARY_ONLY_ROW_ACTIONS } from './schema';
import { parseExpression, parseForEach, type AstNode } from './expressions';
import { cfrFieldName } from './refs';
import {
  colorChainOf, contrastPairsOf, contrastRatio, compositeOver, formatRatio,
  parseCssColor, STOCK_THEME, type ColorChain, type ColorOutcome,
} from './contrast';

export type Severity = 'error' | 'warning' | 'info';

export interface LintIssue {
  severity: Severity;
  rule: string;
  message: string;
  path: NodePath;
  /** For 'unknown-field' issues: the missing column's internal name, so the
   *  lint UI can group the flood of per-reference warnings into one row per
   *  column (and offer to create it) without parsing message text. */
  field?: string;
}

interface WalkState {
  /** Field internal names known to the mock schema (undefined = skip the check). */
  knownFields?: Set<string>;
  /** Field name → type, for type-aware rules (e.g. empty-date comparisons). */
  fieldTypes?: Record<string, string>;
  /** forEach iterator names in scope. */
  iterators: Set<string>;
  /** A strict ancestor carries sp-card-showOnHoverParent (hover-reveal pairing). */
  underHoverParent?: boolean;
  /** Nearest authored fill behind this element ('unknown' = a theme class or
   *  unresolvable value paints here — stay silent; undefined = the bare list
   *  surface). low-contrast context. */
  bg?: ColorChain | 'unknown';
  /** Inherited authored text color (same conventions as bg). */
  fgInherit?: ColorChain | 'unknown';
  /** Inherited literal font-size in px / bold-ness, for the WCAG large-text
   *  threshold (unparseable or formula values leave these undefined). */
  fontPx?: number;
  fontBold?: boolean;
}

const HOVER_PARENT_CLASS = 'sp-card-showOnHoverParent';
const HOVER_CHILD_CLASS = 'sp-card-showOnHoverChild';

/** The element's class value as searchable text — attributes.class is an
 *  SPExpr, so a conditional class may live inside an "=if(...)" expression
 *  string or an operator-tree object; both carry the class token verbatim. */
function classText(el: SPElement): string {
  const c = el.attributes?.class;
  if (typeof c === 'string') return c;
  if (c && typeof c === 'object') return JSON.stringify(c);
  return '';
}

/** True if any DOM descendant carries the hover child class. Does not cross
 *  into customCardProps.formatter — the card renders in a callout, not as a
 *  descendant, so the parent's :hover can never reveal anything inside it. */
function hasHoverChildInSubtree(el: SPElement): boolean {
  for (const child of el.children ?? []) {
    if (classText(child).includes(HOVER_CHILD_CLASS) || hasHoverChildInSubtree(child)) return true;
  }
  return false;
}

export function lintDocument(
  doc: FormatterDocument,
  knownFields?: string[],
  fieldTypes?: Record<string, string>,
): LintIssue[] {
  const issues: LintIssue[] = [];
  // additionalRowClass + rowFormatter are mutually exclusive on real SP: "If
  // a rowFormatter is specified, then additionalRowClass is ignored" (MS
  // view-formatting syntax reference). A row doc here always exports a
  // rowFormatter, so a class riding viewExtras will be silently dropped by
  // SharePoint — classic silent-failure territory, teach it.
  // 'grid' included: the grid is editor presentation, but it EXPORTS as a
  // rowFormatter view too (exportPayload), so the class dies there as well.
  if ((doc.kind === 'row' || doc.kind === 'grid')
    && typeof doc.viewExtras?.additionalRowClass === 'string'
    && doc.viewExtras.additionalRowClass.trim()) {
    issues.push({
      severity: 'warning', rule: 'rowclass-with-rowformatter', path: [],
      message: 'additionalRowClass is IGNORED by SharePoint when a rowFormatter is present (they are mutually exclusive — MS syntax reference). This view exports a rowFormatter, so the row class will silently not apply on the real list; put the styling on the row root element instead.',
    });
  }
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
  const push = (severity: Severity, rule: string, message: string, extra?: Pick<LintIssue, 'field'>) =>
    issues.push({ severity, rule, message, path: [...path], ...extra });

  // bring this element's own iterator into scope for it and its subtree
  if (el.forEach) {
    const b = parseForEach(el.forEach);
    if (b) state = { ...state, iterators: new Set([...state.iterators, b.iterator]) };
  }

  // columnFormatterReference stands in for elmType: the element renders the
  // referenced column's LIVE formatter (verified semantics in HANDOFF §3 —
  // @currentField inside it reads the referenced column). Never demand
  // elmType on one, and check the reference against the mock schema so the
  // missing-column tooling (grouping, create) covers CFRs too.
  const cfrValue = typeof el.columnFormatterReference === 'string'
    ? el.columnFormatterReference.trim() : '';
  if (cfrValue) {
    const refField = cfrFieldName(cfrValue);
    if (state.knownFields && refField && !state.knownFields.has(refField)) {
      push('warning', 'unknown-field', `columnFormatterReference: [$${refField}] is not in the mock schema — add the field in the Data tab or import your list schema.`, { field: refField });
    }
    push('info', 'cfr-not-emulated', 'columnFormatterReference embeds the referenced column\'s LIVE formatter on real SP. The preview here renders a placeholder — it has no tenant to resolve the reference against (inside the referenced formatter, @currentField reads the REFERENCED column).');
  } else if (!el.elmType) {
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

  // hover-reveal pairing (HANDOFF §3): the child class hides the element until
  // an ANCESTOR carrying the parent class is hovered — the reveal selector is
  // .sp-card-showOnHoverParent:hover .sp-card-showOnHoverChild, so the parent
  // class on the element ITSELF doesn't count (a hidden element can't be hovered)
  const cls = classText(el);
  if (cls.includes(HOVER_CHILD_CLASS) && !state.underHoverParent) {
    push('warning', 'hover-child-no-parent', `${HOVER_CHILD_CLASS} with no ancestor carrying ${HOVER_PARENT_CLASS} — this element is hidden and nothing can ever reveal it. Add ${HOVER_PARENT_CLASS} to the container the user will hover (the reveal works in column, row and tile formatters alike).`);
  }
  if (cls.includes(HOVER_PARENT_CLASS)) {
    if (!hasHoverChildInSubtree(el)) {
      push('info', 'hover-parent-no-child', `${HOVER_PARENT_CLASS} with no ${HOVER_CHILD_CLASS} anywhere inside it — the class does nothing on its own. Put ${HOVER_CHILD_CLASS} on the element(s) that should appear on hover.`);
    }
    state = { ...state, underHoverParent: true };
  }

  // low-contrast (WCAG): fold this element's authored colors into the
  // inherited context, then judge its own text against the fill behind it
  state = colorContextFor(el, cls, state);
  checkContrast(el, state, push);

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
          push('warning', 'unknown-field', `${where}: [$${name}] is not in the mock schema — add the field in the Data tab or import your list schema.`, { field: name });
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
        push('warning', 'unknown-field', `forEach: [$${m[1]}] is not in the mock schema — add the field in the Data tab or import your list schema.`, { field: m[1] });
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
    // click-opened cards only: the field observation is about children
    // swallowing the CLICK — hover propagates fine, and a hover card on a
    // division with children is exactly what the trigger workflow generates
    if (el.customCardProps.openOnEvent !== 'hover' && el.elmType !== 'button' && el.children?.length) {
      push('info', 'card-trigger-button', 'customCardProps opening on click, on an element with children: the children have been seen to swallow the click so the card never opens (field observation). The robust trigger patterns: an absolutely-positioned overlay div (sp-card-defaultClickButton), or a button with direct txtContent.');
    }
    const f = el.customCardProps.formatter;
    if (f) {
      const cardIssues: LintIssue[] = [];
      path.push(-1);
      // the card body renders in a callout, not as a DOM descendant of the
      // host — a host-side showOnHoverParent can't reveal anything inside it,
      // and the host's colors/fonts don't carry in (fresh card surface)
      walk(f, path, {
        ...state, underHoverParent: false,
        bg: undefined, fgInherit: undefined, fontPx: undefined, fontBold: undefined,
      }, cardIssues);
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
    // library-only actions (pnp/List-Formatting generic-rowactions; #286) —
    // real and working in document libraries, silently dead on a plain list.
    // Info, not a gate: the tool can't know which surface this deploys to.
    if (LIBRARY_ONLY_ROW_ACTIONS.has(a.action)) {
      push('info', 'action-library-only', `${a.action} works in document libraries only — on a plain list the button renders but the click does nothing.`);
    }
    // executeQuickStep is runtime-accepted but NOT in the published v2 schema
    // (docs/QUICK-STEPS.md §4.3) — always warn, and refuse-and-teach when the
    // ruleTemplateId is missing (a blank trigger does nothing, like executeFlow).
    if (a.action === 'executeQuickStep') {
      push('warning', 'quickstep-undocumented', 'executeQuickStep is an undocumented identifier — it works today but is not in the published v2 schema, and the ruleTemplateId it targets is unversioned, list-specific and non-portable. Prefer reproducing the action with documented primitives where possible.');
      const hasId = a.actionInput && typeof a.actionInput === 'object'
        && typeof (a.actionInput as Record<string, unknown>).ruleTemplateId === 'string'
        && ((a.actionInput as Record<string, unknown>).ruleTemplateId as string).trim() !== '';
      if (!hasId) push('error', 'quickstep-missing-id', 'executeQuickStep needs actionInput {"ruleTemplateId":"<RuleTemplateId from GetAllRules>"} — without it the action does nothing on the list.');
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

// ─── low-contrast helpers (the WCAG rule; math in core/contrast.ts) ─────────

/** Theme-driven paint the linter can't statically resolve: SP/Fabric utility
 *  classes that set a fill or an ink. Best-effort — a class token anywhere in
 *  the value (conditional expressions included) silences the channel. */
const CLASS_SETS_BG = /sp-css-backgroundColor|ms-bgColor|sp-field-/;
const CLASS_SETS_FG = /sp-css-color|ms-fontColor|sp-field-/;

const STOCK = {
  lightText: parseCssColor(STOCK_THEME.light.text)!,
  lightSurface: parseCssColor(STOCK_THEME.light.surface)!,
  darkText: parseCssColor(STOCK_THEME.dark.text)!,
  darkSurface: parseCssColor(STOCK_THEME.dark.surface)!,
};

function isSingleOpaque(c: ColorChain): boolean {
  return c.complete && c.entries.length === 1 && c.entries[0].rgba.a >= 1;
}

/** The fill context an authored background-color leaves for this subtree. */
function resolveBgChain(raw: NonNullable<SPElement['style']>[string], prior: WalkState['bg']): WalkState['bg'] {
  const chain = colorChainOf(raw);
  if (!chain.entries.length) return 'unknown';
  const out: ColorOutcome[] = [];
  let complete = chain.complete;
  for (const e of chain.entries) {
    if (e.rgba.a === 0) {
      // that branch shows what's behind — when the backdrop is a single known
      // opaque fill, the branch RESOLVES to it (a conditional 'transparent'
      // over a white parent is a real white outcome, condition and all)
      if (prior && prior !== 'unknown' && isSingleOpaque(prior)) {
        out.push({ cond: e.cond, css: prior.entries[0].css, rgba: prior.entries[0].rgba });
      } else {
        complete = false;
      }
      continue;
    }
    if (e.rgba.a < 1) {
      // a translucent fill needs a known opaque backdrop to composite over
      if (!prior || prior === 'unknown' || !isSingleOpaque(prior)) return 'unknown';
      out.push({ ...e, rgba: compositeOver(e.rgba, prior.entries[0].rgba) });
    } else {
      out.push(e);
    }
  }
  if (!out.length) return prior; // fully transparent: the inherited fill stays
  return { entries: out, complete };
}

/** The text-color context an authored color leaves for this subtree. */
function resolveFgChain(raw: NonNullable<SPElement['style']>[string]): WalkState['fgInherit'] {
  const chain = colorChainOf(raw);
  const entries = chain.entries.filter((e) => e.rgba.a > 0); // invisible text isn't a contrast problem
  if (!entries.length) return 'unknown';
  return { entries, complete: chain.complete && entries.length === chain.entries.length };
}

function literalPx(raw: unknown): number | undefined {
  if (typeof raw === 'number') return raw;
  if (typeof raw !== 'string' || raw.startsWith('=')) return undefined;
  const m = raw.trim().match(/^(\d+(?:\.\d+)?)px$/i);
  return m ? parseFloat(m[1]) : undefined;
}

function literalBold(raw: unknown): boolean | undefined {
  if (typeof raw === 'number') return raw >= 700;
  if (typeof raw !== 'string' || raw.startsWith('=')) return undefined;
  const v = raw.trim().toLowerCase();
  if (v === 'bold') return true;
  // 'bolder' is RELATIVE — from a light parent it can resolve to 400, so
  // treating it as bold could unlock the 3:1 bar and hide a real failure.
  // Unknown keeps the stricter normal-text threshold (info-tier at worst).
  if (v === 'bolder') return undefined;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n >= 700 : undefined;
}

/** Fold the element's own class/style paint into the inherited color context.
 *  Inline styles beat classes (the CSS rule), so a resolvable style value
 *  recovers a channel a class made unknown. */
function colorContextFor(el: SPElement, cls: string, state: WalkState): WalkState {
  let bg = state.bg, fg = state.fgInherit;
  let fontPx = state.fontPx, fontBold = state.fontBold;
  if (CLASS_SETS_BG.test(cls)) bg = 'unknown';
  if (CLASS_SETS_FG.test(cls)) fg = 'unknown';
  const st = el.style ?? {};
  if (st['background-color'] !== undefined) bg = resolveBgChain(st['background-color'], bg);
  // AFTER the color: an image paints OVER any background-color fallback, so
  // its presence makes the backdrop unknown no matter what color rode along
  if (st['background-image'] !== undefined) bg = 'unknown';
  if (st['color'] !== undefined) fg = resolveFgChain(st['color']);
  // links/buttons paint their own theme ink unless a color is authored — the
  // body-text assumption is wrong for the element AND for text in its children
  if ((el.elmType === 'a' || el.elmType === 'button') && st['color'] === undefined) fg = 'unknown';
  if (st['font-size'] !== undefined) fontPx = literalPx(st['font-size']);
  if (st['font-weight'] !== undefined) fontBold = literalBold(st['font-weight']);
  if (bg === state.bg && fg === state.fgInherit && fontPx === state.fontPx && fontBold === state.fontBold) return state;
  return { ...state, bg, fgInherit: fg, fontPx, fontBold };
}

/**
 * Judge this element's text against the fill behind it. Two-sided authored
 * pairs check directly (SOUND pairings only — contrastPairsOf); one-sided
 * cases check against BOTH stock themes and flag only when both fail, since
 * the tenant theme decides which one a reader gets. Severity: below 3:1 (the
 * WCAG floor even for large text) = warning; 3:1–4.5:1 on normal-size text =
 * info. One issue per element, worst pairs listed.
 */
function checkContrast(el: SPElement, state: WalkState, push: (s: Severity, r: string, m: string) => void): void {
  if (el.txtContent === undefined) return;
  if (typeof el.txtContent === 'string' && el.txtContent.trim() === '') return;
  const fg = state.fgInherit, bg = state.bg;
  if (fg === 'unknown' || bg === 'unknown') return;
  if (!fg && !bg) return;
  const large = state.fontPx !== undefined
    && (state.fontPx >= 24 || (state.fontPx >= 18.66 && state.fontBold === true));
  const floor = large ? 3 : 4.5;

  const fails: Array<{ text: string; worst: number }> = [];
  if (fg && bg) {
    for (const p of contrastPairsOf(fg, bg)) {
      const r = contrastRatio(p.fg.rgba, p.bg.rgba);
      if (r < floor) {
        const cond = p.fg.cond || p.bg.cond ? 'when its conditions pick ' : '';
        fails.push({ text: `${cond}'${p.fg.css}' text on the '${p.bg.css}' fill (${formatRatio(r)})`, worst: r });
      }
    }
  } else if (fg) {
    // authored text on the bare list surface
    for (const f of fg.entries) {
      const rl = contrastRatio(f.rgba, STOCK.lightSurface);
      const rd = contrastRatio(f.rgba, STOCK.darkSurface);
      if (rl < floor && rd < floor) {
        fails.push({ text: `'${f.css}' text on the list's own background — it fails in BOTH stock themes (${formatRatio(rl)} light, ${formatRatio(rd)} dark), so no tenant look saves it. Pick a stronger color or give the element a fill`, worst: Math.max(rl, rd) });
      }
    }
  } else if (bg) {
    // authored fill under the default text color (links/buttons never reach
    // here — colorContextFor marks their un-authored ink 'unknown')
    for (const b of bg.entries) {
      const rl = contrastRatio(STOCK.lightText, b.rgba);
      const rd = contrastRatio(STOCK.darkText, b.rgba);
      if (rl < floor && rd < floor) {
        fails.push({ text: `the default text color on the '${b.css}' fill — it fails in BOTH stock themes (${formatRatio(rl)} light, ${formatRatio(rd)} dark). Set style.color to something readable on this fill`, worst: Math.max(rl, rd) });
      }
    }
  }
  if (!fails.length) return;

  const severity: Severity = fails.some((f) => f.worst < 3) ? 'warning' : 'info';
  fails.sort((a, b) => a.worst - b.worst); // worst first — the shown pairs must justify the severity
  const shown = fails.slice(0, 3).map((f) => f.text).join('; ');
  const more = fails.length > 3 ? ` (+${fails.length - 3} more)` : '';
  const bar = large
    ? 'WCAG wants at least 3:1 for text this large'
    : severity === 'warning'
      ? 'below even the 3:1 WCAG floor for large text, so many readers simply lose it (normal-size text needs 4.5:1)'
      : 'readable at WCAG-large sizes (24px+, or bold 18.66px+), but under the 4.5:1 AA minimum for text this size';
  push(severity, 'low-contrast', `Low contrast: ${shown}${more} — ${bar}. SharePoint renders it anyway; the readers it excludes won't file a bug.`);
}
