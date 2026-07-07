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
 */

import { state, samePath } from './state';
import { exportJson, importJson, treeHasNames } from '../core/serializer';
import { exportJsonWithMap, pathAtOffset, rangeForPath, type JsonRange } from '../core/jsonMap';
import { preserveCaret, lineSpanOf, SyncEcho } from './codeSync';
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
  host.classList.add('wb-codesync'); // positioning context for the flash bar
  host.innerHTML = `
    <div class="wb-json-toolbar">
      <div class="wb-json-actions">
        <button id="wb-json-copy" class="wb-json-primary" title="Copy to clipboard">Copy</button>
        <button id="wb-json-copy-csom" title="Copy with & and < escaped as \\u0026/\\u003c — safe for CSOM deploys">Copy (CSOM-safe)</button>
        <button id="wb-json-download" title="Download .json">Download</button>
        <button id="wb-json-apply" title="Parse the JSON below back into the visual editor">⬅ Apply to canvas</button>
      </div>
      <div class="wb-json-options">
        <label class="wb-check"><input type="checkbox" id="wb-json-sanitize" checked> sanitize whitespace</label>
        <label class="wb-check" title="Keep the Structure pane's _elmName labels in copied/downloaded JSON (SharePoint ignores them). Uncheck for schema-pristine output. The editor view below always shows them so Apply round-trips losslessly."><input type="checkbox" id="wb-json-names" checked> names</label>
      </div>
      <div class="wb-json-deploy-row">
        <button id="wb-json-deploy" title="Generate a deploy snippet: run it on your list page and it writes this formatter to the column/view — confirm-first, lint-gated, with a clobber guard before replacing a view's formatting">🚀 Deploy…</button>
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
    <textarea id="wb-json-text" spellcheck="false"></textarea>
    <div id="wb-json-import-error" class="wb-import-error" role="alert" aria-live="assertive" hidden></div>
    <div id="wb-lint" class="wb-lint"></div>
  `;

  const textEl = host.querySelector('#wb-json-text') as HTMLTextAreaElement;
  const sanitizeEl = host.querySelector('#wb-json-sanitize') as HTMLInputElement;
  const namesEl = host.querySelector('#wb-json-names') as HTMLInputElement;
  const lintEl = host.querySelector('#wb-lint') as HTMLElement;
  const importErrorEl = host.querySelector('#wb-json-import-error') as HTMLDivElement;
  const applyBtn = host.querySelector('#wb-json-apply') as HTMLButtonElement;
  let dirty = false;

  const clearImportError = (): void => { importErrorEl.hidden = true; importErrorEl.textContent = ''; };
  const setDirty = () => {
    dirty = true;
    textEl.classList.add('wb-json-dirty');
    applyBtn.classList.add('wb-json-apply-pending');
  };
  const clearDirty = () => {
    dirty = false;
    textEl.classList.remove('wb-json-dirty');
    applyBtn.classList.remove('wb-json-apply-pending');
  };

  // ── #218 split-view sync state ──
  let mapRanges: JsonRange[] = []; // offset↔path map for the CURRENT textarea text
  const echo = new SyncEcho();

  const regenerate = () => {
    if (dirty) return; // don't clobber a paste in progress
    // the editor view keeps _elmName so "Apply to canvas" never loses names
    const prev = textEl.value;
    const { text, ranges } = exportJsonWithMap(state.doc, { sanitizeWhitespace: sanitizeEl.checked, keepMeta: true });
    mapRanges = ranges;
    if (text !== prev) {
      // refresh IN PLACE: the serializer is deterministic, so untouched parts
      // of the text are byte-identical — keep the reader's caret + scroll
      // instead of resetting them (a visual edit must not lose their place)
      const selStart = textEl.selectionStart ?? 0;
      const selEnd = textEl.selectionEnd ?? selStart;
      const { scrollTop, scrollLeft } = textEl;
      textEl.value = text;
      textEl.setSelectionRange(preserveCaret(prev, text, selStart), preserveCaret(prev, text, selEnd));
      textEl.scrollTop = scrollTop;
      textEl.scrollLeft = scrollLeft;
    }
    clearImportError(); // stale error no longer matches what's in the textarea
  };

  // ── #218 code → canvas: a caret landing inside an element selects it ──
  // Wired to user gestures only (click / keyup) so programmatic value swaps
  // can never masquerade as a caret move; typing marks the buffer dirty
  // before keyup fires, so hand-edits (stale offsets) never mis-select.
  const syncSelectionFromCaret = (): void => {
    if (dirty) return; // hand-edited text: offsets are stale until Apply
    const path = pathAtOffset(mapRanges, textEl.selectionStart ?? 0);
    if (!path) return; // wrapper chrome ($schema line) selects nothing
    if (state.selection && samePath(state.selection, path)) return; // already there — no churn
    echo.run('code', () => state.select(path));
  };
  textEl.addEventListener('click', syncSelectionFromCaret);
  textEl.addEventListener('keyup', syncSelectionFromCaret);

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
    const { first, last } = lineSpanOf(textEl.value, range.start, range.end);
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
    host.appendChild(bar);
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

  host.querySelector('#wb-json-copy')!.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(exportJson(state.doc, { sanitizeWhitespace: sanitizeEl.checked, keepMeta: namesEl.checked }));
      onToast('Formatter JSON copied');
    } catch {
      onToast('Copy failed — clipboard access blocked (select the text and use Ctrl/Cmd+C)');
    }
  });
  host.querySelector('#wb-json-copy-csom')!.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(exportJson(state.doc, { sanitizeWhitespace: sanitizeEl.checked, keepMeta: namesEl.checked, csomSafe: true }));
      onToast('CSOM-safe JSON copied (& and < escaped)');
    } catch {
      onToast('Copy failed — clipboard access blocked (select the text and use Ctrl/Cmd+C)');
    }
  });
  host.querySelector('#wb-json-download')!.addEventListener('click', () => {
    const blob = new Blob([exportJson(state.doc, { sanitizeWhitespace: sanitizeEl.checked, keepMeta: namesEl.checked })], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${state.doc.kind}-formatter.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  host.querySelector('#wb-json-apply')!.addEventListener('click', () => {
    try {
      const doc = importJson(textEl.value);
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

  host.querySelector('#wb-json-deploy')!.addEventListener('click', () => {
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
  hostAny._unsub = state.subscribe((reason) => {
    if (reason === 'selection') {
      // #218 canvas → code — unless the selection ORIGINATED here (the echo
      // guard): a code-side caret move must not bounce back and scroll/flash
      // the very textarea it came from.
      if (!echo.from('code')) revealSelection();
      return;
    }
    if (reason !== 'theme') { clearDirty(); regenerate(); refreshDeployPanel(); }
  });
  regenerate();
  renderLint([]);

  return { refreshLint: renderLint };
}
