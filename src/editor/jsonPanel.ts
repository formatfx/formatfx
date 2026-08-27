// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Sam Yost

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
 *
 * #PR-D — the live working map (spec 2026-07-09 §4–5): while dirty, a
 * per-frame-debounced tolerant parse (core/jsonText) refreshes a WORKING
 * path map + positioned errors, so the scope bar, the breadcrumb strip and
 * the squiggle layer keep understanding a half-typed buffer. View affordances
 * read `rangesNow()` (live while dirty, serializer map while clean);
 * caret→canvas selection deliberately does NOT (#218 — a half-typed buffer
 * must never drive selection). Lint issues underline their element's opening
 * line; hovers explain squiggles, refs, functions and formulas (jsonHover).
 */

import { state, samePath, CARD_SEGMENT } from './state';
import { parseComponentDefJson } from './components';
import { componentById } from './componentLibrary';
import { exportJson, importJson, treeHasNames } from '../core/serializer';
import {
  exportJsonWithMap, pathAtOffset, rangeForPath, childrenRangeForPath,
  type JsonRange, type JsonSection, type JsonChildrenRange,
} from '../core/jsonMap';
import { parseJsonWithMap, type TextParseError } from '../core/jsonText';
import { preserveCaret, lineSpanOf, lineOfOffset, selectionEcho } from './codeSync';
import { foldState, childrenFoldKey, childrenPathOfKey } from './foldState';
import { mountJsonIde } from './jsonIde';
import { decorationsFrom, type Decoration } from './jsonDecorations';
import { hoverAt as hoverInfoAt } from './jsonHover';
import { evalChipAt } from './exprPreview';
import { SYN_SLOTS, loadSynPrefs, saveSynPrefs, applySynPrefs } from './synPalette';
import { formatDocument } from './jsonFormat';
import type { NodePath } from '../core/types';
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
import {
  buildLintView, inferFieldType, loadLintPrefs, saveLintPrefs,
  type MissingColumnRow, type SeverityTally,
} from './lintView';
import { FIELD_TYPE_OPTIONS } from '../core/schemaImport';
import type { FieldType, MockField } from '../core/types';
import type { RenderIssue } from '../core/renderer';

export interface JsonPanelApi {
  refreshLint: (runtime: RenderIssue[]) => { errors: number; warnings: number; runtime: number };
}

