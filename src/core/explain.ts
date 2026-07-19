// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Sam Yost

/**
 * core/explain.ts — the plain-English decompiler: read a formatter back to
 * the maker in sentences ("If Status is 'Blocked', the background turns red.
 * Clicking runs a Power Automate flow.").
 *
 * The comprehension half of the teaching linter. Two layers:
 *   - explainAst / explainValue — a visitor over the SAME 9 AST node kinds
 *     evalAst walks (core/expressions.ts), plus the legacy object/AST syntax
 *     community samples use (converted, then explained the same way).
 *   - explainDocument — a depth-first walk of the element tree (children +
 *     the customCardProps CARD_SEGMENT, mirroring the linter's paths) that
 *     turns txtContent / conditional styles / attributes / actions / cards /
 *     forEach into labeled sentences, addressed by NodePath so a UI can
 *     select-on-click exactly like a lint warning.
 *
 * House rule, refuse-don't-guess: anything outside the known subset comes
 * back as an explicit "can't explain this yet" line (unexplained: true) —
 * never a confident-but-wrong reading.
 *
 * Pure and node-testable: no DOM, no editor imports.
 */

import type { SPElement, SPExpr, NodePath, FormatterDocument } from './types';
import { parseExpression, parseForEach, type AstNode } from './expressions';

/** Descends into customCardProps.formatter — same convention as the linter
 *  and editor/state.ts CARD_SEGMENT. */
const CARD_SEGMENT = -1;

export interface ExplainContext {
  /** Field internal name → display name (falls back to the internal name). */
  displayNames?: Record<string, string>;
  /** Resolves "@currentField" to a named column when known. */
  currentFieldName?: string;
}

export type Explanation =
  | { ok: true; text: string }
  | { ok: false; reason: string };

/** Deliberate refusal carried out of the recursion (refuse-don't-guess). */
class CannotExplain extends Error {}

// ─── field / token phrasing ──────────────────────────────────────────────────

const PROP_PHRASES: Record<string, string> = {
  title: 'name', email: 'email', picture: 'photo', sip: 'sip address',
  id: 'id', department: 'department', jobTitle: 'job title',
  lookupValue: 'value', lookupId: 'item id', desc: 'description',
};

function fieldPhrase(ref: string, ctx: ExplainContext): string {
  if (ref.startsWith('!')) {
    const name = ref.slice(1).split('.')[0];
    return `the display name of the ${displayOf(name, ctx)} column`;
  }
  const parts = (ref.startsWith('$') ? ref.slice(1) : ref).split('.');
  const base = displayOf(parts[0], ctx);
  const props = parts.slice(1).map((p) => PROP_PHRASES[p] ?? p);
  return props.length ? `${base}’s ${props.join(' ')}` : base;
}

function displayOf(internal: string, ctx: ExplainContext): string {
  return `“${ctx.displayNames?.[internal] ?? internal}”`;
}

function tokenPhrase(name: string, ctx: ExplainContext): string {
  const [head, ...props] = name.split('.');
  const propTail = props.map((p) => PROP_PHRASES[p] ?? p).join(' ');
  switch (head) {
    case '@currentField': {
      const col = ctx.currentFieldName ? `this column (${displayOf(ctx.currentFieldName, ctx)})` : 'this column’s value';
      return propTail ? `${col}’s ${propTail}` : col;
    }
    case '@me': return propTail ? `the current viewer’s ${propTail}` : 'the current viewer’s email';
    case '@now': return 'the current date and time';
    case '@rowIndex': return 'the row’s position in the view (first row is 0)';
    case '@isSelected': return 'whether the row is selected';
    case '@currentWeb': return 'the site’s URL';
    case '@thumbnail': return propTail ? `the file thumbnail’s ${propTail}` : 'the file’s thumbnail';
    case '@window':
      if (propTail === 'innerWidth') return 'the window’s width in pixels';
      if (propTail === 'innerHeight') return 'the window’s height in pixels';
      return `the window’s ${propTail || 'size'}`;
    default:
      throw new CannotExplain(`the ${head} token isn’t in Explain’s vocabulary yet`);
  }
}

// ─── the AST visitor ─────────────────────────────────────────────────────────

/** Explain a parsed expression node in plain English. Throws CannotExplain
 *  for constructs outside the known subset — callers catch via explainValue. */
