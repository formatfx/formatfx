/**
 * editor/dialect.ts — the Sheet transpiler (Sheet stage 2's brain).
 *
 * A pure, node-testable module (sibling of condRules.ts: no DOM, no state)
 * that translates between the **Excel dialect** people already read and the
 * **SharePoint dialect** that is always the stored truth. It works in BOTH
 * directions over a closed, round-trip-safe subset and — like the rest of
 * this product — it REFUSES with teaching copy rather than emit a guess.
 *
 * The stored truth is always SP (see SHEET-MODE.md). The fx bar may render a
 * stored formula "parsed out toward" Excel for display, and accept Excel-ish
 * input back; Advanced mode keeps showing the raw SP dialect untouched.
 *
 * The supported subset, both ways:
 *   =  ↔ ==      ·  <> ↔ !=        ·  &  → +  (concat; SP '+' shows as '+')
 *   "  ↔ '       ·  TODAY()/NOW() ↔ @now   ·  ME() ↔ @me
 *   AND()/OR()   ↔ &&/||           ·  IF(…) ↔ if(…)   (function names case-folded)
 *   TRUE/FALSE   ↔ true/false      ·  [Display Name] ↔ [$InternalName]
 *   @tokens      — the engine's SPECIAL_TOKENS (@currentField, @rowIndex,
 *                  @window.innerWidth, …) pass through verbatim both ways
 *                  (#222); bare @now/@me still display as TODAY()/ME(). An
 *                  Excel-side [$Internal(.prop)] spelling is accepted too.
 *   NOT(x)       — rewritten in place (flip the operator, De Morgan, compare a
 *                  yes/no column with = FALSE); refused when it can't be.
 *
 * Anything outside the subset (other SP functions, unknown @tokens, [!display]
 * refs) is refused — the caller falls back to Advanced, which shows raw SP.
 *
 * dialect.test.ts is the contract: change behaviour there first, then here.
 */

import { parseExpression, type AstNode } from '../core/expressions';
import { SPECIAL_TOKENS } from '../core/schema';
import type { FieldType, MockField } from '../core/types';

/** Exactly the engine's tokens — plus a dotted property on a BASE token the
 *  engine resolves on its own (e.g. @currentField.email, @me.email). A head
 *  that only ever appears dotted in SPECIAL_TOKENS (@window) is NOT itself a
 *  token: never accept or render what SharePoint wouldn't resolve. */
const EXACT_TOKENS = new Set<string>(SPECIAL_TOKENS);
const DOTTED_BASES = new Set<string>(SPECIAL_TOKENS.filter((t) => !t.includes('.')));
const knownToken = (name: string): boolean => {
  if (EXACT_TOKENS.has(name)) return true;
  const dot = name.indexOf('.');
  return dot > 0 && DOTTED_BASES.has(name.slice(0, dot));
};

// ─── public surface ──────────────────────────────────────────────────────────

/** The slice of a column the transpiler needs to map names ↔ internal refs. */
export type DialectField = Pick<MockField, 'name' | 'displayName' | 'type'>;

/** Refuse-don't-guess result: a translation, or a reason a human can act on. */
export type Transpile =
  | { ok: true; value: string }
  | { ok: false; reason: string };

/**
 * Excel-ish formula → stored SP dialect (leading '=' included on the result).
 * `fields` resolves bracketed column names against the imported schema; with
 * no schema, column names pass through unchanged (identity).
 */
export function excelToSp(input: string, fields?: DialectField[]): Transpile {
  const body = stripLead(input);
  if (!body.trim()) return { ok: true, value: '' };
  try {
    const ast = new ExcelParser(body, indexFields(fields)).parseProgram();
    return { ok: true, value: '=' + renderSP(ast) };
  } catch (e) {
    return refusal(e, 'this Excel formula');
  }
}

/**
 * Stored SP dialect → Excel-ish display (leading '=' included on the result).
 * Reuses the engine's own SP parser, then renders toward Excel. Refuses on any
 * SP function/token outside the subset so the caller can defer to Advanced.
 */