export function mountJsonPanel(host: HTMLElement, onToast: (m: string) => void): JsonPanelApi {
  host.innerHTML = `
    <div class="wb-json-toolbar">
      <div class="wb-json-actions">
        <button id="wb-json-apply" title="Parse the JSON below back into the visual editor">⬅ Apply to canvas</button>
        <button id="wb-json-copy-btn" class="wb-json-copybtn" title="Copy the compiled formatter JSON to the clipboard">COPY JSON</button>
        <button id="wb-json-revert" hidden title="Throw away the hand-edits in this pane and re-sync it from the canvas — the canvas document is untouched">↩ Discard edits</button>
      </div>
    </div>
    <div id="wb-json-compbar" class="wb-json-compbar" hidden></div>
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
    <div id="wb-syn-panel" class="wb-syn-panel" hidden></div>
    <div class="wb-json-crumbrow">
      <div id="wb-json-crumbs" class="wb-json-crumbs" aria-label="Element path at the caret" hidden></div>
      <span id="wb-json-size" class="wb-json-size" title="Size of the JSON that Copy produces, with the current sanitize/names toggles"></span>
    </div>
    <div id="wb-json-shell" class="wb-json-shell wb-codesync">
      <textarea id="wb-json-text" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off"></textarea>
    </div>
    <div id="wb-json-import-error" class="wb-import-error" role="alert" aria-live="assertive" hidden></div>
    <div id="wb-lint" class="wb-lint"></div>
  `;

  // The pane chrome is one slim head row (JSON ⇄ Explain + ⋮, owned by the app
  // shell) plus the Apply / Copy row above the editor — a quick COPY JSON sits
  // beside Apply, and every other JSON action lives in the head's ⋮ dropdown
  // (owner call, #257 follow-up). The shell provides the dropdown slot; bare
  // test mounts get a hidden local stand-in so the controls (and regenerate's
  // option reads) keep existing.
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
        <button id="wb-json-syncolors" title="Tune the expression syntax-highlight colors for the current theme (stored locally, per theme)">Syntax colors…</button>
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
  const revertBtn = host.querySelector('#wb-json-revert') as HTMLButtonElement;
  let dirty = false;
  // The dirty-buffer safety trio (owner ask 2026-07-13): while the buffer is
  // dirty the DOCUMENT keeps moving (canvas edits, undo, imports) but the
  // buffer never gets clobbered — instead this flag remembers the fork, the
  // canvas dims behind a body-level class (non-blocking: browsing/selecting
  // stay free), and Apply confirms before overwriting the diverged canvas.
  let divergedWhileDirty = false;

  // ── COMPONENT MODE (the doc-switcher feature): while a ⬡ workshop tab is
  // active the pane shows/edits the STAGED def instead of the surface doc.
  // `bufferDefId` is the def the CURRENT BUFFER was generated from (null =
  // surface); every mode gate keys off the BUFFER's origin, not the active
  // tab, so a dirty surface draft keeps its surface tools — and is never
  // clobbered — until Apply or Discard. ──
  let bufferDefId: string | null = null;
  /** The serialized staged def this component buffer forked from — the
   *  divergence check compares against THIS, so register/unregister churn
   *  (tab switches) can never fake a "workshop changed" confirm. */
  let bufferBaseline = '';
  const compBarEl = host.querySelector('#wb-json-compbar') as HTMLDivElement;
  /** The workshop seam while a component tab is up — null for the frame
   *  between the tab activating and its workshop registering ('workshop'
   *  announces the registration and re-runs regenerate). */
  const activeWorkshop = () => (state.activeComponentTab !== null ? state.workshopCtx : null);

  const clearImportError = (): void => { importErrorEl.hidden = true; importErrorEl.textContent = ''; };
  const setDirty = () => {
    dirty = true;
    // EVERY keystroke stales the parsed offsets — not just the first one. The
    // live map and its decorations drop immediately (scope bar hides, squiggle
    // layer paints nothing) and the debounced parse rebuilds them a frame
    // later: blank beats wrong (PR #272 review).
    liveRanges = null;
    liveErrors = [];
    liveLabels = {};
    decorations = [];
    textEl.classList.add('wb-json-dirty');
    shellEl.classList.add('wb-json-dirty'); // the border lives on the shell now
    applyBtn.classList.add('wb-json-apply-pending');
    revertBtn.hidden = false; // the way out that isn't Apply
    document.body.classList.add('wb-json-editing'); // dims the canvas (CSS)
    ide.refreshScope(); // stale offsets: hidden until the live parse lands (#PR-D, a frame)
  };
  const clearDirty = () => {
    dirty = false;
    divergedWhileDirty = false; // divergence only accumulates while dirty
    textEl.classList.remove('wb-json-dirty');
    shellEl.classList.remove('wb-json-dirty');
    applyBtn.classList.remove('wb-json-apply-pending');
    revertBtn.hidden = true;
    document.body.classList.remove('wb-json-editing');
  };

  // ── #218 split-view sync state ──
  let mapRanges: JsonRange[] = []; // offset↔path map for the FULL (unfolded) text
  let mapSections: JsonSection[] = []; // foldable wrapper sections (groupProps, commandBarProps …)
  let mapChildren: JsonChildrenRange[] = []; // foldable `children` arrays, by parent path
  // the SHARED echo (codeSync.ts): the canvas consults it too, to skip its
  // synced selection pulse for caret-originated selections
  const echo = selectionEcho;

  // ── #PR-D the live working map + decorations. While dirty, the debounced
  // parse below refreshes these so VIEW affordances (scope bar, breadcrumb,
  // squiggles, lint-row flash) keep tracking the hand-edited buffer; they
  // reset to the serializer's truth on every regenerate. `decorations` is
  // kept in DISPLAYED coordinates (fold-translated) — folds only exist on
  // clean buffers, so the two coordinate systems are never both non-trivial. ──
  let liveRanges: JsonRange[] | null = null;
  let liveErrors: TextParseError[] = [];
  let liveLabels: Record<string, string> = {};
  let lintIssues: LintIssue[] = [];
  let decorations: Decoration[] = [];
  const rangesNow = (): JsonRange[] => (dirty && liveRanges ? liveRanges : mapRanges);
  const crumbsEl = host.querySelector('#wb-json-crumbs') as HTMLDivElement;

  // ── #PR-C subtree folding: a clean-buffer-only VIEW over the textarea.
  // `fullText` is authoritative; the textarea shows foldView.text when folds
  // are active. Every offset consumer translates through these two maps.
  // Edits never coexist with folds (the beforeinput guard below expands
  // first), so folds never meet the undo stack.
  // WHICH nodes are folded lives in the SHARED foldState set (2026-07-16) —
  // the Structure tree reads and writes the same keys, so folding syncs
  // between the two surfaces. This panel stays the owner of the VIEW (cuts,
  // sentinel text, caret math) and of pruning keys that stop resolving. ──
  let fullText = '';
  let foldView: FoldView | null = null;
  let activeFoldKeys: string[] = [];       // aligned with foldView.cuts

  const displayedToFull = (o: number): number => (foldView ? foldView.toFull(o) : o);
  const fullToDisplayed = (o: number): number => (foldView ? foldView.toFolded(o) : o);
  /** Whether a FULL-text offset sits strictly inside one of the active cuts
   *  (i.e. is elided into a sentinel right now). */
  const hiddenInActiveFold = (fullOff: number): boolean =>
    !!foldView && foldView.cuts.some((c) => fullOff > c.start && fullOff < c.end);
  const pathKey = (p: number[]): string => p.join('/');
  // wrapper-SECTION fold keys ride the same foldedPaths set, namespaced with
  // '@' so they can never read as a numeric element path ('@groupProps',
  // '@commandBarProps/commands' …) — resolved against mapSections
  const sectionKey = (s: JsonSection): string => `@${s.key}`;
  const sectionForKey = (key: string): JsonSection | null =>
    (key.startsWith('@') ? mapSections.find((s) => s.key === key.slice(1)) ?? null : null);

  /** Re-derive the fold view from the shared foldState against the current
   *  map. Pure state — callers own the textarea swap (they know their caret
   *  rules). Keys that stop resolving (node deleted, no longer multi-line)
   *  are pruned from the shared set, so the tree un-collapses with them. */
  const rebuildFoldView = (): void => {
    const resolved: Array<{ key: string; cut: FoldCut }> = [];
    const stale: string[] = [];
    for (const key of foldState.keys()) {
      let range: { start: number; end: number } | null;
      const childrenOf = childrenPathOfKey(key);
      if (childrenOf) {
        range = childrenRangeForPath(mapChildren, childrenOf);
      } else if (key.startsWith('@')) {
        range = sectionForKey(key);
      } else {
        const path = key === '' ? [] : key.split('/').map(Number);
        range = rangeForPath(mapRanges, path);
      }
      const cut = range ? cutForRange(fullText, range) : null;
      if (cut) resolved.push({ key, cut });
      else stale.push(key); // the node no longer exists / no longer folds
    }
    if (stale.length) foldState.update('json', (set) => stale.forEach((k) => set.delete(k)));
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
    if (next !== textEl.value) {
      textEl.value = next;
      clearFlash(); // displayed lines moved — the bar's geometry is a lie now
    }
    textEl.setSelectionRange(fullToDisplayed(fullSelStart), fullToDisplayed(fullSelEnd));
    textEl.scrollTop = scrollTop;
    textEl.scrollLeft = scrollLeft;
    refreshDecorations(); // displayed coordinates changed with the view
    ide.repaint();
    refreshCrumbs();
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
    const wctx = activeWorkshop();
    // a component tab is active but its workshop hasn't registered yet — or
    // the seam still belongs to the OUTGOING workshop mid tab-switch (this
    // pane subscribes before the strip). Keep the old buffer for the frame;
    // the incoming workshop's 'workshop' announce re-runs us.
    if (state.activeComponentTab !== null
      && (!wctx || wctx.def().id !== state.activeComponentTab)) return;
    if (wctx) {
      // ── component mode: the staged def, verbatim. No offset↔path map and
      // no folds (that machinery is surface-doc-shaped — the PR after this
      // one adapts it), and the SHARED fold set stays untouched: the
      // Structure tree resolves it against the staged tree right now, so
      // pruning against our empty map would wipe the workshop's folds.
      const def = wctx.def();
      bufferDefId = def.id;
      delete def.builtin; // save-flow bookkeeping, not component content
      mapRanges = [];
      mapSections = [];
      mapChildren = [];
      liveRanges = null;
      liveErrors = [];
      liveLabels = {};
      foldView = null;
      activeFoldKeys = [];
      const text = JSON.stringify(def, null, 2);
      bufferBaseline = text; // the staged snapshot this buffer forks from
      const selStart = preserveCaret(fullText, text, textEl.selectionStart ?? 0);
      const selEnd = preserveCaret(fullText, text, textEl.selectionEnd ?? textEl.selectionStart ?? 0);
      fullText = text;
      syncFoldDisplay(selStart, selEnd);
      clearImportError();
      refreshSizeMeter();
      refreshComponentChrome();
      return;
    }
    bufferDefId = null;
    // the editor view keeps _elmName so "Apply to canvas" never loses names
    const { text, ranges, sections, childrenRanges } = exportJsonWithMap(state.doc, { sanitizeWhitespace: sanitizeEl.checked, keepMeta: true });
    mapRanges = ranges;
    mapSections = sections;
    mapChildren = childrenRanges;
    liveRanges = null; // the serializer's map is the truth again
    liveErrors = [];
    liveLabels = {};
    const oldFull = fullText;
    // caret: displayed → old full → (deterministic-serializer diff) → new full
    const selStart = preserveCaret(oldFull, text, displayedToFull(textEl.selectionStart ?? 0));
    const selEnd = preserveCaret(oldFull, text, displayedToFull(textEl.selectionEnd ?? textEl.selectionStart ?? 0));
    fullText = text;
    rebuildFoldView(); // folds are path-keyed: survivors re-apply, the rest drop
    syncFoldDisplay(selStart, selEnd);
    clearImportError(); // stale error no longer matches what's in the textarea
    refreshSizeMeter(); // the doc changed — so did what Copy would produce
    refreshComponentChrome();
  };

  // ── #PR-E size meter: the byte count of what COPY produces with the
  // current toggles (names/sanitize) — the doc's truth, so a dirty buffer
  // doesn't move it until Apply. No threshold judgment: the SP formatting
  // docs document no JSON size cap (checked 2026-07-10, per spec §6). ──
  const sizeEl = host.querySelector('#wb-json-size') as HTMLSpanElement;
  /** What Copy/Download produce — the DOC's truth for the current mode: the
   *  compiled formatter on a surface, the staged def in component mode (a
   *  dirty buffer moves neither until Apply). Null when the buffer is an
   *  ORPHANED component draft — its workshop tab left while dirty — because
   *  no doc truth is reachable then: exporting the surface (or a DIFFERENT
   *  workshop's def) labeled as this component's would lie (Copilot review,
   *  PR #312). csom escapes &/< the way the serializer's csomSafe does —
   *  safe as a text op because JSON syntax has no bare & or < outside
   *  strings. */
  const exportText = (opts: { csom?: boolean } = {}): string | null => {
    if (bufferDefId !== null) {
      const wctx = activeWorkshop();
      const def = wctx?.def();
      if (!def || def.id !== bufferDefId) return null;
      delete def.builtin; // save-flow bookkeeping, not component content
      const t = JSON.stringify(def, null, 2);
      return opts.csom ? t.replace(/&/g, '\\u0026').replace(/</g, '\\u003c') : t;
    }
    return exportJson(state.doc, {
      sanitizeWhitespace: sanitizeEl.checked, keepMeta: namesEl.checked,
      ...(opts.csom ? { csomSafe: true } : {}),
    });
  };
  const orphanExportToast = (): void =>
    onToast('This draft\'s workshop isn\'t active — open its ⬡ tab to copy or download the component JSON');
  const sizeTitleDefault = sizeEl.title;
  const refreshSizeMeter = (): void => {
    const out = exportText();
    if (out === null) { // orphaned component draft — nothing measurable
      sizeEl.textContent = '—';
      sizeEl.title = 'Open the component\'s ⬡ tab to measure or copy its JSON';
      return;
    }
    sizeEl.title = sizeTitleDefault;
    const bytes = typeof TextEncoder === 'function' ? new TextEncoder().encode(out).length : out.length;
    sizeEl.textContent = bytes < 10240
      ? `${bytes.toLocaleString()} B`
      : `${(bytes / 1024).toFixed(1)} KB`;
  };

  // ── #218 code → canvas: a caret landing inside an element selects it ──
  // Wired to user gestures only (click / keyup) so programmatic value swaps
  // can never masquerade as a caret move; typing marks the buffer dirty
  // before keyup fires, so hand-edits (stale offsets) never mis-select.
  const syncSelectionFromCaret = (): void => {
    if (dirty) return; // hand-edited text: offsets are stale until Apply
    if (bufferDefId !== null) return; // component mode: def offsets aren't surface paths (PR 2 adapts this)
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
        foldState.update('json', (set) => set.delete(activeFoldKeys[idx]));
        rebuildFoldView();
        syncFoldDisplay(caretFull, caretFull);
        return;
      }
    }
    syncSelectionFromCaret();
    refreshCrumbs();
  });
  textEl.addEventListener('keyup', () => { syncSelectionFromCaret(); refreshCrumbs(); });

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
  let flashTop = 0;    // the bar's CONTENT-space top (scroll-independent) …
  let flashHeight = 0; // … and height — set when the bar is created
  const clearFlash = (): void => {
    window.clearTimeout(flashTimer);
    flashBar?.remove();
    flashBar = null;
  };
  /** Glue the bar to its lines at the current scrollTop, clipped to the
   *  textarea's viewport (scrolled fully out = hidden, not cleared — scrolling
   *  back mid-animation shows the remainder). offsetTop/Left resolve to the
   *  textarea's BORDER box; its text sits inside the border, so clientTop/Left
   *  (the border width) keeps the bar aligned with the content. */
  const positionFlashBar = (): void => {
    if (!flashBar) return;
    let y = flashTop - textEl.scrollTop;
    let h = flashHeight;
    if (textEl.clientHeight > 0) { // test DOMs have no layout — skip clipping
      const y0 = Math.max(0, y);
      const y1 = Math.min(textEl.clientHeight, y + h);
      if (y1 <= y0) { flashBar.style.display = 'none'; return; }
      y = y0;
      h = y1 - y0;
    }
    flashBar.style.display = '';
    flashBar.style.top = `${textEl.offsetTop + textEl.clientTop + y}px`;
    flashBar.style.height = `${h}px`;
  };
  // The bar TRACKS the viewport instead of dying with it. It used to be
  // cleared on any scroll — including the reveal's OWN programmatic scroll,
  // whose async scroll event killed the flash the moment the selected
  // element's lines needed scrolling into view. That's why big containers
  // (usually the _elmName'd ones) "never flashed" while small in-view leaves
  // did (owner report 2026-07-16).
  textEl.addEventListener('scroll', positionFlashBar);

  /** Line metrics for the monospace box (with fallbacks for test DOMs). */
  const lineHeightPx = (): number => {
    const cs = window.getComputedStyle(textEl);
    const lh = parseFloat(cs.lineHeight);
    if (Number.isFinite(lh) && lh > 0) return lh;
    const fs = parseFloat(cs.fontSize);
    return Number.isFinite(fs) && fs > 0 ? fs * 1.3 : 14;
  };

  /** Scroll a FULL-coordinate range into view and flash its lines — shared by
   *  canvas-selection reveals and lint-row jumps. NEVER moves the caret or
   *  focus — the reading/edit position is sacred (the echo-guard deal). */
  const flashRange = (range: { start: number; end: number }): void => {
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
    const bar = document.createElement('div');
    bar.className = 'wb-code-flashbar';
    bar.dataset.lines = `${first + 1}-${last + 1}`; // 1-based, for humans + tests
    bar.setAttribute('aria-hidden', 'true');
    bar.style.left = `${textEl.offsetLeft + textEl.clientLeft}px`;
    bar.style.width = textEl.clientWidth ? `${textEl.clientWidth}px` : '100%';
    shellEl.appendChild(bar); // the shell is the positioning context (#244)
    flashBar = bar;
    flashTop = top;
    flashHeight = bottom - top;
    positionFlashBar(); // top/height for the current scroll (and viewport clip)
    const done = (): void => {
      if (flashBar === bar) flashBar = null;
      bar.remove();
    };
    bar.addEventListener('animationend', done);
    flashTimer = window.setTimeout(done, 1600); // fallback for DOMs without CSS animation
  };

  /** Show where the primary selection lives in the JSON (canvas → code). */
  const revealSelection = (): void => {
    clearFlash();
    if (dirty) return; // don't fight a hand-edit in progress
    if (bufferDefId !== null) return; // surface selections have no lines in a def buffer
    const path = state.selection;
    if (!path) return;
    const range = rangeForPath(mapRanges, path);
    if (!range) return; // stale map (shouldn't happen) — just skip
    flashRange(range);
  };

  textEl.addEventListener('input', () => { setDirty(); clearImportError(); clearFlash(); scheduleLiveParse(); });
  sanitizeEl.addEventListener('change', () => {
    // regenerating re-renders the DOC — on a dirty buffer that discards the
    // hand-edits, which this toggle used to do silently (a real footgun:
    // owner report 2026-07-13). Confirm first; declining flips the box back.
    if (dirty && !confirm('Re-rendering with the new whitespace setting discards your unapplied hand-edits in this pane. Continue?')) {
      sanitizeEl.checked = !sanitizeEl.checked;
      return;
    }
    clearDirty();
    regenerate();
  });
  namesEl.addEventListener('change', refreshSizeMeter); // names only change COPY output — and so the meter

  // ↩ Discard edits — the dirty buffer's way out that isn't Apply: drop the
  // hand-edits and re-sync from the canvas (the document is untouched).
  revertBtn.addEventListener('click', () => {
    if (!dirty) return;
    clearDirty();
    clearImportError();
    regenerate();
    onToast(bufferDefId !== null
      ? 'Hand-edits discarded — the pane shows the staged component again.'
      : 'Hand-edits discarded — the pane shows the canvas again.');
  });

  // ── #244 the IDE dressing: highlight overlay, gutter, completions ──
  // Mounted AFTER the input listener above so on every keystroke the buffer
  // is marked dirty first, then the overlay repaints — the scope bar never
  // paints one frame of stale offsets.
  const ide = mountJsonIde(shellEl, textEl, {
    // component mode gates: field completions, row-context hovers/eval and
    // the surface selection's scope bar are all surface-schema affordances —
    // PR 2 re-points them at slot keys; until then blank beats wrong
    fields: () => (bufferDefId !== null ? [] : state.fields),
    completionOpts: () => (bufferDefId !== null ? {} : {
      current: state.fields.find((f) => f.name === state.currentFieldName),
      ctx: state.rows.length ? ctxForRow(0) : undefined,
    }),
    selectionRange: () => {
      if (bufferDefId !== null) return null;
      if (!state.selection) return null;
      // #PR-D: while dirty the LIVE map takes over — hidden only for the
      // frame before the first parse lands (stale offsets must never paint)
      if (dirty && !liveRanges) return null;
      const r = rangeForPath(rangesNow(), state.selection);
      return r ? { start: fullToDisplayed(r.start), end: fullToDisplayed(r.end) } : null;
    },
    // #PR-D squiggles + hovers: decisions live in jsonDecorations/jsonHover;
    // the panel just hands them its decoration list and field/row context
    decorations: () => decorations,
    hoverAt: (off) => (bufferDefId !== null ? null
      : hoverInfoAt(textEl.value, off, decorations, state.fields,
        { ctx: state.rows.length ? ctxForRow(0) : undefined })),
    // #PR-E the eval chip: the caret's live string through the REAL engine
    // against the sample row (same ctx source as completions — row 0; swap in
    // the canvas's active row here when that notion exists)
    evalChip: (off) => (bufferDefId !== null ? null
      : evalChipAt(textEl.value, off, state.rows.length ? ctxForRow(0) : undefined)),
    // #PR-C: the fold bridge — chevrons, gapped numbers, edit guards
    folds: {
      usable: () => !dirty && bufferDefId === null,
      active: () => !!foldView,
      expandAll: () => expandAllFolds(),
      foldableFoldedLines: () => {
        if (dirty || bufferDefId !== null) return [];
        const out: Array<{ line: number; folded: boolean; label: string }> = [];
        const add = (range: { start: number; end: number }, key: string, label: string): void => {
          const cut = cutForRange(fullText, range);
          if (!cut) return;
          const foldedHere = activeFoldKeys.includes(key);
          // hidden inside an ANCESTOR's fold — clamped offsets land ON the
          // sentinel's opener line, so test in FULL coordinates or interior
          // nodes stack ghost chevrons there (and steal the toggle's click)
          if (!foldedHere && hiddenInActiveFold(range.start)) return;
          out.push({ line: lineOfOffset(textEl.value, fullToDisplayed(range.start)), folded: foldedHere, label });
        };
        for (const r of mapRanges) {
          if (r.path.length === 0) continue; // the root never folds — it IS the document
          add(r, pathKey(r.path), `element ${pathKey(r.path).replaceAll('/', '.')}`);
        }
        // `children` arrays fold on their own line (owner ask 2026-07-16) —
        // the parent's properties stay visible, only the list collapses
        for (const c of mapChildren) {
          add(c, childrenFoldKey(c.path),
            c.path.length ? `children of element ${pathKey(c.path).replaceAll('/', '.')}` : 'children of the root');
        }
        // wrapper sections (groupProps + its header/footerFormatter trees,
        // commandBarProps/commands, top-level footerFormatter …) fold too
        for (const s of mapSections) {
          add(s, sectionKey(s), `section ${s.key.replaceAll('/', '.')}`);
        }
        return out;
      },
      toggleAtFoldedLine: (line: number) => {
        if (dirty || bufferDefId !== null) return;
        const toggle = (range: { start: number; end: number }, key: string): boolean => {
          if (!cutForRange(fullText, range)) return false;
          const foldedHere = activeFoldKeys.includes(key);
          // same hidden-interior rule as the chevron list — a node elided
          // into a sentinel must never swallow the visible chevron's click
          if (!foldedHere && hiddenInActiveFold(range.start)) return false;
          if (lineOfOffset(textEl.value, fullToDisplayed(range.start)) !== line) return false;
          foldState.update('json', (set) => {
            if (set.has(key)) set.delete(key);
            else set.add(key);
          });
          applyFolds();
          return true;
        };
        for (const r of mapRanges) {
          if (r.path.length === 0) continue; // the root never folds
          if (toggle(r, pathKey(r.path))) return;
        }
        for (const c of mapChildren) {
          if (toggle(c, childrenFoldKey(c.path))) return;
        }
        for (const s of mapSections) {
          if (toggle(s, sectionKey(s))) return;
        }
      },
      fullLineNumber: (l: number) => (foldView ? fullLineOfFoldedLine(foldView, fullText, l) : l),
    },
    // an accepted completion is buffer input like any other keystroke (the
    // execCommand path re-enters via the input listener instead)
    onSplice: () => { setDirty(); clearImportError(); clearFlash(); scheduleLiveParse(); },
  });

  // ── #PR-D: the debounced live parse + the decoration pipeline ──
  let liveParsePending = false;
  const scheduleLiveParse = (): void => {
    if (liveParsePending) return;
    liveParsePending = true;
    const raf: (cb: () => void) => void = typeof requestAnimationFrame === 'function'
      ? (cb) => requestAnimationFrame(() => cb())
      : (cb) => { window.setTimeout(cb, 16); };
    raf(() => {
      liveParsePending = false;
      if (!dirty) return; // regenerated/applied meanwhile — the clean map rules
      const res = parseJsonWithMap(textEl.value); // dirty ⇒ no folds ⇒ value IS the full text
      liveRanges = res.ranges;
      liveErrors = res.errors;
      liveLabels = res.labels;
      refreshDecorations();
      ide.refreshScope();
      refreshCrumbs();
    });
  };

  /** Rebuild the displayed-coordinate decoration list (parse errors while
   *  dirty + lint issues on their element's opening line) and repaint the
   *  squiggle layer. Fold translation drops fully-hidden decorations. */
  const refreshDecorations = (): void => {
    const full = dirty ? textEl.value : fullText;
    const decos = decorationsFrom(dirty ? liveErrors : [], lintIssues, rangesNow(), full);
    decorations = foldView
      ? decos
          .map((d) => ({ ...d, start: fullToDisplayed(d.start), end: fullToDisplayed(d.end) }))
          .filter((d) => d.end > d.start)
      : decos;
    ide.repaintSquiggles();
  };

  // ── #PR-D breadcrumb: the caret's element chain, labelled from the buffer
  // while dirty (jsonText labels) and from the doc while clean. A crumb click
  // is a code-originated selection — echoed exactly like a caret move, so the
  // pane never flashes/scrolls itself. ──
  const crumbLabel = (prefix: NodePath): string => {
    if (dirty) {
      const live = liveLabels[prefix.join('/')];
      if (live) return live;
    }
    const node = state.nodeAt(prefix) as { _elmName?: string; elmType?: string } | null;
    if (node) return node._elmName ?? node.elmType ?? 'element';
    const last = prefix[prefix.length - 1];
    return last === CARD_SEGMENT ? 'card' : `#${last ?? 0}`;
  };
  const refreshCrumbs = (): void => {
    if (bufferDefId !== null) { crumbsEl.hidden = true; return; } // def paths aren't element paths (PR 2)
    if (dirty && !liveRanges) { crumbsEl.hidden = true; return; } // pre-parse frame
    const path = pathAtOffset(rangesNow(), displayedToFull(textEl.selectionStart ?? 0));
    if (!path) { crumbsEl.hidden = true; return; } // wrapper chrome — no element here
    crumbsEl.hidden = false;
    const parts: Node[] = [];
    for (let i = 0; i <= path.length; i++) {
      const prefix = path.slice(0, i);
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'wb-crumb-sep';
        sep.setAttribute('aria-hidden', 'true');
        sep.textContent = '›';
        parts.push(sep);
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'wb-crumb';
      b.textContent = crumbLabel(prefix);
      if (state.nodeAt(prefix)) {
        b.title = 'Select this element on the canvas';
        b.addEventListener('click', () => echo.run('code', () => state.select(prefix)));
      } else {
        b.disabled = true; // typed by hand — becomes selectable after Apply
        b.title = 'Not applied yet — Apply to select it on the canvas';
      }
      parts.push(b);
    }
    crumbsEl.replaceChildren(...parts);
  };

  // ── #PR-B Format document: buffer-only pretty print, never an Apply.
  // Canonical (importJson → the deterministic serializer) when the buffer
  // parses; tolerant re-indent + the parse error when it doesn't. The dirty
  // flag is deliberately untouched — a formatted hand-edit still needs Apply,
  // and a clean buffer is already canonical so the swap is a no-op. ──
  /** Component-mode Format: the formatter parser doesn't apply to a def —
   *  canonical is a plain JSON pretty-print when the buffer parses, and the
   *  tolerant re-indent tier (with its parse error) when it doesn't. Without
   *  this, a VALID def hit importJson's "unrecognized formatter shape" error
   *  (Copilot review, PR #312). */
  const compFormat = (text: string): ReturnType<typeof formatDocument> => {
    try {
      return { text: JSON.stringify(JSON.parse(text), null, 2), tier: 'canonical' };
    } catch {
      return formatDocument(text, { sanitizeWhitespace: sanitizeEl.checked });
    }
  };
  const formatCmd = (): void => {
    expandAllFolds(); // format is a buffer op on the full text (no-op when clean+canonical)
    const res = bufferDefId !== null
      ? compFormat(textEl.value)
      : formatDocument(textEl.value, { sanitizeWhitespace: sanitizeEl.checked });
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
      if (dirty) scheduleLiveParse(); // the swap moved every live-map offset
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
      if (dirty || bufferDefId !== null) return;
      const off = displayedToFull(textEl.selectionStart ?? 0);
      const path = pathAtOffset(mapRanges, off);
      if (path && path.length > 0) { // the root never folds — it IS the document
        foldState.update('json', (set) => set.add(pathKey(path)));
        applyFolds();
        return;
      }
      // wrapper chrome (no element here): fold the INNERMOST section at the
      // caret — groupProps/commandBarProps interiors fold like elements do
      let sec: JsonSection | null = null;
      for (const s of mapSections) {
        if (off < s.start || off > s.end) continue;
        if (!sec || s.start > sec.start) sec = s; // sections nest — innermost wins
      }
      if (sec) {
        const key = sectionKey(sec);
        foldState.update('json', (set) => set.add(key));
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
        foldState.update('json', (set) => set.delete(activeFoldKeys[idx]));
        applyFolds();
      }
    }
  });

  // #PR-C kebab commands: focus the selection / show everything
  const isPrefix = (p: number[], q: number[]): boolean => p.length <= q.length && p.every((v, i) => q[i] === v);
  menuHost.querySelector('#wb-json-fold-others')!.addEventListener('click', () => {
    if (dirty || bufferDefId !== null) return;
    const sel = state.selection;
    foldState.update('json', (set) => {
      for (const r of mapRanges) {
        if (r.path.length === 0) continue; // never fold the root — that's the whole doc
        if (sel && (isPrefix(r.path, sel) || isPrefix(sel, r.path))) continue; // keep the selection's chain open
        if (cutForRange(fullText, r)) set.add(pathKey(r.path));
      }
      // wrapper sections are never in the selection's chain — fold them all
      // (only outermost cuts survive buildFoldView, so nesting costs nothing)
      for (const s of mapSections) {
        if (cutForRange(fullText, s)) set.add(sectionKey(s));
      }
    });
    applyFolds();
  });
  menuHost.querySelector('#wb-json-expand-all')!.addEventListener('click', () => {
    if (bufferDefId !== null) return; // the shared set is the workshop tree's right now
    foldState.clear('json'); // shared: the Structure tree expands with it
    expandAllFolds();
  });

  // ── #PR-E (owner ask): the syntax color mapper. One color input per
  // --wb-syn-x* slot for the CURRENT theme; overrides live in localStorage
  // (a NEW key — frozen-keys rule intact) and apply as inline custom
  // properties on <body>, outranking both theme blocks. synPalette.ts owns
  // the decisions; this is DOM only. ──
  const synPanel = host.querySelector('#wb-syn-panel') as HTMLDivElement;
  const isDark = (): boolean => document.body.classList.contains('wb-dark');
  let synPrefs = loadSynPrefs();
  applySynPrefs(synPrefs, isDark(), document.body); // saved hues greet the session

  /** Effective #rrggbb for a slot, for seeding the input (inline override
   *  first, else the stylesheet's computed value; '#888888' in bare DOMs). */
  const effectiveHex = (cssVar: string): string => {
    const v = (document.body.style.getPropertyValue(cssVar)
      || getComputedStyle(document.body).getPropertyValue(cssVar)).trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) return v;
    if (/^#[0-9a-fA-F]{3}$/.test(v)) return `#${[...v.slice(1)].map((c) => c + c).join('')}`;
    const rgb = v.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
    if (rgb) return `#${rgb.slice(1, 4).map((n) => (+n).toString(16).padStart(2, '0')).join('')}`;
    return '#888888';
  };

  const rebuildSynPanel = (): void => {
    const theme = isDark() ? 'dark' : 'light';
    const rows: Node[] = SYN_SLOTS.map(({ cssVar, label }) => {
      const row = document.createElement('label');
      row.className = 'wb-syn-row';
      const name = document.createElement('span');
      name.textContent = label;
      const input = document.createElement('input');
      input.type = 'color';
      input.value = effectiveHex(cssVar);
      input.setAttribute('aria-label', `${label} color (${theme} theme)`);
      input.addEventListener('input', () => {
        synPrefs[theme === 'dark' ? 'dark' : 'light'][cssVar] = input.value;
        saveSynPrefs(synPrefs);
        applySynPrefs(synPrefs, isDark(), document.body);
      });
      row.append(name, input);
      return row;
    });
    const head = document.createElement('div');
    head.className = 'wb-syn-head';
    const title = document.createElement('span');
    title.textContent = `Expression colors — ${theme} theme`;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'wb-syn-close';
    close.textContent = '×';
    close.title = 'Hide this panel (Esc) — the ⋮ menu reopens it';
    close.setAttribute('aria-label', 'Hide the syntax colors panel');
    close.addEventListener('click', () => closeSynPanel());
    head.append(title, close);
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.id = 'wb-syn-reset';
    reset.textContent = 'Reset to defaults';
    reset.title = 'Drop every override for this theme';
    reset.addEventListener('click', () => {
      synPrefs[isDark() ? 'dark' : 'light'] = {};
      saveSynPrefs(synPrefs);
      applySynPrefs(synPrefs, isDark(), document.body);
      rebuildSynPanel(); // inputs re-seed from the stylesheet defaults
    });
    synPanel.replaceChildren(head, ...rows, reset);
  };

  // quick-hide (owner ask 2026-07-10): × on the panel, or Esc while it shows.
  // Capture phase keeps the app-level Esc (clear canvas selection) out of a
  // close gesture; the listener only exists while the panel is up.
  const synPanelEsc = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    closeSynPanel();
  };
  const openSynPanel = (): void => {
    synPanel.hidden = false;
    rebuildSynPanel();
    document.addEventListener('keydown', synPanelEsc, true);
  };
  const closeSynPanel = (): void => {
    synPanel.hidden = true;
    document.removeEventListener('keydown', synPanelEsc, true);
  };

  menuHost.querySelector('#wb-json-syncolors')!.addEventListener('click', () => {
    // the mapper lives in the JSON tab — surface it if Explain is up front
    const jsonTab = document.getElementById('wb-side-tab-json');
    if (jsonTab && !jsonTab.classList.contains('active')) jsonTab.click();
    if (synPanel.hidden) openSynPanel();
    else closeSynPanel();
  });

  const copyFormatterJson = async (): Promise<void> => {
    const comp = bufferDefId !== null;
    const text = exportText();
    if (text === null) { orphanExportToast(); return; }
    try {
      await navigator.clipboard.writeText(text);
      onToast(comp ? 'Component JSON copied (the staged def)' : 'Formatter JSON copied');
    } catch {
      onToast('Copy failed — clipboard access blocked (select the text and use Ctrl/Cmd+C)');
    }
  };
  menuHost.querySelector('#wb-json-copy')!.addEventListener('click', copyFormatterJson);
  host.querySelector('#wb-json-copy-btn')!.addEventListener('click', copyFormatterJson);
  menuHost.querySelector('#wb-json-copy-csom')!.addEventListener('click', async () => {
    const text = exportText({ csom: true });
    if (text === null) { orphanExportToast(); return; }
    try {
      await navigator.clipboard.writeText(text);
      onToast('CSOM-safe JSON copied (& and < escaped)');
    } catch {
      onToast('Copy failed — clipboard access blocked (select the text and use Ctrl/Cmd+C)');
    }
  });
  menuHost.querySelector('#wb-json-download')!.addEventListener('click', () => {
    const text = exportText();
    if (text === null) { orphanExportToast(); return; }
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = bufferDefId !== null ? `component-${bufferDefId}.json` : `${state.doc.kind}-formatter.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  host.querySelector('#wb-json-apply')!.addEventListener('click', () => {
    // ── component mode: Apply STAGES into the workshop (one modal-undo
    // step); Save in the workshop stays the one publish step. Routed by the
    // BUFFER's origin, so a surface draft still applies to the surface even
    // while a workshop tab is up.
    if (bufferDefId !== null) {
      try {
        const def = parseComponentDefJson(textEl.value); // folds never coexist with component mode
        if (def.id !== bufferDefId) {
          throw new Error(`This def's id ("${def.id}") doesn't match the open workshop tab's `
            + `("${bufferDefId}") — the id is the tab's identity. Change anything but that.`);
        }
        const wctx = activeWorkshop();
        if (!wctx || wctx.def().id !== bufferDefId) {
          throw new Error('That component\'s workshop tab isn\'t active any more — open its ⬡ tab and Apply again.');
        }
        if (divergedWhileDirty
          && !confirm('The workshop changed while you were editing this JSON — applying replaces those staged edits (the workshop\'s ↶ brings its tree back).\n\nApply anyway?')) return;
        clearDirty();
        clearImportError();
        wctx.applyDef(def);
        onToast(`Staged into the ${def.name} workshop — Save there publishes it`);
      } catch (e) {
        const msg = `Import failed: ${(e as Error).message}`;
        onToast(msg);
        importErrorEl.textContent = msg;
        importErrorEl.hidden = false;
      }
      return;
    }
    try {
      // #PR-C: folds are a view — Apply always parses the FULL text
      const doc = importJson(foldView ? fullText : textEl.value);
      // divergence guard: the canvas moved while this buffer was being
      // hand-edited (the buffer forked from an OLDER document) — applying
      // overwrites those canvas changes. Confirm at the exact moment of
      // harm; a buffer that never diverged applies without ceremony.
      if (divergedWhileDirty) {
        if (!confirm('The canvas changed while you were editing this JSON — applying replaces the canvas version, overwriting those changes (one Ctrl+Z brings them back).\n\nApply anyway?')) return;
      }
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

  // ── component-mode chrome: the banner + standing the surface tools down.
  // Everything keys off the BUFFER's origin (bufferDefId), so a dirty
  // surface draft keeps its lint/deploy until Apply or Discard. ──
  const deployBtnEl = menuHost.querySelector('#wb-json-deploy') as HTMLButtonElement;
  const deployBtnTitle = deployBtnEl.title;
  const applyBtnTitle = applyBtn.title;
  const refreshComponentChrome = (): void => {
    const activeComp = state.activeComponentTab;
    const inCompBuffer = bufferDefId !== null;
    lintEl.hidden = inCompBuffer;
    deployBtnEl.disabled = inCompBuffer;
    deployBtnEl.title = inCompBuffer
      ? 'Deploy ships view formatting — a component ships by being used in a view'
      : deployBtnTitle;
    if (inCompBuffer) deployPanel.hidden = true;
    applyBtn.title = inCompBuffer
      ? 'Parse the JSON below and stage it into the workshop — Save there publishes'
      : applyBtnTitle;
    // the surface Type select acts on the surface doc — inert under a def
    const kindSel = document.getElementById('wb-kind') as HTMLSelectElement | null;
    if (kindSel) kindSel.disabled = inCompBuffer;
    const compName = (id: string): string => componentById(id)?.name ?? id;
    if (inCompBuffer && activeComp === bufferDefId) {
      compBarEl.hidden = false;
      compBarEl.textContent = `⬡ ${compName(bufferDefId!)} — the workshop's staged JSON. `
        + 'Apply stages your edits; Save in the workshop publishes.';
    } else if (inCompBuffer) {
      compBarEl.hidden = false;
      compBarEl.textContent = `Editing ⬡ ${compName(bufferDefId!)}'s JSON, but its workshop tab `
        + 'isn\'t active — reopen the ⬡ tab to Apply (or ↩ Discard).';
    } else if (activeComp !== null && dirty) {
      compBarEl.hidden = false;
      compBarEl.textContent = `⬡ ${compName(activeComp)} is open, but this pane still holds your `
        + 'unapplied surface edits — Apply or ↩ Discard them to see the component\'s JSON.';
    } else {
      compBarEl.hidden = true;
      compBarEl.textContent = '';
    }
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

  // ── the lint footer. Missing-column warnings fold into ONE row per column
  // (count badge = how many places reference it) with an inline "create the
  // column" flow; a head bar carries the severity summary, the collapse
  // toggle and the missing-column filter (lintView.ts owns the decisions;
  // the filter pref persists under the additive wb-lint-prefs.v1 key). ──
  let lintPrefs = loadLintPrefs();
  let lintCollapsed = false;              // session-only: minimized to the summary bar
  let lintCreateOpen: string | null = null;   // field with the create form expanded
  let lintCreateType: FieldType | null = null; // its picked type (survives re-renders)
  let lastRuntime: RenderIssue[] = [];

  /** Severity badge span (glyph + word — WCAG 1.4.1, colour never alone). */
  const sevBadge = (sev: string): HTMLSpanElement => {
    const { glyph, label } = lintBadge(sev);
    const badge = document.createElement('span');
    badge.className = 'wb-lint-badge';
    const glyphEl = document.createElement('span');
    glyphEl.className = 'wb-lint-glyph';
    glyphEl.setAttribute('aria-hidden', 'true');
    glyphEl.textContent = glyph;
    badge.append(glyphEl, document.createTextNode(` ${label}`));
    return badge;
  };

  /** Row shell: severity stripe + badge + message, keyboard-operable jump. */
  const lintRow = (sev: string, text: string, path: number[], aria?: string): HTMLDivElement => {
    const row = document.createElement('div');
    row.className = `wb-lint-item wb-lint-${sev}`;
    const msg = document.createElement('span');
    msg.className = 'wb-lint-msg';
    msg.textContent = text;
    row.append(sevBadge(sev), msg);
    row.title = `Click to select node [${path.join(' › ')}]`;
    row.setAttribute('aria-label', aria ?? lintAriaLabel(sev, text));
    // The row acts as a button (jump to the node), so make it operable — and
    // its severity announceable — by keyboard, not mouse only.
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    // #PR-D flash symmetry: on clean buffers the selection emit reveals and
    // flashes; when it didn't (dirty — reveal bails), flash via the live map
    const jump = (): void => {
      state.select(path);
      if (!flashBar && (!dirty || liveRanges)) {
        const r = rangeForPath(rangesNow(), path);
        if (r) { clearFlash(); flashRange(r); }
      }
    };
    row.addEventListener('click', (e) => {
      // clicks inside the create controls are theirs, not a jump
      if ((e.target as HTMLElement).closest('.wb-lint-create, .wb-lint-createform')) return;
      jump();
    });
    row.addEventListener('keydown', (e) => {
      if (e.target !== row) return; // form controls keep their own keys
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jump(); }
    });
    return row;
  };

  /** The grouped missing-column row: count badge + the create-column flow. */
  const missingRow = (group: MissingColumnRow): HTMLDivElement => {
    const label = `[$${group.field}] — column not in the Data tab`;
    const places = `${group.count} place${group.count === 1 ? '' : 's'} reference${group.count === 1 ? 's' : ''} it`;
    const row = lintRow('warning', label, group.paths[0], `Warning: missing column ${group.field} — ${places}`);
    row.classList.add('wb-lint-missing');
    const msg = row.querySelector('.wb-lint-msg')!;
    if (group.count > 1) {
      const count = document.createElement('span');
      count.className = 'wb-lint-count';
      count.textContent = `×${group.count}`;
      count.title = places;
      msg.after(count);
    }
    const create = document.createElement('button');
    create.type = 'button';
    create.className = 'wb-lint-create';
    create.textContent = '＋ Create column';
    create.title = `Add ${group.field} to the Data tab (pick a type, sample values are seeded)`;
    create.setAttribute('aria-expanded', String(lintCreateOpen === group.field));
    create.addEventListener('click', () => {
      lintCreateOpen = lintCreateOpen === group.field ? null : group.field;
      lintCreateType = null; // re-infer for the newly opened field
      renderLint(lastRuntime);
    });
    row.appendChild(create);
    if (lintCreateOpen === group.field) {
      const form = document.createElement('span');
      form.className = 'wb-lint-createform';
      const sel = document.createElement('select');
      sel.setAttribute('aria-label', `Type for the new ${group.field} column`);
      for (const opt of FIELD_TYPE_OPTIONS) {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        sel.appendChild(o);
      }
      // preselect the type the formatter's own usage suggests
      sel.value = lintCreateType ?? inferFieldType(state.doc.root, group.field);
      sel.addEventListener('change', () => { lintCreateType = sel.value as FieldType; });
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'wb-lint-createok';
      add.textContent = 'Add';
      add.addEventListener('click', () => {
        const type = sel.value as FieldType;
        const field: MockField = {
          name: group.field,
          type,
          ...(type === 'lookup' || type === 'lookupMulti'
            ? { lookup: { list: '?', column: 'Title' } }
            : {}),
        };
        if (state.addMockField(field)) {
          lintCreateOpen = null;
          lintCreateType = null;
          onToast(`Added ${group.field} (${type}) to the Data tab — sample values seeded`);
          // addMockField emits 'data': the re-lint drops this row on its own
        } else {
          // the only reachable refusal: the column already exists (e.g. just
          // added from the Data tab) — say so instead of silently closing;
          // the next re-lint drops this row anyway once the schema knows it
          onToast(`${group.field} is already in the Data tab — nothing to add`);
          renderLint(lastRuntime);
        }
      });
      form.append(sel, add);
      row.appendChild(form);
    }
    return row;
  };

  const renderLint = (runtime: RenderIssue[]): { errors: number; warnings: number; runtime: number } => {
    lastRuntime = runtime;
    if (bufferDefId !== null) {
      // component mode: the lint pipeline reads the SURFACE doc — its rows
      // would judge a document the pane isn't showing. Apply's shape check
      // is the def gate; deep def linting is PR-2 territory.
      lintEl.hidden = true;
      lintEl.replaceChildren();
      lintIssues = [];
      return { errors: 0, warnings: 0, runtime: 0 };
    }
    lintEl.hidden = false;
    const issues = lintDocument(
      state.doc,
      state.fields.map((f) => f.name),
      Object.fromEntries(state.fields.map((f) => [f.name, f.type])),
    );
    // #PR-D: the squiggle layer mirrors the footer — the missing-column
    // filter quiets the editor's underlines too (that's its whole point)
    lintIssues = lintPrefs.hideMissingColumns
      ? issues.filter((i) => !(i.rule === 'unknown-field' && i.field))
      : issues;
    refreshDecorations();
    const view = buildLintView(issues, runtime, { hideMissingColumns: lintPrefs.hideMissingColumns });
    if (lintCreateOpen && !view.rows.some((r) => r.kind === 'missing' && r.field === lintCreateOpen)) {
      lintCreateOpen = null; // the column got created (or filtered) — form gone
      lintCreateType = null;
    }
    lintEl.innerHTML = '';
    const { errors, warnings, infos } = view.summary;
    if (issues.length === 0 && runtime.length === 0) {
      lintEl.innerHTML = '<div class="wb-lint-ok">✓ No issues — schema-clean and expression-safe.</div>';
      return { errors: 0, warnings: 0, runtime: 0 };
    }

    // head bar: fold toggle + severity summary (+ hidden note + the filter)
    const head = document.createElement('div');
    head.className = 'wb-lint-head';
    const fold = document.createElement('button');
    fold.type = 'button';
    fold.className = 'wb-lint-fold';
    fold.setAttribute('aria-expanded', String(!lintCollapsed));
    fold.setAttribute('aria-controls', 'wb-lint-body');
    fold.title = lintCollapsed ? 'Show the issue list' : 'Minimize to this summary bar';
    fold.textContent = `${lintCollapsed ? '▸' : '▾'} Problems`;
    fold.addEventListener('click', () => {
      lintCollapsed = !lintCollapsed;
      renderLint(lastRuntime);
    });
    head.appendChild(fold);
    const sum = document.createElement('span');
    sum.className = 'wb-lint-sum';
    const parts: string[] = [];
    // "2 errors (×51)" per level: 2 distinct KINDS of error, 51 occurrences
    const chip = (sev: string, t: SeverityTally, word: string): void => {
      if (!t.total) return;
      const s = document.createElement('span');
      s.className = `wb-lint-chip wb-lint-chip-${sev}`;
      s.textContent = `${lintBadge(sev).glyph} ${t.types} ${word}${t.types === 1 ? '' : 's'} (×${t.total})`;
      const detail = `${t.types} ${word} type${t.types === 1 ? '' : 's'}, ${t.total} occurrence${t.total === 1 ? '' : 's'}`;
      s.title = detail;
      sum.appendChild(s);
      parts.push(detail);
    };
    chip('error', errors, 'error');
    chip('warning', warnings, 'warning');
    chip('info', infos, 'info');
    chip('runtime', view.summary.runtime, 'runtime issue');
    // no live-region role: the footer rebuilds on every emit and a status
    // region would re-announce unchanged counts — the label alone serves
    sum.setAttribute('aria-label', parts.join(', '));
    head.appendChild(sum);
    if (view.hiddenMissing > 0) {
      const hid = document.createElement('span');
      hid.className = 'wb-lint-hiddennote';
      hid.textContent = `${view.hiddenMissing} ignored`;
      hid.title = `${view.hiddenMissing} missing-column warning${view.hiddenMissing === 1 ? '' : 's'} ignored by the filter`;
      head.appendChild(hid);
    }
    const missingTotal = issues.filter((i) => i.rule === 'unknown-field' && i.field).length;
    if (missingTotal > 0) {
      const filterLbl = document.createElement('label');
      filterLbl.className = 'wb-check wb-lint-filter';
      filterLbl.title = 'Working on pasted JSON without wiring up the Data tab? Ignore the warnings about columns it doesn\'t have (rows and underlines both) — nothing is hidden from your list, and the count above stays honest.';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id = 'wb-lint-hide-missing'; // id is shipped DOM contract — label text changed only
      cb.checked = lintPrefs.hideMissingColumns;
      cb.addEventListener('change', () => {
        lintPrefs = { ...lintPrefs, hideMissingColumns: cb.checked };
        saveLintPrefs(lintPrefs);
        renderLint(lastRuntime);
      });
      filterLbl.append(cb, document.createTextNode(' ignore warnings about columns missing from Data'));
      head.appendChild(filterLbl);
    }
    lintEl.appendChild(head);

    const body = document.createElement('div');
    body.className = 'wb-lint-body';
    body.id = 'wb-lint-body';
    body.hidden = lintCollapsed;
    for (const r of view.rows) {
      body.appendChild(r.kind === 'missing' ? missingRow(r) : lintRow(r.sev, r.text, r.path));
    }
    if (view.rows.length === 0) {
      const quiet = document.createElement('div');
      quiet.className = 'wb-lint-ok';
      quiet.textContent = '✓ Nothing to show — every issue is ignored by the filter.';
      body.appendChild(quiet);
    }
    lintEl.appendChild(body);
    return { errors: errors.total, warnings: warnings.total, runtime: runtime.length };
  };

  const hostAny = host as any;
  if (typeof hostAny._unsub === 'function') {
    hostAny._unsub();
  }
  // fold changes made ELSEWHERE (the Structure tree's chevrons, a reset)
  // re-apply the fold view here; our own writes already applied it in the
  // gesture, and a dirty buffer waits for its next regenerate to re-read
  // the set (folds are clean-buffer-only — spec §3).
  const foldUnsub = foldState.subscribe((origin) => {
    // component mode: the shared set belongs to the Structure tree's staged
    // paths — applyFolds would prune every key against our empty map
    if (origin === 'json' || dirty || bufferDefId !== null) return;
    applyFolds();
  });
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
    if (reason === 'theme') {
      // #PR-E: the other theme's palette overrides take over; open panel re-seeds
      applySynPrefs(synPrefs, isDark(), document.body);
      if (!synPanel.hidden) rebuildSynPanel();
      return;
    }
    // A dirty buffer is the maker's DRAFT — it must never be clobbered from
    // underneath (this used to clearDirty-then-regenerate, silently eating
    // unapplied hand-edits on any canvas change — owner report 2026-07-13).
    // Document-moving emits mark the fork instead: Apply confirms before
    // overwriting the moved canvas, ↩ Discard edits is the other way out.
    if (dirty) {
      if (bufferDefId === null) {
        // a surface draft forks from the DOC — doc-moving emits diverge it
        if (reason === 'document' || reason === 'load' || reason === 'kind') divergedWhileDirty = true;
      } else if (reason === 'workshop' && !divergedWhileDirty) {
        // a component draft forks from the STAGED def — only a REAL staged
        // change diverges it. Register/unregister churn (tab switches) emits
        // 'workshop' too, so compare against the forked-from snapshot
        // instead of trusting the reason alone (Copilot review, PR #312).
        const d = activeWorkshop()?.def();
        if (d && d.id === bufferDefId) {
          delete d.builtin;
          if (JSON.stringify(d, null, 2) !== bufferBaseline) divergedWhileDirty = true;
        }
      }
      refreshSizeMeter(); // the meter reads the DOC (Copy output), not the buffer
      refreshDeployPanel();
      refreshComponentChrome(); // tab switches under a dirty draft re-word the banner
      return;
    }
    clearDirty(); regenerate(); refreshDeployPanel();
  });
  hostAny._unsub = () => {
    stateUnsub();
    foldUnsub();
    ide.dispose(); // the shell's ResizeObserver must not outlive the mount
    document.body.classList.remove('wb-json-editing'); // a dirty unmount must not leave the canvas dimmed
    document.removeEventListener('pointerdown', closeKebabOnOutside);
    document.removeEventListener('keydown', synPanelEsc, true);
    kebabBtn?.removeEventListener('click', toggleKebab);
    kebabPanel?.removeEventListener('click', closeKebabOnItem);
  };
  regenerate();
  renderLint([]);

  return { refreshLint: renderLint };
}
