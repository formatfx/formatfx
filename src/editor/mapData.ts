// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * editor/mapData.ts — "Map data" (issue #217): the visual IF / ELSE-IF /
 * ELSE builder for ONE property of the selected element. Each row is
 * column → operator → comparison → output; the ELSE row is the fallback
 * output. Everything compiles through the EXISTING condition engine
 * (condRules.mapRulesToExpr → condExpr — no parallel codegen) into one
 * schema-valid `=if(…)` chain, stamped on the property as ONE undoable
 * mutation.
 *
 * Reopen, don't restart: a chain this builder (or the ✨ dialog — shared
 * vocabulary) generated parses back into editable rows, gated by the
 * byte-identical rebuild in parseMapFromExpr. A hand-written formula it
 * can't parse gets a teaching note + "Start fresh" instead of a guessed
 * parse — refuse-and-teach, never corrupt (the condFormat precedent).
 *
 * Operators are type-honest: only what the engine's verified vocabulary
 * supports for the column's type (mapOperatorsFor) — number comparisons on
 * numbers, no 'greater' on plain text, dates through the pinned
 * overdue/today/soon semantics, and never a standalone '!'.
 */

import type { MockField, NodePath, SPExpr } from '../core/types';
import { evaluate, type EvalContext } from '../core/expressions';
import { state } from './state';
import {
  mapOperatorsFor, mapRulesToExpr, parseMapFromExpr, escapeCondValue,
  type CondKind, type Condition, type MapRule,
} from './condRules';
import { elementRefChip } from './elmRef';
import { createOverlay } from './overlay';

export interface MapDataTarget {
  /** The element whose property gets the mapping. */
  path: NodePath;
  /** Where the expression lands: a style property, or the element's text. */
  slot: 'style' | 'text';
  /** Style property name (required when slot === 'style'). */
  prop?: string;
  /** Plain-language label for the header ("Background", "Text"). */
  label: string;
}

let activeClose: (() => void) | null = null;

export function closeMapData(): void {
  const close = activeClose;
  activeClose = null;
  close?.();
}

/** One editable builder row (the UI-side shape of a MapRule). */
interface Row {
  fieldName: string;
  kind: CondKind;
  value: string;
  days: number;
  output: string;
}

const condOf = (row: Row, needs: 'text' | 'number' | 'days' | undefined): Condition => {
  const cond: Condition = { kind: row.kind };
  if (needs === 'text' || needs === 'number') cond.value = row.value;
  if (needs === 'days') cond.days = row.days;
  return cond;
};

/** Friendly type names, matching the ✨ dialog's field picker. */
const TYPE_LABELS: Record<string, string> = {
  text: 'text', note: 'multiline text', number: 'number', currency: 'currency',
  choice: 'choice', choiceMulti: 'multi-choice', date: 'date',
  person: 'person', personMulti: 'people', boolean: 'yes/no',
  hyperlink: 'link', lookup: 'lookup', lookupMulti: 'multi-lookup',
};

