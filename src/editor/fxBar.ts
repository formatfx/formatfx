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
import { openIconPicker } from './iconPicker';
import type { SPExpr } from '../core/types';

type Tone = 'hint' | 'error' | 'ok' | 'raw';
type SetFeedback = (text: string, tone?: Tone) => void;

export function mountFxBar(host: HTMLElement, opts: { accessory?: HTMLElement } = {}): void {
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

  // The accessory (Title-column toggle) rides on the edit bar; re-home it on
  // every rebuild so it survives the host.innerHTML reset.
  const placeAccessory = (): void => { if (opts.accessory) host.appendChild(opts.accessory); };

  const render = (): void => {
    // The detached editor is a free-floating tool window now — it stays put
    // across selections and clicks elsewhere, so render() leaves it alone.
    host.innerHTML = '';
    const node = state.selectedNode;
    if (!node) {
      host.appendChild(message('Select a cell to format it.'));
      placeAccessory();
      return;
    }
    const slots = slotsFor(node);
    if (!slots.length) {
      host.appendChild(message('This element has no formattable slots.'));
      placeAccessory();
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
    // Slots that already carry a value on this element are shown in heavy bold,
    // the rest in the normal weight — an at-a-glance map of what's set.
    const picker = document.createElement('select');
    picker.className = 'wb-fx-slot';
    picker.title = 'Which property this formula paints. Bold = already has a value on this cell. The list changes with what you have selected.';
    for (const s of slots) {
      const o = document.createElement('option');
      o.value = s.id;
      o.textContent = s.label;
      // heavy bold marks a slot that already carries a value (native <option>
      // honors font-weight in Chromium/Firefox)
      if (readSlot(node, s) !== undefined) o.style.fontWeight = '800';
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
    const onPickValue = (value: string): void => {
      editor.value = value;
      if (applyText(value, setFeedback)) editor.focus();
    };
    // the Icon slot gets preview chips + a one-click gallery of every SP icon
    const currentIcon = typeof stored === 'string' && !stored.startsWith('=') ? stored : undefined;
    const chips = slot.picker === 'icon'
      ? buildIconChips(suggestions, view.readOnly, currentIcon, onPickValue)
      : buildChips(suggestions, view.readOnly, onPickValue);

    // ── ⤢ detach into a roomy floating editor (never a cramped single line) ──
    const expand = document.createElement('button');
    expand.className = 'wb-fx-expand';
    expand.type = 'button';
    expand.textContent = '⤢';
    expand.title = 'Open a roomy editor — more space to write and read a longer formula';
    expand.addEventListener('click', () => {
      closeFloat();
      float = openFloat(node, nameOfNode(node, slot), expand, slot, editor.value, view, suggestions, placeholder, applyText, () => render());
    });

    const bar = document.createElement('div');
    bar.className = 'wb-fx-row';
    bar.append(badge, picker, editor, expand);
    if (opts.accessory) bar.append(opts.accessory);
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

/** A readable label for the float head — which element & property it edits. */
function nameOfNode(node: { _elmName?: string; elmType?: string }, slot: FxSlot): string {
  const el = node._elmName ?? `<${node.elmType ?? 'element'}>`;
  return `${el} · ${slot.label}`;
}

/**
 * Unapplied float text, stashed per element + slot. Dismissing the window with
 * ✕ keeps what you typed (without committing it) so reopening resumes it — only
 * Apply touches the formatter.
 */
const floatStash = new WeakMap<object, Record<string, string>>();

function openFloat(
  node: object,
  targetLabel: string,
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

  // ── draggable head, with a non-destructive ✕ dismiss ──
  const head = document.createElement('div');
  head.className = 'wb-fx-float-head';
  const title = document.createElement('span');
  title.className = 'wb-fx-float-title';
  title.innerHTML = `<span class="wb-fx-badge">ƒx</span> ${targetLabel}`;
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'wb-fx-float-dismiss';
  dismiss.textContent = '✕';
  dismiss.title = 'Dismiss this window — what you typed is kept (unapplied) until you reopen it. Use Apply to commit.';
  head.append(title, dismiss);

  const ta = document.createElement('textarea');
  ta.className = 'wb-fx-float-editor';
  ta.rows = 8;
  ta.spellcheck = false;
  // resume any stash for this element + slot, falling back to the live value
  ta.value = floatStash.get(node)?.[slot.id] ?? initial;
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
  const apply = document.createElement('button');
  apply.type = 'button';
  apply.className = 'wb-fx-float-apply';
  apply.textContent = 'Apply';
  apply.disabled = view.readOnly;
  foot.append(apply);

  panel.append(head, ta, fb);
  if (chips) panel.append(chips);
  panel.append(foot);
  document.body.appendChild(panel);

  // position under the anchor, kept on-screen
  const r = anchor.getBoundingClientRect();
  panel.style.top = `${Math.min(r.bottom + 6, Math.max(8, window.innerHeight - 240))}px`;
  panel.style.left = `${Math.max(8, Math.min(r.left - 360, window.innerWidth - 380))}px`;

  let done = false;
  // Dismiss keeps the typed text (unapplied) so it resumes on reopen; clearing
  // the box clears the stash, so a wiped editor doesn't haunt the next open.
  const dismissWin = (): void => {
    if (done) return;
    done = true;
    if (!view.readOnly) {
      const stash = floatStash.get(node) ?? {};
      if (ta.value.trim() === initial.trim()) delete stash[slot.id];
      else stash[slot.id] = ta.value;
      if (Object.keys(stash).length) floatStash.set(node, stash);
      else floatStash.delete(node);
    }
    cleanup();
    panel.remove();
  };
  const doApply = (): void => {
    if (!applyText(ta.value, setFb)) return;
    // committed — it's no longer an unapplied stash
    const stash = floatStash.get(node);
    if (stash) { delete stash[slot.id]; if (!Object.keys(stash).length) floatStash.delete(node); }
    onApplied(); // refresh the inline bar; the window stays open
  };

  apply.addEventListener('click', doApply);
  dismiss.addEventListener('click', dismissWin);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doApply(); }
    if (e.key === 'Escape') { e.preventDefault(); dismissWin(); }
  });

  // ── drag by the head (anywhere but the ✕) ──
  let drag: { dx: number; dy: number } | null = null;
  const onMove = (e: PointerEvent): void => {
    if (!drag) return;
    const x = Math.max(8, Math.min(window.innerWidth - panel.offsetWidth - 8, e.clientX - drag.dx));
    const y = Math.max(8, Math.min(window.innerHeight - 40, e.clientY - drag.dy));
    panel.style.left = `${x}px`;
    panel.style.top = `${y}px`;
  };
  const onUp = (e: PointerEvent): void => {
    drag = null;
    head.releasePointerCapture(e.pointerId);
    document.removeEventListener('pointermove', onMove);
  };
  head.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('.wb-fx-float-dismiss')) return;
    e.preventDefault();
    const box = panel.getBoundingClientRect();
    drag = { dx: e.clientX - box.left, dy: e.clientY - box.top };
    head.setPointerCapture(e.pointerId);
    document.addEventListener('pointermove', onMove);
  });
  head.addEventListener('pointerup', onUp);

  const cleanup = (): void => document.removeEventListener('pointermove', onMove);

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

