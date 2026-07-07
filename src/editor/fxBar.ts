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
import { slotsFor, readSlot, writeSlot, slotIdForProp, type FxSlot } from './fxSlots';
import { fxSuggestions, completionAt, excelColumnRef, type CompletionOpts } from './fxSuggest';
import { excelToSp, spToExcel } from './dialect';
import { openIconPicker } from './iconPicker';
import { openAcMenu, type AcMenu } from './acMenu';
import { ctxForRow } from './previewCtx';
import { FIELD_MIME } from './templateUi';
import type { SPExpr } from '../core/types';

type Tone = 'hint' | 'error' | 'ok' | 'raw';
type SetFeedback = (text: string, tone?: Tone) => void;

/** How long a refusal lingers before it fades on its own (ms) — long enough to
 *  read, short enough not to nag. It also clears the instant the maker types. */
const FEEDBACK_FADE_MS = 6000;

/** The mounted bar's "dock onto this property" handler, so other panels (the
 *  inspector's `=` formula preview) can hand a property to the fx bar. Null
 *  until mountFxBar runs; the app mounts exactly one bar. */
let dockOntoProp: ((prop: string) => void) | null = null;

/**
 * Dock the fx bar onto a given CSS property's slot and focus its editor — the
 * inspector's `=` formula preview calls this so a maker can edit the same
 * formula in the bar (with its column / function autocomplete). The element
 * must already be selected (the bar reads state.selectedNode). Returns false
 * when no bar is mounted, so callers can fall back gracefully.
 */
export function focusFxSlot(prop: string): boolean {
  if (!dockOntoProp) return false;
  dockOntoProp(prop);
  return true;
}