export function spToExcel(input: string, fields?: DialectField[]): Transpile {
  const body = stripLead(input);
  if (!body.trim()) return { ok: true, value: '' };
  let ast: AstNode;
  try {
    ast = parseExpression(body);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: `Couldn't read this as a SharePoint formula: ${msg}` };
  }
  try {
    return { ok: true, value: '=' + renderExcel(ast, indexFields(fields)) };
  } catch (e) {
    return refusal(e, 'this formula');
  }
}

// ─── refusals ────────────────────────────────────────────────────────────────

/** A deliberate, teach-don't-guess refusal carried out of the recursion. */
class Refusal extends Error {}

const NO_NOT_HELP =
  "SharePoint has no logical NOT, so this NOT() can't be flipped automatically. "
  + 'Negate it by hand instead: turn = into <>, < into >=, swap the IF() branches, '
  + 'or compare a yes/no column with = FALSE.';

function refusal(e: unknown, subject: string): Transpile {
  if (e instanceof Refusal) return { ok: false, reason: e.message };
  const msg = e instanceof Error ? e.message : String(e);
  return { ok: false, reason: `Couldn't translate ${subject}: ${msg}` };
}

// ─── leading '=' ─────────────────────────────────────────────────────────────

/** Both dialects mark a formula with a single leading '='; strip it for parsing. */
function stripLead(s: string): string {
  const t = s.replace(/^﻿/, '').replace(/^\s+/, '');
  return t.startsWith('=') ? t.slice(1) : t;
}

// ─── schema index ────────────────────────────────────────────────────────────

interface FieldIndex {
  /** lower(display|internal) → internal name. */
  byKey: Map<string, string>;
  /** internal → display label (falls back to internal). */
  displayOf: Map<string, string>;
  /** internal → type. */
  typeOf: Map<string, FieldType>;
  /** display labels, for the "available columns" teaching list. */
  labels: string[];
}

function indexFields(fields?: DialectField[]): FieldIndex {
  const byKey = new Map<string, string>();
  const displayOf = new Map<string, string>();
  const typeOf = new Map<string, FieldType>();
  const labels: string[] = [];
  for (const f of fields ?? []) {
    const label = f.displayName ?? f.name;
    byKey.set(f.name.toLowerCase(), f.name);
    byKey.set(label.toLowerCase(), f.name);
    displayOf.set(f.name, label);
    if (f.type) typeOf.set(f.name, f.type);
    labels.push(label);
  }
  return { byKey, displayOf, typeOf, labels };
}

/** Excel `[Display Name(.prop)]` (or SP-spelled `[$Internal(.prop)]`) → SP ref
 *  body `$Internal(.prop)`. The `$` spelling is what the token autocomplete
 *  inserts (#222); byKey already indexes internal names, so just strip it. */
function resolveExcelColumn(rawInner: string, idx: FieldIndex): string {
  const inner = rawInner.trim().startsWith('$') ? rawInner.trim().slice(1) : rawInner;
  const segs = inner.split('.');
  // Longest leading run of segments that names a real column wins; the rest
  // are property access (e.g. a lookup's `.lookupValue`).
  for (let k = segs.length; k >= 1; k--) {
    const head = segs.slice(0, k).join('.').trim();
    const internal = idx.byKey.get(head.toLowerCase());
    if (internal) {
      const props = segs.slice(k).map((s) => s.trim()).filter(Boolean);
      return '$' + internal + (props.length ? '.' + props.join('.') : '');
    }
  }
  if (idx.byKey.size === 0) return '$' + inner.trim(); // no schema → identity
  const available = idx.labels.length ? ` Available columns: ${idx.labels.join(', ')}.` : '';
  throw new Refusal(`There's no column called “${inner.trim()}”. Pick it from the list.${available}`);
}

