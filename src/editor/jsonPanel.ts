// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * editor/jsonPanel.ts — Bidirectional JSON view.
 *
 * Out: live compiled SP JSON ($schema wrapper, sanitized expressions),
 * with copy / download / CSOM-safe copy.
 * In: paste any column/view/tile formatter JSON and "Apply" loads it into
 * the visual editor.
 *
 * #218 — the split-view sync (this pane sits open beside the canvas):
 *   · code → canvas: a caret landing inside an element's JSON selects that
 *     element (the canvas's own .wb-selected highlight — no parallel system);
 *   · canvas → code: document changes refresh the text IN PLACE, preserving
 *     the reader's caret + scroll (preserveCaret over the deterministic
 *     serializer output); selection changes scroll to and flash the selected
 *     element's lines WITHOUT ever moving the caret.
 *   · Both directions ride core/jsonMap's offset↔path map (a byproduct of
 *     the serialization walk) and a SyncEcho guard so a code-originated
 *     selection never bounces back onto its own caret. Sync is pure view
 *     work: it never creates undo entries.
 *
 * #244 — the IDE dressing (editor/jsonIde.ts): the textarea sits transparent
 * over a scroll-synced highlight overlay inside .wb-json-shell, with a line
 * gutter, bracket matching, the selected element's scope bar, contextual
 * completions (jsonComplete.ts) and expression signature hints. All of it is
 * view/buffer work — the one document write remains the Apply button.
 */

import { state, samePath } from './state';
import { exportJson, importJson, treeHasNames } from '../core/serializer';
import { exportJsonWithMap, pathAtOffset, rangeForPath, type JsonRange } from '../core/jsonMap';
import { preserveCaret, lineSpanOf, lineOfOffset, SyncEcho } from './codeSync';
import { mountJsonIde } from './jsonIde';
import { formatDocument } from './jsonFormat';
import {
  cutForRange, outermost, buildFoldView, fullLineOfFoldedLine,
  type FoldCut, type FoldView,
} from './jsonFold';
import { ctxForRow } from './previewCtx';
import { lintDocument, type LintIssue } from '../core/linter';
import { buildDeploySnippet } from '../bridge/deploySnippet';
import { serializeApplyPayload } from '../bridge/applyPayload';
import { onExtensionReady, stageApplyToExtension } from './extensionBridge';
import { buildCurrentApplyPayload } from './deployPayload';
import { lintBadge, lintAriaLabel } from './lintBadge';
import type { RenderIssue } from '../core/renderer';

export interface JsonPanelApi {
  refreshLint: (runtime: RenderIssue[]) => { errors: number; warnings: number; runtime: number };
}