export function explainAst(node: AstNode, ctx: ExplainContext): string {
  return render(node, null, ctx);
}

const BINARY_PHRASES: Record<string, string> = {
  '==': 'is', '!=': 'is not',
  '>': 'is more than', '>=': 'is at least',
  '<': 'is less than', '<=': 'is at most',
  '-': 'minus', '*': 'times', '/': 'divided by', '%': 'modulo',
};

function render(node: AstNode, parentOp: string | null, ctx: ExplainContext): string {
  switch (node.kind) {
    case 'num': return String(node.value);
    case 'str': return node.value === '' ? 'empty' : `‘${node.value}’`;
    case 'field': return fieldPhrase(node.ref, ctx);
    case 'token': return tokenPhrase(node.name, ctx);
    case 'ident':
      if (node.name === 'true') return 'yes';
      if (node.name === 'false') return 'no';
      if (node.name.startsWith('_')) return `the current ${node.name} loop item`;
      throw new CannotExplain(`“${node.name}” isn’t something Explain recognizes`);
    case 'unary':
      return `negative ${render(node.operand, null, ctx)}`;
    case 'ternary':
      return ifPhrase(node.cond, node.yes, node.no, ctx);
    case 'binary': {
      if (node.op === '&&' || node.op === '||') {
        const joiner = node.op === '&&' ? 'and' : 'or';
        const text = `${render(node.left, node.op, ctx)} ${joiner} ${render(node.right, node.op, ctx)}`;
        // parenthesize mixed and/or so the reading is unambiguous
        return parentOp && (parentOp === '&&' || parentOp === '||') && parentOp !== node.op
          ? `(${text})` : text;
      }
      if (node.op === '+') {
        const stringy = node.left.kind === 'str' || node.right.kind === 'str';
        return `${render(node.left, node.op, ctx)} ${stringy ? 'followed by' : 'plus'} ${render(node.right, node.op, ctx)}`;
      }
      const phrase = BINARY_PHRASES[node.op];
      if (!phrase) throw new CannotExplain(`the “${node.op}” operator isn’t in Explain’s vocabulary yet`);
      return `${render(node.left, node.op, ctx)} ${phrase} ${render(node.right, node.op, ctx)}`;
    }
    case 'call':
      return callPhrase(node.fn, node.args, ctx);
  }
}

function ifPhrase(cond: AstNode, yes: AstNode | undefined, no: AstNode | undefined, ctx: ExplainContext): string {
  const y = yes ? render(yes, null, ctx) : 'nothing';
  const n = no ? render(no, null, ctx) : 'nothing';
  return `if ${render(cond, null, ctx)}, then ${y}, otherwise ${n}`;
}

function callPhrase(fn: string, args: AstNode[], ctx: ExplainContext): string {
  const a = (i: number): string => (args[i] ? render(args[i], null, ctx) : 'nothing');
  switch (fn) {
    case 'if': return ifPhrase(args[0], args[1], args[2], ctx);
    case 'toString': return `${a(0)} as text`;
    case 'Number': return `${a(0)} as a number`;
    case 'Date': return `${a(0)} as a date`;
    case 'abs': return `the absolute value of ${a(0)}`;
    case 'floor': return `${a(0)} rounded down`;
    case 'ceiling': return `${a(0)} rounded up`;
    case 'pow': return `${a(0)} to the power of ${a(1)}`;
    case 'cos': return `the cosine of ${a(0)}`;
    case 'sin': return `the sine of ${a(0)}`;
    case 'indexOf': return `the position of ${a(1)} within ${a(0)} (−1 when absent)`;
    case 'lastIndexOf': return `the last position of ${a(1)} within ${a(0)}`;
    case 'substring': return `the part of ${a(0)} from position ${a(1)} to ${a(2)}`;
    case 'startsWith': return `${a(0)} starts with ${a(1)}`;
    case 'endsWith': return `${a(0)} ends with ${a(1)}`;
    case 'replace': return `${a(0)} with the first ${a(1)} replaced by ${a(2)}`;
    case 'replaceAll': return `${a(0)} with every ${a(1)} replaced by ${a(2)}`;
    case 'padStart': return `${a(0)} padded at the start to ${a(1)} characters`;
    case 'padEnd': return `${a(0)} padded at the end to ${a(1)} characters`;
    case 'toLowerCase': return `${a(0)} in lower case`;
    case 'toUpperCase': return `${a(0)} in upper case`;
    case 'split': return `${a(0)} split into pieces on ${a(1)}`;
    case 'join': return `the items of ${a(0)} joined with ${a(1)}`;
    case 'length': return `how many items ${a(0)} holds`;
    case 'appendTo': return `${a(0)} with ${a(1)} added`;
    case 'removeFrom': return `${a(0)} with ${a(1)} removed`;
    case 'getDate': return `the day of the month of ${a(0)}`;
    case 'getMonth': return `the month of ${a(0)} (January is 0)`;
    case 'getYear': return `the year of ${a(0)}`;
    case 'toLocaleString': return `${a(0)} formatted as date and time`;
    case 'toLocaleDateString': return `${a(0)} formatted as a date`;
    case 'toLocaleTimeString': return `${a(0)} formatted as a time`;
    case 'addDays': return `${a(0)} plus ${a(1)} days`;
    case 'addMinutes': return `${a(0)} plus ${a(1)} minutes`;
    case 'loopIndex': return `the position of the current ${a(0)} loop item`;
    case 'getUserImage': return `the profile photo of ${a(0)}`;
    case 'getThumbnailImage': return `a thumbnail of ${a(0)}`;
    default:
      throw new CannotExplain(`${fn}() isn’t a SharePoint formatting function Explain covers yet`);
  }
}