export function mountFxBar(host: HTMLElement, opts: { accessory?: HTMLElement } = {}): void {
  host.classList.add('wb-fxbar');
  /** Which slot is being edited — kept across selections so "Fill color" sticks. */
  let currentSlotId: string | null = null;
  /** Skip the rebuild triggered by our own commit, so focus stays in the editor. */
  let selfCommit = false;
  /** The detached floating editor, when open. */
  let float: { panel: HTMLElement; cleanup: () => void } | null = null;
  /** The on-focus value drop-down, when open. */
  let menu: FxMenu | null = null;
  /** The as-you-type inline autocomplete menu, when open. */
  let acMenu: AcMenu | null = null;
  /** Pending auto-fade for a transient refusal message, if any. */
  let feedbackTimer: ReturnType<typeof setTimeout> | null = null;

  const closeFloat = (): void => {
    if (!float) return;
    float.cleanup();
    float.panel.remove();
    float = null;
  };
  const closeMenu = (): void => { if (menu) { menu.el.remove(); menu = null; } };
  const closeAc = (): void => { if (acMenu) { acMenu.close(); acMenu = null; } };

  // The accessory (Title-column toggle) rides on the edit bar; re-home it on
  // every rebuild so it survives the host.innerHTML reset.
  const placeAccessory = (): void => { if (opts.accessory) host.appendChild(opts.accessory); };

  const render = (focusAfter = false): void => {
    // The detached editor is a free-floating tool window now — it stays put
    // across selections and clicks elsewhere, so render() leaves it alone. The
    // on-focus value menu, however, belongs to this bar's editor — drop it.
    closeMenu();
    closeAc();
    if (feedbackTimer) { clearTimeout(feedbackTimer); feedbackTimer = null; }
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
    // Slots with a value show a suffix: "ƒ" for formula-driven (a '=...' string
    // or an AST-object); "·" for static literals (plain strings, numbers,
    // booleans). Both also get heavy bold. This works in the closed select and
    // across browsers (font-weight on <option> is invisible when closed and
    // unsupported in Safari; the bold is an additional open-state signal only).
    const picker = document.createElement('select');
    picker.className = 'wb-fx-slot';
    picker.title = 'Which property this formula paints. ƒ = formula-driven · = has a static value. The list changes with what you have selected.';
    for (const s of slots) {
      const o = document.createElement('option');
      o.value = s.id;
      const sv = readSlot(node, s);
      const hasValue = sv !== undefined;
      const isFormula = hasValue && (
        (typeof sv === 'string' && sv.startsWith('=')) ||
        (typeof sv === 'object' && sv !== null)
      );
      o.textContent = isFormula ? `${s.label} ƒ` : hasValue ? `${s.label} ·` : s.label;
      if (hasValue) o.style.fontWeight = '800';
      if (s.id === slot.id) o.selected = true;
      picker.appendChild(o);
    }
    picker.addEventListener('change', () => { currentSlotId = picker.value; render(true); });

    // ── the editor (Excel dialect) ──
    const stored = readSlot(node, slot);
    const view = toEditorView(stored);
    const suggestions = fxSuggestions(slot, state.fields);
    const placeholder = slotPlaceholder(slot, suggestions);
    // a literal icon name currently on the cell (so the menu marks it selected)
    const currentIcon = typeof stored === 'string' && !stored.startsWith('=') ? stored : undefined;

    const editor = document.createElement('textarea');
    editor.className = 'wb-fx-editor';
    editor.rows = 1;
    editor.spellcheck = false;
    editor.value = view.text;
    editor.placeholder = placeholder;
    editor.readOnly = view.readOnly;

    // ── feedback line: silent unless something's wrong ──
    // No slot hint, no draft nudge, no "applied" — the bar speaks only to
    // REFUSE input (refuse-and-teach). A refusal shows in red, fades on its own
    // after a readable beat, clears the instant the maker starts fixing it, and
    // carries a ✕ to dismiss now. A read-only note is a persistent condition, so
    // it stays put (no fade, no ✕).
    const feedback = document.createElement('div');
    feedback.className = 'wb-fx-feedback';
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');
    const clearFeedback = (): void => {
      if (feedbackTimer) { clearTimeout(feedbackTimer); feedbackTimer = null; }
      feedback.textContent = '';
      feedback.removeAttribute('data-tone');
      feedback.setAttribute('role', 'status');
      feedback.setAttribute('aria-live', 'polite');
    };
    const setFeedback: SetFeedback = (text, tone = 'hint') => {
      if (feedbackTimer) { clearTimeout(feedbackTimer); feedbackTimer = null; }
      feedback.textContent = text;
      feedback.dataset.tone = tone;
      // only a refusal is transient + dismissable; a read-only note stays.
      if (tone === 'error') {
        feedback.setAttribute('role', 'alert');
        feedback.setAttribute('aria-live', 'assertive');
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'wb-fx-feedback-x';
        x.textContent = '✕';
        x.title = 'Dismiss';
        x.setAttribute('aria-label', 'Dismiss');
        x.addEventListener('mousedown', (e) => e.preventDefault());
        x.addEventListener('click', clearFeedback);
        feedback.appendChild(x);
        feedbackTimer = setTimeout(clearFeedback, FEEDBACK_FADE_MS);
      }
    };

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
      editor.classList.remove('wb-fx-draft');
      return true; // success is silent — the value visibly applies
    };

    // ── type for the user: pre-populate the bar with the best default ──
    // The smartest choice for THIS property is dropped straight into the bar as a
    // MUTED, UNCOMMITTED draft — visible, ready to accept with Enter, or type
    // over. It is never written to the document until the user acts, so a misclick
    // can't corrupt the formatter (click-only safety).
    const best = stored === undefined ? bestDefault(slot, suggestions) : undefined;
    const draftable = !view.readOnly && best !== undefined;
    if (draftable) {
      editor.value = best!;
      editor.classList.add('wb-fx-draft');
    }
    editor.addEventListener('input', () => {
      editor.classList.remove('wb-fx-draft');
      // typing again = "I'm fixing it" → drop a lingering refusal at once.
      if (feedback.dataset.tone === 'error') clearFeedback();
    });

    // Silent by default. The one thing that can't vanish is a read-only note —
    // it explains why the field can't be edited here and where to go instead.
    if (view.readOnly) {
      setFeedback(`Shown read-only — ${view.note}`, 'raw');
      feedback.appendChild(advancedLink());
    }

    // ── the value menu: a styled drop-down, shown only while the bar is focused.
    // No permanent wall of buttons under the bar — the choices appear on demand,
    // and each is drawn to look like the property it sets (a colour swatch, a
    // sample weight/size, a bordered box). Click or Enter to apply.
    const onPickValue = (value: string): void => {
      editor.value = value;
      editor.classList.remove('wb-fx-draft');
      if (applyText(value, setFeedback)) editor.focus();
      closeMenu();
    };

    // ── inline autocomplete: column refs, system @tokens (with inline docs +
    // live mock previews, #222), and IF() condition / result templates appear
    // as you type a formula. Previews evaluate against the data editor's
    // first mock row via the shared preview context.
    const acOpts = (): CompletionOpts => ({
      current: state.fields.find((f) => f.name === state.currentFieldName),
      ctx: state.rows.length ? ctxForRow(0) : undefined,
    });
    const updateAc = (): void => {
      if (view.readOnly) { closeAc(); return; }
      const caret = editor.selectionStart ?? editor.value.length;
      const comp = completionAt(editor.value, caret, slot, state.fields, acOpts());
      if (!comp || comp.items.length === 0) { closeAc(); return; }
      closeMenu(); // the inline typeahead supersedes the on-focus value menu
      closeAc();
      const pick = (value: string): void => {
        const v = editor.value;
        editor.value = v.slice(0, comp.from) + value + v.slice(comp.to);
        editor.classList.remove('wb-fx-draft');
        const pos = comp.from + value.length;
        editor.setSelectionRange(pos, pos);
        editor.focus();
        updateAc(); // chain: picking 'IF(' immediately offers the condition list
      };
      acMenu = openAcMenu(editor, comp.items, pick);
    };

    if (!view.readOnly) {
      editor.addEventListener('focus', () => {
        if (menu || acMenu || suggestions.length === 0) return;
        menu = openMenu(editor, slot, suggestions, currentIcon, onPickValue);
      });
      editor.addEventListener('blur', () => { closeMenu(); closeAc(); });
      editor.addEventListener('input', updateAc);
      editor.addEventListener('change', () => applyText(editor.value, setFeedback));
      editor.addEventListener('keydown', (e) => {
        if (acMenu) {
          if (e.key === 'ArrowDown') { e.preventDefault(); acMenu.move(1); return; }
          if (e.key === 'ArrowUp') { e.preventDefault(); acMenu.move(-1); return; }
          if (e.key === 'Escape') { e.preventDefault(); closeAc(); return; }
          if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
            if (acMenu.accept()) { e.preventDefault(); return; }
          }
        }
        if (menu) {
          if (e.key === 'ArrowDown') { e.preventDefault(); menu.move(1); return; }
          if (e.key === 'ArrowUp') { e.preventDefault(); menu.move(-1); return; }
          if (e.key === 'Escape') { e.preventDefault(); closeMenu(); return; }
          if (e.key === 'Enter' && !e.shiftKey) {
            const v = menu.activeValue();
            if (v !== null) { e.preventDefault(); onPickValue(v); return; }
          }
        }
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
      closeMenu();
      closeFloat();
      float = openFloat(nameOfNode(node, slot), expand, slot, editor.value, view, suggestions, placeholder, applyText, () => render(), (text) => {
        float = null;
        editor.value = text;
        editor.classList.remove('wb-fx-draft');
        editor.focus();
        updateAc();
      });
    });

    // ── × clear-slot button: one-click remove when the slot has a set, editable value ──
    // The slot already accepts an empty commit (applyText('') → spValue=undefined →
    // writeSlot removes the key), but that requires select-all + delete + Enter.
    // This button does it in one gesture. It is hidden when the slot is empty
    // (nothing to clear) or read-only (AST/out-of-subset formula — clear via Advanced).
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'wb-fx-clear';
    clearBtn.textContent = '×';
    clearBtn.title = `Clear this ${slot.label} value (Ctrl+Z undoes)`;
    clearBtn.hidden = stored === undefined || view.readOnly;
    // Prevent the mousedown from blurring the editor before click fires,
    // matching the same guard used on every other bar button.
    clearBtn.addEventListener('mousedown', (e) => e.preventDefault());
    clearBtn.addEventListener('click', () => { applyText('', setFeedback); render(true); });

    const bar = document.createElement('div');
    bar.className = 'wb-fx-row';
    bar.append(badge, picker, editor, clearBtn, expand);
    if (opts.accessory) bar.append(opts.accessory);
    host.append(bar, feedback);
    if (focusAfter) editor.focus();
  };

  // let the inspector (and anything else) dock the bar onto a property slot
  dockOntoProp = (prop) => {
    currentSlotId = slotIdForProp(prop);
    render(true); // render() falls back to slots[0] if this element lacks the slot
    host.scrollIntoView({ block: 'nearest' });
  };

  const hostAny = host as any;
  if (typeof hostAny._unsub === 'function') {
    hostAny._unsub();
  }
  const unsub = state.subscribe((reason) => {
    if (reason === 'document' && selfCommit) return;
    if (reason === 'selection' || reason === 'load' || reason === 'document'
      || reason === 'data' || reason === 'kind') render();
  });
  hostAny._unsub = () => {
    unsub();
    dockOntoProp = null;
  };
  render();
}

