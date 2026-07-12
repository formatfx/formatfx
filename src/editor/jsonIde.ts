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

import { tokenizeJson, matchBracketAt, renderJsonHtml, occurrenceTargetAt } from './jsonHighlight';
import type { EvalChip } from './exprPreview';
import { typingAssist, pasteReindent } from './jsonFormat';
import { jsonCompletionAt, signatureHintAt, type JsonCompletion } from './jsonComplete';
import { renderSquigglesHtml, type Decoration } from './jsonDecorations';
import type { HoverInfo } from './jsonHover';
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
  /** #PR-D squiggles: DISPLAYED-coordinate decorations for the wb-json-sq
   *  overlay layer (the panel owns merging/translating; this shell only
   *  paints). Absent = no squiggle layer content. */
  decorations?: () => Decoration[];
  /** #PR-D hover: what to show at a displayed-buffer offset (the panel wires
   *  jsonHover.hoverAt with its decoration + field context). null = nothing. */
  hoverAt?: (offset: number) => HoverInfo | null;
  /** #PR-E: the live eval chip for the caret's live string (the panel wires
   *  exprPreview.evalChipAt with its sample-row ctx). Appends to the
   *  signature strip; null = no chip. */
  evalChip?: (offset: number) => EvalChip | null;
  /** #PR-C fold bridge — the panel owns fold state; the shell paints chevrons,
   *  gapped line numbers, and expands before any assist/paste edit lands. */
  folds?: {
    usable(): boolean;
    active(): boolean;
    expandAll(): void;
    foldableFoldedLines(): Array<{ line: number; folded: boolean; label: string }>;
    toggleAtFoldedLine(line: number): void;
    fullLineNumber(foldedLine: number): number;
  };
}

export interface JsonIdeApi {
  /** Full overlay refresh — call after any programmatic buffer change. */
  repaint: () => void;
  /** Reposition the selected-element bar (selection changed, buffer didn't). */
  refreshScope: () => void;
  /** Close the completion menu — for programmatic buffer swaps (Format) that
   *  fire no input event and would otherwise leave a stale menu (PR #266). */
  closeMenu: () => void;
  /** #PR-D: rebuild only the squiggle layer — for decoration changes that
   *  arrive without a buffer change (the debounced live parse, lint refresh). */
  repaintSquiggles: () => void;
  /** Disconnect the shell's ResizeObserver — for panel teardown (the host's
   *  _unsub), so remounts never accumulate observers holding detached DOM. */
  dispose: () => void;
}

/** Left rail width: 38px number gutter + 14px fold column — keep in step
 *  with the CSS (.wb-json-gutter, .wb-json-foldcol, the 60px padding-left). */