/** SP ref body `$Internal(.prop)` → Excel `[Display Name(.prop)]`. */
function reverseColumn(ref: string, idx: FieldIndex): string {
  if (ref.startsWith('!')) {
    throw new Refusal('This formula references a column’s display-name token ([!…]); the Sheet bar doesn’t translate that — edit it in Advanced mode.');
  }
  const raw = ref.startsWith('$') ? ref.slice(1) : ref;
  const segs = raw.split('.');
  const internal = segs[0];
  const display = idx.displayOf.get(internal) ?? internal;
  const props = segs.slice(1);
  return '[' + display + (props.length ? '.' + props.join('.') : '') + ']';
}

// ─── negation rewrite (NOT has no SP target) ─────────────────────────────────

const FLIP: Record<string, string> = {
  '==': '!=', '!=': '==', '<': '>=', '<=': '>', '>': '<=', '>=': '<',
};

/**
 * Rewrite NOT(node) as an equivalent positive expression, or refuse.
 * Comparisons flip; AND/OR go through De Morgan; a yes/no column becomes
 * `= false`; everything else is refused with teaching copy.
 */
function negate(node: AstNode, idx: FieldIndex): AstNode {
  switch (node.kind) {
    case 'binary':
      if (node.op in FLIP) return { kind: 'binary', op: FLIP[node.op], left: node.left, right: node.right };
      if (node.op === '&&') return { kind: 'binary', op: '||', left: negate(node.left, idx), right: negate(node.right, idx) };
      if (node.op === '||') return { kind: 'binary', op: '&&', left: negate(node.left, idx), right: negate(node.right, idx) };
      throw new Refusal(NO_NOT_HELP);
    case 'ident':
      if (node.name === 'true') return { kind: 'ident', name: 'false' };
      if (node.name === 'false') return { kind: 'ident', name: 'true' };
      throw new Refusal(NO_NOT_HELP);
    case 'field': {
      const internal = node.ref.replace(/^\$/, '').split('.')[0];
      if (idx.typeOf.get(internal) === 'boolean') {
        return { kind: 'binary', op: '==', left: node, right: { kind: 'ident', name: 'false' } };
      }
      throw new Refusal(
        `NOT() of a column only works when SharePoint can compare it explicitly. `
        + (idx.typeOf.size === 0
          ? 'Import the list schema so the column type is known, or rewrite it as a comparison (e.g. = FALSE).'
          : `“${internal}” isn’t a yes/no column — rewrite the NOT as a comparison instead.`),
      );
    }
    default:
      throw new Refusal(NO_NOT_HELP);
  }
}

// ─── precedence (shared by both renderers) ───────────────────────────────────

const BINPREC: Record<string, number> = {
  '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '<=': 4, '>': 4, '>=': 4,
  '+': 5, '-': 5, '*': 6, '/': 6, '%': 6,
};

function numStr(n: number): string {
  return Number.isFinite(n) ? String(n) : '0';
}

// ─── render → SP ─────────────────────────────────────────────────────────────

function renderSP(node: AstNode): string {
  const r = (n: AstNode, parentPrec: number, side: 'l' | 'r'): string => {
    switch (n.kind) {
      case 'num': return numStr(n.value);
      case 'str':
        if (n.value.includes("'")) {
          throw new Refusal('SharePoint text in quotes can’t contain a single quote (’) — there’s no escape for it. Remove or rephrase it.');
        }
        return `'${n.value}'`;
      case 'field': return `[${n.ref}]`;
      case 'token': return n.name;
      case 'ident':
        if (n.name === 'true' || n.name === 'false') return n.name;
        throw new Refusal(`Don’t know how to translate “${n.name}”.`);
      case 'unary': return wrap('-' + r(n.operand, 7, 'r'), 7, parentPrec, side);
      case 'ternary':
        return `if(${r(n.cond, 0, 'l')}, ${r(n.yes, 0, 'l')}, ${r(n.no, 0, 'l')})`;
      case 'call':
        return `${n.fn}(${n.args.map((a) => r(a, 0, 'l')).join(', ')})`;
      case 'binary': {
        const p = BINPREC[n.op];
        return wrap(`${r(n.left, p, 'l')} ${n.op} ${r(n.right, p, 'r')}`, p, parentPrec, side);
      }
    }
  };
  return r(node, 0, 'l');
}