export function mountJsonPanel(host: HTMLElement, onToast: (m: string) => void): JsonPanelApi {
  host.innerHTML = `
    <div class="wb-json-toolbar">
      <div class="wb-json-actions">
        <button id="wb-json-apply" title="Parse the JSON below back into the visual editor">⬅ Apply to canvas</button>
      </div>
    </div>
    <div id="wb-deploy-panel" class="wb-deploy" hidden>
      <div id="wb-deploy-target" class="wb-deploy-target"></div>
      <input id="wb-deploy-view" placeholder="View title, exactly as on the list" value="All Items" title="The (shared) view that receives this row formatting">
      <input id="wb-deploy-list" placeholder="List title (blank = the list you run it on)" title="Usually leave blank and run the snippet on the list's own page">
      <button id="wb-deploy-copy">Copy deploy snippet</button>
      <button id="wb-deploy-apply-ext" title="Copy for the FormatFX companion extension: on your list tab, click the extension → Apply from clipboard">Copy for extension</button>
      <button id="wb-deploy-send-ext" hidden title="Send straight to the FormatFX companion extension (no clipboard): then click the extension on your list tab to apply">⚡ Send to extension</button>
      <div class="wb-deploy-note">Paste the snippet into the console (F12) on your SharePoint list page.
It reads the target, shows you exactly what changes, and asks before the ONE write.
Needs Edit on the list (formatters ride "Manage Lists", part of the default Edit level).
Or, with the FormatFX companion extension installed, use "Copy for extension" and click Apply on the list tab.</div>
    </div>
    <div id="wb-json-shell" class="wb-json-shell wb-codesync">
      <textarea id="wb-json-text" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off"></textarea>
    </div>
    <div id="wb-json-import-error" class="wb-import-error" role="alert" aria-live="assertive" hidden></div>
    <div id="wb-lint" class="wb-lint"></div>
  `;

  // The pane chrome is one slim head row (JSON ⇄ Explain + ⋮, owned by the app
  // shell) plus the Apply row above the editor — every other JSON action lives
  // in the head's ⋮ dropdown (owner call, #257 follow-up). The shell provides
  // the dropdown slot; bare test mounts get a hidden local stand-in so the
  // controls (and regenerate's option reads) keep existing.
  const menuHost = document.getElementById('wb-json-kebab-slot') ?? (() => {
    const d = document.createElement('div');
    d.hidden = true;
    host.appendChild(d);
    return d;
  })();
  menuHost.innerHTML = `
        <button id="wb-json-copy" title="Copy to clipboard">Copy</button>
        <button id="wb-json-copy-csom" title="Copy with & and < escaped as \\u0026/\\u003c — safe for CSOM deploys">Copy (CSOM-safe)</button>
        <button id="wb-json-download" title="Download .json">Download</button>
        <button id="wb-json-deploy" title="Generate a deploy snippet: run it on your list page and it writes this formatter to the column/view — confirm-first, lint-gated, with a clobber guard before replacing a view's formatting">🚀 Deploy…</button>
        <button id="wb-json-format" title="Pretty-print the buffer: canonical when it parses (Alt+Shift+F). Does not Apply.">Format document</button>
        <button id="wb-json-fold-others" title="Collapse every element outside the selected element's chain (Ctrl+Shift+[ folds the element at the caret)">Fold others</button>
        <button id="wb-json-expand-all" title="Unfold everything (Ctrl+Shift+] unfolds at the caret)">Expand all</button>
        <hr>
        <label class="wb-check"><input type="checkbox" id="wb-json-sanitize" checked> sanitize whitespace</label>
        <label class="wb-check" title="Keep the Structure pane's _elmName labels in copied/downloaded JSON (SharePoint ignores them). Uncheck for schema-pristine output. The editor view below always shows them so Apply round-trips losslessly."><input type="checkbox" id="wb-json-names" checked> names</label>`;

  // .wb-codesync (the flash bar's positioning context) moved from the host to
  // the shell with #244 — the bar overlays the editor box, not the whole pane
  const shellEl = host.querySelector('#wb-json-shell') as HTMLDivElement;
  const textEl = host.querySelector('#wb-json-text') as HTMLTextAreaElement;
  const sanitizeEl = menuHost.querySelector('#wb-json-sanitize') as HTMLInputElement;
  const namesEl = menuHost.querySelector('#wb-json-names') as HTMLInputElement;
  const lintEl = host.querySelector('#wb-lint') as HTMLElement;
  const importErrorEl = host.querySelector('#wb-json-import-error') as HTMLDivElement;
  const applyBtn = host.querySelector('#wb-json-apply') as HTMLButtonElement;
  let dirty = false;

  const clearImportError = (): void => { importErrorEl.hidden = true; importErrorEl.textContent = ''; };
  const setDirty = () => {
    dirty = true;
    textEl.classList.add('wb-json-dirty');
    shellEl.classList.add('wb-json-dirty'); // the border lives on the shell now
    applyBtn.classList.add('wb-json-apply-pending');
    ide.refreshScope(); // stale offsets: the scope bar hides until Apply
  };
  const clearDirty = () => {
    dirty = false;
    textEl.classList.remove('wb-json-dirty');
    shellEl.classList.remove('wb-json-dirty');
    applyBtn.classList.remove('wb-json-apply-pending');
  };

  // ── #218 split-view sync state ──
  let mapRanges: JsonRange[] = []; // offset↔path map for the FULL (unfolded) text
  const echo = new SyncEcho();

  // ── #PR-C subtree folding: a clean-buffer-only VIEW over the textarea.
  // `fullText` is authoritative; the textarea shows foldView.text when folds
  // are active. Every offset consumer translates through these two maps.
  // Edits never coexist with folds (the beforeinput guard below expands
  // first), so folds never meet the undo stack. ──
  let fullText = '';
  const foldedPaths = new Set<string>();   // path keys ('0/2') the user folded
  let foldView: FoldView | null = null;
  let activeFoldKeys: string[] = [];       // aligned with foldView.cuts

  const displayedToFull = (o: number): number => (foldView ? foldView.toFull(o) : o);
  const fullToDisplayed = (o: number): number => (foldView ? foldView.toFolded(o) : o);
  const pathKey = (p: number[]): string => p.join('/');

  /** Re-derive the fold view from foldedPaths against the current map.
   *  Pure state — callers own the textarea swap (they know their caret rules). */
  const rebuildFoldView = (): void => {
    const resolved: Array<{ key: string; cut: FoldCut }> = [];
    for (const key of [...foldedPaths]) {
      const path = key === '' ? [] : key.split('/').map(Number);
      const range = rangeForPath(mapRanges, path);
      const cut = range ? cutForRange(fullText, range) : null;
      if (cut) resolved.push({ key, cut });
      else foldedPaths.delete(key); // the node no longer exists / no longer folds
    }
    const outer = outermost(resolved.map((r) => r.cut));
    activeFoldKeys = outer.map(
      (c) => resolved.find((r) => r.cut.start === c.start && r.cut.end === c.end)!.key,
    );
    foldView = outer.length ? buildFoldView(fullText, outer) : null;
  };

  /** Swap the textarea to the current view, keeping a FULL-coordinate
   *  selection and the scroll position. No-op when the display is current. */
  const syncFoldDisplay = (fullSelStart: number, fullSelEnd: number): void => {
    const next = foldView ? foldView.text : fullText;
    const { scrollTop, scrollLeft } = textEl;
    if (next !== textEl.value) textEl.value = next;
    textEl.setSelectionRange(fullToDisplayed(fullSelStart), fullToDisplayed(fullSelEnd));
    textEl.scrollTop = scrollTop;
    textEl.scrollLeft = scrollLeft;
    ide.repaint();
  };

  /** Toggle-path entry: capture the caret through the OLD view, rebuild, swap. */
  const applyFolds = (): void => {
    const selStart = displayedToFull(textEl.selectionStart ?? 0);
    const selEnd = displayedToFull(textEl.selectionEnd ?? selStart);
    rebuildFoldView();
    syncFoldDisplay(selStart, selEnd);
  };

  /** Show the full text (foldedPaths survive for the next clean regenerate). */
  const expandAllFolds = (): void => {
    if (!foldView) return;
    const selStart = foldView.toFull(textEl.selectionStart ?? 0);
    const selEnd = foldView.toFull(textEl.selectionEnd ?? selStart);
    foldView = null;
    activeFoldKeys = [];
    syncFoldDisplay(selStart, selEnd);
  };

  const regenerate = () => {
    if (dirty) return; // don't clobber a paste in progress
    // the editor view keeps _elmName so "Apply to canvas" never loses names
    const { text, ranges } = exportJsonWithMap(state.doc, { sanitizeWhitespace: sanitizeEl.checked, keepMeta: true });
    mapRanges = ranges;
    const oldFull = fullText;
    // caret: displayed → old full → (deterministic-serializer diff) → new full
    const selStart = preserveCaret(oldFull, text, displayedToFull(textEl.selectionStart ?? 0));
    const selEnd = preserveCaret(oldFull, text, displayedToFull(textEl.selectionEnd ?? textEl.selectionStart ?? 0));
    fullText = text;
    rebuildFoldView(); // folds are path-keyed: survivors re-apply, the rest drop
    syncFoldDisplay(selStart, selEnd);
    clearImportError(); // stale error no longer matches what's in the textarea
  };

  // ── #218 code → canvas: a caret landing inside an element selects it ──
  // Wired to user gestures only (click / keyup) so programmatic value swaps
  // can never masquerade as a caret move; typing marks the buffer dirty
  // before keyup fires, so hand-edits (stale offsets) never mis-select.
  const syncSelectionFromCaret = (): void => {
    if (dirty) return; // hand-edited text: offsets are stale until Apply
    const path = pathAtOffset(mapRanges, displayedToFull(textEl.selectionStart ?? 0));
    if (!path) return; // wrapper chrome ($schema line) selects nothing
    if (state.selection && samePath(state.selection, path)) return; // already there — no churn
    echo.run('code', () => state.select(path));
  };
  textEl.addEventListener('click', () => {
    // #PR-C: a caret landing inside a fold's sentinel unfolds just that region
    if (foldView) {
      const idx = foldView.cutIndexAtFolded(textEl.selectionStart ?? 0);
      if (idx >= 0) {
        const caretFull = foldView.cuts[idx].start;
        foldedPaths.delete(activeFoldKeys[idx]);
        rebuildFoldView();
        syncFoldDisplay(caretFull, caretFull);
        return;
      }
    }
    syncSelectionFromCaret();
  });
  textEl.addEventListener('keyup', syncSelectionFromCaret);

  // ── #PR-C edit guards: folds and edits never coexist. Any beforeinput on a
  // folded view is cancelled, everything expands, and the common edit kinds
  // re-apply at the remapped selection (a selection visually spanning a
  // sentinel expands to cover the hidden interior — WYSIWYG delete). IME
  // composition can't be cancelled mid-flight, so it expands preemptively. ──
  const reapplyInsert = (ins: string): void => {
    const s = textEl.selectionStart ?? 0;
    const e2 = textEl.selectionEnd ?? s;
    if (typeof document.execCommand === 'function') {
      textEl.focus();
      try { if (document.execCommand('insertText', false, ins)) return; } catch { /* fall through */ }
    }
    const v = textEl.value;
    textEl.value = v.slice(0, s) + ins + v.slice(e2);
    const pos = s + ins.length;
    textEl.setSelectionRange(pos, pos);
    setDirty(); clearImportError(); clearFlash();
    ide.repaint();
  };
  const reapplyDelete = (dir: 'back' | 'fwd'): void => {
    let s = textEl.selectionStart ?? 0;
    let e2 = textEl.selectionEnd ?? s;
    if (s === e2) {
      if (dir === 'back' && s > 0) s--;
      else if (dir === 'fwd' && e2 < textEl.value.length) e2++;
    }
    if (s === e2) return;
    textEl.setSelectionRange(s, e2);
    if (typeof document.execCommand === 'function') {
      textEl.focus();
      try { if (document.execCommand('delete')) return; } catch { /* fall through */ }
    }
    const v = textEl.value;
    textEl.value = v.slice(0, s) + v.slice(e2);
    textEl.setSelectionRange(s, s);
    setDirty(); clearImportError(); clearFlash();
    ide.repaint();
  };
  textEl.addEventListener('beforeinput', (e) => {
    if (!foldView) return;
    e.preventDefault();
    expandAllFolds(); // remaps the selection through the dying view
    switch (e.inputType) {
      case 'insertText': if (e.data) reapplyInsert(e.data); break;
      case 'insertLineBreak':
      case 'insertParagraph': reapplyInsert('\n'); break;
      case 'insertFromPaste':
      case 'insertFromDrop': {
        const t = e.dataTransfer?.getData('text/plain') ?? e.data ?? '';
        if (t) reapplyInsert(t);
        break;
      }
      case 'deleteContentBackward': reapplyDelete('back'); break;
      case 'deleteContentForward': reapplyDelete('fwd'); break;
      default: break; // rare kinds: expanded only — the user repeats the gesture
    }
  });
  textEl.addEventListener('compositionstart', () => expandAllFolds());

  // ── #218 canvas → code: scroll to + flash the selected element's lines ──
  let flashBar: HTMLDivElement | null = null;
  let flashTimer = 0;
  const clearFlash = (): void => {
    window.clearTimeout(flashTimer);
    flashBar?.remove();
    flashBar = null;
  };
  textEl.addEventListener('scroll', clearFlash); // a moved viewport orphans the bar

  /** Line metrics for the monospace box (with fallbacks for test DOMs). */
  const lineHeightPx = (): number => {
    const cs = window.getComputedStyle(textEl);
    const lh = parseFloat(cs.lineHeight);
    if (Number.isFinite(lh) && lh > 0) return lh;
    const fs = parseFloat(cs.fontSize);
    return Number.isFinite(fs) && fs > 0 ? fs * 1.3 : 14;
  };

  /** Show where the primary selection lives in the JSON: scroll it into view
   *  if needed and flash its lines. NEVER moves the caret or focus — the
   *  reading/edit position is sacred (that's the whole echo-guard deal). */
  const revealSelection = (): void => {
    clearFlash();
    if (dirty) return; // don't fight a hand-edit in progress
    const path = state.selection;
    if (!path) return;
    const range = rangeForPath(mapRanges, path);
    if (!range) return; // stale map (shouldn't happen) — just skip
    // folded view: a fully-hidden element clamps to its fold's sentinel line
    const { first, last } = lineSpanOf(textEl.value, fullToDisplayed(range.start), fullToDisplayed(range.end));
    const lh = lineHeightPx();
    const padTop = parseFloat(window.getComputedStyle(textEl).paddingTop) || 0;
    const top = first * lh + padTop;
    const bottom = (last + 1) * lh + padTop;
    if (textEl.clientHeight > 0 && (top < textEl.scrollTop || bottom > textEl.scrollTop + textEl.clientHeight)) {
      // center-ish, biased a third down so context above stays visible
      textEl.scrollTop = Math.max(0, top - Math.max(lh, (textEl.clientHeight - (bottom - top)) / 3));
    }
    let y = top - textEl.scrollTop;
    let h = bottom - top;
    if (textEl.clientHeight > 0) { // clip to the textarea's viewport
      const y0 = Math.max(0, y);
      const y1 = Math.min(textEl.clientHeight, y + h);
      if (y1 <= y0) return;
      y = y0;
      h = y1 - y0;
    }
    const bar = document.createElement('div');
    bar.className = 'wb-code-flashbar';
    bar.dataset.lines = `${first + 1}-${last + 1}`; // 1-based, for humans + tests
    bar.setAttribute('aria-hidden', 'true');
    // offsetTop/Left resolve to the textarea's BORDER box; its text content
    // sits inside the border, so add clientTop/Left (the border width) to keep
    // the flash bar aligned with the content rather than overlapping the border
    bar.style.top = `${textEl.offsetTop + textEl.clientTop + y}px`;
    bar.style.left = `${textEl.offsetLeft + textEl.clientLeft}px`;
    bar.style.width = textEl.clientWidth ? `${textEl.clientWidth}px` : '100%';
    bar.style.height = `${h}px`;
    shellEl.appendChild(bar); // the shell is the positioning context (#244)
    flashBar = bar;
    const done = (): void => {
      if (flashBar === bar) flashBar = null;
      bar.remove();
    };
    bar.addEventListener('animationend', done);
    flashTimer = window.setTimeout(done, 1600); // fallback for DOMs without CSS animation
  };

  textEl.addEventListener('input', () => { setDirty(); clearImportError(); clearFlash(); });
  sanitizeEl.addEventListener('change', () => { clearDirty(); regenerate(); });

  // ── #244 the IDE dressing: highlight overlay, gutter, completions ──
  // Mounted AFTER the input listener above so on every keystroke the buffer
  // is marked dirty first, then the overlay repaints — the scope bar never
  // paints one frame of stale offsets.
  const ide = mountJsonIde(shellEl, textEl, {
    fields: () => state.fields,
    completionOpts: () => ({
      current: state.fields.find((f) => f.name === state.currentFieldName),
      ctx: state.rows.length ? ctxForRow(0) : undefined,
    }),
    selectionRange: () => {
      if (dirty || !state.selection) return null; // hand-edit: offsets are stale
      const r = rangeForPath(mapRanges, state.selection);
      return r ? { start: fullToDisplayed(r.start), end: fullToDisplayed(r.end) } : null;
    },
    // #PR-C: the fold bridge — chevrons, gapped numbers, edit guards
    folds: {
      usable: () => !dirty,
      active: () => !!foldView,
      expandAll: () => expandAllFolds(),
      foldableFoldedLines: () => {
        if (dirty) return [];
        const out: Array<{ line: number; folded: boolean; label: string }> = [];
        for (const r of mapRanges) {
          const cut = cutForRange(fullText, r);
          if (!cut) continue;
          const key = pathKey(r.path);
          const foldedHere = activeFoldKeys.includes(key);
          const openerDisplayed = fullToDisplayed(r.start);
          // hidden inside an ANCESTOR's fold: its opener sits in a sentinel
          if (!foldedHere && foldView && foldView.cutIndexAtFolded(openerDisplayed) >= 0) continue;
          out.push({
            line: lineOfOffset(textEl.value, openerDisplayed),
            folded: foldedHere,
            label: `element ${key.replaceAll('/', '.')}`,
          });
        }
        return out;
      },
      toggleAtFoldedLine: (line: number) => {
        if (dirty) return;
        for (const r of mapRanges) {
          const cut = cutForRange(fullText, r);
          if (!cut) continue;
          if (lineOfOffset(textEl.value, fullToDisplayed(r.start)) !== line) continue;
          const key = pathKey(r.path);
          if (foldedPaths.has(key)) foldedPaths.delete(key);
          else foldedPaths.add(key);
          applyFolds();
          return;
        }
      },
      fullLineNumber: (l: number) => (foldView ? fullLineOfFoldedLine(foldView, fullText, l) : l),
    },
    // an accepted completion is buffer input like any other keystroke (the
    // execCommand path re-enters via the input listener instead)
    onSplice: () => { setDirty(); clearImportError(); clearFlash(); },
  });

  // ── #PR-B Format document: buffer-only pretty print, never an Apply.
  // Canonical (importJson → the deterministic serializer) when the buffer
  // parses; tolerant re-indent + the parse error when it doesn't. The dirty
  // flag is deliberately untouched — a formatted hand-edit still needs Apply,
  // and a clean buffer is already canonical so the swap is a no-op. ──
  const formatCmd = (): void => {
    expandAllFolds(); // format is a buffer op on the full text (no-op when clean+canonical)
    const res = formatDocument(textEl.value, { sanitizeWhitespace: sanitizeEl.checked });
    if (res.text !== textEl.value) {
      ide.closeMenu(); // a swapped buffer would orphan the menu's offsets
      const selStart = textEl.selectionStart ?? 0;
      const selEnd = textEl.selectionEnd ?? selStart;
      const { scrollTop, scrollLeft } = textEl;
      const prev = textEl.value;
      textEl.value = res.text;
      textEl.setSelectionRange(preserveCaret(prev, res.text, selStart), preserveCaret(prev, res.text, selEnd));
      textEl.scrollTop = scrollTop;
      textEl.scrollLeft = scrollLeft;
      clearFlash();
      ide.repaint();
    }
    if (res.tier === 'reindent') {
      importErrorEl.textContent = `Format is re-indent only until the JSON parses — ${res.error}`;
      importErrorEl.hidden = false;
      onToast('Re-indented. Fix the parse error for canonical formatting.');
    } else {
      clearImportError();
      onToast('Formatted');
    }
  };
  menuHost.querySelector('#wb-json-format')!.addEventListener('click', formatCmd);
  textEl.addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
      e.preventDefault();
      formatCmd();
      return;
    }
    // #PR-C fold commands (clean buffer only): Ctrl+Shift+[ folds the element
    // at the caret; Ctrl+Shift+] unfolds the fold containing it
    if (e.ctrlKey && e.shiftKey && (e.key === '{' || e.key === '[')) {
      e.preventDefault();
      if (dirty) return;
      const path = pathAtOffset(mapRanges, displayedToFull(textEl.selectionStart ?? 0));
      if (path) {
        foldedPaths.add(pathKey(path));
        applyFolds();
      }
      return;
    }
    if (e.ctrlKey && e.shiftKey && (e.key === '}' || e.key === ']')) {
      e.preventDefault();
      if (!foldView) return;
      const fullCaret = foldView.toFull(textEl.selectionStart ?? 0);
      const idx = foldView.cuts.findIndex((c) => fullCaret >= c.start && fullCaret <= c.end);
      if (idx >= 0) {
        foldedPaths.delete(activeFoldKeys[idx]);
        applyFolds();
      }
    }
  });

  // #PR-C kebab commands: focus the selection / show everything
  const isPrefix = (p: number[], q: number[]): boolean => p.length <= q.length && p.every((v, i) => q[i] === v);
  menuHost.querySelector('#wb-json-fold-others')!.addEventListener('click', () => {
    if (dirty) return;
    const sel = state.selection;
    for (const r of mapRanges) {
      if (r.path.length === 0) continue; // never fold the root — that's the whole doc
      if (sel && (isPrefix(r.path, sel) || isPrefix(sel, r.path))) continue; // keep the selection's chain open
      if (cutForRange(fullText, r)) foldedPaths.add(pathKey(r.path));
    }
    applyFolds();
  });
  menuHost.querySelector('#wb-json-expand-all')!.addEventListener('click', () => {
    foldedPaths.clear();
    expandAllFolds();
  });

  menuHost.querySelector('#wb-json-copy')!.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(exportJson(state.doc, { sanitizeWhitespace: sanitizeEl.checked, keepMeta: namesEl.checked }));
      onToast('Formatter JSON copied');
    } catch {
      onToast('Copy failed — clipboard access blocked (select the text and use Ctrl/Cmd+C)');
    }
  });
  menuHost.querySelector('#wb-json-copy-csom')!.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(exportJson(state.doc, { sanitizeWhitespace: sanitizeEl.checked, keepMeta: namesEl.checked, csomSafe: true }));
      onToast('CSOM-safe JSON copied (& and < escaped)');
    } catch {
      onToast('Copy failed — clipboard access blocked (select the text and use Ctrl/Cmd+C)');
    }
  });
  menuHost.querySelector('#wb-json-download')!.addEventListener('click', () => {
    const blob = new Blob([exportJson(state.doc, { sanitizeWhitespace: sanitizeEl.checked, keepMeta: namesEl.checked })], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${state.doc.kind}-formatter.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  host.querySelector('#wb-json-apply')!.addEventListener('click', () => {
    try {
      // #PR-C: folds are a view — Apply always parses the FULL text
      const doc = importJson(foldView ? fullText : textEl.value);
      // soft guard: name-less JSON replacing a named design silently drops
      // every _elmName — the Structure pane falls back to type/class hints
      if (treeHasNames(state.doc.root) && !treeHasNames(doc.root)) {
        if (!confirm('The JSON you are applying has no element names (_elmName), but your current design is named.\n\nApplying will drop those names from the Structure pane. Apply anyway?')) return;
      }
      clearDirty();
      clearImportError();
      state.loadDocument(doc);
      // a column payload doesn't replace the surface — it becomes the current
      // field's LOOK, rendered embedded in its grid cell
      onToast(doc.kind === 'column'
        ? `Imported column formatter — applied as the ${state.currentFieldName} column's look`
        : `Imported ${doc.kind} formatter`);
    } catch (e) {
      const msg = `Import failed: ${(e as Error).message}`;
      onToast(msg);
      importErrorEl.textContent = msg;
      importErrorEl.hidden = false;
    }
  });

  // ── deploy: the Tier-0 bridge (docs/CONNECTIVITY.md §3.3) ──
  const deployPanel = host.querySelector('#wb-deploy-panel') as HTMLDivElement;
  const deployTargetEl = host.querySelector('#wb-deploy-target') as HTMLDivElement;
  const deployViewEl = host.querySelector('#wb-deploy-view') as HTMLInputElement;
  const deployListEl = host.querySelector('#wb-deploy-list') as HTMLInputElement;

  /** Where the formatter lands: the canvas doc is always a surface now
   *  (grid/row/tile), shipping as a view's row/tile formatting. Per-column
   *  JSON comes from the column's header menu, not the deploy panel. */
  const deployTarget = (): { target: 'view'; name: string; label: string } => ({
    target: 'view',
    name: deployViewEl.value.trim() || 'All Items',
    label: '→ a view\'s CustomFormatter (row/tile formatting):',
  });

  const refreshDeployPanel = () => {
    if (deployPanel.hidden) return;
    deployTargetEl.textContent = `Deploys ${deployTarget().label}`;
    deployViewEl.hidden = false;
  };

  // The head kebab (⋮ beside the JSON ⇄ Explain tabs, markup owned by the app
  // shell) — same open/close contract as the topbar ☰ menu: outside pointerdown
  // closes, choosing an action closes; checkbox options keep it open. Absent in
  // bare test mounts, so wiring is conditional.
  const kebabBtn = document.getElementById('wb-json-kebab') as HTMLButtonElement | null;
  const kebabPanel = document.getElementById('wb-json-kebab-panel') as HTMLDivElement | null;
  // named so the host's _unsub teardown can remove it (document-level listener;
  // tests remount this panel — see jsonPanel.sync.test.ts's teardown discipline)
  // All three handlers are NAMED and removed in the host's _unsub below: the
  // kebab elements are persistent shell DOM (not recreated by host.innerHTML),
  // so a re-mount would otherwise stack listeners — and a doubled toggle
  // opens-then-closes, presenting as a dead button.
  const closeKebabOnOutside = (e: PointerEvent): void => {
    if (kebabBtn && kebabPanel && !kebabPanel.hidden
      && !(kebabBtn.parentElement as HTMLElement).contains(e.target as Node)) kebabPanel.hidden = true;
  };
  const toggleKebab = (): void => { if (kebabPanel) kebabPanel.hidden = !kebabPanel.hidden; };
  const closeKebabOnItem = (e: Event): void => {
    if (kebabPanel && (e.target as HTMLElement).closest('button')) kebabPanel.hidden = true;
  };
  if (kebabBtn && kebabPanel) {
    kebabBtn.addEventListener('click', toggleKebab);
    document.addEventListener('pointerdown', closeKebabOnOutside);
    kebabPanel.addEventListener('click', closeKebabOnItem);
  }

  menuHost.querySelector('#wb-json-deploy')!.addEventListener('click', () => {
    // the deploy config lives in the JSON tab — surface it if Explain is up front
    const jsonTab = document.getElementById('wb-side-tab-json');
    if (jsonTab && !jsonTab.classList.contains('active')) jsonTab.click();
    deployPanel.hidden = !deployPanel.hidden;
    refreshDeployPanel();
  });

  // both deploy paths refuse-and-teach on lint errors: SP would accept a
  // broken write and render blank. Same gate as buildDeploySnippet expects.
  const passesLintGate = (): boolean => {
    const errors = lintDocument(
      state.doc,
      state.fields.map((f) => f.name),
      Object.fromEntries(state.fields.map((f) => [f.name, f.type])),
    ).filter((i) => i.severity === 'error');
    if (errors.length) {
      onToast(`Not deploying with ${errors.length} lint error${errors.length === 1 ? '' : 's'} — SP would accept the write and render blank. Fix the red items below first.`);
      return false;
    }
    return true;
  };

  // never csomSafe here: REST (snippet MERGE and the extension alike) stores the raw string
  const currentFormatterJson = (): string =>
    exportJson(state.doc, { sanitizeWhitespace: sanitizeEl.checked, keepMeta: namesEl.checked });

  host.querySelector('#wb-deploy-copy')!.addEventListener('click', async () => {
    if (!passesLintGate()) return;
    const t = deployTarget();
    const snippet = buildDeploySnippet({
      target: t.target,
      name: t.name,
      formatterJson: currentFormatterJson(),
      ...(deployListEl.value.trim() ? { listTitle: deployListEl.value.trim() } : {}),
    });
    try {
      await navigator.clipboard.writeText(snippet);
      onToast(`Deploy snippet copied for the "${t.name}" view — run it in the console on your list page; it confirms before writing`);
    } catch {
      onToast('Copy failed — clipboard access blocked (select the text and use Ctrl/Cmd+C)');
    }
  });

  /** Current formatter as an apply payload, honouring the panel's toggles. */
  const currentApplyPayload = () => buildCurrentApplyPayload({
    viewTitle: deployViewEl.value,
    listTitle: deployListEl.value,
    sanitize: sanitizeEl.checked,
    keepMeta: namesEl.checked,
  });

  host.querySelector('#wb-deploy-apply-ext')!.addEventListener('click', async () => {
    const { payload, error } = currentApplyPayload();
    if (!payload) { onToast(error!); return; }
    const t = deployTarget();
    try {
      await navigator.clipboard.writeText(serializeApplyPayload(payload));
      onToast(`Copied for the extension (the "${t.name}" view) — on your list tab, click the FormatFX extension → Apply from clipboard`);
    } catch {
      onToast('Copy failed — clipboard access blocked (select the text and use Ctrl/Cmd+C)');
    }
  });

  // ── live channel: when the companion extension is present, offer a
  // clipboard-free hand-off. The write still happens on the list tab. ──
  const sendExtBtn = host.querySelector('#wb-deploy-send-ext') as HTMLButtonElement;
  onExtensionReady(() => { sendExtBtn.hidden = false; });
  sendExtBtn.addEventListener('click', async () => {
    const { payload, error } = currentApplyPayload();
    if (!payload) { onToast(error!); return; }
    try {
      const { staged } = await stageApplyToExtension(payload);
      onToast(`Sent to the extension (${staged} formatter) — switch to your SharePoint list tab and click the FormatFX extension → Apply staged`);
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e));
    }
  });

  const renderLint = (runtime: RenderIssue[]): { errors: number; warnings: number; runtime: number } => {
    const issues = lintDocument(
      state.doc,
      state.fields.map((f) => f.name),
      Object.fromEntries(state.fields.map((f) => [f.name, f.type])),
    );
    lintEl.innerHTML = '';
    const all: Array<{ sev: string; text: string; path: number[] }> = [
      ...issues.map((i: LintIssue) => ({ sev: i.severity, text: `${i.rule}: ${i.message}`, path: i.path })),
      ...runtime.map((r) => ({ sev: 'runtime', text: r.message, path: r.path })),
    ];
    const errors = issues.filter((i: LintIssue) => i.severity === 'error').length;
    const warnings = issues.filter((i: LintIssue) => i.severity === 'warning').length;
    if (all.length === 0) {
      lintEl.innerHTML = '<div class="wb-lint-ok">✓ No issues — schema-clean and expression-safe.</div>';
      return { errors: 0, warnings: 0, runtime: 0 };
    }
    for (const issue of all) {
      const row = document.createElement('div');
      row.className = `wb-lint-item wb-lint-${issue.sev}`;
      // Lead with a severity badge: glyph (shape) + word, so the level reads
      // without relying on the stripe colour alone (WCAG 1.4.1). The glyph is
      // decorative — the word carries the meaning, echoed in the row aria-label.
      const { glyph, label } = lintBadge(issue.sev);
      const badge = document.createElement('span');
      badge.className = 'wb-lint-badge';
      const glyphEl = document.createElement('span');
      glyphEl.className = 'wb-lint-glyph';
      glyphEl.setAttribute('aria-hidden', 'true');
      glyphEl.textContent = glyph;
      badge.append(glyphEl, document.createTextNode(` ${label}`));
      const msg = document.createElement('span');
      msg.className = 'wb-lint-msg';
      msg.textContent = issue.text;
      row.append(badge, msg);
      row.title = `Click to select node [${issue.path.join(' › ')}]`;
      row.setAttribute('aria-label', lintAriaLabel(issue.sev, issue.text));
      // The row acts as a button (jump to the node), so make it operable — and
      // its severity announceable — by keyboard, not mouse only.
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      const jump = (): void => state.select(issue.path);
      row.addEventListener('click', jump);
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jump(); }
      });
      lintEl.appendChild(row);
    }
    return { errors, warnings, runtime: runtime.length };
  };

  const hostAny = host as any;
  if (typeof hostAny._unsub === 'function') {
    hostAny._unsub();
  }
  const stateUnsub = state.subscribe((reason) => {
    if (reason === 'selection') {
      // #218 canvas → code — unless the selection ORIGINATED here (the echo
      // guard): a code-side caret move must not bounce back and scroll/flash
      // the very textarea it came from. The scope bar tracks EVERY selection
      // (echoed included) — marking where you are is its whole job.
      if (!echo.from('code')) revealSelection();
      ide.refreshScope();
      return;
    }
    if (reason !== 'theme') { clearDirty(); regenerate(); refreshDeployPanel(); }
  });
  hostAny._unsub = () => {
    stateUnsub();
    document.removeEventListener('pointerdown', closeKebabOnOutside);
    kebabBtn?.removeEventListener('click', toggleKebab);
    kebabPanel?.removeEventListener('click', closeKebabOnItem);
  };
  regenerate();
  renderLint([]);

  return { refreshLint: renderLint };
}
