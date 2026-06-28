/**
 * editor/condFormat.ts — the conditional formatting builder: the Excel
 * mental model ("when the value …, make it look …") rebuilt as a click-only
 * overlay in the house style. The field's type drives everything: choice
 * fields arrive with one ready-made chip per choice (and a one-click "color
 * every choice"), dates get overdue/today/soon, people get "is you" — the
 * menu does the thinking. Rules read top-down, first match wins, and the
 * result is previewed against the real mock rows through the real renderer
 * before anything is applied (one undoable mutation).
 *
 * Two routes in, mirroring the rest of the app:
 *  - element route: merge the generated conditional styles into THIS element
 *  - column route (grid header): land the rules on the column's registered
 *    formatter — creating/CFR-wiring it exactly like "Format this column" —
 *    and switch the workspace to it
 */

import type { MockField, NodePath, SPElement, SPExpr } from '../core/types';
import { renderElement } from '../core/renderer';
import { evaluate, type EvalContext } from '../core/expressions';
import { state } from './state';
import {
  defaultColumnFormatter, gridCellForField, fieldRefsIn, fieldLabel,
} from './gridScaffold';
import {
  COND_COLORS, COND_EFFECTS, condColor, condEffect, condExpr, condLabel,
  conditionOptionsFor, escapeCondValue, rulesToStyle,
  type CondOption, type CondRule, type EffectId,
} from './condRules';

export type CondTarget =
  | { kind: 'element'; path: NodePath }
  | { kind: 'column'; fieldName: string; cellPath?: NodePath };

let overlay: HTMLElement | null = null;
let escHandler: ((e: KeyboardEvent) => void) | null = null;

export function closeCondFormat(): void {
  overlay?.remove();
  overlay = null;
  if (escHandler) { document.removeEventListener('keydown', escHandler); escHandler = null; }
}

const nameOf = (el: SPElement): string => el._elmName ?? `<${el.elmType}>`;

/** Best-guess field for an element: bound field, else first reference. */
function guessField(node: SPElement): MockField {
  const editable = state.fields.filter((f) => !f.protected);
  if (state.doc.kind === 'column') {
    const f = state.fields.find((x) => x.name === state.currentFieldName);
    if (f) return f;
  }
  for (const name of fieldRefsIn(node)) {
    const f = state.fields.find((x) => x.name === name);
    if (f) return f;
  }
  return editable[0] ?? state.fields[0];
}

function defaultEffectFor(field: MockField): EffectId {
  if (field.type === 'choice' || field.type === 'choiceMulti' || field.type === 'lookup') return 'pill';
  if (field.type === 'date') return 'text';
  return 'fill';
}

/** Friendly type names — the picker must SAY what kind of column it is. */
const TYPE_LABELS: Record<string, string> = {
  text: 'text', note: 'multiline text', number: 'number', currency: 'currency',
  choice: 'choice', choiceMulti: 'multi-choice', date: 'date',
  person: 'person', personMulti: 'people', boolean: 'yes/no',
  hyperlink: 'link', lookup: 'lookup', lookupMulti: 'multi-lookup',
};
const typeLabel = (f: MockField): string => TYPE_LABELS[f.type] ?? f.type;

