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
      host.appendChild(message('Select a cell to format how every row looks.'));
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
    const picker = document.createElement('select');
    picker.className = 'wb-fx-slot';
    picker.title = 'Which property this formula paints — the list changes with what you’ve selected';
    for (const s of slots) {
      const o = document.createElement('option');
      o.value = s.id;
      o.textContent = s.label;
      if (s.id === slot.id) o.selected = true;
      picker.appendChild(o);
    }
    picker.addEventListener('change', () => { currentSlotId = picker.value; render(); });

    // ── the editor (Excel dialect) ──
    const stored = readSlot(node, slot);
    const view = toEditorView(stored);
    const placeholder = slot.kind === 'text'
      ? 'Plain text, or =IF([Status]="Done","Done ✓","")'
      : '=IF([Status]="Done","#107c10","#d13438")  ·  or a plain value';

    const editor = document.createElement('textarea');
    editor.className = 'wb-fx-editor';
    editor.rows = 1;
    editor.spellcheck = false;
    editor.value = view.text;
    editor.placeholder = placeholder;
    editor.readOnly = view.readOnly;

    // type-aware suggestions that fit this slot (and round-trip cleanly)
    const dl = document.createElement('datalist');
    dl.id = `wb-fx-dl-${slotKeyId(slot)}`;
    for (const value of fxSuggestions(slot, state.fields)) {
      const o = document.createElement('option');
      o.value = value;
      dl.appendChild(o);
    }
    editor.setAttribute('list', dl.id);

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
      setFb('✓ Applied to every row.', 'ok');
      return true;
    };

    if (!editor.readOnly) {
      editor.addEventListener('change', () => applyText(editor.value, setFeedback));
      editor.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); applyText(editor.value, setFeedback); editor.blur(); }
      });
    }

    // ── ⤢ detach into a roomy floating editor (never a cramped single line) ──
    const expand = document.createElement('button');
    expand.className = 'wb-fx-expand';
    expand.type = 'button';
    expand.textContent = '⤢';
    expand.title = 'Open a roomy editor — more space to write and read a longer formula';
    expand.addEventListener('click', () => {
      closeFloat();
      float = openFloat(expand, slot, editor.value, view, dl.id, placeholder, applyText, () => render());
    });

    const bar = document.createElement('div');
    bar.className = 'wb-fx-row';
    bar.append(badge, picker, editor, dl, expand);
    host.append(bar, feedback);
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
  listId: string,
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
  ta.setAttribute('list', listId);

  const fb = document.createElement('div');
  fb.className = 'wb-fx-feedback';
  const setFb: SetFeedback = (text, tone = 'hint') => { fb.textContent = text; fb.dataset.tone = tone; };
  if (view.readOnly) setFb(`Read-only — ${view.note} Edit it in Advanced mode.`, 'raw');
  else setFb(`${slot.hint}  ·  Enter applies · Shift+Enter for a new line`, 'hint');

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

  panel.append(head, ta, fb, foot);
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

function slotKeyId(slot: FxSlot): string {
  return slot.id.replace(/[^a-z0-9]/gi, '-');
}

function message(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'wb-fx-empty';
  el.textContent = text;
  return el;
}