// ─── the legacy object/AST syntax ────────────────────────────────────────────

const OBJECT_BINARY = new Set(['+', '-', '*', '/', '%', '==', '!=', '<', '>', '<=', '>=']);

/** Convert the older {"operator": …, "operands": […]} syntax into the same
 *  AstNode shape the parser emits, so one visitor explains both dialects. */
export function astFromObjectForm(node: { operator: string; operands: SPExpr[] }): AstNode {
  const op = node.operator;
  const operands = (node.operands ?? []).map(astFromOperand);
  if (op === '?' || op === ':') {
    return { kind: 'ternary', cond: operands[0], yes: operands[1], no: operands[2] };
  }
  if (op === '&&' || op === '||') {
    if (operands.length === 0) throw new CannotExplain(`${op} with no operands`);
    return operands.reduce((l, r) => ({ kind: 'binary', op, left: l, right: r }));
  }
  if (OBJECT_BINARY.has(op)) {
    if (op === '-' && operands.length === 1) return { kind: 'unary', op: '-', operand: operands[0] };
    if (operands.length === 0) throw new CannotExplain(`${op} with no operands`);
    return operands.reduce((l, r) => ({ kind: 'binary', op, left: l, right: r }));
  }
  const fn = op.replace(/\(\)$/, '');
  return { kind: 'call', fn, args: operands };
}

function astFromOperand(o: SPExpr): AstNode {
  if (typeof o === 'number') return { kind: 'num', value: o };
  if (typeof o === 'boolean') return { kind: 'ident', name: o ? 'true' : 'false' };
  if (typeof o === 'string') {
    // mirror evaluate(): '=…' is a formula, bare [$x]/@token are references,
    // anything else is a literal
    if (o.startsWith('=')) return parseExpression(o.slice(1));
    const t = o.trim();
    if (/^\[[$!][A-Za-z0-9_. ]+\]$/.test(t)) return { kind: 'field', ref: t.slice(1, -1) };
    if (/^@[A-Za-z]+(\.[A-Za-z]+)*$/.test(t)) return { kind: 'token', name: t };
    return { kind: 'str', value: o };
  }
  if (o && typeof o === 'object' && typeof o.operator === 'string') return astFromObjectForm(o);
  throw new CannotExplain('an operand Explain doesn’t recognize');
}

// ─── any schema value → explanation ──────────────────────────────────────────

/**
 * Explain any schema value: Excel-style '=…' strings, bare [$Field]/@token
 * references, the object/AST syntax, and plain literals. Never throws — the
 * refusal comes back as { ok: false } with a human reason.
 */
