// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * core/expressions.ts — Parser + evaluator for SharePoint formatter expressions.
 *
 * Any string starting with '=' is an expression. Supports the documented
 * operator set, Excel-style functions, field references ([$Field],
 * [$Field.prop], [!Field.DisplayName]), special tokens (@currentField, @me,
 * @now, @rowIndex, ...) and forEach iterator variables.
 */

import type { MockRow, PersonValue, SPExpr } from './types';
import { SP_FUNCTIONS } from './schema';

// ─── Values & context ────────────────────────────────────────────────────────

export type SPValue = string | number | boolean | Date | null | SPValue[] | PersonValue | Record<string, unknown>;

export interface EvalContext {
  row: MockRow;
  rowIndex: number;
  /** Field the column formatter is applied to (resolves @currentField). */
  currentFieldName: string;
  me: PersonValue;
  /** forEach iterator variables currently in scope: name → value. */
  iterators: Record<string, SPValue>;
  /** forEach iterator indices: name → index (for loopIndex). */
  iteratorIndex: Record<string, number>;
  displayNames: Record<string, string>;
  now: Date;
}

export class ExpressionError extends Error {}

// ─── Tokenizer ───────────────────────────────────────────────────────────────

type TokType = 'num' | 'str' | 'field' | 'token' | 'ident' | 'op' | 'lparen' | 'rparen' | 'comma';
interface Tok { type: TokType; value: string }

const OPS = new Set(['==', '!=', '<=', '>=', '&&', '||', '+', '-', '*', '/', '%', '<', '>', '!', '?', ':']);

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c === '(') { toks.push({ type: 'lparen', value: '(' }); i++; continue; }
    if (c === ')') { toks.push({ type: 'rparen', value: ')' }); i++; continue; }
    if (c === ',') { toks.push({ type: 'comma', value: ',' }); i++; continue; }
    if (c === "'" || c === '"') {
      const quote = c;
      let j = i + 1, out = '';
      while (j < src.length && src[j] !== quote) { out += src[j]; j++; }
      if (j >= src.length) throw new ExpressionError(`Unterminated string literal at ${i}`);
      toks.push({ type: 'str', value: out });
      i = j + 1; continue;
    }
    if (c === '[') {
      const end = src.indexOf(']', i);
      if (end < 0) throw new ExpressionError(`Unterminated field reference at ${i}`);
      const inner = src.slice(i + 1, end);
      toks.push({ type: 'field', value: inner });
      i = end + 1; continue;
    }
    if (c === '@') {
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_.]/.test(src[j])) j++;
      toks.push({ type: 'token', value: src.slice(i, j) });
      i = j; continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const raw = src.slice(i, j);
      // a second dot means it's not a number — parseFloat would silently
      // truncate '1.2.3' to 1.2, so refuse it instead of miscompiling
      if ((raw.match(/\./g)?.length ?? 0) > 1) {
        throw new ExpressionError(`Malformed number '${raw}' at ${i} — a number can have at most one decimal point.`);
      }
      toks.push({ type: 'num', value: raw });
      i = j; continue;
    }
    const two = src.slice(i, i + 2);
    if (OPS.has(two)) { toks.push({ type: 'op', value: two }); i += 2; continue; }
    if (OPS.has(c)) { toks.push({ type: 'op', value: c }); i++; continue; }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_$.]/.test(src[j])) j++;
      toks.push({ type: 'ident', value: src.slice(i, j) });
      i = j; continue;
    }
    throw new ExpressionError(`Unexpected character '${c}' at ${i}`);
  }
  return toks;
}

// ─── Parser (AST) ────────────────────────────────────────────────────────────

export type AstNode =
  | { kind: 'num'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'field'; ref: string }
  | { kind: 'token'; name: string }
  | { kind: 'ident'; name: string }
  | { kind: 'unary'; op: string; operand: AstNode }
  | { kind: 'binary'; op: string; left: AstNode; right: AstNode }
  | { kind: 'ternary'; cond: AstNode; yes: AstNode; no: AstNode }
  | { kind: 'call'; fn: string; args: AstNode[] };

/**
 * SharePoint's expression language has NO logical NOT in either syntax —
 * no not() function and no standalone '!' prefix (owner-corrected
 * 2026-06-12; an earlier version of this engine wrongly recommended '!').
 * '!=' (not-equals) is a different, fully supported operator. Negation
 * must be rewritten inside the expression itself.
 */
