/**
 * editor/fxBar.ts — the Sheet fx bar (Sheet stage 2, surfaced).
 *
 * The Sheet counterpart to the inspector: edit the selected element one
 * PROPERTY SLOT at a time, in the Excel dialect people already read. The left
 * dropdown (the Name-Box, done right) picks the slot — "Text shown", "Fill
 * color", "Left border" … ; the editor shows that slot's stored formula parsed
 * out toward Excel and accepts Excel-ish input back, with type-aware
 * suggestions (fxSuggest.ts) that always round-trip cleanly.
 *
 * The dialect module is refuse-don't-guess, so invalid input is rejected and
 * NEVER committed: a misclick or typo can't corrupt the formatter. Advanced
 * mode keeps the raw SP dialect (the inspector); a formula outside the Excel
 * subset shows read-only here with a "edit in Advanced" pointer.
 *
 * Comfort: the ⤢ button detaches the editor into a roomy floating panel so it's
 * never a cramped single line. One commit = one undoable document mutation.
 */

import { state } from './state';
import { slotsFor, readSlot, writeSlot, type FxSlot } from './fxSlots';
import { fxSuggestions } from './fxSuggest';
import { excelToSp, spToExcel } from './dialect';
import type { SPExpr } from '../core/types';

type Tone = 'hint' | 'error' | 'ok' | 'raw';
type SetFeedback = (text: string, tone?: Tone) => void;

export function mountFxBar(host: HTMLElement): void {
  host.classList.add('wb-fxbar');
  /** Which slot is being edited — kept across selections so "Fill color" sticks. */
  let currentSlotId: string | null = null;
  /** Skip the rebuild triggered by our own commit, so focus stays in the editor. */
  let selfCommit = false;
  /** The detached floating editor, when open. */
  let float: { panel: HTMLElement; cleanup: () => void } | null = null;

  const closeFloat = (): void => {
    if (!float) return;
    float.cleanup();
    float.panel.remove();
    float = null;
  };

  const render = (): void => {
    closeFloat();
    host.innerHTML = '';
    const node = state.selectedNode;
    if (!node) {
      host.appendChild(message('Select a cell to format it.'));
      return;
    }
    const slots = slotsFor(node);
    if (!slots.length) {
      host.appendChild(message('This element has no formattable slots.'));
      return;
    }
    const slot = slots.find((s) => s.id === currentSlotId) ?? slots[0];
    currentSlotId = slot.id;

    // ── ƒx badge ──
    const badge = document.createElement('span');
    badge.className = 'wb-fx-badge';
    badge.textContent = 'ƒx';
    badge.title = 'Write an Excel-style formula for the selected property.';

    // ── slot picker (left-edge property dropdown) ──
    // ● marks slots that already carry a value on this element, ○ those that
    // don't — an at-a-glance map of what's set without opening each one.
    const picker = document.createElement('select');
    picker.className = 'wb-fx-slot';
    picker.title = 'Which property this formula paints. ● = already has a value on this cell · ○ = not set. The list changes with what you’ve selected.';
    for (const s of slots) {
      const o = document.createElement('option');
      o.value = s.id;
      o.textContent = `${readSlot(node, s) === undefined ? '○' : '●'} ${s.label}`;
      if (s.id === slot.id) o.selected = true;
      picker.appendChild(o);
    }
    picker.addEventListener('change', () => { currentSlotId = picker.value; render(); });

    // ── the editor (Excel dialect) ──
    const stored = readSlot(node, slot);
    const view = toEditorView(stored);
    const suggestions = fxSuggestions(slot, state.fields);
    const placeholder = slotPlaceholder(slot, suggestions);

    const editor = document.createElement('textarea');
    editor.className = 'wb-fx-editor';
    editor.rows = 1;
    editor.spellcheck = false;
    editor.value = view.text;
    editor.placeholder = placeholder;
    editor.readOnly = view.readOnly;

    // ── feedback line: the slot promise, or an error / raw-only note ──
    const feedback = document.createElement('div');
    feedback.className = 'wb-fx-feedback';
    const setFeedback: SetFeedback = (text, tone = 'hint') => {
      feedback.textContent = text;
      feedback.dataset.tone = tone;
    };
    if (view.readOnly) setFeedback(`Shown read-only — ${view.note} Edit it in Advanced mode.`, 'raw');
    else setFeedback(slot.hint, 'hint');

    // Apply text to the slot — refuse-don't-guess: a refusal never mutates.
    const applyText = (text: string, setFb: SetFeedback): boolean => {
      const trimmed = text.trim();
      let spValue: SPExpr | undefined;
      if (trimmed === '') {
        spValue = undefined;
      } else if (trimmed.startsWith('=')) {
        const r = excelToSp(trimmed, state.fields);
        if (!r.ok) { setFb(r.reason, 'error'); return false; }
        spValue = r.value;
      } else {
        spValue = text; // a plain literal value is stored as-is
      }
      selfCommit = true;
      state.mutateDocument(() => writeSlot(node, slot, spValue));
      selfCommit = false;
      setFb('✓ Applied.', 'ok');
      return true;
    };

    if (!editor.readOnly) {
      editor.addEventListener('change', () => applyText(editor.value, setFeedback));
      editor.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); applyText(editor.value, setFeedback); editor.blur(); }
      });
    }

    // ── visible value choices: click a chip to drop it in (and apply) ──
    // Datalist can't attach to a <textarea>, so the suggestions are real chips
    // — discoverable without typing, the playground's pick-a-value feel.
    const chips = buildChips(suggestions, view.readOnly, (value) => {
      editor.value = value;
      if (applyText(value, setFeedback)) editor.focus();
    });

    // ── ⤢ detach into a roomy floating editor (never a cramped single line) ──
    const expand = document.createElement('button');
    expand.className = 'wb-fx-expand';
    expand.type = 'button';
    expand.textContent = '⤢';
    expand.title = 'Open a roomy editor — more space to write and read a longer formula';
    expand.addEventListener('click', () => {
      closeFloat();
      float = openFloat(expand, slot, editor.value, view, suggestions, placeholder, applyText, () => render());
    });

    const bar = document.createElement('div');
    bar.className = 'wb-fx-row';
    bar.append(badge, picker, editor, expand);
    host.append(bar, feedback);
    if (chips) host.append(chips);
  };

  state.subscribe((reason) => {
    if (reason === 'document' && selfCommit) return;
    if (reason === 'selection' || reason === 'load' || reason === 'document'
      || reason === 'data' || reason === 'kind') render();
  });
  render();
}