export function openCondFormat(target: CondTarget, onToast?: (m: string) => void): void {
  closeCondFormat();
  const toast = onToast ?? (() => { /* entry points without a toaster stay quiet */ });

  // the column being PAINTED is fixed (column route); the field being
  // WATCHED is free — "color DueDate by Status" is the whole point
  const paintField: MockField | null = target.kind === 'column'
    ? state.fields.find((f) => f.name === target.fieldName) ?? null
    : null;
  let field: MockField =
    paintField ?? guessField(state.nodeAt(target.kind === 'element' ? target.path : []) ?? state.doc.root);
  if (!field) { toast('Add a column in the Data tab first.'); return; }

  const rules: CondRule[] = [];
  // composer state — color follows the picked condition until touched by hand
  let selOpt: CondOption | null = null;
  let inputVal = '';
  let daysVal = 7;
  let effectId: EffectId = defaultEffectFor(field);
  let colorId = 'blue';
  let colorTouched = false;
  // pending field switch — set when user changes the watch-field select while
  // rules exist; cleared by confirming the switch or cancelling
  let pendingFieldKey: string | null = null;

  /** Style object the generated chains will fall back to (the "else" look). */
  const existingStyle = (): Record<string, SPExpr | undefined> | undefined =>
    target.kind === 'element'
      ? state.nodeAt(target.path)?.style
      : state.columnRefs[paintField!.name]?.style;

  overlay = document.createElement('div');
  overlay.className = 'wb-cf-overlay';
  overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) closeCondFormat(); });
  escHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeCondFormat(); };
  document.addEventListener('keydown', escHandler);

  const panel = document.createElement('div');
  panel.className = 'wb-cf';
  overlay.appendChild(panel);

  const ctxForRow = (rowIndex: number): EvalContext => ({
    row: state.rows[rowIndex] ?? {},
    rowIndex,
    // @currentField in the painted content is the painted column
    currentFieldName: (paintField ?? field).name,
    me: state.me,
    iterators: {},
    iteratorIndex: {},
    displayNames: Object.fromEntries(state.fields.map((f) => [f.name, f.displayName ?? f.name])),
    now: new Date(),
  });

  /** A sample value wearing one rule's look — instant feedback everywhere. */
  const lookChip = (effect: EffectId, color: string, text: string): HTMLElement => {
    const chip = document.createElement('span');
    chip.className = 'wb-cf-chip';
    chip.textContent = text;
    const e = condEffect(effect);
    Object.assign(chip.style, e.static ?? {}, e.conditional(condColor(color)));
    return chip;
  };

  const group = (label: string, ...kids: (HTMLElement | string)[]): HTMLElement => {
    const g = document.createElement('div');
    g.className = 'wb-cf-group';
    const lab = document.createElement('div');
    lab.className = 'wb-cf-grouplab';
    lab.textContent = label;
    g.appendChild(lab);
    for (const k of kids) g.append(k);
    return g;
  };

  const render = (): void => {
    panel.innerHTML = '';
    const targetNode = target.kind === 'element' ? state.nodeAt(target.path) : null;
    if (target.kind === 'element' && !targetNode) {
      panel.textContent = 'The element is gone (undone or removed) — close and reselect.';
      return;
    }

    // ── header ──
    const head = document.createElement('div');
    head.className = 'wb-cf-head';
    head.innerHTML = `<span class="wb-cf-title">✨ Conditional formatting</span>
      <span class="wb-cf-sub">rules read top-down, the first match wins — nothing changes until you apply</span>`;
    const close = document.createElement('button');
    close.className = 'wb-cf-close';
    close.textContent = '✕';
    close.title = 'Close (Esc) — discards these rules';
    close.addEventListener('click', closeCondFormat);
    head.appendChild(close);
    panel.appendChild(head);

    // ── what gets painted, watching which field ──
    const targetRow = document.createElement('div');
    targetRow.className = 'wb-cf-target';
    const tlabel = document.createElement('span');
    tlabel.textContent = target.kind === 'element'
      ? `Painting ${nameOf(targetNode!)} — every row — when`
      : `Painting the ${fieldLabel(paintField!)} column — every row — when`;
    targetRow.appendChild(tlabel);
    const fieldSel = document.createElement('select');
    for (const f of state.fields) {
      const o = document.createElement('option');
      o.value = f.name;
      // the type is part of the name here — it decides which conditions appear
      o.textContent = `[$${f.name}] — ${typeLabel(f)}`;
      if (f.name === field.name) o.selected = true;
      fieldSel.appendChild(o);
    }
    fieldSel.title = 'Which column the rules watch — pick any column in the row (no typing); the conditions below adapt to its type';
    fieldSel.addEventListener('change', () => {
      const nextFieldName = fieldSel.value;
      if (rules.length > 0 && nextFieldName !== field.name) {
        // guard: don't silently discard rules — show a soft-confirm banner
        pendingFieldKey = nextFieldName;
        render();
        return;
      }
      field = state.fields.find((f) => f.name === nextFieldName) ?? field;
      rules.length = 0;
      selOpt = null;
      inputVal = '';
      effectId = defaultEffectFor(field);
      colorTouched = false;
      render();
    });
    targetRow.appendChild(fieldSel);
    panel.appendChild(targetRow);

    // ── soft-confirm when switching watch-field with rules in flight ──
    if (pendingFieldKey !== null) {
      const pendingName = pendingFieldKey;
      const warn = document.createElement('div');
      warn.className = 'wb-cf-field-warn';
      const msg = document.createElement('span');
      msg.textContent = `Switching to [$${pendingName}] will clear your ${rules.length} rule${rules.length === 1 ? '' : 's'}.`;
      const switchBtn = document.createElement('button');
      switchBtn.textContent = 'Switch and clear';
      switchBtn.className = 'wb-cf-field-warn-ok';
      switchBtn.addEventListener('click', () => {
        field = state.fields.find((f) => f.name === pendingName) ?? field;
        rules.length = 0;
        selOpt = null;
        inputVal = '';
        effectId = defaultEffectFor(field);
        colorTouched = false;
        pendingFieldKey = null;
        render();
      });
      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Keep my rules';
      cancelBtn.addEventListener('click', () => { pendingFieldKey = null; render(); });
      warn.append(msg, switchBtn, cancelBtn);
      panel.appendChild(warn);
    }

    // ── the rules so far ──
    const rulesBox = document.createElement('div');
    rulesBox.className = 'wb-cf-rules';
    if (!rules.length) {
      const empty = document.createElement('div');
      empty.className = 'wb-cf-empty';
      empty.textContent = 'No rules yet — pick a condition below'
        + (field.type === 'choice' ? ', or let ✨ color every choice at once.' : '.');
      rulesBox.appendChild(empty);
    }
    rules.forEach((rule, i) => {
      const row = document.createElement('div');
      row.className = 'wb-cf-rule';
      const num = document.createElement('span');
      num.className = 'wb-cf-rule-num';
      num.textContent = String(i + 1);
      const when = document.createElement('span');
      when.className = 'wb-cf-rule-when';
      when.textContent = `When ${condLabel(field, rule.cond)}`;
      const arrow = document.createElement('span');
      arrow.className = 'wb-cf-rule-arrow';
      arrow.textContent = '→';
      const chip = lookChip(rule.effect, rule.color, sampleText(field, rule));
      const del = document.createElement('button');
      del.className = 'wb-cf-rule-del';
      del.textContent = '✕';
      del.title = 'Remove this rule';
      del.addEventListener('click', () => { rules.splice(i, 1); render(); });
      // reorder controls — only meaningful when there are 2+ rules
      const actions = document.createElement('span');
      actions.className = 'wb-cf-rule-actions';
      if (rules.length > 1) {
        if (i > 0) {
          const up = document.createElement('button');
          up.type = 'button';
          up.className = 'wb-cf-rule-move';
          up.textContent = '↑';
          up.title = 'Move this rule up — rules apply top to bottom, first match wins';
          up.setAttribute('aria-label', `Move rule ${i + 1} up`);
          up.addEventListener('click', () => { [rules[i - 1], rules[i]] = [rules[i], rules[i - 1]]; render(); });
          actions.appendChild(up);
        }
        if (i < rules.length - 1) {
          const down = document.createElement('button');
          down.type = 'button';
          down.className = 'wb-cf-rule-move';
          down.textContent = '↓';
          down.title = 'Move this rule down — rules apply top to bottom, first match wins';
          down.setAttribute('aria-label', `Move rule ${i + 1} down`);
          down.addEventListener('click', () => { [rules[i], rules[i + 1]] = [rules[i + 1], rules[i]]; render(); });
          actions.appendChild(down);
        }
      }
      actions.appendChild(del);
      row.append(num, when, arrow, chip, actions);
      rulesBox.appendChild(row);
    });
    if (field.type === 'choice' && field.choices?.length) {
      const auto = document.createElement('button');
      auto.className = 'wb-cf-auto';
      auto.textContent = `✨ A color for each choice (${field.choices.length})`;
      auto.title = 'One rule per choice, colors picked from the words themselves — Done goes green, Blocked goes red. Tune afterwards.';
      auto.addEventListener('click', () => {
        rules.length = 0;
        for (const opt of conditionOptionsFor(field)) {
          if (opt.kind !== 'eq') continue;
          rules.push({ cond: { kind: 'eq', value: opt.value }, effect: effectId, color: opt.suggestColor });
        }
        render();
      });
      rulesBox.appendChild(auto);
    }
    panel.appendChild(group('Rules', rulesBox));

    // ── composer: condition · look · color · add ──
    const condRow = document.createElement('div');
    condRow.className = 'wb-cf-row';
    for (const opt of conditionOptionsFor(field)) {
      const b = document.createElement('button');
      b.className = 'wb-cf-cond' + (selOpt === opt || (selOpt && selOpt.kind === opt.kind && selOpt.value === opt.value) ? ' active' : '');
      b.textContent = opt.label;
      b.addEventListener('click', () => {
        selOpt = opt;
        if (!colorTouched) colorId = opt.suggestColor;
        render();
        panel.querySelector<HTMLInputElement>('.wb-cf-valinput')?.focus();
      });
      condRow.appendChild(b);
    }
    // inline value input for the conditions that need one
    if (selOpt?.needs) {
      const inp = document.createElement('input');
      inp.className = 'wb-cf-valinput';
      if (selOpt.needs === 'text') {
        inp.type = 'text';
        inp.placeholder = 'value… (quotes are dropped)';
        inp.value = inputVal;
      } else {
        inp.type = 'number';
        if (selOpt.needs === 'days') {
          inp.min = '1'; inp.max = '365';
          inp.value = String(daysVal);
        } else {
          inp.placeholder = 'number…';
          inp.value = inputVal;
        }
      }
      inp.addEventListener('input', () => {
        if (selOpt?.needs === 'days') daysVal = Number(inp.value) || 7;
        else inputVal = inp.value;
        refreshAddState();
      });
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') panel.querySelector<HTMLButtonElement>('.wb-cf-addbtn')?.click();
      });
      condRow.appendChild(inp);
    }
    panel.appendChild(group(`When ${fieldLabel(field)} (a ${typeLabel(field)} column)…`, condRow));

    const lookRow = document.createElement('div');
    lookRow.className = 'wb-cf-row';
    for (const eff of COND_EFFECTS) {
      const b = document.createElement('button');
      b.className = 'wb-cf-look' + (eff.id === effectId ? ' active' : '');
      b.title = eff.hint;
      b.appendChild(lookChip(eff.id, colorId, 'Aa'));
      const t = document.createElement('span');
      t.textContent = eff.label;
      b.appendChild(t);
      b.addEventListener('click', () => { effectId = eff.id; render(); });
      lookRow.appendChild(b);
    }
    const swatches = document.createElement('div');
    swatches.className = 'wb-cf-swatches';
    for (const c of COND_COLORS) {
      const s = document.createElement('button');
      s.className = 'wb-cf-swatch' + (c.id === colorId ? ' active' : '');
      s.title = c.label;
      s.style.background = effectId === 'fill' ? c.soft : c.strong;
      if (effectId === 'fill') s.style.borderColor = c.strong;
      s.addEventListener('click', () => { colorId = c.id; colorTouched = true; render(); });
      swatches.appendChild(s);
    }
    lookRow.appendChild(swatches);

    const addBtn = document.createElement('button');
    addBtn.className = 'wb-cf-addbtn';
    addBtn.textContent = '+ Add rule';
    const addHint = document.createElement('span');
    addHint.className = 'wb-cf-add-hint';
    const refreshAddState = (): void => {
      let ok = !!selOpt;
      if (selOpt?.needs === 'text') ok = escapeCondValue(inputVal) !== '';
      if (selOpt?.needs === 'number') ok = Number.isFinite(Number(inputVal)) && inputVal.trim() !== '';
      addBtn.disabled = !ok;
      addHint.textContent = ok ? '' :
        !selOpt ? 'Pick a condition above first' :
        selOpt.needs === 'text' ? 'Enter a value to add this rule' :
        'Enter a valid number to add this rule';
    };
    refreshAddState();
    addBtn.addEventListener('click', () => {
      if (!selOpt || addBtn.disabled) return;
      rules.push({
        cond: {
          kind: selOpt.kind,
          value: selOpt.needs === 'text' || selOpt.needs === 'number' ? inputVal : selOpt.value,
          days: selOpt.needs === 'days' ? daysVal : undefined,
        },
        effect: effectId,
        color: colorId,
      });
      selOpt = null;
      inputVal = '';
      render();
    });
    lookRow.appendChild(addHint);
    lookRow.appendChild(addBtn);
    panel.appendChild(group('…make it look like', lookRow));

    // ── the receipts: every mock row through the real renderer ──
    if (rules.length && state.rows.length) {
      const strip = document.createElement('div');
      strip.className = 'wb-cf-preview';
      const gen = rulesToStyle(field, rules, existingStyle());
      // the preview wears the PAINTED column's content, styled by the rules
      const sample: SPElement = { ...defaultColumnFormatter(paintField ?? field), style: gen.style };
      state.rows.forEach((row, i) => {
        const item = document.createElement('div');
        item.className = 'wb-cf-preview-item';
        try {
          item.appendChild(renderElement(structuredClone(sample), ctxForRow(i), { issues: [] }));
        } catch (e) {
          item.textContent = `⚠ ${(e as Error).message}`;
        }
        const hit = rules.findIndex((r) => {
          try { return evaluate(`=${condExpr(field, r.cond)}`, ctxForRow(i)) === true; }
          catch { return false; }
        });
        const lab = document.createElement('span');
        lab.className = 'wb-cf-preview-lab';
        lab.textContent = hit === -1 ? 'no rule' : `rule ${hit + 1}`;
        lab.title = `Row ${i + 1}: ${String(row.Title ?? '')}`;
        item.appendChild(lab);
        strip.appendChild(item);
      });
      panel.appendChild(group('With your data', strip));
    }

    // ── footer ──
    const foot = document.createElement('div');
    foot.className = 'wb-cf-foot';
    const note = document.createElement('span');
    note.className = 'wb-cf-note';
    const replaced = rules.length ? rulesToStyle(field, rules, existingStyle()).replacedFormulas : [];
    note.textContent = replaced.length
      ? `⚠ replaces the formula currently on ${replaced.join(', ')}`
      : '';
    foot.appendChild(note);
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', closeCondFormat);
    foot.appendChild(cancel);
    const apply = document.createElement('button');
    apply.className = 'wb-cf-apply';
    apply.textContent = target.kind === 'element'
      ? `Apply to ${nameOf(targetNode!)}`
      : `Apply to the [$${paintField!.name}] formatter`;
    apply.title = 'Merge the generated conditional styles (undoable with Ctrl+Z)';
    apply.disabled = !rules.length;
    apply.addEventListener('click', () => {
      if (target.kind === 'element') applyToElement(target.path);
      else applyToColumn(target.cellPath);
      closeCondFormat();
    });
    foot.appendChild(apply);
    panel.appendChild(foot);
  };

  const applyToElement = (path: NodePath): void => {
    const node = state.nodeAt(path);
    if (!node) return;
    const gen = rulesToStyle(field, rules, node.style);
    state.mutateDocument(() => { node.style = { ...(node.style ?? {}), ...gen.style }; });
    toast(`${rules.length} rule${rules.length === 1 ? '' : 's'} applied to ${nameOf(node)} — Ctrl+Z undoes`);
  };

  /** The "Format this column" route: register, CFR-wire the cell, switch,
   *  merge. The PAINTED column gets the formatter; the rules inside it may
   *  watch any field. */
  const applyToColumn = (cellPath?: NodePath): void => {
    const paint = paintField!;
    const existed = paint.name in state.columnRefs;
    if (!existed) state.columnRefs[paint.name] = defaultColumnFormatter(paint);
    if (cellPath?.length && state.activeDocKey === 'main') {
      const cell = state.nodeAt(cellPath);
      const p = state.parentOf(cellPath);
      if (cell && !cell.columnFormatterReference && p?.parent.children) {
        state.mutateDocument(() => {
          const next = gridCellForField(paint, state.columnRefs);
          if (cell._elmName) next._elmName = cell._elmName;
          p.parent.children![p.index] = next;
        });
      }
    }
    state.openColumnRef(paint.name);
    const root = state.doc.root;
    const gen = rulesToStyle(field, rules, root.style);
    state.mutateDocument(() => { root.style = { ...(root.style ?? {}), ...gen.style }; });
    toast(existed
      ? `Rules applied to the [$${paint.name}] formatter — you're editing it now (Ctrl+Z undoes the styles)`
      : `Started a formatter for ${paint.name} with your rules — the grid renders it live`);
  };

  render();
  document.body.appendChild(overlay);
}

/** Text the look-preview chips wear: the rule's own value where it has one. */
function sampleText(field: MockField, rule: CondRule): string {
  if (rule.cond.kind === 'eq' && rule.cond.value) return rule.cond.value;
  if (field.type === 'date') return 'Jun 3';
  if (field.type === 'number' || field.type === 'currency') return '42';
  if (field.type === 'person' || field.type === 'personMulti') return 'Ada Lovelace';
  if (field.type === 'boolean') return rule.cond.kind === 'isFalse' ? 'No' : 'Yes';
  return 'Sample';
}
