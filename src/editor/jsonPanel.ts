/**
 * editor/jsonPanel.ts — Bidirectional JSON view.
 *
 * Out: live compiled SP JSON ($schema wrapper, sanitized expressions),
 * with copy / download / CSOM-safe copy.
 * In: paste any column/view/tile formatter JSON and "Apply" loads it into
 * the visual editor.
 */

import { state } from './state';
import { exportJson, importJson, treeHasNames } from '../core/serializer';
import { lintDocument, type LintIssue } from '../core/linter';
import { buildDeploySnippet } from '../bridge/deploySnippet';
import { serializeApplyPayload } from '../bridge/applyPayload';
import { onExtensionReady, stageApplyToExtension } from './extensionBridge';
import { buildCurrentApplyPayload } from './deployPayload';
import type { RenderIssue } from '../core/renderer';

export interface JsonPanelApi {
  refreshLint: (runtime: RenderIssue[]) => void;
}

export function mountJsonPanel(host: HTMLElement, onToast: (m: string) => void): JsonPanelApi {
  host.innerHTML = `
    <div class="wb-json-toolbar">
      <label class="wb-check"><input type="checkbox" id="wb-json-sanitize" checked> sanitize whitespace</label>
      <label class="wb-check" title="Keep the Structure pane's _elmName labels in copied/downloaded JSON (SharePoint ignores them). Uncheck for schema-pristine output. The editor view below always shows them so Apply round-trips losslessly."><input type="checkbox" id="wb-json-names" checked> names</label>
      <button id="wb-json-copy" title="Copy to clipboard">Copy</button>
      <button id="wb-json-copy-csom" title="Copy with & and < escaped as \\u0026/\\u003c — safe for CSOM deploys">Copy (CSOM-safe)</button>
      <button id="wb-json-download" title="Download .json">Download</button>
      <button id="wb-json-apply" title="Parse the JSON below back into the visual editor">⬅ Apply to canvas</button>
      <button id="wb-json-deploy" title="Generate a deploy snippet: run it on your list page and it writes this formatter to the column/view — confirm-first, lint-gated, with a clobber guard before replacing a view's formatting">🚀 Deploy…</button>
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
    <div id="wb-lint" class="wb-lint"></div>
  `;

  const textEl = host.querySelector('#wb-json-text') as HTMLTextAreaElement;
  const sanitizeEl = host.querySelector('#wb-json-sanitize') as HTMLInputElement;
  const namesEl = host.querySelector('#wb-json-names') as HTMLInputElement;
  const lintEl = host.querySelector('#wb-lint') as HTMLElement;
  let dirty = false;

  const regenerate = () => {
    if (dirty) return; // don't clobber a paste in progress
    // the editor view keeps _elmName so "Apply to canvas" never loses names
    textEl.value = exportJson(state.doc, { sanitizeWhitespace: sanitizeEl.checked, keepMeta: true });
  };

  textEl.addEventListener('input', () => { dirty = true; });
  sanitizeEl.addEventListener('change', () => { dirty = false; regenerate(); });

  host.querySelector('#wb-json-copy')!.addEventListener('click', async () => {
    await navigator.clipboard.writeText(exportJson(state.doc, { sanitizeWhitespace: sanitizeEl.checked, keepMeta: namesEl.checked }));
    onToast('Formatter JSON copied');
  });
  host.querySelector('#wb-json-copy-csom')!.addEventListener('click', async () => {
    await navigator.clipboard.writeText(exportJson(state.doc, { sanitizeWhitespace: sanitizeEl.checked, keepMeta: namesEl.checked, csomSafe: true }));
    onToast('CSOM-safe JSON copied (& and < escaped)');
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
      dirty = false;
      state.loadDocument(doc);
      onToast(`Imported ${doc.kind} formatter`);
    } catch (e) {
      onToast(`Import failed: ${(e as Error).message}`);
    }
  });

  // ── deploy: the Tier-0 bridge (docs/CONNECTIVITY.md §3.3) ──
  const deployPanel = host.querySelector('#wb-deploy-panel') as HTMLDivElement;
  const deployTargetEl = host.querySelector('#wb-deploy-target') as HTMLDivElement;
  const deployViewEl = host.querySelector('#wb-deploy-view') as HTMLInputElement;
  const deployListEl = host.querySelector('#wb-deploy-list') as HTMLInputElement;

  /** Where the formatter lands, derived from what's being edited. */
  const deployTarget = (): { target: 'field' | 'view'; name: string; label: string } => {
    if (state.doc.kind === 'column') {
      const field = state.activeDocKey !== 'main' ? state.activeDocKey : state.currentFieldName;
      return { target: 'field', name: field, label: `→ the [$${field}] column's CustomFormatter` };
    }
    // row/grid/tile all ship as view formatting
    return { target: 'view', name: deployViewEl.value.trim() || 'All Items', label: '→ a view\'s CustomFormatter (row/tile formatting):' };
  };

  const refreshDeployPanel = () => {
    if (deployPanel.hidden) return;
    const t = deployTarget();
    deployTargetEl.textContent = `Deploys ${t.label}`;
    deployViewEl.hidden = t.target !== 'view';
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
    await navigator.clipboard.writeText(snippet);
    onToast(`Deploy snippet copied for ${t.target === 'field' ? `[$${t.name}]` : `the "${t.name}" view`} — run it in the console on your list page; it confirms before writing`);
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
    await navigator.clipboard.writeText(serializeApplyPayload(payload));
    onToast(`Copied for the extension (${t.target === 'field' ? `[$${t.name}]` : `the "${t.name}" view`}) — on your list tab, click the FormatFX extension → Apply from clipboard`);
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

  const renderLint = (runtime: RenderIssue[]) => {
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
    if (all.length === 0) {
      lintEl.innerHTML = '<div class="wb-lint-ok">✓ No issues — schema-clean and expression-safe.</div>';
      return;
    }
    for (const issue of all) {
      const row = document.createElement('div');
      row.className = `wb-lint-item wb-lint-${issue.sev}`;
      row.textContent = issue.text;
      row.title = `Click to select node [${issue.path.join(' › ')}]`;
      row.addEventListener('click', () => state.select(issue.path));
      lintEl.appendChild(row);
    }
  };

  state.subscribe((reason) => {
    if (reason !== 'selection' && reason !== 'theme') { dirty = false; regenerate(); refreshDeployPanel(); }
  });
  regenerate();
  renderLint([]);

  return { refreshLint: renderLint };
}