// ─── render → Excel ──────────────────────────────────────────────────────────

function renderExcel(node: AstNode, idx: FieldIndex): string {
  const r = (n: AstNode, parentPrec: number, side: 'l' | 'r'): string => {
    switch (n.kind) {
      case 'num': return numStr(n.value);
      case 'str': return `"${n.value.replace(/"/g, '""')}"`;
      case 'field': return reverseColumn(n.ref, idx);
      case 'token':
        if (n.name === '@now') return 'TODAY()';
        if (n.name === '@me') return 'ME()';
        // every other engine-known token (and a dotted @me.prop / @now.prop)
        // reads the same in both dialects — pass it through verbatim (#222)
        if (knownToken(n.name)) return n.name;
        throw new Refusal(`This formula uses ${n.name}, which the Sheet bar doesn’t translate — edit it in Advanced mode (it shows the raw SharePoint formula).`);
      case 'ident':
        if (n.name === 'true') return 'TRUE';
        if (n.name === 'false') return 'FALSE';
        throw new Refusal(`Don’t know how to show “${n.name}” in Excel terms.`);
      case 'unary': return wrap('-' + r(n.operand, 7, 'r'), 7, parentPrec, side);
      case 'ternary':
        return `IF(${r(n.cond, 0, 'l')}, ${r(n.yes, 0, 'l')}, ${r(n.no, 0, 'l')})`;
      case 'call':
        if (n.fn === 'if') return `IF(${n.args.map((a) => r(a, 0, 'l')).join(', ')})`;
        throw new Refusal(`${n.fn}() has no Sheet-bar equivalent yet — edit this one in Advanced mode (it shows the raw SharePoint formula).`);
      case 'binary': {
        if (n.op === '&&') return `AND(${flatten(n, '&&').map((a) => r(a, 0, 'l')).join(', ')})`;
        if (n.op === '||') return `OR(${flatten(n, '||').map((a) => r(a, 0, 'l')).join(', ')})`;
        const spell = n.op === '==' ? '=' : n.op === '!=' ? '<>' : n.op;
        const p = BINPREC[n.op];
        return wrap(`${r(n.left, p, 'l')} ${spell} ${r(n.right, p, 'r')}`, p, parentPrec, side);
      }
    }
  };
  return r(node, 0, 'l');
}

/** Collapse a left-leaning chain of the same operator into a flat operand list. */
function flatten(node: AstNode, op: string): AstNode[] {
  if (node.kind === 'binary' && node.op === op) {
    return [...flatten(node.left, op), ...flatten(node.right, op)];
  }
  return [node];
}

/** Parenthesise a child only when precedence (and left-associativity) demands. */
function wrap(text: string, prec: number, parentPrec: number, side: 'l' | 'r'): string {
  const needs = prec < parentPrec || (prec === parentPrec && side === 'r');
  return needs ? `(${text})` : text;
}

// ─── Excel tokenizer + parser (→ SP-vocabulary AstNode) ──────────────────────

type ExTokType = 'num' | 'str' | 'col' | 'attok' | 'op' | 'ident' | 'lparen' | 'rparen' | 'comma';
interface ExTok { type: ExTokType; value: string }

const EX_OPS2 = ['<>', '<=', '>=', '==', '!=', '&&', '||'];
const EX_OPS1 = ['=', '<', '>', '+', '-', '*', '/', '%', '&', '(', ')', ','];

/** Excel operator spelling → SP-vocabulary operator. */
const EX_OP_TO_SP: Record<string, string> = {
  '=': '==', '==': '==', '<>': '!=', '!=': '!=',
  '<': '<', '<=': '<=', '>': '>', '>=': '>=',
  '&': '+', '+': '+', '-': '-', '*': '*', '/': '/', '%': '%',
  '&&': '&&', '||': '||',
};