// ─── the floating / detached editor ──────────────────────────────────────────

/** A readable label for the float head — which element & property it edits. */
function nameOfNode(node: { _elmName?: string; elmType?: string }, slot: FxSlot): string {
  const el = node._elmName ?? `<${node.elmType ?? 'element'}>`;
  return `${el} · ${slot.label}`;
}

function openFloat(
  targetLabel: string,
  anchor: HTMLElement,
  slot: FxSlot,
  initial: string,
  view: EditorView,
  suggestions: string[],
  placeholder: string,
  applyText: (text: string, setFb: SetFeedback) => boolean,
  onCommitted: () => void,
  onDock: (text: string) => void,
): { panel: HTMLElement; cleanup: () => void } {
  const panel = document.createElement('div');
  // wb-esc-owner: this window dismisses itself on Escape (the ta keydown
  // handler below) — see the convention comment in editor/overlay.ts.
  panel.className = 'wb-fx-float wb-esc-owner';

  // ── draggable head, with a dock (⤓) and a close (✕) ──
  const head = document.createElement('div');
  head.className = 'wb-fx-float-head';
  const title = document.createElement('span');
  title.className = 'wb-fx-float-title';
  const badge = document.createElement('span');
  badge.className = 'wb-fx-badge';
  badge.textContent = 'ƒx';
  title.append(badge, ` ${targetLabel}`);
  const dock = document.createElement('button');
  dock.type = 'button';
  dock.className = 'wb-fx-float-dock';
  dock.textContent = '⤓';
  dock.title = 'Dock back into the one-line bar — keep editing there';
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'wb-fx-float-dismiss';
  dismiss.textContent = '✕';
  dismiss.title = 'Close this editor (changes apply as you make them)';
  dismiss.setAttribute('aria-label', 'Close');
  head.append(title, dock, dismiss);

  const ta = document.createElement('textarea');
  ta.className = 'wb-fx-float-editor';
  ta.rows = 8;
  ta.spellcheck = false;
  ta.value = initial;
  ta.placeholder = placeholder;
  ta.readOnly = view.readOnly;

  const fb = document.createElement('div');
  fb.className = 'wb-fx-feedback';
  fb.setAttribute('role', 'status');
  fb.setAttribute('aria-live', 'polite');
  const setFb: SetFeedback = (text, tone = 'hint') => {
    fb.textContent = text;
    fb.dataset.tone = tone;
    fb.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    fb.setAttribute('aria-live', tone === 'error' ? 'assertive' : 'polite');
  };
  // typing again = "I'm fixing it" → drop a lingering refusal at once.
  const clearError = (): void => {
    if (fb.dataset.tone !== 'error') return;
    fb.textContent = '';
    delete fb.dataset.tone;
    fb.setAttribute('role', 'status');
    fb.setAttribute('aria-live', 'polite');
  };
  if (view.readOnly) {
    setFb(`Read-only — ${view.note}`, 'raw');
    fb.appendChild(advancedLink());
  } else setFb(`${slot.hint}  ·  Changes apply when you click away`, 'hint');

  // Commit like the inline bar: on change (fires on blur). Refuse-don't-guess —
  // a bad formula shows an error and never mutates. No Apply button.
  const commit = (): void => { if (applyText(ta.value, setFb)) onCommitted(); };

  // chips fill the editor with a COMPLETE value and commit it, like the inline
  // bar's value menu (a chip is a finished choice, not a token to keep editing).
  const chips = buildChips(suggestions, view.readOnly, (value) => {
    ta.value = value;
    if (applyText(value, setFb)) onCommitted();
    ta.focus();
  });

  panel.append(head, ta, fb);
  if (chips) panel.append(chips);
  document.body.appendChild(panel);

  // position under the anchor, kept on-screen
  const r = anchor.getBoundingClientRect();
  panel.style.top = `${Math.min(r.bottom + 6, Math.max(8, window.innerHeight - 240))}px`;
  panel.style.left = `${Math.max(8, Math.min(r.left - 360, window.innerWidth - 380))}px`;

  let done = false;
  const closeWin = (): void => {
    if (done) return;
    done = true;
    cleanup();
    panel.remove();
    onCommitted(); // re-render the inline bar so it reflects the committed value
  };
  const dockWin = (): void => {
    if (done) return;
    done = true;
    cleanup();
    panel.remove();
    onDock(ta.value); // hand the current text back to the inline bar
  };

  dismiss.addEventListener('click', closeWin);
  dock.addEventListener('click', dockWin);
  ta.addEventListener('input', clearError);
  ta.addEventListener('change', commit);
  ta.addEventListener('keydown', (e) => {
    // a roomy multiline editor: Enter inserts a new line; Escape closes.
    if (e.key === 'Escape') { e.preventDefault(); closeWin(); }
  });

  // ── drop a column chip (FIELD_MIME) to insert its reference at the drop point ──
  // Accept-gated per the repo convention: only claim the drop for a field payload.
  if (!view.readOnly) {
    const accepts = (e: DragEvent): boolean => !!e.dataTransfer?.types.includes(FIELD_MIME);
    ta.addEventListener('dragover', (e) => {
      if (!accepts(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
      ta.classList.add('wb-fx-float-drop');
    });
    ta.addEventListener('dragleave', () => ta.classList.remove('wb-fx-float-drop'));
    ta.addEventListener('drop', (e) => {
      ta.classList.remove('wb-fx-float-drop');
      if (!accepts(e)) return;
      e.preventDefault();
      const field = state.fields.find((f) => f.name === e.dataTransfer!.getData(FIELD_MIME));
      if (!field) return;
      const ref = excelColumnRef(field); // the Excel bracket form: [Display Name]
      if (ta.value.trim() === '') {
        // a bare drop onto an empty editor binds the whole column — a complete
        // formula, so apply it straight away (one gesture = one commit).
        ta.value = `=${ref}`;
        ta.setSelectionRange(ta.value.length, ta.value.length);
        clearError();
        if (applyText(ta.value, setFb)) onCommitted();
      } else {
        // mid-formula: splice the reference at the drop point like typed text;
        // it commits on the next change as the maker keeps building the formula.
        const at = dropCaret(ta, e);
        ta.value = ta.value.slice(0, at) + ref + ta.value.slice(at);
        ta.setSelectionRange(at + ref.length, at + ref.length);
        clearError();
      }
      ta.focus();
    });
  }

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
    if ((e.target as HTMLElement).closest('.wb-fx-float-dismiss, .wb-fx-float-dock')) return;
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

/** The text index a drop lands on inside the textarea — mapped from the pointer
 *  when the browser supports it, else the current caret (or end). */
function dropCaret(ta: HTMLTextAreaElement, e: DragEvent): number {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  try {
    if (typeof doc.caretPositionFromPoint === 'function') {
      const p = doc.caretPositionFromPoint(e.clientX, e.clientY);
      if (p && (p.offsetNode === ta || ta.contains(p.offsetNode))) return p.offset;
    } else if (typeof doc.caretRangeFromPoint === 'function') {
      const range = doc.caretRangeFromPoint(e.clientX, e.clientY);
      if (range && (range.startContainer === ta || ta.contains(range.startContainer))) return range.startOffset;
    }
  } catch { /* fall through to the caret / end fallback */ }
  return ta.selectionStart ?? ta.value.length;
}

/** One-click shortcut to open the Advanced panel from a read-only fx-bar note. */
function advancedLink(): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'wb-fx-adv-link';
  btn.textContent = 'Open Advanced';
  btn.title = 'Open the Advanced panel to edit this formula in the raw SP dialect';
  btn.addEventListener('click', () => {
    // The "Advanced" topbar toggle opens the validated-JSON pane — the raw-SP
    // escape hatch this link points at. (Was #wb-studio-toggle, which no longer
    // exists; the pane IS the JSON surface, so there's no separate tab to click.)
    const toggle = document.getElementById('wb-json-toggle') as HTMLButtonElement | null;
    if (toggle && !toggle.classList.contains('active')) toggle.click();
  });
  return btn;
}

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

// ─── the on-focus value menu (a styled drop-down of choices) ─────────────────

interface FxMenu {
  el: HTMLElement;
  /** Move the keyboard highlight by ±1 (wraps). */
  move: (delta: number) => void;
  /** The highlighted option's value, or null when nothing is highlighted. */
  activeValue: () => string | null;
}

/**
 * The drop-down of value choices for a slot — anchored under the editor and
 * alive only while the bar is focused. Each option is rendered to RESEMBLE the
 * property it sets (a colour swatch, a sample at that weight/size, a bordered
 * box) so the right one reads at a glance. Arrow keys highlight; click or Enter
 * applies. The Icon slot shows common icons with previews plus a one-click door
 * to the full searchable gallery.
 */
function openMenu(
  editor: HTMLElement,
  slot: FxSlot,
  suggestions: string[],
  currentIcon: string | undefined,
  onPick: (value: string) => void,
): FxMenu {
  const el = document.createElement('div');
  el.className = 'wb-fx-menu';

  // arrow-navigable value options (the icon "browse" row is clickable, not arrowed)
  const opts: { value: string; node: HTMLElement }[] = [];
  let active = -1;

  // keep focus in the editor while picking, so the click can't blur-commit first
  const wire = (node: HTMLElement, value: string): void => {
    node.addEventListener('mousedown', (e) => e.preventDefault());
    node.addEventListener('click', () => onPick(value));
    opts.push({ value, node });
  };

  if (slot.picker === 'icon') {
    for (const name of suggestions.slice(0, 12)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'wb-fx-menu-opt wb-fx-iconsug' + (name === currentIcon ? ' selected' : '');
      b.innerHTML = `<i class="ms-Icon ms-Icon--${name}" aria-hidden="true"></i><span class="wb-fx-opt-label">${name}</span>`;
      b.title = `Use the ${name} icon`;
      wire(b, name);
      el.appendChild(b);
    }
    const browse = document.createElement('button');
    browse.type = 'button';
    browse.className = 'wb-fx-menu-opt wb-fx-iconbrowse';
    browse.textContent = '⊞ All icons…';
    browse.title = 'Browse and search every icon SharePoint can render — with previews';
    browse.addEventListener('mousedown', (e) => e.preventDefault());
    browse.addEventListener('click', () => openIconPicker({ anchor: browse, current: currentIcon, title: 'Pick an icon', onPick }));
    el.appendChild(browse);
  } else {
    for (const value of suggestions.slice(0, 12)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'wb-fx-menu-opt';
      b.title = value.startsWith('=') ? `Use this formula: ${value}` : `Use the value ${value}`;
      fillOption(b, slot, value);
      wire(b, value);
      el.appendChild(b);
    }
  }

  const move = (delta: number): void => {
    if (!opts.length) return;
    if (active >= 0) opts[active].node.classList.remove('active');
    active = (active + delta + opts.length) % opts.length;
    const cur = opts[active].node;
    cur.classList.add('active');
    cur.scrollIntoView({ block: 'nearest' });
  };
  const activeValue = (): string | null => (active >= 0 ? opts[active].value : null);

  document.body.appendChild(el);
  const r = editor.getBoundingClientRect();
  el.style.top = `${Math.min(r.bottom + 4, window.innerHeight - 12)}px`;
  el.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - el.offsetWidth - 8))}px`;
  el.style.minWidth = `${Math.max(220, r.width)}px`;
  return { el, move, activeValue };
}

/** The single best default for a slot — what we pre-populate the bar with. */
function bestDefault(slot: FxSlot, suggestions: string[]): string | undefined {
  if (!suggestions.length) return undefined;
  const k = previewKind(slot);
  // colour / weight / border lead with a smart conditional template (the showcase
  // of "thinking for the user"); text & attributes lead with a column reference.
  if (k === 'code' || k === 'color' || k === 'weight' || k === 'border') return suggestions[0];
  // align / size / opacity / radius read best as a concrete literal value.
  return suggestions.find((s) => !s.startsWith('=')) ?? suggestions[0];
}

/** What a slot's values should look like in the menu. */
type PreviewKind = 'color' | 'weight' | 'size' | 'align' | 'opacity' | 'radius' | 'border' | 'generic' | 'code';
function previewKind(slot: FxSlot): PreviewKind {
  if (slot.kind !== 'style' || !slot.prop) return 'code';
  const p = slot.prop;
  if (p === 'font-weight') return 'weight';
  if (p === 'font-size') return 'size';
  if (p === 'text-align') return 'align';
  if (p === 'opacity') return 'opacity';
  if (p === 'border-radius') return 'radius';
  if (p.includes('border') || p === 'outline') return 'border';
  if (p.includes('color') || p === 'fill' || p === 'stroke' || p === 'background') return 'color';
  return 'generic';
}

/** Fill a menu option button with a property-styled preview + the value label. */
function fillOption(button: HTMLElement, slot: FxSlot, value: string): void {
  // a formula can't be previewed visually — flag it with the ƒx badge and show
  // the expression in monospace so it reads as "a rule", not a literal value.
  if (value.startsWith('=')) {
    const fx = document.createElement('span');
    fx.className = 'wb-fx-opt-fx';
    fx.textContent = 'ƒx';
    const code = document.createElement('span');
    code.className = 'wb-fx-opt-label wb-fx-opt-formula';
    code.textContent = value;
    button.append(fx, code);
    return;
  }
  const label = document.createElement('span');
  label.className = 'wb-fx-opt-label';
  label.textContent = value;
  let prev: HTMLElement | null = null;
  switch (previewKind(slot)) {
    case 'color': {
      prev = document.createElement('span');
      prev.className = 'wb-fx-prev wb-fx-swatch';
      prev.style.background = value;
      break;
    }
    case 'weight': { prev = box('Ab'); prev.style.fontWeight = value; break; }
    case 'size': { prev = box('Ab'); prev.style.fontSize = value; break; }
    case 'align': { prev = box('Ab'); prev.style.display = 'block'; prev.style.textAlign = value; break; }
    case 'opacity': { prev = box(''); prev.style.background = 'var(--wb-accent)'; prev.style.opacity = value; break; }
    case 'radius': { prev = box(''); prev.style.background = 'var(--wb-bg)'; prev.style.borderRadius = value; break; }
    case 'border': { prev = box(''); if (value !== '0') prev.style.border = value; break; }
    default: prev = null; // generic / code: the label alone
  }
  if (prev) button.append(prev);
  button.append(label);
}

/** A small bordered preview box that carries a property-styled sample. */
function box(text: string): HTMLElement {
  const b = document.createElement('span');
  b.className = 'wb-fx-prev wb-fx-prev-box';
  b.textContent = text;
  return b;
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