/**
 * The Icon slot's chips: a few common icons shown WITH their preview glyph,
 * plus a "Browse all icons" button that opens the full searchable gallery.
 */
function buildIconChips(
  suggestions: string[],
  readOnly: boolean,
  current: string | undefined,
  onPick: (value: string) => void,
): HTMLElement | null {
  if (readOnly) return null;
  const row = document.createElement('div');
  row.className = 'wb-fx-sugs wb-fx-iconsugs';

  for (const name of suggestions.slice(0, 12)) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'wb-fx-sug wb-fx-iconsug' + (name === current ? ' selected' : '');
    // name first, then a colon, then the glyph — reads as "this is the Edit
    // icon", not an Edit button that does something when clicked
    chip.innerHTML = `<span>${name}:</span><i class="ms-Icon ms-Icon--${name}" aria-hidden="true"></i>`;
    chip.title = `Use the ${name} icon`;
    chip.addEventListener('mousedown', (e) => e.preventDefault());
    chip.addEventListener('click', () => onPick(name));
    row.appendChild(chip);
  }

  const browse = document.createElement('button');
  browse.type = 'button';
  browse.className = 'wb-fx-sug wb-fx-iconbrowse';
  browse.textContent = '⊞ All icons…';
  browse.title = 'Browse and search every icon SharePoint can render — with previews';
  browse.addEventListener('mousedown', (e) => e.preventDefault());
  browse.addEventListener('click', () => {
    openIconPicker({ anchor: browse, current, title: 'Pick an icon', onPick });
  });
  row.appendChild(browse);
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
