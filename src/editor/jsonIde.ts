// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * editor/jsonIde.ts — the IDE dressing over the JSON pane's textarea (#244).
 *
 * The zero-dependency Monaco technique: the textarea stays the real editor
 * (native caret, selection, undo, IME) but paints its TEXT transparent; a
 * scroll-synced <pre> underneath carries the highlighted tokens, a gutter
 * carries line numbers, and thin absolute bars mark the active line and the
 * selected element's span. Completions ride the shared acMenu drop-down,
 * anchored at the caret; a signature chip floats above it inside `=` calls.
 * Typing assists (Enter indent, pair auto-close, paste re-base) ride
 * jsonFormat.ts decisions through the same splice path (#PR-B).
 *
 * Decision logic is all elsewhere and pure: jsonHighlight.ts (tokens,
 * brackets), jsonComplete.ts (what to offer, signature hints). This module is
 * only geometry + event plumbing, and it NEVER touches the document or the
 * undo stack — an accepted completion is a plain buffer edit, exactly like
 * typing, which the panel's existing dirty-buffer → Apply flow owns.
 *
 * Repaints rebuild the overlay's innerHTML wholesale. Formatter JSON is a
 * few KB (the schema itself caps how big a sane formatter gets), so this
 * stays comfortably under a frame; revisit only if profiling ever says so.
 */

import { tokenizeJson, matchBracketAt, renderJsonHtml } from './jsonHighlight';
import { typingAssist, pasteReindent } from './jsonFormat';
import { jsonCompletionAt, signatureHintAt, type JsonCompletion } from './jsonComplete';
import { openAcMenu, type AcMenu } from './acMenu';
import { lineOfOffset } from './codeSync';
import type { MockField } from '../core/types';
import type { CompletionOpts } from './fxSuggest';

export interface JsonIdeDeps {
  fields: () => MockField[];
  completionOpts: () => CompletionOpts;
  /** The selected element's [start,end) range in the CURRENT buffer, or null
   *  (nothing selected / hand-edit in progress — stale offsets must not paint). */
  selectionRange: () => { start: number; end: number } | null;
  /** Called after an accepted completion splices the buffer — the panel marks
   *  itself dirty exactly as it does for typed input. */
  onSplice: () => void;
}

export interface JsonIdeApi {
  /** Full overlay refresh — call after any programmatic buffer change. */
  repaint: () => void;
  /** Reposition the selected-element bar (selection changed, buffer didn't). */
  refreshScope: () => void;
  /** Close the completion menu — for programmatic buffer swaps (Format) that
   *  fire no input event and would otherwise leave a stale menu (PR #266). */
  closeMenu: () => void;
}

/** Gutter width — keep in step with the CSS (.wb-json-gutter / padding-left). */
const GUTTER_W = 38;

/** Keys the completion menu owns while open — assists must not steal them. */
const MENU_KEYS = new Set(['Enter', 'Tab', 'ArrowDown', 'ArrowUp', 'Escape']);

export function mountJsonIde(shell: HTMLElement, textEl: HTMLTextAreaElement, deps: JsonIdeDeps): JsonIdeApi {
  const gutter = document.createElement('div');
  gutter.className = 'wb-json-gutter';
  gutter.setAttribute('aria-hidden', 'true');
  const gutterIn = document.createElement('div');
  gutterIn.className = 'wb-json-gutter-in';
  gutter.appendChild(gutterIn);

  const lineband = document.createElement('div');
  lineband.className = 'wb-json-lineband';
  lineband.setAttribute('aria-hidden', 'true');

  const hl = document.createElement('pre');
  hl.className = 'wb-json-hl';
  hl.setAttribute('aria-hidden', 'true');
  const code = document.createElement('code');
  hl.appendChild(code);

  const scopebar = document.createElement('div');
  scopebar.className = 'wb-json-scopebar';
  scopebar.setAttribute('aria-hidden', 'true');

  const sig = document.createElement('div');
  sig.className = 'wb-json-sighint';
  sig.setAttribute('aria-hidden', 'true');
  sig.hidden = true;

  shell.insertBefore(lineband, textEl);
  shell.insertBefore(hl, textEl);
  shell.insertBefore(gutter, textEl);
  shell.insertBefore(scopebar, textEl);
  shell.appendChild(sig);

  // ── metrics (monospace: geometry is arithmetic, not measurement) ──
  const lineHeight = (): number => {
    const lh = parseFloat(window.getComputedStyle(textEl).lineHeight);
    return Number.isFinite(lh) && lh > 0 ? lh : 16;
  };
  const padTop = (): number => parseFloat(window.getComputedStyle(textEl).paddingTop) || 8;
  let charWCache = 0;
  const charW = (): number => {
    if (charWCache > 0) return charWCache;
    const probe = document.createElement('span');
    probe.textContent = '0'.repeat(50);
    probe.style.visibility = 'hidden';
    code.appendChild(probe);
    const w = probe.getBoundingClientRect().width / 50;
    probe.remove();
    if (w > 0) charWCache = w;
    return charWCache > 0 ? charWCache : 6.6;
  };

  const caretPos = (): number => textEl.selectionStart ?? 0;
  const lineColOf = (offset: number): { line: number; col: number } => {
    const text = textEl.value;
    const line = lineOfOffset(text, offset);
    const col = offset - (text.lastIndexOf('\n', offset - 1) + 1);
    return { line, col };
  };

  // ── the layers ──
  let lastLineCount = -1;
  let lastActiveLine = -1;
  const refreshGutter = (): void => {
    const text = textEl.value;
    const lines = text.split('\n').length;
    const active = lineColOf(caretPos()).line;
    if (lines === lastLineCount && active === lastActiveLine) return;
    lastLineCount = lines;
    lastActiveLine = active;
    const rows: string[] = [];
    for (let i = 0; i < lines; i++) {
      rows.push(`<div class="wb-json-ln${i === active ? ' active' : ''}">${i + 1}</div>`);
    }
    gutterIn.innerHTML = rows.join('');
  };

  const positionLineband = (): void => {
    const { line } = lineColOf(caretPos());
    lineband.style.top = `${padTop() + line * lineHeight() - textEl.scrollTop}px`;
    lineband.style.height = `${lineHeight()}px`;
  };

  const refreshScope = (): void => {
    const range = deps.selectionRange();
    if (!range) { scopebar.hidden = true; return; }
    const text = textEl.value;
    const first = lineOfOffset(text, range.start);
    const last = lineOfOffset(text, Math.max(range.start, range.end - 1));
    scopebar.hidden = false;
    scopebar.style.top = `${padTop() + first * lineHeight() - textEl.scrollTop}px`;
    scopebar.style.height = `${(last - first + 1) * lineHeight()}px`;
  };

  const refreshSig = (): void => {
    const hint = signatureHintAt(textEl.value, caretPos());
    if (!hint) { sig.hidden = true; return; }
    const m = hint.doc.signature.match(/^([A-Za-z_][A-Za-z0-9_]*)\((.*)\)$/);
    sig.replaceChildren();
    if (m) {
      sig.append(`${m[1]}(`);
      const params = m[2].split(', ');
      params.forEach((p, i) => {
        if (i > 0) sig.append(', ');
        if (i === Math.min(hint.argIndex, params.length - 1)) {
          const b = document.createElement('b');
          b.textContent = p;
          sig.appendChild(b);
        } else {
          sig.append(p);
        }
      });
      sig.append(')');
    } else {
      sig.append(hint.doc.signature);
    }
    sig.title = hint.doc.summary;
    const { line, col } = lineColOf(caretPos());
    sig.hidden = false;
    sig.style.top = `${padTop() + line * lineHeight() - textEl.scrollTop - 2}px`;
    sig.style.left = `${Math.max(GUTTER_W, GUTTER_W + 8 + col * charW() - textEl.scrollLeft)}px`;
  };

  const syncScroll = (): void => {
    hl.scrollTop = textEl.scrollTop;
    hl.scrollLeft = textEl.scrollLeft;
    gutterIn.style.transform = `translateY(${-textEl.scrollTop}px)`;
    positionLineband();
    refreshScope();
    refreshSig();
  };

  const repaint = (): void => {
    const text = textEl.value;
    const tokens = tokenizeJson(text);
    code.innerHTML = renderJsonHtml(text, tokens, matchBracketAt(text, tokens, caretPos()));
    refreshGutter();
    syncScroll();
  };

  // ── the typeahead ──
  let ac: AcMenu | null = null;
  const closeMenu = (): void => { if (ac) { ac.close(); ac = null; } };

  const caretAnchor = (): { left: number; bottom: number } => {
    const r = textEl.getBoundingClientRect();
    const { line, col } = lineColOf(caretPos());
    const x = r.left + GUTTER_W + 8 + col * charW() - textEl.scrollLeft;
    const y = r.top + padTop() + line * lineHeight() - textEl.scrollTop;
    return {
      left: Math.max(r.left, Math.min(x, r.right - 24)),
      bottom: Math.max(r.top, Math.min(y + lineHeight(), r.bottom)),
    };
  };

  /** Splice through execCommand where the browser still offers it — that
   *  keeps the textarea's NATIVE undo stack intact (Ctrl+Z undoes the pick),
   *  and fires the input event that runs the panel's own dirty marking. */
  const spliceKeepingUndo = (from: number, to: number, value: string): boolean => {
    if (typeof document.execCommand !== 'function') return false;
    textEl.focus();
    textEl.setSelectionRange(from, to);
    try { return document.execCommand('insertText', false, value); } catch { return false; }
  };

  const accept = (comp: JsonCompletion, value: string): void => {
    const item = comp.items.find((i) => i.insert === value);
    if (!spliceKeepingUndo(comp.from, comp.to, value)) {
      // fallback (test DOMs, execCommand-less browsers): plain value splice —
      // no input event fires, so mark + repaint explicitly
      const v = textEl.value;
      textEl.value = v.slice(0, comp.from) + value + v.slice(comp.to);
      deps.onSplice();
      repaint();
    }
    const pos = comp.from + (item?.caretOffset ?? value.length);
    textEl.setSelectionRange(pos, pos);
    textEl.focus();
    repaint(); // the caret (bracket match, active line) moved either way
    updateMenu(true); // chain: "elmType" scaffolds straight into its value menu
  };

  const updateMenu = (force: boolean): void => {
    closeMenu();
    const comp = jsonCompletionAt(textEl.value, caretPos(), deps.fields(), deps.completionOpts());
    // bare-structure menus (fresh key position, after `:`) only open on
    // Ctrl+Space or completion chaining — auto-popping them on every comma
    // and newline would fight plain typing (Enter would accept, not break)
    if (!comp || (comp.bare && !force)) return;
    // nothing to say: the single remaining item IS what's already typed
    if (comp.items.length === 1 && textEl.value.slice(comp.from, comp.to) === comp.items[0].insert) return;
    ac = openAcMenu(textEl, comp.items, (value) => accept(comp, value), caretAnchor());
  };

  textEl.addEventListener('input', () => { repaint(); updateMenu(false); });
  textEl.addEventListener('beforeinput', (e) => {
    // #PR-B: multi-line pastes re-base to the caret line's indentation
    if (e.inputType !== 'insertFromPaste') return;
    const raw = e.dataTransfer?.getData('text/plain') ?? e.data ?? '';
    if (!raw.includes('\n')) return;
    const selStart = textEl.selectionStart ?? 0;
    const adjusted = pasteReindent(textEl.value, selStart, raw);
    if (adjusted === raw) return;
    e.preventDefault();
    if (!spliceKeepingUndo(selStart, textEl.selectionEnd ?? selStart, adjusted)) {
      const v = textEl.value;
      textEl.value = v.slice(0, selStart) + adjusted + v.slice(textEl.selectionEnd ?? selStart);
      deps.onSplice();
    }
    const pos = selStart + adjusted.length;
    textEl.setSelectionRange(pos, pos);
    repaint();
    updateMenu(false); // the manual-splice fallback fires no input event
  });
  textEl.addEventListener('click', () => { closeMenu(); repaint(); });
  textEl.addEventListener('keyup', (e) => {
    // caret-only moves (arrows, Home/End, PgUp/PgDn) — input already repainted
    // for typing keys, but bracket match + active line must follow the caret
    if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End'
      || e.key === 'PageUp' || e.key === 'PageDown') repaint();
  });
  textEl.addEventListener('scroll', () => { closeMenu(); syncScroll(); });
  textEl.addEventListener('blur', () => closeMenu());
  textEl.addEventListener('keydown', (e) => {
    if (e.key === ' ' && e.ctrlKey) {
      e.preventDefault();
      updateMenu(true);
      return;
    }
    // #PR-B typing assists. The menu owns its navigation keys while open;
    // everything else (brackets, quotes — and Enter when no menu is up)
    // flows to the pure decision layer. Splices ride the same undo path
    // as accepted completions.
    if (!e.defaultPrevented && (!ac || !MENU_KEYS.has(e.key))) {
      const a = typingAssist(textEl.value, textEl.selectionStart ?? 0, textEl.selectionEnd ?? 0, e.key);
      if (a) {
        e.preventDefault();
        if (a.kind === 'caret') {
          textEl.setSelectionRange(a.caret, a.caret);
        } else {
          if (!spliceKeepingUndo(a.from, a.to, a.insert)) {
            const v = textEl.value;
            textEl.value = v.slice(0, a.from) + a.insert + v.slice(a.to);
            deps.onSplice();
          }
          textEl.setSelectionRange(a.caret, a.caret);
        }
        repaint();
        // caret-only moves and manual-splice fallbacks fire no input event,
        // and even the execCommand path updates the menu BEFORE the final
        // caret lands — re-evaluate at the true caret so it never goes stale
        updateMenu(false);
        return;
      }
    }
    if (!ac) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); ac.move(1); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); ac.move(-1); return; }
    if (e.key === 'Escape') {
      // closing the menu is THIS Escape's whole job — it must not bubble on
      // to the app's overlay/owner convention and close something else too
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      if (ac.accept()) e.preventDefault(); // accept instead of newline / focus move
    }
  });

  repaint();
  return { repaint, refreshScope, closeMenu };
}