function exTokenize(src: string): ExTok[] {
  const toks: ExTok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c === '(') { toks.push({ type: 'lparen', value: '(' }); i++; continue; }
    if (c === ')') { toks.push({ type: 'rparen', value: ')' }); i++; continue; }
    if (c === ',') { toks.push({ type: 'comma', value: ',' }); i++; continue; }
    if (c === '"') {
      let j = i + 1, out = '';
      while (j < src.length) {
        if (src[j] === '"') {
          if (src[j + 1] === '"') { out += '"'; j += 2; continue; } // "" → literal quote
          break;
        }
        out += src[j]; j++;
      }
      if (j >= src.length) throw new Refusal('A double-quoted text value is missing its closing quote.');
      toks.push({ type: 'str', value: out });
      i = j + 1; continue;
    }
    if (c === '[') {
      const end = src.indexOf(']', i);
      if (end < 0) throw new Refusal('A [column] reference is missing its closing bracket.');
      toks.push({ type: 'col', value: src.slice(i + 1, end) });
      i = end + 1; continue;
    }
    if (c === '@') {
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_.]/.test(src[j])) j++;
      toks.push({ type: 'attok', value: src.slice(i, j) });
      i = j; continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      toks.push({ type: 'num', value: src.slice(i, j) });
      i = j; continue;
    }
    const two = src.slice(i, i + 2);
    if (EX_OPS2.includes(two)) { toks.push({ type: 'op', value: two }); i += 2; continue; }
    if (EX_OPS1.includes(c)) { toks.push({ type: 'op', value: c }); i++; continue; }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      toks.push({ type: 'ident', value: src.slice(i, j) });
      i = j; continue;
    }
    throw new Refusal(`Unexpected character “${c}”. Reference columns with brackets, e.g. [Status].`);
  }
  return toks;
}

class ExcelParser {
  private pos = 0;
  private toks: ExTok[];
  private idx: FieldIndex;
  constructor(src: string, idx: FieldIndex) { this.toks = exTokenize(src); this.idx = idx; }

  parseProgram(): AstNode {
    if (this.toks.length === 0) throw new Refusal('Nothing to translate.');
    const node = this.orExpr();
    if (this.pos < this.toks.length) {
      throw new Refusal(`Unexpected “${this.toks[this.pos].value}” — check the formula reads as one expression.`);
    }
    return node;
  }

  private peek(): ExTok | undefined { return this.toks[this.pos]; }
  private eat(): ExTok { return this.toks[this.pos++]; }
  private matchOp(...ops: string[]): string | null {
    const t = this.peek();
    if (t && t.type === 'op' && ops.includes(t.value)) { this.pos++; return t.value; }
    return null;
  }
  private bin(left: AstNode, ex: string, right: AstNode): AstNode {
    return { kind: 'binary', op: EX_OP_TO_SP[ex], left, right };
  }