const NO_NOT_MESSAGE =
  "SharePoint formatting has no logical NOT — neither not() nor a standalone '!' works "
  + "('!=' for not-equals is fine; that's a different operator). "
  + 'Negate inside the expression instead: turn == into !=, < into >=, '
  + 'swap the if() branches, or compare a yes/no field with == false.';

class Parser {
  private pos = 0;
  private toks: Tok[];
  constructor(toks: Tok[]) { this.toks = toks; }

  parse(): AstNode {
    const node = this.ternary();
    if (this.pos < this.toks.length) {
      throw new ExpressionError(`Unexpected token '${this.toks[this.pos].value}'`);
    }
    return node;
  }

  private peek(): Tok | undefined { return this.toks[this.pos]; }
  private next(): Tok { return this.toks[this.pos++]; }
  private matchOp(...ops: string[]): string | null {
    const t = this.peek();
    if (t && t.type === 'op' && ops.includes(t.value)) { this.pos++; return t.value; }
    return null;
  }

  private ternary(): AstNode {
    const cond = this.or();
    if (this.matchOp('?')) {
      const yes = this.ternary();
      if (!this.matchOp(':')) throw new ExpressionError("Expected ':' in ternary");
      const no = this.ternary();
      return { kind: 'ternary', cond, yes, no };
    }
    return cond;
  }
  private or(): AstNode {
    let left = this.and();
    let op: string | null;
    while ((op = this.matchOp('||'))) left = { kind: 'binary', op, left, right: this.and() };
    return left;
  }
  private and(): AstNode {
    let left = this.equality();
    let op: string | null;
    while ((op = this.matchOp('&&'))) left = { kind: 'binary', op, left, right: this.equality() };
    return left;
  }
  private equality(): AstNode {
    let left = this.relational();
    let op: string | null;
    while ((op = this.matchOp('==', '!='))) left = { kind: 'binary', op, left, right: this.relational() };
    return left;
  }
  private relational(): AstNode {
    let left = this.additive();
    let op: string | null;
    while ((op = this.matchOp('<=', '>=', '<', '>'))) left = { kind: 'binary', op, left, right: this.additive() };
    return left;
  }
  private additive(): AstNode {
    let left = this.multiplicative();
    let op: string | null;
    while ((op = this.matchOp('+', '-'))) left = { kind: 'binary', op, left, right: this.multiplicative() };
    return left;
  }
  private multiplicative(): AstNode {
    let left = this.unary();
    let op: string | null;
    while ((op = this.matchOp('*', '/', '%'))) left = { kind: 'binary', op, left, right: this.unary() };
    return left;
  }
  private unary(): AstNode {
    const op = this.matchOp('!', '-');
    if (op === '!') throw new ExpressionError(NO_NOT_MESSAGE);
    if (op) return { kind: 'unary', op, operand: this.unary() };
    return this.primary();
  }
  private primary(): AstNode {
    const t = this.peek();
    if (!t) throw new ExpressionError('Unexpected end of expression');
    if (t.type === 'num') { this.next(); return { kind: 'num', value: parseFloat(t.value) }; }
    if (t.type === 'str') { this.next(); return { kind: 'str', value: t.value }; }
    if (t.type === 'field') { this.next(); return { kind: 'field', ref: t.value }; }
    if (t.type === 'token') { this.next(); return { kind: 'token', name: t.value }; }
    if (t.type === 'lparen') {
      this.next();
      const inner = this.ternary();
      if (this.peek()?.type !== 'rparen') throw new ExpressionError("Expected ')'");
      this.next();
      return inner;
    }
    if (t.type === 'ident') {
      this.next();
      if (this.peek()?.type === 'lparen') {
        this.next();
        const args: AstNode[] = [];
        if (this.peek()?.type !== 'rparen') {
          args.push(this.ternary());
          while (this.peek()?.type === 'comma') { this.next(); args.push(this.ternary()); }
        }
        if (this.peek()?.type !== 'rparen') throw new ExpressionError(`Expected ')' after ${t.value}(...)`);
        this.next();
        return { kind: 'call', fn: t.value, args };
      }
      return { kind: 'ident', name: t.value };
    }
    throw new ExpressionError(`Unexpected token '${t.value}'`);
  }
}

