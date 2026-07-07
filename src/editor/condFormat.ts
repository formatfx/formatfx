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
 * ELEMENT-scoped only (the inspector door): the generated conditional styles
 * merge into the element the dialog was opened on. The per-column route died
 * with "Format this column" (COLUMNS-COMPONENTS-VIEWS model B) — a column's
 * conditional look now travels inside the component applied to it.
 */

import type { MockField, NodePath, SPElement, SPExpr } from '../core/types';
import { renderElement } from '../core/renderer';
import { evaluate, type EvalContext } from '../core/expressions';
import { state } from './state';
import {
  defaultColumnFormatter, fieldRefsIn, fieldLabel,
} from './gridScaffold';
import {
  COND_COLORS, COND_EFFECTS, condColor, condEffect, condExpr, condLabel,
  conditionOptionsFor, escapeCondValue, rulesToStyle, parseRulesFromStyle,
  rulesToClass, parseClassRules,
  type CondOption, type CondRule, type EffectId, type Condition, type CondClassRule,
} from './condRules';
import {
  paletteClass, severityClass, parseThemeClass, themeColor, type SeverityLevel,
} from './themeClasses';
import { elementRefChip } from './elmRef';
import { createOverlay } from './overlay';
import { createModalUndo, wireModalUndoKeys, modalUndoButtons } from './modalUndo';

export type CondTarget = { kind: 'element'; path: NodePath };

let activeClose: (() => void) | null = null;

export function closeCondFormat(): void {
  const close = activeClose;
  activeClose = null;
  close?.();
}

const nameOf = (el: SPElement): string => el._elmName ?? `<${el.elmType}>`;

