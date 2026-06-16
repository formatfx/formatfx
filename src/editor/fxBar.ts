/**
 * editor/fxBar.ts — the Sheet fx bar (Sheet stage 2, surfaced).
 *
 * The Basic/Sheet counterpart to the inspector: edit the selected element one
 * PROPERTY SLOT at a time, in the Excel dialect people already read. The left
 * dropdown (the Name-Box, done right) picks the slot — "Text shown", "Fill
 * color", "Left border" … ; the editor shows that slot's stored formula parsed
 * out toward Excel and accepts Excel-ish input back.
 *
 * The bar FORMATS, it never sets values — that's said out loud in the chrome
 * and in every slot hint ("every row · formatting only"). The dialect module
 * is refuse-don't-guess, so invalid input is rejected and NEVER committed: a
 * misclick or typo can't corrupt the formatter. Advanced mode keeps the raw SP
 * dialect (the inspector); a formula outside the Excel subset shows read-only
 * here with a "edit in Advanced" pointer.
 *
 * One commit = one undoable document mutation (state.mutateDocument).
 */

import { state } from './state';
import { slotsFor, readSlot, writeSlot, type FxSlot } from './fxSlots';
import { excelToSp, spToExcel } from './dialect';
import type { SPExpr } from '../core/types';

export function mountFxBar(host: HTMLElement): void {
  host.classList.add('wb-fxbar');
  /** Which slot is being edited — kept across selections so "Fill color" sticks. */
  let currentSlotId: string | null = null;
  let expanded = false;
  /** Skip the rebuild triggered by our own commit, so focus stays in the editor. */
  let selfCommit = false;

  const render = (): void => {
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

    // ── ƒx badge — the "formats, never sets values" promise ──
    const badge = document.createElement('span');
    badge.className = 'wb-fx-badge';
    badge.textContent = 'ƒx';
    badge.title = 'The formula bar paints how every row LOOKS. It never changes a column’s stored value.';

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

    const editor = document.createElement('textarea');
    editor.className = 'wb-fx-editor' + (expanded ? ' wb-fx-expanded' : '');
    editor.rows = expanded ? 6 : 1;
    editor.spellcheck = false;
    editor.value = view.text;
    editor.placeholder = slot.kind === 'text'
      ? 'Plain text, or =IF([Status]="Done","Done ✓","")'
      : '=IF([Status]="Done","#107c10","#d13438")  ·  or a plain value';
    editor.readOnly = view.readOnly;

    // field-reference suggestions in the Excel bracket form
    const dl = document.createElement('datalist');
    dl.id = `wb-fx-dl-${slotKeyId(slot)}`;
    for (const f of state.fields) {
      const o = document.createElement('option');
      o.value = `[${f.displayName ?? f.name}]`;
      dl.appendChild(o);
    }
    editor.setAttribute('list', dl.id);

    // ── feedback line: the slot promise, or an error / raw-only note ──
    const feedback = document.createElement('div');
    feedback.className = 'wb-fx-feedback';
    const setFeedback = (text: string, tone: 'hint' | 'error' | 'ok' | 'raw' = 'hint') => {
      feedback.textContent = text;
      feedback.dataset.tone = tone;
    };
    if (view.readOnly) setFeedback(`Shown read-only — ${view.note} Edit it in Advanced mode.`, 'raw');
    else setFeedback(slot.hint, 'hint');

    const commit = (): void => {
      if (editor.readOnly) return;
      const text = editor.value;
      const trimmed = text.trim();
      let spValue: SPExpr | undefined;
      if (trimmed === '') {
        spValue = undefined;
      } else if (trimmed.startsWith('=')) {
        const r = excelToSp(trimmed, state.fields);
        if (!r.ok) { setFeedback(r.reason, 'error'); return; } // refuse: do NOT mutate
        spValue = r.value;
      } else {
        spValue = text; // a plain literal value is stored as-is
      }
      selfCommit = true;
      state.mutateDocument(() => writeSlot(node, slot, spValue));
      selfCommit = false;
      setFeedback('✓ Applied to every row.', 'ok');
    };
    editor.addEventListener('change', commit);
    editor.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); editor.blur(); }
    });

    // ── expand toggle (never a cramped single line) ──
    const expand = document.createElement('button');
    expand.className = 'wb-fx-expand';
    expand.type = 'button';
    expand.textContent = expanded ? '⤡' : '⤢';
    expand.title = expanded ? 'Collapse the editor' : 'Expand the editor — room to write a longer formula';
    expand.addEventListener('click', () => { expanded = !expanded; render(); });

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