export function explainValue(value: SPExpr, ctx: ExplainContext = {}): Explanation {
  try {
    if (typeof value === 'number' || typeof value === 'boolean') {
      return { ok: true, text: String(value) };
    }
    if (typeof value === 'string') {
      if (value.startsWith('=')) {
        return { ok: true, text: explainAst(parseExpression(value.slice(1)), ctx) };
      }
      const t = value.trim();
      if (/^\[[$!][A-Za-z0-9_. ]+\]$/.test(t)) {
        return { ok: true, text: fieldPhrase(t.slice(1, -1), ctx) };
      }
      if (/^@[A-Za-z]+(\.[A-Za-z]+)*$/.test(t)) {
        return { ok: true, text: tokenPhrase(t, ctx) };
      }
      return { ok: true, text: value === '' ? 'nothing' : `‘${value}’` };
    }
    if (value && typeof value === 'object' && typeof value.operator === 'string') {
      return { ok: true, text: explainAst(astFromObjectForm(value), ctx) };
    }
    return { ok: false, reason: 'this value isn’t a string, number, boolean or operator object' };
  } catch (e) {
    if (e instanceof CannotExplain) return { ok: false, reason: e.message };
    return { ok: false, reason: `the formula couldn’t be parsed — ${(e as Error).message}` };
  }
}

// ─── the element-tree walk ───────────────────────────────────────────────────

export interface ExplainLine {
  text: string;
  /** True when this line is a refusal ("can't explain yet"), not a reading. */
  unexplained?: boolean;
}

export interface ExplainEntry {
  /** Node address — same path convention as lint issues (CARD_SEGMENT = -1). */
  path: NodePath;
  /** The element's friendly name (or its tag). */
  label: string;
  lines: ExplainLine[];
}

/** Style properties whose conditional values carry the story, phrased warmly. */
const STYLE_PHRASES: Record<string, string> = {
  'background-color': 'The background color is',
  'color': 'The text color is',
  'display': 'Shown or hidden:',
  'visibility': 'Visible or not:',
  'width': 'The width is',
  'border-color': 'The border color is',
  'fill': 'The (SVG) fill color is',
};

const ACTION_PHRASES: Record<string, string> = {
  defaultClick: 'Clicking opens the item (the row’s default action).',
  share: 'Clicking opens SharePoint’s share dialog for the item.',
  delete: 'Clicking deletes the item (SharePoint asks to confirm).',
  editProps: 'Clicking opens the item’s properties for editing.',
  openContextMenu: 'Clicking opens the item’s context menu (the “…” menu).',
  embed: 'Clicking opens an embedded preview.',
  copyLink: 'Clicking opens the copy-link dialog for the item.',
  comment: 'Clicking opens the item’s comments pane.',
  openApprovalDialog: 'Clicking opens the approval dialog for the item.',
  previewFileAction: 'Clicking opens the file preview (document libraries only — does nothing on a plain list).',
  copyFile: 'Clicking opens the copy-file dialog (document libraries only — does nothing on a plain list).',
  moveFile: 'Clicking opens the move-file dialog (document libraries only — does nothing on a plain list).',
};

/**
 * Walk the whole document and return one entry per element that has
 * something to say (structure-only wrappers are skipped). Entries keep
 * NodePaths so a UI can select-on-click like the lint list does.
 */
export function explainDocument(doc: FormatterDocument, ctx: ExplainContext = {}): ExplainEntry[] {
  const entries: ExplainEntry[] = [];
  walkExplain(doc.root, [], ctx, entries);
  return entries;
}