// ─── the floating / detached editor ──────────────────────────────────────────

function openFloat(
  anchor: HTMLElement,
  slot: FxSlot,
  initial: string,
  view: EditorView,
  suggestions: string[],
  placeholder: string,
  applyText: (text: string, setFb: SetFeedback) => boolean,
  onApplied: () => void,
): { panel: HTMLElement; cleanup: () => void } {
  const panel = document.createElement('div');
  panel.className = 'wb-fx-float';

  const head = document.createElement('div');
  head.className = 'wb-fx-float-head';
  head.innerHTML = `<span class="wb-fx-badge">ƒx</span> ${slot.label}`;

  const ta = document.createElement('textarea');
  ta.className = 'wb-fx-float-editor';
  ta.rows = 8;
  ta.spellcheck = false;
  ta.value = initial;
  ta.placeholder = placeholder;
  ta.readOnly = view.readOnly;

  const fb = document.createElement('div');
  fb.className = 'wb-fx-feedback';
  const setFb: SetFeedback = (text, tone = 'hint') => { fb.textContent = text; fb.dataset.tone = tone; };
  if (view.readOnly) setFb(`Read-only — ${view.note} Edit it in Advanced mode.`, 'raw');
  else setFb(`${slot.hint}  ·  Enter applies · Shift+Enter for a new line`, 'hint');

  // chips fill the editor (the Apply button commits) — visible value choices
  const chips = buildChips(suggestions, view.readOnly, (value) => { ta.value = value; ta.focus(); });

  const foot = document.createElement('div');
  foot.className = 'wb-fx-float-foot';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'wb-fx-float-cancel';
  cancel.textContent = 'Cancel';
  const apply = document.createElement('button');
  apply.type = 'button';
  apply.className = 'wb-fx-float-apply';
  apply.textContent = 'Apply';
  apply.disabled = view.readOnly;
  foot.append(cancel, apply);

  panel.append(head, ta, fb);
  if (chips) panel.append(chips);
  panel.append(foot);
  document.body.appendChild(panel);

  // position under the anchor, kept on-screen
  const r = anchor.getBoundingClientRect();
  panel.style.top = `${Math.min(r.bottom + 6, Math.max(8, window.innerHeight - 240))}px`;
  panel.style.left = `${Math.max(8, Math.min(r.left - 360, window.innerWidth - 380))}px`;

  let done = false;
  const close = (): void => { if (!done) { done = true; cleanup(); panel.remove(); } };
  const doApply = (): void => { if (applyText(ta.value, setFb)) { onApplied(); /* render() removes panel */ } };

  apply.addEventListener('click', doApply);
  cancel.addEventListener('click', close);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doApply(); }
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  const onOutside = (e: PointerEvent): void => {
    if (!panel.contains(e.target as Node) && e.target !== anchor) close();
  };
  // defer so the opening click doesn't immediately close it
  setTimeout(() => document.addEventListener('pointerdown', onOutside), 0);
  const cleanup = (): void => document.removeEventListener('pointerdown', onOutside);

  ta.focus();
  return { panel, cleanup };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