  // precedence, low → high: || , && , comparison , & (concat) , + - , * / % , unary , primary
  private orExpr(): AstNode {
    let left = this.andExpr();
    let op: string | null;
    while ((op = this.matchOp('||'))) left = this.bin(left, op, this.andExpr());
    return left;
  }
  private andExpr(): AstNode {
    let left = this.compare();
    let op: string | null;
    while ((op = this.matchOp('&&'))) left = this.bin(left, op, this.compare());
    return left;
  }
  private compare(): AstNode {
    let left = this.concat();
    let op: string | null;
    while ((op = this.matchOp('=', '==', '<>', '!=', '<', '<=', '>', '>='))) left = this.bin(left, op, this.concat());
    return left;
  }
  private concat(): AstNode {
    let left = this.additive();
    let op: string | null;
    while ((op = this.matchOp('&'))) left = this.bin(left, op, this.additive());
    return left;
  }
  private additive(): AstNode {
    let left = this.multiplicative();
    let op: string | null;
    while ((op = this.matchOp('+', '-'))) left = this.bin(left, op, this.multiplicative());
    return left;
  }
  private multiplicative(): AstNode {
    let left = this.unary();
    let op: string | null;
    while ((op = this.matchOp('*', '/', '%'))) left = this.bin(left, op, this.unary());
    return left;
  }
  private unary(): AstNode {
    if (this.matchOp('-')) return { kind: 'unary', op: '-', operand: this.unary() };
    return this.primary();
  }
  private primary(): AstNode {
    const t = this.peek();
    if (!t) throw new Refusal('The formula ends sooner than expected.');
    if (t.type === 'num') { this.eat(); return { kind: 'num', value: parseFloat(t.value) }; }
    if (t.type === 'str') { this.eat(); return { kind: 'str', value: t.value }; }
    if (t.type === 'col') { this.eat(); return { kind: 'field', ref: resolveExcelColumn(t.value, this.idx) }; }
    if (t.type === 'attok') {
      this.eat();
      // only the tokens the engine actually resolves — refuse-don't-guess
      if (!knownToken(t.value)) {
        throw new Refusal(`“${t.value}” isn’t a SharePoint context token. The tokens are: ${SPECIAL_TOKENS.join(', ')}.`);
      }
      return { kind: 'token', name: t.value };
    }
    if (t.type === 'lparen') {
      this.eat();
      const inner = this.orExpr();
      if (this.peek()?.type !== 'rparen') throw new Refusal('A “(” is missing its matching “)”.');
      this.eat();
      return inner;
    }
    if (t.type === 'ident') { this.eat(); return this.identNode(t.value); }
    throw new Refusal(`Unexpected “${t.value}”.`);
  }

  /** An identifier is a function call, a TRUE/FALSE constant, or a refusal. */
  private identNode(name: string): AstNode {
    if (this.peek()?.type === 'lparen') return this.callNode(name);
    const folded = name.toLowerCase();
    if (folded === 'true') return { kind: 'ident', name: 'true' };
    if (folded === 'false') return { kind: 'ident', name: 'false' };
    if (folded === 'today' || folded === 'now') return { kind: 'token', name: '@now' };
    if (folded === 'me') return { kind: 'token', name: '@me' };
    throw new Refusal(`“${name}” isn’t something the Sheet bar understands. Reference columns with brackets, e.g. [${name}], and pick them from the list.`);
  }

  private callNode(name: string): AstNode {
    this.eat(); // '('
    const args: AstNode[] = [];
    if (this.peek()?.type !== 'rparen') {
      args.push(this.orExpr());
      while (this.peek()?.type === 'comma') { this.eat(); args.push(this.orExpr()); }
    }
    if (this.peek()?.type !== 'rparen') throw new Refusal(`${name}( … ) is missing its closing “)”.`);
    this.eat();
    return this.mapCall(name, args);
  }

  /** Map a supported Excel function onto SP-vocabulary AST, or refuse. */
  private mapCall(name: string, args: AstNode[]): AstNode {
    const fn = name.toLowerCase();
    switch (fn) {
      case 'if':
        if (args.length !== 3) throw new Refusal('IF() needs three parts: IF(test, value-if-true, value-if-false).');
        return { kind: 'call', fn: 'if', args };
      case 'and':
        if (args.length === 0) throw new Refusal('AND() needs at least one test.');
        return args.reduce((l, r) => ({ kind: 'binary', op: '&&', left: l, right: r }));
      case 'or':
        if (args.length === 0) throw new Refusal('OR() needs at least one test.');
        return args.reduce((l, r) => ({ kind: 'binary', op: '||', left: l, right: r }));
      case 'not':
        if (args.length !== 1) throw new Refusal('NOT() takes exactly one test.');
        return negate(args[0], this.idx);
      case 'today': case 'now':
        if (args.length !== 0) throw new Refusal(`${name}() takes no arguments.`);
        return { kind: 'token', name: '@now' };
      case 'me':
        if (args.length !== 0) throw new Refusal('ME() takes no arguments.');
        return { kind: 'token', name: '@me' };
      default:
        throw new Refusal(`${name}() isn’t in the Sheet bar’s vocabulary yet. Supported: IF, AND, OR, NOT, TODAY/NOW, ME. For anything else, use Advanced mode (raw SharePoint).`);
    }
  }
}