// ⚡ Bolt: Cache parsed AST nodes to avoid redundant string parsing (which is expensive)
// for frequently evaluated expressions. Prevents unbounded memory growth with a simple
// bounded size clear.
const PARSE_CACHE = new Map<string, AstNode>();

export function parseExpression(src: string): AstNode {
  let node = PARSE_CACHE.get(src);
  if (node) return node;

  node = new Parser(tokenize(src)).parse();

  if (PARSE_CACHE.size > 1000) PARSE_CACHE.clear();
  PARSE_CACHE.set(src, node);

  return node;
}

// ─── Coercion helpers (SP-style loose semantics) ─────────────────────────────

export function toStr(v: SPValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(toStr).join(',');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    // person → title/email; lookup → lookupValue
    if (typeof o.lookupValue === 'string') return o.lookupValue;
    if (typeof o.title === 'string') return o.title;
    if (typeof o.email === 'string') return o.email;
    return JSON.stringify(v);
  }
  return String(v);
}

export function toNum(v: SPValue): number {
  if (v === null || v === undefined || v === '') return NaN;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v;
  return parseFloat(toStr(v));
}

export function truthy(v: SPValue): boolean {
  if (v === null || v === undefined || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
  return Boolean(v);
}

function looseEq(a: SPValue, b: SPValue): boolean {
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull || bNull) {
    // null CELL values are not equal to '' on real SP; absent FIELDS
    // resolve to '' and are. Pinned in core.test.ts — don't fold together.
    return aNull && bNull;
  }
  if (typeof a === 'number' || typeof b === 'number') {
    const na = toNum(a), nb = toNum(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na === nb;
  }
  return toStr(a) === toStr(b);
}

function svgAvatar(seed: string): string {
  const palette = ['#0078d4', '#107c10', '#5c2d91', '#d83b01', '#008272', '#a4262c'];
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const bg = palette[h % palette.length];
  const initials = seed.split(/[\s.@_-]+/).filter(Boolean).slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="${bg}"/><text x="24" y="31" font-family="Segoe UI,sans-serif" font-size="20" fill="#fff" text-anchor="middle">${initials}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// ─── Evaluator ───────────────────────────────────────────────────────────────

function resolveProp(base: SPValue, prop: string): SPValue {
  if (base === null || base === undefined) return '';
  if (Array.isArray(base)) {
    return base.map((item) => resolveProp(item, prop)) as SPValue[];
  }
  if (typeof base === 'object' && !(base instanceof Date)) {
    const obj = base as Record<string, SPValue>;
    if (prop === 'picture' && !obj['picture'] && (obj['email'] || obj['title'])) {
      return svgAvatar(toStr(obj['email'] ?? obj['title']));
    }
    return (obj[prop] ?? '') as SPValue;
  }
  return '';
}

function resolveFieldRef(ref: string, ctx: EvalContext): SPValue {
  // [!Field.DisplayName]
  if (ref.startsWith('!')) {
    const parts = ref.slice(1).split('.');
    const fieldName = parts[0];
    return ctx.displayNames[fieldName] ?? fieldName;
  }
  if (!ref.startsWith('$')) return '';
  const parts = ref.slice(1).split('.');
  const name = parts[0];
  let value: SPValue;
  if (name in ctx.iterators) {
    value = ctx.iterators[name];
  } else {
    // absent fields resolve to '' — but a present-but-null cell (empty Date)
    // stays null so SP's =='' semantics hold
    const cell = ctx.row[name];
    value = (cell === undefined ? '' : cell) as SPValue;
  }
  for (const prop of parts.slice(1)) value = resolveProp(value, prop);
  return value;
}

function resolveToken(name: string, ctx: EvalContext): SPValue {
  const [head, ...props] = name.split('.');
  let value: SPValue;
  switch (head) {
    case '@currentField': {
      const cell = ctx.row[ctx.currentFieldName];
      value = (cell === undefined ? '' : cell) as SPValue;
      break;
    }
    case '@me': value = props.length ? (ctx.me as SPValue) : ctx.me.email; break;
    case '@now': value = ctx.now; break;
    case '@rowIndex': value = ctx.rowIndex; break;
    case '@isSelected': value = false; break;
    case '@currentWeb': value = 'https://contoso.sharepoint.com/sites/sandbox'; break;
    case '@window': value = { innerWidth: window.innerWidth, innerHeight: window.innerHeight }; break;
    case '@group': value = ''; break;
    case '@columnAggregate': value = { value: '', columnDisplayName: '' } as Record<string, unknown>; break;
    case '@lastIndexedTime': value = ctx.now; break;
    case '@thumbnail': value = svgAvatar('thumbnail'); break;
    default:
      throw new ExpressionError(`Unknown token '${head}'`);
  }
  for (const prop of props) value = resolveProp(value, prop);
  return value;
}

function callFn(fn: string, args: SPValue[], ctx: EvalContext): SPValue {
  const a = (i: number): SPValue => args[i] ?? null;
  switch (fn) {
    case 'if': return truthy(a(0)) ? a(1) : a(2);
    case 'toString': return toStr(a(0));
    case 'Number': return toNum(a(0));
    case 'Date': {
      const v = a(0);
      if (v instanceof Date) return v;
      const d = new Date(toStr(v));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    case 'cos': return Math.cos(toNum(a(0)));
    case 'sin': return Math.sin(toNum(a(0)));
    case 'abs': return Math.abs(toNum(a(0)));
    case 'floor': return Math.floor(toNum(a(0)));
    case 'ceiling': return Math.ceil(toNum(a(0)));
    case 'pow': return Math.pow(toNum(a(0)), toNum(a(1)));
    case 'indexOf': {
      const target = a(0);
      if (Array.isArray(target)) return target.findIndex((x) => looseEq(x, a(1)));
      return toStr(target).indexOf(toStr(a(1)));
    }
    case 'lastIndexOf': return toStr(a(0)).lastIndexOf(toStr(a(1)));
    case 'substring': return toStr(a(0)).substring(toNum(a(1)), toNum(a(2)));
    case 'startsWith': return toStr(a(0)).startsWith(toStr(a(1)));
    case 'endsWith': return toStr(a(0)).endsWith(toStr(a(1)));
    case 'replace': return toStr(a(0)).replace(toStr(a(1)), toStr(a(2)));
    case 'replaceAll': return toStr(a(0)).split(toStr(a(1))).join(toStr(a(2)));
    case 'padStart': return toStr(a(0)).padStart(toNum(a(1)), toStr(a(2) ?? ' '));
    case 'padEnd': return toStr(a(0)).padEnd(toNum(a(1)), toStr(a(2) ?? ' '));
    case 'toLowerCase': return toStr(a(0)).toLowerCase();
    case 'toUpperCase': return toStr(a(0)).toUpperCase();
    case 'split': return toStr(a(0)).split(toStr(a(1))) as SPValue[];
    case 'join': return (Array.isArray(a(0)) ? (a(0) as SPValue[]) : [a(0)]).map(toStr).join(toStr(a(1) ?? ','));
    case 'length': {
      const v = a(0);
      if (Array.isArray(v)) return v.length;
      return toStr(v).length;
    }
    case 'appendTo': {
      const arr = Array.isArray(a(0)) ? [...(a(0) as SPValue[])] : toStr(a(0)).split(',').filter(Boolean);
      arr.push(a(1));
      return arr as SPValue[];
    }
    case 'removeFrom': {
      const arr = Array.isArray(a(0)) ? [...(a(0) as SPValue[])] : toStr(a(0)).split(',').filter(Boolean);
      return arr.filter((x) => !looseEq(x as SPValue, a(1))) as SPValue[];
    }
    case 'getDate': return dateOf(a(0)).getDate();
    case 'getMonth': return dateOf(a(0)).getMonth();
    case 'getYear': return dateOf(a(0)).getFullYear();
    // empty dates render as empty text on real SP, not the epoch
    case 'toLocaleString': return isEmptyValue(a(0)) ? '' : dateOf(a(0)).toLocaleString();
    case 'toLocaleDateString': return isEmptyValue(a(0)) ? '' : dateOf(a(0)).toLocaleDateString();
    case 'toLocaleTimeString': return isEmptyValue(a(0)) ? '' : dateOf(a(0)).toLocaleTimeString();
    case 'addDays': {
      const d = new Date(dateOf(a(0)).getTime());
      d.setDate(d.getDate() + toNum(a(1)));
      return d;
    }
    case 'addMinutes': {
      const d = new Date(dateOf(a(0)).getTime());
      d.setMinutes(d.getMinutes() + toNum(a(1)));
      return d;
    }
    case 'loopIndex': {
      const name = toStr(a(0));
      if (name in ctx.iteratorIndex) return ctx.iteratorIndex[name];
      throw new ExpressionError(`loopIndex: iterator '${name}' not in scope`);
    }
    case 'getUserImage': return svgAvatar(toStr(a(0)));
    case 'getThumbnailImage': return toStr(a(0)) || svgAvatar('thumb');
    case 'not':
      throw new ExpressionError(NO_NOT_MESSAGE);
    default:
      throw new ExpressionError(`'${fn}' is not a SharePoint formatting function. The full set is: ${SP_FUNCTIONS.join(', ')}. (Check spelling — names are case-sensitive.)`);
  }
}

function applyBinary(op: string, l: SPValue, r: SPValue): SPValue {
  switch (op) {
    case '+': {
      // A blank operand (null/undefined/'' — how an empty number cell arrives)
      // is the additive identity, so a running sum keeps adding instead of
      // silently cascading into string concatenation. A NON-empty string still
      // concatenates (SP overloads + for concat: '$' + 5 → '$5').
      const lEmpty = isEmptyValue(l), rEmpty = isEmptyValue(r);
      if ((typeof l === 'string' && !lEmpty) || (typeof r === 'string' && !rEmpty)) {
        return toStr(l) + toStr(r);
      }
      const nl = lEmpty ? 0 : toNum(l);
      const nr = rEmpty ? 0 : toNum(r);
      // a genuinely non-numeric operand (e.g. a person/lookup object) still concatenates
      if (Number.isNaN(nl) || Number.isNaN(nr)) return toStr(l) + toStr(r);
      return nl + nr;
    }
    case '-': return toNum(l) - toNum(r);
    case '*': return toNum(l) * toNum(r);
    case '/': return toNum(l) / toNum(r);
    case '%': return toNum(l) % toNum(r);
    case '==': return looseEq(l, r);
    case '!=': return !looseEq(l, r);
    case '<': return cmpNum(l, r, (a, b) => a < b);
    case '>': return cmpNum(l, r, (a, b) => a > b);
    case '<=': return cmpNum(l, r, (a, b) => a <= b);
    case '>=': return cmpNum(l, r, (a, b) => a >= b);
  }
  throw new ExpressionError(`Unknown operator '${op}'`);
}

/** Ordering comparison — if either side is a Date, both coerce to dates (so [$DueDate] <= @now works on date-string fields). */
function cmpNum(l: SPValue, r: SPValue, op: (a: number, b: number) => boolean): boolean {
  if (l instanceof Date || r instanceof Date) {
    return op(dateOf(l).getTime(), dateOf(r).getTime());
  }
  return op(toNum(l), toNum(r));
}

function isEmptyValue(v: SPValue): boolean {
  return v === null || v === undefined || v === '';
}

function dateOf(v: SPValue): Date {
  if (v instanceof Date) return v;
  const d = new Date(toStr(v));
  if (Number.isNaN(d.getTime())) return new Date(0);
  return d;
}

export function evalAst(node: AstNode, ctx: EvalContext): SPValue {
  switch (node.kind) {
    case 'num': return node.value;
    case 'str': return node.value;
    case 'field': return resolveFieldRef(node.ref, ctx);
    case 'token': return resolveToken(node.name, ctx);
    case 'ident': {
      if (node.name === 'true') return true;
      if (node.name === 'false') return false;
      if (node.name in ctx.iterators) return ctx.iterators[node.name];
      throw new ExpressionError(`Unknown identifier '${node.name}'`);
    }
    case 'unary': {
      // only '-' reaches here — '!' is rejected at parse time (NO_NOT_MESSAGE)
      return -toNum(evalAst(node.operand, ctx));
    }
    case 'ternary':
      return truthy(evalAst(node.cond, ctx)) ? evalAst(node.yes, ctx) : evalAst(node.no, ctx);
    case 'call': {
      // if() is lazy — only the taken branch is evaluated (matches SP behavior
      // closely enough and avoids errors in the untaken branch)
      if (node.fn === 'if') {
        const branch = truthy(evalAst(node.args[0], ctx)) ? node.args[1] : node.args[2];
        return branch === undefined ? '' : evalAst(branch, ctx);
      }
      return callFn(node.fn, node.args.map((a) => evalAst(a, ctx)), ctx);
    }
    case 'binary': {
      const l = evalAst(node.left, ctx);
      if (node.op === '&&') return truthy(l) ? evalAst(node.right, ctx) : false;
      if (node.op === '||') return truthy(l) ? l : evalAst(node.right, ctx);
      const r = evalAst(node.right, ctx);
      return applyBinary(node.op, l, r);
    }
  }
}

/**
 * Evaluate any schema string value.
 * - '=expr' → full expression
 * - bare '[$Field]' / '@token' (entire string) → direct reference (SP resolves these in txtContent/attributes)
 * - anything else → literal
 */
export function evaluate(raw: string, ctx: EvalContext): SPValue {
  if (raw.startsWith('=')) {
    return evalAst(parseExpression(raw.slice(1)), ctx);
  }
  const trimmed = raw.trim();
  if (/^\[[$!][A-Za-z0-9_. ]+\]$/.test(trimmed)) {
    return resolveFieldRef(trimmed.slice(1, -1), ctx);
  }
  if (/^@[A-Za-z]+(\.[A-Za-z]+)*$/.test(trimmed)) {
    try { return resolveToken(trimmed, ctx); } catch { return raw; }
  }
  return raw;
}

// ─── Abstract Syntax Tree syntax ─────────────────────────────────────────────
// The older object form many community samples use:
//   { "operator": "?", "operands": [ {"operator":"<=","operands":["@currentField",70]}, "#f00", "" ] }
// Operator names may carry a "()" suffix (e.g. "toString()").

const BINARY_OPS = new Set(['+', '-', '*', '/', '%', '==', '!=', '<', '>', '<=', '>=']);

function evalAstTree(node: { operator: string; operands: SPExpr[] }, ctx: EvalContext): SPValue {
  const op = node.operator;
  const operands = node.operands ?? [];
  const ev = (i: number): SPValue => evalAny(operands[i], ctx);

  if (op === '?' || op === ':') {
    // ternary — ":" appears in some legacy samples as an alias
    return truthy(ev(0)) ? ev(1) : ev(2);
  }
  if (op === '&&') {
    for (let i = 0; i < operands.length; i++) if (!truthy(ev(i))) return false;
    return true;
  }
  if (op === '||') {
    for (let i = 0; i < operands.length; i++) {
      const v = ev(i);
      if (truthy(v)) return v;
    }
    return false;
  }
  if (op === '!') throw new ExpressionError(NO_NOT_MESSAGE); // no NOT in the AST form either
  if (BINARY_OPS.has(op)) {
    if (op === '-' && operands.length === 1) return -toNum(ev(0));
    let acc = ev(0);
    for (let i = 1; i < operands.length; i++) acc = applyBinary(op, acc, ev(i));
    return acc;
  }
  // function-style operators: "toString()", "Number()", "indexOf", "abs", ...
  const fn = op.replace(/\(\)$/, '');
  if (fn === 'if') return truthy(ev(0)) ? ev(1) : ev(2);
  return callFn(fn, operands.map((_, i) => ev(i)), ctx);
}

/**
 * Evaluate any schema value: Excel-style string, AST object, or literal
 * number/boolean. This is what the renderer feeds every txtContent, style
 * value and attribute through.
 */
export function evalAny(value: SPExpr | undefined, ctx: EvalContext): SPValue {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return evaluate(value, ctx);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'object' && typeof value.operator === 'string') {
    return evalAstTree(value, ctx);
  }
  throw new ExpressionError('Value is neither a string expression nor an AST operator object');
}

export function evaluateToString(raw: SPExpr, ctx: EvalContext): string {
  const v = evalAny(raw, ctx);
  if (v instanceof Date) return v.toLocaleDateString();
  return toStr(v);
}

/** Parse a forEach binding: "iter in expr" → { iterator, listExpr }. */
export function parseForEach(spec: string): { iterator: string; listExpr: string } | null {
  const m = spec.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s+in\s+(.+)$/);
  if (!m) return null;
  return { iterator: m[1], listExpr: m[2] };
}

/** Evaluate the list portion of a forEach binding into an array. */
export function evaluateForEachList(listExpr: string, ctx: EvalContext): SPValue[] {
  const v = listExpr.startsWith('=')
    ? evalAst(parseExpression(listExpr.slice(1)), ctx)
    : evalAst(parseExpression(listExpr), ctx);
  if (Array.isArray(v)) return v;
  if (v === null || v === '') return [];
  return [v];
}

export { svgAvatar };