/** Best-guess field for an element: the first field it references. */
function guessField(node: SPElement): MockField {
  const editable = state.fields.filter((f) => !f.protected);
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

// ── theme-aware look vocabulary (classes-first): the two looks with a single-
//    class form, mapped to/from a (effect,color) rule so the whole rule pipeline
//    (composer, preview, reorder, reopen) is reused. Fill uses SharePoint's
//    severity class for the status colors and a palette fill for the rest.
const THEME_LOOKS: EffectId[] = ['text', 'fill'];
const COLOR_SEVERITY: Record<string, SeverityLevel> = { green: 'good', amber: 'warning', red: 'blocked' };
const SEVERITY_COLOR: Partial<Record<SeverityLevel, string>> = { good: 'green', warning: 'amber', blocked: 'red' };

/** A theme-mode rule → its single class token (null for looks with no class form). */
function condRuleToClassToken(rule: CondRule): string | null {
  const c = themeColor(rule.color);
  if (rule.effect === 'text') return paletteClass('text', c);
  if (rule.effect === 'fill') {
    const sev = COLOR_SEVERITY[rule.color];
    return sev ? severityClass(sev) : paletteClass('fill', c);
  }
  return null; // pill / stripe / strike have no single-class form
}

/** A parsed class token → the (effect,color) rule the composer edits (null if foreign). */
function classTokenToCondRule(cond: Condition, token: string): CondRule | null {
  const info = parseThemeClass(token);
  if (!info) return null;
  if (info.role === 'text' && info.colorId) return { cond, effect: 'text', color: info.colorId };
  if (info.role === 'fill' && info.severity) {
    const color = SEVERITY_COLOR[info.severity];
    return color ? { cond, effect: 'fill', color } : null;
  }
  if (info.role === 'fill' && info.colorId) return { cond, effect: 'fill', color: info.colorId };
  return null;
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

  // the ELEMENT being painted is fixed; the field being WATCHED is free —
  // "color this badge by Status" is the whole point
  let field: MockField = guessField(state.nodeAt(target.path) ?? state.doc.root);
  if (!field) { toast('Add a column in the Data tab first.'); return; }

  const rules: CondRule[] = [];
  // composer state — color follows the picked condition until touched by hand
  let selOpt: CondOption | null = null;
  let inputVal = '';
  let daysVal = 7;
  let effectId: EffectId = defaultEffectFor(field);
  let colorId = 'blue';
  let colorTouched = false;
  // tracks a field the user picked while rules exist; held until confirmed
  let pendingField: MockField | null = null;

  /** Style object the generated chains will fall back to (the "else" look). */
  const existingStyle = (): Record<string, SPExpr | undefined> | undefined =>
    state.nodeAt(target.path)?.style;
  const existingClass = (): SPExpr | undefined => state.nodeAt(target.path)?.attributes?.class;

  // Reopen, don't restart (§6 1.7's "obvious next step"): `=if()` chains this
  // dialog generated parse back into editable rules — gated by regenerating and
  // requiring byte-identical output, so a lossy reopen is structurally
  // impossible. Classes-first: a fresh dialog emits theme classes; reopen picks
  // the mode from what's on the element — the conditional-CLASS chain
  // (attributes.class) first, then the style chains. Anything hand-edited or
  // foreign fails the gate and the dialog starts fresh (refuse-and-teach).
  // Opt-in: a fresh dialog opens in the familiar hex/style look mode (all five
  // looks). A class-chain reopen flips to theme mode to match what's on the
  // element; the ✨ toggle switches modes. (Inspector stays primary classes-first.)
  let themeAware = false;
  let parsedClass = false;
  let parsedFallbacks: Record<string, string> | null = null;
  const classParsed = parseClassRules(existingClass(), state.fields);
  if (classParsed) {
    const watched = state.fields.find((f) => f.name === classParsed.fieldName);
    const mapped = watched ? classParsed.rules.map((r) => classTokenToCondRule(r.cond, r.token)) : null;
    if (watched && mapped && mapped.every((r): r is CondRule => r !== null)) {
      field = watched;
      rules.push(...mapped);
      parsedClass = true;
      themeAware = true; // reopened a conditional-class look
    }
  }
  if (!parsedClass) {
    const parsed = parseRulesFromStyle(existingStyle(), state.fields);
    if (parsed) {
      const watched = state.fields.find((f) => f.name === parsed.fieldName);
      if (watched) {
        field = watched; // the chains may watch a different column than they paint
        rules.push(...parsed.rules);
        parsedFallbacks = parsed.fallbacks;
        themeAware = false; // reopened a fixed-hex style look
      }
    }
  }
  // theme mode exposes only the two looks with a single-class form
  if (themeAware && !THEME_LOOKS.includes(effectId)) effectId = 'fill';

  /** The generated conditional-class chain for attributes.class (null = no rules). */
  const classChain = (): string | null => {
    const cr: CondClassRule[] = [];
    for (const r of rules) {
      const token = condRuleToClassToken(r);
      if (token) cr.push({ cond: r.cond, token });
    }
    return rulesToClass(field, cr, '');
  };

  /** The style the rules layer over. With a parsed reopen, each managed
   *  chain reads as its pre-rules FALLBACK (plain value, or absent), so
   *  re-applying preserves the original fallback and never warns about
   *  replacing our own generated formulas. */
  const priorStyle = (base = existingStyle()): Record<string, SPExpr | undefined> | undefined => {
    if (!parsedFallbacks || !base) return base;
    const out: Record<string, SPExpr | undefined> = { ...base };
    for (const [prop, fb] of Object.entries(parsedFallbacks)) {
      if (fb) out[prop] = fb; else delete out[prop];
    }
    return out;
  };

  /** Zero rules on a parsed reopen = REMOVE the managed chains: each one
   *  returns to its pre-rules fallback or leaves the style entirely. Effect
   *  statics stay — inert shape, clearable in Format cells if unwanted. */
  const removeRulesFrom = (host: { style?: Record<string, SPExpr | undefined> }): void => {
    const s: Record<string, SPExpr | undefined> = { ...(host.style ?? {}) };
    for (const [prop, fb] of Object.entries(parsedFallbacks ?? {})) {
      if (fb) s[prop] = fb; else delete s[prop];
    }
    if (Object.keys(s).length) host.style = s; else delete host.style;
  };

  // the shared modal chokepoint (Stage 4): backdrop, Esc-to-close and the
  // wb-esc-owner marker all come from createOverlay — this dialog used to
  // duplicate that machinery by hand
  const { overlay, close } = createOverlay('wb-cf-overlay', () => closeCondFormat());

  // modal-local undo (§2.3): the rules list and the watched field bottom out
  // at the moment the dialog opened; render() is the commit chokepoint, so
  // every gesture that reshapes the rules is exactly one ↶ step. Composer
  // picks (condition/effect/color before "Add") are pre-gesture config and
  // deliberately outside the bag. Apply still lands as ONE app-level step.
  const muBag = (): { fieldName: string; rules: CondRule[]; themeAware: boolean } =>
    ({ fieldName: field.name, rules, themeAware });
  const mu = createModalUndo(muBag());
  const muRestore = (bag: { fieldName: string; rules: CondRule[]; themeAware: boolean } | null): void => {
    if (!bag) return;
    field = state.fields.find((f) => f.name === bag.fieldName) ?? field;
    pendingField = null;
    themeAware = bag.themeAware;
    rules.length = 0;
    rules.push(...bag.rules);
    render();
  };
  const detachMuKeys = wireModalUndoKeys(() => muRestore(mu.undo()), () => muRestore(mu.redo()));
  activeClose = () => { detachMuKeys(); close(); };

  const panel = document.createElement('div');
  panel.className = 'wb-cf';
  overlay.appendChild(panel);

  const ctxForRow = (rowIndex: number): EvalContext => ({
    row: state.rows[rowIndex] ?? {},
    rowIndex,
    // @currentField in the preview content is the watched column
    currentFieldName: field.name,
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
    const targetNode = state.nodeAt(target.path);
    if (!targetNode) {
      panel.textContent = 'The element is gone (undone or removed) — close and reselect.';
      return;
    }
    // every gesture funnels through render(): snapshot here (no-op renders
    // are free — the brain drops identical states)
    mu.commit(muBag());

    // ── header ──
    const head = document.createElement('div');
    head.className = 'wb-cf-head';
    head.innerHTML = `<span class="wb-cf-title">✨ Conditional formatting</span>
      <span class="wb-cf-sub">rules read top-down, the first match wins — nothing changes until you apply</span>`;
    head.appendChild(modalUndoButtons(mu, () => muRestore(mu.undo()), () => muRestore(mu.redo())).root);
    const close = document.createElement('button');
    close.className = 'wb-cf-close';
    close.textContent = '✕';
    close.title = 'Close (Esc) — discards these rules';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', closeCondFormat);
    head.appendChild(close);
    panel.appendChild(head);

    // ── what gets painted, watching which field ──
    const targetRow = document.createElement('div');
    targetRow.className = 'wb-cf-target';
    const tlabel = document.createElement('span');
    tlabel.className = 'wb-cf-targetlab';
    // Show the painted element as a reference badge (tree icon + name) so the
    // user can tie this dialog back to the element they clicked (issue #143).
    tlabel.append('Painting ', elementRefChip(targetNode), ' — every row — when');
    targetRow.appendChild(tlabel);
    const fieldSel = document.createElement('select');
    for (const f of state.fields) {
      const o = document.createElement('option');
      o.value = f.name;
      // the type is part of the name here — it decides which conditions appear
      o.textContent = `[$${f.name}] — ${typeLabel(f)}`;
      o.selected = (pendingField ?? field).name === f.name;
      fieldSel.appendChild(o);
    }
    fieldSel.title = 'Which column the rules watch — pick any column in the row (no typing); the conditions below adapt to its type';
    fieldSel.addEventListener('change', () => {
      const next = state.fields.find((f) => f.name === fieldSel.value) ?? field;
      if (next.name === field.name) {
        // user reverted to the current field — clear any pending confirmation
        pendingField = null;
        render();
        return;
      }
      if (rules.length > 0) {
        // guard: don't wipe rules silently — hold the pick until confirmed
        pendingField = next;
        render();
        return;
      }
      field = next;
      selOpt = null;
      inputVal = '';
      effectId = defaultEffectFor(field);
      colorTouched = false;
      pendingField = null;
      render();
    });
    targetRow.appendChild(fieldSel);
    panel.appendChild(targetRow);

    // When the builder opens on an element that already has formula-driven styles
    // (e.g. from a previous condFormat apply), show an upfront notice so the user
    // knows the empty rules list is expected — not that their rules were lost.
    if (!rules.length && !themeAware) {
      const st = existingStyle();
      const hasFormulas = st && Object.values(st).some(
        (v) => v !== undefined && (
          (typeof v === 'string' && v.startsWith('=')) ||
          (typeof v === 'object' && v !== null)
        ),
      );
      if (hasFormulas) {
        const notice = document.createElement('div');
        notice.className = 'wb-cf-notice';
        notice.textContent = 'This element already has formula-driven styles — the builder starts fresh over them. Rules you add and Apply will replace those formulas (Ctrl+Z undoes).';
        panel.appendChild(notice);
      }
    }

    // Switching the watched field clears the rules (they're per-field); if any
    // exist, hold the pick and confirm first rather than silently wiping them.
    if (pendingField) {
      const warn = document.createElement('div');
      warn.className = 'wb-cf-field-warn';
      const msg = document.createElement('span');
      msg.textContent = `Switching to [${pendingField.name}] will clear all ${rules.length} rule${rules.length === 1 ? '' : 's'} — confirm?`;
      const yes = document.createElement('button');
      yes.className = 'wb-cf-field-warn-yes';
      yes.textContent = 'Clear rules and switch';
      const switchTo = pendingField; // captured at render time — avoids non-null assertion on mutable var
      yes.addEventListener('click', () => {
        field = switchTo;
        rules.length = 0;
        selOpt = null;
        inputVal = '';
        effectId = defaultEffectFor(field);
        colorTouched = false;
        pendingField = null;
        render();
      });
      const no = document.createElement('button');
      no.className = 'wb-cf-field-warn-no';
      no.textContent = 'Keep current column';
      no.addEventListener('click', () => { pendingField = null; render(); });
      warn.append(msg, yes, no);
      panel.appendChild(warn);
    }

    // ── the rules so far ──
    const rulesBox = document.createElement('div');
    rulesBox.className = 'wb-cf-rules';
    if (!rules.length) {
      const empty = document.createElement('div');
      empty.className = 'wb-cf-empty';
      empty.textContent = (parsedFallbacks || parsedClass)
        ? 'All rules removed — Apply now clears the conditional formatting.'
        : 'No rules yet — pick a condition below'
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
      del.setAttribute('aria-label', 'Remove this rule');
      del.addEventListener('click', () => {
        rules.splice(i, 1);
        // if a field switch was pending and the user just cleared the last rule,
        // apply it now — no rules means no confirmation needed
        if (pendingField && rules.length === 0) {
          field = pendingField;
          selOpt = null;
          inputVal = '';
          effectId = defaultEffectFor(field);
          colorTouched = false;
          pendingField = null;
        }
        render();
      });
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
    const lookEffects = themeAware ? COND_EFFECTS.filter((e) => THEME_LOOKS.includes(e.id)) : COND_EFFECTS;
    for (const eff of lookEffects) {
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

    // classes-first mode toggle: theme classes (dark-mode + tenant safe) vs fixed hex
    const modeRow = document.createElement('div');
    modeRow.className = 'wb-cf-row wb-cf-thememode';
    const themeBtn = document.createElement('button');
    themeBtn.type = 'button';
    themeBtn.className = 'wb-cf-look wb-cf-mode' + (themeAware ? ' active' : '');
    themeBtn.textContent = themeAware ? '🎨 Theme-aware classes' : '🎨 Fixed hex styles';
    themeBtn.title = themeAware
      ? 'Emitting SharePoint theme classes onto attributes.class — they survive dark mode and tenant re-theming. Click to switch to fixed-hex looks (adds Solid pill / Edge stripe / Strike out).'
      : 'Emitting fixed hex onto style. Click to emit theme-aware classes (survive dark mode + tenant themes) instead.';
    themeBtn.addEventListener('click', () => {
      themeAware = !themeAware;
      if (themeAware) {
        for (const r of rules) if (!THEME_LOOKS.includes(r.effect)) r.effect = 'fill';
        if (!THEME_LOOKS.includes(effectId)) effectId = 'fill';
      }
      render();
    });
    modeRow.appendChild(themeBtn);
    panel.appendChild(group('…make it look like', modeRow, lookRow));

    // ── the receipts: every mock row through the real renderer ──
    if (rules.length && state.rows.length) {
      const strip = document.createElement('div');
      strip.className = 'wb-cf-preview';
      // the preview wears the WATCHED column's plain content, styled by the rules
      let sample: SPElement;
      if (themeAware) {
        const cls = classChain();
        const b = defaultColumnFormatter(field);
        sample = cls ? { ...b, attributes: { ...(b.attributes ?? {}), class: cls } } : b;
      } else {
        const gen = rulesToStyle(field, rules, priorStyle());
        sample = { ...defaultColumnFormatter(field), style: gen.style };
      }
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
    if (themeAware) {
      const cur = existingClass();
      note.textContent = parsedClass
        ? '↻ editing the conditional classes already on it — parsed back from its formula'
        : (rules.length && typeof cur === 'string' && cur !== ''
          ? '⚠ replaces the class currently set on this element'
          : '');
    } else {
      const replaced = rules.length ? rulesToStyle(field, rules, priorStyle()).replacedFormulas : [];
      note.textContent = replaced.length
        ? `⚠ replaces the formula currently on ${replaced.join(', ')}`
        : (parsedFallbacks ? '↻ editing the rules already on it — parsed back from its formulas' : '');
    }
    foot.appendChild(note);
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', closeCondFormat);
    foot.appendChild(cancel);
    const apply = document.createElement('button');
    apply.className = 'wb-cf-apply';
    const removing = !rules.length && (themeAware ? parsedClass : parsedFallbacks !== null);
    const targetLabel = nameOf(targetNode);
    apply.textContent = removing ? `Remove the rules from ${targetLabel}` : `Apply to ${targetLabel}`;
    apply.title = removing
      ? (themeAware ? 'Clears the conditional class (undoable with Ctrl+Z)' : 'Every managed property returns to its pre-rules look (undoable with Ctrl+Z)')
      : (themeAware ? 'Set the generated conditional class (undoable with Ctrl+Z)' : 'Merge the generated conditional styles (undoable with Ctrl+Z)');
    apply.disabled = !rules.length && !removing;
    apply.addEventListener('click', () => {
      applyToElement(target.path);
      closeCondFormat();
    });
    foot.appendChild(apply);
    panel.appendChild(foot);
  };

  const applyToElement = (path: NodePath): void => {
    const node = state.nodeAt(path);
    if (!node) return;
    if (themeAware) {
      // classes-first: the conditional look is one =if() chain on attributes.class
      if (!rules.length && parsedClass) {
        state.mutateDocument(() => {
          if (node.attributes) {
            delete node.attributes.class;
            if (Object.keys(node.attributes).length === 0) delete node.attributes;
          }
        });
        toast(`Conditional classes removed from ${nameOf(node)} (Ctrl+Z undoes)`);
        return;
      }
      const cls = classChain();
      if (!cls) return;
      state.mutateDocument(() => { node.attributes = { ...(node.attributes ?? {}), class: cls }; });
      toast(`${rules.length} rule${rules.length === 1 ? '' : 's'} applied to ${nameOf(node)} — Ctrl+Z undoes`);
      return;
    }
    if (!rules.length && parsedFallbacks) {
      state.mutateDocument(() => removeRulesFrom(node));
      toast(`Conditional rules removed from ${nameOf(node)} — the pre-rules look is back (Ctrl+Z undoes)`);
      return;
    }
    const gen = rulesToStyle(field, rules, priorStyle(node.style));
    state.mutateDocument(() => { node.style = { ...(node.style ?? {}), ...gen.style }; });
    toast(`${rules.length} rule${rules.length === 1 ? '' : 's'} applied to ${nameOf(node)} — Ctrl+Z undoes`);
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