interface EditorView { text: string; readOnly: boolean; note: string }

/** Render a stored slot value into the Excel-dialect editor (or read-only raw). */
function toEditorView(stored: SPExpr | undefined): EditorView {
  if (stored === undefined) return { text: '', readOnly: false, note: '' };
  if (typeof stored !== 'string') {
    return { text: JSON.stringify(stored), readOnly: true, note: 'this slot holds an AST-form formula.' };
  }
  if (stored.startsWith('=')) {
    const r = spToExcel(stored, state.fields);
    if (r.ok) return { text: r.value, readOnly: false, note: '' };
    return { text: stored, readOnly: true, note: r.reason };
  }
  return { text: stored, readOnly: false, note: '' }; // a plain literal
}

/** A row of clickable value choices for the slot, or null when there are none. */
function buildChips(
  suggestions: string[],
  readOnly: boolean,
  onPick: (value: string) => void,
): HTMLElement | null {
  if (readOnly || suggestions.length === 0) return null;
  const row = document.createElement('div');
  row.className = 'wb-fx-sugs';
  // Cap the chips so the bar stays one tidy row; the editor + datalist-style
  // typeahead still reach the long tail. (Deliberate — not a paging bug.)
  for (const value of suggestions.slice(0, 10)) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'wb-fx-sug';
    chip.textContent = value;
    chip.title = value.startsWith('=') ? `Use this formula: ${value}` : `Use the value ${value}`;
    // Don't let the mousedown blur the editor first — otherwise a typed-but-
    // uncommitted value would commit on blur, then the chip again = two undos.
    chip.addEventListener('mousedown', (e) => e.preventDefault());
    chip.addEventListener('click', () => onPick(value));
    row.appendChild(chip);
  }
  return row;
}

/** A slot-specific placeholder: a real example value for THIS property. */
function slotPlaceholder(slot: FxSlot, suggestions: string[]): string {
  const formula = suggestions.find((s) => s.startsWith('='));
  const literal = suggestions.find((s) => !s.startsWith('='));
  if (slot.kind === 'text') return formula ? `Plain text, or ${formula}` : 'Plain text';
  if (slot.kind === 'attr') return formula ? `A URL, or ${formula}` : 'A web address (URL)';
  if (literal && formula) return `${literal}, or a formula`;
  if (literal) return `e.g. ${literal}`;
  if (formula) return formula;
  return 'A value, or a formula';
}

function message(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'wb-fx-empty';
  el.textContent = text;
  return el;
}