function walkExplain(el: SPElement, path: NodePath, ctx: ExplainContext, entries: ExplainEntry[]): void {
  const lines: ExplainLine[] = [];
  const say = (value: SPExpr, phrase: (text: string) => string, what: string): void => {
    const ex = explainValue(value, ctx);
    if (ex.ok) lines.push({ text: phrase(ex.text) });
    else lines.push({ text: `${what}: can’t explain this yet — ${ex.reason}.`, unexplained: true });
  };

  if (el.forEach) {
    const binding = parseForEach(el.forEach);
    if (binding) {
      say(binding.listExpr.startsWith('=') ? binding.listExpr : `=${binding.listExpr}`,
        (t) => `Repeats once for each item in ${t}.`, 'The forEach loop');
    } else {
      lines.push({ text: `The forEach loop: can’t explain this yet — “${el.forEach}” isn’t “iterator in expression”.`, unexplained: true });
    }
  }

  if (el.txtContent !== undefined) {
    say(el.txtContent, (t) => `Shows ${t}.`, 'The text');
  }

  if (el.inlineEditField) {
    const ref = el.inlineEditField.replace(/^\[?\$?/, '').replace(/\]$/, '');
    lines.push({ text: `Lets the reader edit the ${displayOf(ref, ctx)} field right here in the view.` });
  }

  // conditional styles carry meaning; static styles are just design
  for (const [prop, value] of Object.entries(el.style ?? {})) {
    if (value === undefined || prop === '_comment') continue;
    const isExpr = (typeof value === 'string' && value.startsWith('=')) || typeof value === 'object';
    if (!isExpr) continue;
    const lead = STYLE_PHRASES[prop] ?? `The “${prop}” style is`;
    say(value, (t) => `${lead} ${t}.`, `The “${prop}” style`);
  }

  for (const [attr, value] of Object.entries(el.attributes ?? {})) {
    if (value === undefined) continue;
    const isExpr = (typeof value === 'string' && value.startsWith('=')) || typeof value === 'object';
    if (attr === 'href') { say(value, (t) => `Links to ${t}.`, 'The link target'); continue; }
    if (attr === 'src') { say(value, (t) => `Shows the image at ${t}.`, 'The image source'); continue; }
    if (attr === 'iconName') {
      if (isExpr) say(value, (t) => `Shows an icon chosen by ${t}.`, 'The icon');
      else lines.push({ text: `Shows the “${String(value)}” icon.` });
      continue;
    }
    if (isExpr) say(value, (t) => `The “${attr}” attribute is ${t}.`, `The “${attr}” attribute`);
  }
  if (typeof el.attributes?.target === 'string' && el.attributes.target === '_blank' && el.attributes?.href !== undefined) {
    lines.push({ text: 'The link opens in a new tab.' });
  }

  if (el.customRowAction) {
    lines.push(actionLine(el.customRowAction, ctx));
  }

  if (el.customCardProps) {
    lines.push({ text: `Opens a hover card on ${el.customCardProps.openOnEvent === 'hover' ? 'hover' : 'click'} — its contents are explained below.` });
  }

  if (lines.length) {
    entries.push({ path: [...path], label: el._elmName ?? `<${el.elmType ?? '?'}>`, lines });
  }

  el.children?.forEach((child, i) => {
    path.push(i);
    walkExplain(child, path, ctx, entries);
    path.pop();
  });
  if (el.customCardProps?.formatter) {
    path.push(CARD_SEGMENT);
    walkExplain(el.customCardProps.formatter, path, ctx, entries);
    path.pop();
  }
}

function actionLine(action: NonNullable<SPElement['customRowAction']>, ctx: ExplainContext): ExplainLine {
  if (action.action === 'executeFlow') {
    const id = typeof action.actionParams === 'string'
      ? /"id"\s*:\s*"([^"]+)"/.exec(action.actionParams)?.[1] : undefined;
    return { text: id
      ? `Clicking runs the Power Automate flow ${id}.`
      : 'Clicking is meant to run a Power Automate flow, but no flow id is set — it will do nothing on the real list.' };
  }
  if (action.action === 'setValue') {
    const input = action.actionInput;
    if (input && typeof input === 'object' && Object.keys(input).length) {
      let hasRefusal = false;
      const parts = Object.entries(input).map(([field, v]) => {
        const ex = explainValue(v as SPExpr, ctx);
        if (!ex.ok) hasRefusal = true;
        return `${displayOf(field, ctx)} to ${ex.ok ? ex.text : 'a value Explain can’t read yet'}`;
      });
      return {
        text: `Clicking sets ${parts.join(' and ')} on the item — no form, it just writes.`,
        // a partly-unreadable sentence is still a refusal — style it as one
        ...(hasRefusal ? { unexplained: true } : {}),
      };
    }
    return { text: 'Clicking is meant to set a field value, but no field/value is configured — it will do nothing on the real list.' };
  }
  if (action.action === 'executeQuickStep') {
    const input = action.actionInput;
    const id = input && typeof input === 'object' ? (input as Record<string, unknown>).ruleTemplateId : undefined;
    return { text: typeof id === 'string' && id.trim()
      ? `Clicking fires the existing Quick Step with rule template id ${id} (an undocumented action — see the lint note).`
      : 'Clicking is meant to fire an existing Quick Step, but no ruleTemplateId is set — it will do nothing on the real list.' };
  }
  const known = ACTION_PHRASES[action.action];
  if (known) return { text: known };
  if (action.action === '') return { text: 'A click action is declared but left empty — it does nothing.' };
  return { text: `The “${action.action}” click action: can’t explain this yet.`, unexplained: true };
}