export function openMapData(target: MapDataTarget, onToast?: (m: string) => void): void {
  closeMapData();
  const toast = onToast ?? (() => { /* entry points without a toaster stay quiet */ });

  const node = state.nodeAt(target.path);
  if (!node) return;
  if (!state.fields.length) {
    toast('Add a column in the Data tab first — Map data builds rules from your columns.');
    return;
  }

  const readCurrent = (): SPExpr | undefined =>
    target.slot === 'text' ? node.txtContent : node.style?.[target.prop!];

  // color-ish properties get swatch output pickers; everything else is text
  const colorish = target.slot === 'style' && /color/.test(target.prop ?? '');

  // ── hydrate: our own chain reopens as rows; a foreign formula refuses ──
  const rows: Row[] = [];
  let elseOutput = '';
  let hydrated = false;          // reopened on a chain the builder generated
  let foreign: string | null = null; // a formula we refuse to parse over

  const current = readCurrent();
  const opFor = (field: MockField, kind: CondKind) =>
    mapOperatorsFor(field).find((o) => o.kind === kind);
  if (typeof current === 'string' && current.startsWith('=')) {
    const parsed = parseMapFromExpr(current, state.fields);
    if (parsed) {
      for (const r of parsed.rules) {
        rows.push({
          fieldName: r.fieldName,
          kind: r.cond.kind,
          value: r.cond.value ?? '',
          days: r.cond.days ?? 7,
          output: r.output,
        });
      }
      elseOutput = parsed.elseOutput;
      hydrated = true;
    } else {
      foreign = current;
    }
  } else if (current !== undefined && typeof current !== 'string') {
    // an AST operator object — hand-authored, not ours
    foreign = JSON.stringify(current);
  } else if (typeof current === 'string') {
    // the plain value becomes the ELSE — the "no rule matched" look
    elseOutput = current;
  }

  const fieldByName = (name: string): MockField | undefined =>
    state.fields.find((f) => f.name === name);

  const { overlay, close } = createOverlay('wb-md-overlay', () => closeMapData());
  activeClose = close;

  const panel = document.createElement('div');
  panel.className = 'wb-md';
  // modal dialog semantics — createOverlay wires the backdrop + Escape; name
  // the panel and make it focusable so keyboard/screen-reader users can reach it
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', `Map data — ${target.label ?? target.prop ?? 'property'}`);
  panel.tabIndex = -1;
  overlay.appendChild(panel);

  const ctxForRow = (rowIndex: number): EvalContext => ({
    row: state.rows[rowIndex] ?? {},
    rowIndex,
    currentFieldName: state.currentFieldName,
    me: state.me,
    iterators: {},
    iteratorIndex: {},
    displayNames: Object.fromEntries(state.fields.map((f) => [f.name, f.displayName ?? f.name])),
    fieldTypes: Object.fromEntries(state.fields.map((f) => [f.name, f.type])),
    now: new Date(),
  });

  const rowComplete = (row: Row): boolean => {
    const field = fieldByName(row.fieldName);
    if (!field) return false;
    const op = opFor(field, row.kind);
    if (!op) return false;
    if (op.needs === 'text') return escapeCondValue(row.value) !== '';
    if (op.needs === 'number') return row.value.trim() !== '' && Number.isFinite(Number(row.value));
    return true;
  };

  const toRules = (): MapRule[] | null => {
    const out: MapRule[] = [];
    for (const row of rows) {
      const field = fieldByName(row.fieldName);
      if (!field) return null;
      const op = opFor(field, row.kind);
      if (!op || !rowComplete(row)) return null;
      out.push({ fieldName: row.fieldName, cond: condOf(row, op.needs), output: row.output });
    }
    return out;
  };

  const compiled = (): string | null => {
    const mapped = toRules();
    return mapped && mapped.length ? mapRulesToExpr(state.fields, mapped, elseOutput) : null;
  };

  /** Output control: text input everywhere, plus a native color well on
   *  color-ish properties (the swatch tracks any valid hex typed by hand). */
  const outputControl = (get: () => string, set: (v: string) => void): HTMLElement => {
    const wrap = document.createElement('span');
    wrap.className = 'wb-md-out';
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'wb-md-outtext';
    inp.value = get();
    inp.placeholder = colorish ? '#d4edda' : 'output value…';
    inp.title = 'What this property becomes when the row matches (quotes are dropped — SP literals can\'t carry them)';
    if (colorish) {
      const well = document.createElement('input');
      well.type = 'color';
      well.className = 'wb-md-swatch';
      const syncWell = (): void => {
        const v = get().trim();
        if (/^#[0-9a-fA-F]{6}$/.test(v)) well.value = v;
      };
      syncWell();
      well.title = 'Pick a color';
      well.addEventListener('input', () => {
        set(well.value);
        inp.value = well.value;
        refreshDynamic();
      });
      inp.addEventListener('input', () => {
        set(inp.value);
        syncWell();
        refreshDynamic();
      });
      wrap.append(well, inp);
      return wrap;
    }
    inp.addEventListener('input', () => { set(inp.value); refreshDynamic(); });
    wrap.appendChild(inp);
    return wrap;
  };

  // dynamic bits refreshed on every keystroke without a full re-render
  // (full render() would drop focus mid-typing — the condFormat pattern)
  let refreshDynamic: () => void = () => {};

  const render = (): void => {
    panel.innerHTML = '';
    const live = state.nodeAt(target.path);
    if (!live) {
      panel.textContent = 'The element is gone (undone or removed) — close and reselect.';
      return;
    }

    // ── header ──
    const head = document.createElement('div');
    head.className = 'wb-md-head';
    const title = document.createElement('span');
    title.className = 'wb-md-title';
    title.textContent = `▦ Map data → ${target.label}`;
    const sub = document.createElement('span');
    sub.className = 'wb-md-sub';
    sub.textContent = 'IF rows read top-down, the first match wins — nothing changes until you apply';
    head.append(title, sub);
    const closeBtn = document.createElement('button');
    closeBtn.className = 'wb-md-close';
    closeBtn.textContent = '✕';
    closeBtn.title = 'Close (Esc) — discards these rows';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.addEventListener('click', closeMapData);
    head.appendChild(closeBtn);
    panel.appendChild(head);

    const targetLine = document.createElement('div');
    targetLine.className = 'wb-md-target';
    targetLine.append('Driving ', target.label.toLowerCase(), ' on ', elementRefChip(live));
    panel.appendChild(targetLine);

    // ── the refuse-and-teach door: a formula this builder didn't write ──
    if (foreign !== null) {
      const note = document.createElement('div');
      note.className = 'wb-md-foreign';
      const msg = document.createElement('div');
      msg.className = 'wb-md-foreign-msg';
      msg.textContent = `This ${target.label.toLowerCase()} is already driven by a formula this builder didn't write — mapping over it would silently overwrite hand-written logic, so it refuses to guess.`;
      const code = document.createElement('code');
      code.className = 'wb-md-foreign-code';
      code.textContent = foreign;
      const hint = document.createElement('div');
      hint.className = 'wb-md-foreign-hint';
      hint.textContent = 'Keep it: close this dialog and edit the formula in the property field or the Function Bar (ƒx). Or replace it:';
      const fresh = document.createElement('button');
      fresh.className = 'wb-md-fresh';
      fresh.textContent = 'Start fresh (replaces it on Apply)';
      fresh.title = 'Discard nothing yet — the formula is only replaced when you Apply, and Ctrl+Z brings it back';
      fresh.addEventListener('click', () => {
        foreign = null;
        rows.length = 0;
        elseOutput = '';
        render();
      });
      note.append(msg, code, hint, fresh);
      panel.appendChild(note);

      const foot = document.createElement('div');
      foot.className = 'wb-md-foot';
      const cancel = document.createElement('button');
      cancel.textContent = 'Close';
      cancel.addEventListener('click', closeMapData);
      foot.appendChild(cancel);
      panel.appendChild(foot);
      return;
    }

    // ── the rows ──
    const rowsBox = document.createElement('div');
    rowsBox.className = 'wb-md-rows';

    rows.forEach((row, i) => {
      const field = fieldByName(row.fieldName) ?? state.fields[0];
      const ops = mapOperatorsFor(field);
      const op = opFor(field, row.kind) ?? ops[0];

      const rowEl = document.createElement('div');
      rowEl.className = 'wb-md-row';

      const kw = document.createElement('span');
      kw.className = 'wb-md-kw';
      kw.textContent = i === 0 ? 'IF' : 'ELSE IF';
      rowEl.appendChild(kw);

      // column picker — the type is part of the name (it decides the operators)
      const fieldSel = document.createElement('select');
      fieldSel.className = 'wb-md-field';
      for (const f of state.fields) {
        const o = document.createElement('option');
        o.value = f.name;
        o.textContent = `[$${f.name}] — ${TYPE_LABELS[f.type] ?? f.type}`;
        o.selected = f.name === row.fieldName;
        fieldSel.appendChild(o);
      }
      fieldSel.value = row.fieldName;
      fieldSel.title = 'Which column this row tests — the operators adapt to its type';
      fieldSel.addEventListener('change', () => {
        row.fieldName = fieldSel.value;
        const next = fieldByName(row.fieldName)!;
        // keep the operator when the new type supports it, else the first honest one
        if (!opFor(next, row.kind)) {
          row.kind = mapOperatorsFor(next)[0].kind;
          row.value = '';
        }
        render();
      });
      rowEl.appendChild(fieldSel);

      // operator picker — strictly the engine's vocabulary for this type
      const opSel = document.createElement('select');
      opSel.className = 'wb-md-op';
      for (const o of ops) {
        const el = document.createElement('option');
        el.value = o.kind;
        el.textContent = o.label;
        el.selected = o.kind === op.kind;
        opSel.appendChild(el);
      }
      opSel.value = op.kind;
      opSel.title = `What to test — only comparisons the engine supports for a ${TYPE_LABELS[field.type] ?? field.type} column`;
      opSel.addEventListener('change', () => {
        const prev = opFor(field, row.kind);
        row.kind = opSel.value as CondKind;
        const next = opFor(field, row.kind);
        if (prev?.needs !== next?.needs) row.value = '';
        render();
      });
      rowEl.appendChild(opSel);

      // comparison input, shaped by the operator (and the column's choices)
      if (op.needs === 'text' && (field.type === 'choice' || field.type === 'choiceMulti') && field.choices?.length) {
        const valSel = document.createElement('select');
        valSel.className = 'wb-md-val';
        const ph = document.createElement('option');
        ph.value = '';
        ph.textContent = '— pick a choice —';
        ph.disabled = true;
        ph.selected = !field.choices.includes(row.value);
        valSel.appendChild(ph);
        for (const c of field.choices) {
          const o = document.createElement('option');
          o.value = c;
          o.textContent = c;
          o.selected = c === row.value;
          valSel.appendChild(o);
        }
        valSel.value = field.choices.includes(row.value) ? row.value : '';
        valSel.addEventListener('change', () => { row.value = valSel.value; refreshDynamic(); });
        rowEl.appendChild(valSel);
      } else if (op.needs === 'text' || op.needs === 'number') {
        const val = document.createElement('input');
        val.className = 'wb-md-val';
        val.type = op.needs === 'number' ? 'number' : 'text';
        val.placeholder = op.needs === 'number' ? 'number…' : 'value… (quotes are dropped)';
        val.value = row.value;
        val.addEventListener('input', () => { row.value = val.value; refreshDynamic(); });
        rowEl.appendChild(val);
      } else if (op.needs === 'days') {
        const val = document.createElement('input');
        val.className = 'wb-md-val wb-md-days';
        val.type = 'number';
        val.min = '1';
        val.max = '365';
        val.value = String(row.days);
        val.title = 'How many days ahead still counts as "soon"';
        val.addEventListener('input', () => { row.days = Number(val.value) || 7; refreshDynamic(); });
        rowEl.appendChild(val);
      }

      const arrow = document.createElement('span');
      arrow.className = 'wb-md-arrow';
      arrow.textContent = '→';
      rowEl.appendChild(arrow);

      rowEl.appendChild(outputControl(() => row.output, (v) => { row.output = v; }));

      const del = document.createElement('button');
      del.className = 'wb-md-del';
      del.textContent = '✕';
      del.title = 'Remove this row';
      del.setAttribute('aria-label', `Remove row ${i + 1}`);
      del.addEventListener('click', () => { rows.splice(i, 1); render(); });
      rowEl.appendChild(del);

      rowsBox.appendChild(rowEl);
    });

    // ELSE — the fallback output (always present)
    const elseEl = document.createElement('div');
    elseEl.className = 'wb-md-row wb-md-else';
    const elseKw = document.createElement('span');
    elseKw.className = 'wb-md-kw';
    elseKw.textContent = 'ELSE';
    elseKw.title = 'When no row matches';
    const elseArrow = document.createElement('span');
    elseArrow.className = 'wb-md-arrow';
    elseArrow.textContent = '→';
    elseEl.append(elseKw, elseArrow, outputControl(() => elseOutput, (v) => { elseOutput = v; }));
    rowsBox.appendChild(elseEl);

    const add = document.createElement('button');
    add.className = 'wb-md-add';
    add.textContent = rows.length ? '+ ELSE IF…' : '+ IF…';
    add.title = 'Add a condition row — rows read top-down, the first match wins';
    add.addEventListener('click', () => {
      const f = state.fields[0];
      rows.push({ fieldName: f.name, kind: mapOperatorsFor(f)[0].kind, value: '', days: 7, output: '' });
      render();
    });
    rowsBox.appendChild(add);
    panel.appendChild(rowsBox);

    // ── receipts: the compiled formula + every mock row's outcome ──
    const exprLine = document.createElement('code');
    exprLine.className = 'wb-md-expr';
    const preview = document.createElement('div');
    preview.className = 'wb-md-preview';
    panel.append(exprLine, preview);

    // ── footer ──
    const foot = document.createElement('div');
    foot.className = 'wb-md-foot';
    const note = document.createElement('span');
    note.className = 'wb-md-note';
    foot.appendChild(note);
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', closeMapData);
    foot.appendChild(cancel);
    const apply = document.createElement('button');
    apply.className = 'wb-md-apply';
    foot.appendChild(apply);
    panel.appendChild(foot);

    const write = (v: SPExpr | undefined): void => {
      const el = state.nodeAt(target.path);
      if (!el) return;
      if (target.slot === 'text') {
        if (v === undefined) delete el.txtContent;
        else el.txtContent = v;
        return;
      }
      const prop = target.prop!;
      if (v === undefined) {
        if (el.style) {
          delete el.style[prop];
          if (Object.keys(el.style).length === 0) delete el.style;
        }
        return;
      }
      el.style = el.style ?? {};
      el.style[prop] = v;
    };

    apply.addEventListener('click', () => {
      if (apply.disabled) return;
      const removing = hydrated && rows.length === 0;
      if (removing) {
        // all rows deleted on a reopen = remove the mapping: the ELSE value
        // stays behind as the plain look ('' clears the property entirely)
        state.mutateDocument(() => write(elseOutput === '' ? undefined : elseOutput));
        toast(`Mapping removed — ${target.label} is a plain value again (Ctrl+Z undoes)`);
        closeMapData();
        return;
      }
      const expr = compiled();
      if (!expr) return;
      state.mutateDocument(() => write(expr));
      toast(`${target.label} now maps from your data — ${rows.length} condition${rows.length === 1 ? '' : 's'} + else (Ctrl+Z undoes)`);
      closeMapData();
    });

    refreshDynamic = (): void => {
      const removing = hydrated && rows.length === 0;
      const expr = compiled();
      apply.textContent = removing ? 'Remove the mapping' : 'Apply';
      apply.title = removing
        ? `Every row is gone — Apply puts the ELSE value back as the plain ${target.label.toLowerCase()} (one undoable step)`
        : 'Stamp the compiled =if(…) chain on this property — one undoable step';
      apply.disabled = !removing && expr === null;
      note.textContent = removing
        ? ''
        : !rows.length
          ? 'Add an IF row to build the mapping'
          : expr === null
            ? 'Finish every row (pick a column, an operator, and a comparison value)'
            : hydrated ? '↻ editing the mapping already on it — parsed back from its formula' : '';

      exprLine.textContent = expr ?? '';
      exprLine.hidden = expr === null;
      exprLine.title = 'The generated SharePoint expression — compiled for you, schema-valid, no logical NOT';

      preview.replaceChildren();
      preview.hidden = expr === null || !state.rows.length;
      if (expr === null) return;
      state.rows.forEach((mockRow, idx) => {
        const item = document.createElement('span');
        item.className = 'wb-md-preview-item';
        let out = '';
        try { out = String(evaluate(expr, ctxForRow(idx)) ?? ''); } catch { out = '⚠'; }
        if (colorish) {
          const dot = document.createElement('span');
          dot.className = 'wb-md-preview-dot';
          dot.style.backgroundColor = out;
          item.appendChild(dot);
        }
        const lab = document.createElement('span');
        lab.textContent = out === '' ? '(empty)' : out;
        item.appendChild(lab);
        item.title = `Row ${idx + 1}: ${String(mockRow.Title ?? '')}`;
        preview.appendChild(item);
      });
    };
    refreshDynamic();
  };

  render();
  document.body.appendChild(overlay);
  // move focus into the dialog so it doesn't linger behind the backdrop —
  // first interactive control if there is one, else the panel itself
  (panel.querySelector<HTMLElement>('button, input, select, textarea, [tabindex]') ?? panel).focus();
}