const GUTTER_W = 52;

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

  // #PR-D squiggle layer: the buffer text again, glyphs transparent, only the
  // wavy text-decorations visible — the highlight layer's lossless invariant
  // is never involved. Sits right above hl (later sibling), under the gutter.
  const sq = document.createElement('pre');
  sq.className = 'wb-json-sq';
  sq.setAttribute('aria-hidden', 'true');
  const sqCode = document.createElement('code');
  sq.appendChild(sqCode);

  // #PR-D hover card: floats above the pointer's line, never interactive
  const hovercard = document.createElement('div');
  hovercard.className = 'wb-json-hover';
  hovercard.hidden = true;
  const hoverTitle = document.createElement('div');
  hoverTitle.className = 'wb-hover-title';
  const hoverBody = document.createElement('div');
  hoverBody.className = 'wb-hover-body';
  hovercard.append(hoverTitle, hoverBody);

  const scopebar = document.createElement('div');
  scopebar.className = 'wb-json-scopebar';
  scopebar.setAttribute('aria-hidden', 'true');

  const sig = document.createElement('div');
  sig.className = 'wb-json-sighint';
  sig.setAttribute('aria-hidden', 'true');
  sig.hidden = true;

  // #PR-C fold column: chevrons OUTSIDE the aria-hidden gutter (interactive)
  const foldcol = document.createElement('div');
  foldcol.className = 'wb-json-foldcol';

  shell.insertBefore(lineband, textEl);
  shell.insertBefore(hl, textEl);
  shell.insertBefore(sq, textEl);
  shell.insertBefore(gutter, textEl);
  shell.insertBefore(scopebar, textEl);
  shell.appendChild(sig);
  shell.appendChild(hovercard);
  shell.appendChild(foldcol); // above the textarea (z-index) — buttons stay clickable

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
    const foldsOn = deps.folds?.active() ?? false;
    // the short-circuit assumes contiguous numbering — skip it when folds gap it
    if (!foldsOn && lines === lastLineCount && active === lastActiveLine) return;
    lastLineCount = lines;
    lastActiveLine = active;
    const rows: string[] = [];
    for (let i = 0; i < lines; i++) {
      const n = deps.folds ? deps.folds.fullLineNumber(i) + 1 : i + 1;
      rows.push(`<div class="wb-json-ln${i === active ? ' active' : ''}">${n}</div>`);
    }
    gutterIn.innerHTML = rows.join('');
  };

  // ── #PR-C: chevrons absolutely positioned per foldable opener line ──
  const refreshFoldcol = (): void => {
    if (!deps.folds || !deps.folds.usable()) { foldcol.replaceChildren(); return; }
    const lh = lineHeight();
    const top0 = padTop() - textEl.scrollTop;
    foldcol.replaceChildren(...deps.folds.foldableFoldedLines().map(({ line, folded, label }) => {
      const b = document.createElement('button');
      b.className = 'wb-json-chev';
      b.type = 'button';
      b.textContent = folded ? '▸' : '▾';
      b.setAttribute('aria-expanded', String(!folded));
      b.setAttribute('aria-label', `${folded ? 'Unfold' : 'Fold'} ${label}`);
      b.style.top = `${top0 + line * lh}px`;
      b.addEventListener('click', () => deps.folds!.toggleAtFoldedLine(line));
      return b;
    }));
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
    // #PR-E: the eval chip rides the same strip — a hint, a chip, or both
    const chip = deps.evalChip?.(caretPos()) ?? null;
    if (!hint && !chip) { sig.hidden = true; return; }
    sig.replaceChildren();
    if (hint) {
      const m = hint.doc.signature.match(/^([A-Za-z_][A-Za-z0-9_]*)\((.*)\)$/);
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
    } else {
      sig.title = '';
    }
    if (chip) {
      const c = document.createElement('span');
      c.className = `wb-evalchip wb-evalchip-${chip.kind}`;
      c.textContent = `${chip.kind === 'error' ? '⚠' : '→'} ${chip.text}`;
      if (chip.type) {
        const b = document.createElement('span');
        b.className = 'wb-evalchip-type';
        b.textContent = chip.type;
        c.appendChild(b);
      }
      sig.appendChild(c);
    }
    const { line, col } = lineColOf(caretPos());
    sig.hidden = false;
    sig.style.top = `${padTop() + line * lineHeight() - textEl.scrollTop - 2}px`;
    sig.style.left = `${Math.max(GUTTER_W, GUTTER_W + 8 + col * charW() - textEl.scrollLeft)}px`;
  };

  // ── #PR-D: the hover card. Geometry only — content comes from deps.hoverAt.
  // A settle delay keeps casual mouse-crossings quiet; anything that moves the
  // text or the viewport hides the card instantly. ──
  const HOVER_SETTLE_MS = 150;
  let hoverTimer = 0;
  const hideHover = (): void => {
    window.clearTimeout(hoverTimer);
    hoverTimer = 0;
    hovercard.hidden = true;
  };

  /** clientX/Y → buffer offset in the monospace grid; null beyond the text
   *  (past the line end, below the last line, in the gutter). */
  const offsetAtPoint = (clientX: number, clientY: number): { off: number; line: number; x: number } | null => {
    const r = textEl.getBoundingClientRect();
    const y = clientY - r.top - padTop() + textEl.scrollTop;
    if (y < 0) return null;
    const line = Math.floor(y / lineHeight());
    const x = clientX - r.left;
    const col = Math.round((x - (GUTTER_W + 8) + textEl.scrollLeft) / charW());
    if (col < 0) return null;
    const text = textEl.value;
    let lineStart = 0;
    for (let i = 0; i < line; i++) {
      const nl = text.indexOf('\n', lineStart);
      if (nl === -1) return null; // below the last line
      lineStart = nl + 1;
    }
    const nl = text.indexOf('\n', lineStart);
    const lineEnd = nl === -1 ? text.length : nl;
    if (lineStart + col > lineEnd) return null; // beyond the line's end — no hover
    return { off: lineStart + col, line, x };
  };

  const showHover = (clientX: number, clientY: number): void => {
    const pt = offsetAtPoint(clientX, clientY);
    const info = pt ? deps.hoverAt!(pt.off) : null;
    if (!pt || !info) { hideHover(); return; }
    hoverTitle.textContent = info.title;
    if (info.icon) {
      // #PR-E: the glyph rides the already-loaded Fabric icon font
      const i = document.createElement('i');
      i.className = `ms-Icon ms-Icon--${info.icon} wb-hover-icon`;
      i.setAttribute('aria-hidden', 'true');
      hoverTitle.prepend(i, ' ');
    }
    hoverBody.textContent = info.body;
    hovercard.classList.toggle('wb-hover-mono', !!info.mono);
    // above the pointer's LINE (translateY(-100%) in CSS), clamped into the box
    hovercard.style.top = `${padTop() + pt.line * lineHeight() - textEl.scrollTop - 2}px`;
    hovercard.style.left = `${Math.max(4, Math.min(pt.x, Math.max(4, shell.clientWidth - 260)))}px`;
    hovercard.hidden = false;
  };

  if (deps.hoverAt) {
    textEl.addEventListener('mousemove', (e) => {
      window.clearTimeout(hoverTimer);
      hoverTimer = window.setTimeout(() => showHover(e.clientX, e.clientY), HOVER_SETTLE_MS);
    });
    textEl.addEventListener('mouseleave', hideHover);
    textEl.addEventListener('blur', hideHover);
  }

  const repaintSquiggles = (): void => {
    sqCode.innerHTML = renderSquigglesHtml(textEl.value, deps.decorations?.() ?? []);
  };

  const syncScroll = (): void => {
    // TRANSFORM, never scrollTop/scrollLeft: a scroll offset clamps to the
    // overlay's OWN max, and the textarea's box is smaller than the overlays'
    // by its scrollbars (the pres never grow any). On classic-scrollbar
    // platforms the textarea scrolls a scrollbar-thickness further than the
    // overlays could — at max scroll the painted text sheared off the real
    // glyph grid and a double-click selected the NEIGHBOURING word. A
    // transform tracks any offset exactly (the gutter always worked this way).
    const x = -textEl.scrollLeft;
    const y = -textEl.scrollTop;
    code.style.transform = `translate(${x}px, ${y}px)`;
    sqCode.style.transform = `translate(${x}px, ${y}px)`;
    gutterIn.style.transform = `translateY(${y}px)`;
    positionLineband();
    refreshScope();
    refreshSig();
    refreshFoldcol();
  };

  // Resizes move the textarea's scroll offsets WITHOUT a scroll event when
  // the browser clamps them (shell grown back — e.g. the lint footer emptied
  // — while the buffer sat at max scroll). Re-sync on any shell resize so the
  // overlay and the scroll-anchored bars never go stale.
  let resizeObs: ResizeObserver | null = null;
  if (typeof ResizeObserver === 'function') {
    resizeObs = new ResizeObserver(() => syncScroll());
    resizeObs.observe(shell);
  }

  const repaint = (): void => {
    const text = textEl.value;
    const tokens = tokenizeJson(text);
    // #PR-E: the caret's xfield/xtoken lights its every occurrence
    const occ = occurrenceTargetAt(text, tokens, caretPos());
    code.innerHTML = renderJsonHtml(text, tokens, matchBracketAt(text, tokens, caretPos()), occ);
    repaintSquiggles();
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

  textEl.addEventListener('input', () => { hideHover(); repaint(); updateMenu(false); });
  textEl.addEventListener('beforeinput', (e) => {
    // #PR-B: multi-line pastes re-base to the caret line's indentation
    if (e.inputType !== 'insertFromPaste') return;
    // an earlier listener (the panel's fold guard) may have consumed this
    // event and re-applied the paste itself — running again would double it
    if (e.defaultPrevented) return;
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
  textEl.addEventListener('scroll', () => { closeMenu(); hideHover(); syncScroll(); });
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
    // assists only ever fire on UNMODIFIED typing keys — Ctrl/Alt/Meta combos
    // are commands (fold/format/copy…), never text (shift stays: '{' IS
    // Shift+[ on US layouts)
    if (!e.defaultPrevented && !e.ctrlKey && !e.metaKey && !e.altKey && (!ac || !MENU_KEYS.has(e.key))) {
      // #PR-C: edit-intent keys expand folds first (selection remapped by the
      // panel); navigation keys read the folded view freely. The panel's
      // beforeinput guard remains the net for mouse paste / drop / IME.
      const willEdit = e.key.length === 1
        || e.key === 'Enter' || e.key === 'Backspace' || e.key === 'Delete';
      if (willEdit && deps.folds?.active()) deps.folds.expandAll();
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
  return {
    repaint,
    refreshScope,
    closeMenu,
    repaintSquiggles,
    dispose: () => {
      resizeObs?.disconnect();
      resizeObs = null;
    },
  };
}
