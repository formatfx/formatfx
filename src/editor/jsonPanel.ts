/**
 * editor/jsonPanel.ts — Bidirectional JSON view.
 *
 * Out: live compiled SP JSON ($schema wrapper, sanitized expressions),
 * with copy / download / CSOM-safe copy.
 * In: paste any column/view/tile formatter JSON and "Apply" loads it into
 * the visual editor.
 */

import { state } from './state';
import { exportJson, importJson } from '../core/serializer';
import { lintDocument, type LintIssue } from '../core/linter';
import type { RenderIssue } from '../core/renderer';

export interface JsonPanelApi {
  refreshLint: (runtime: RenderIssue[]) => void;
}

export function mountJsonPanel(host: HTMLElement, onToast: (m: string) => void): JsonPanelApi {
  host.innerHTML = `
    <div class="wb-json-toolbar">
      <label class="wb-check"><input type="checkbox" id="wb-json-sanitize" checked> sanitize whitespace</label>
      <button id="wb-json-copy" title="Copy to clipboard">Copy</button>
      <button id="wb-json-copy-csom" title="Copy with & and < escaped as \\u0026/\\u003c — safe for CSOM deploys">Copy (CSOM-safe)</button>
      <button id="wb-json-download" title="Download .json">Download</button>
      <button id="wb-json-apply" title="Parse the JSON below back into the visual editor">⬅ Apply to canvas</button>
    </div>
    <textarea id="wb-json-text" spellcheck="false"></textarea>
    <div id="wb-lint" class="wb-lint"></div>
  `;

  const textEl = host.querySelector('#wb-json-text') as HTMLTextAreaElement;
  const sanitizeEl = host.querySelector('#wb-json-sanitize') as HTMLInputElement;
  const lintEl = host.querySelector('#wb-lint') as HTMLElement;
  let dirty = false;

  const regenerate = () => {
    if (dirty) return; // don't clobber a paste in progress
    textEl.value = exportJson(state.doc, { sanitizeWhitespace: sanitizeEl.checked });
  };

  textEl.addEventListener('input', () => { dirty = true; });
  sanitizeEl.addEventListener('change', () => { dirty = false; regenerate(); });

  host.querySelector('#wb-json-copy')!.addEventListener('click', async () => {
    await navigator.clipboard.writeText(exportJson(state.doc, { sanitizeWhitespace: sanitizeEl.checked }));
    onToast('Formatter JSON copied');
  });
  host.querySelector('#wb-json-copy-csom')!.addEventListener('click', async () => {
    await navigator.clipboard.writeText(exportJson(state.doc, { sanitizeWhitespace: sanitizeEl.checked, csomSafe: true }));
    onToast('CSOM-safe JSON copied (& and < escaped)');
  });
  host.querySelector('#wb-json-download')!.addEventListener('click', () => {
    const blob = new Blob([exportJson(state.doc, { sanitizeWhitespace: sanitizeEl.checked })], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${state.doc.kind}-formatter.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  host.querySelector('#wb-json-apply')!.addEventListener('click', () => {
    try {
      const doc = importJson(textEl.value);
      dirty = false;
      state.loadDocument(doc);
      onToast(`Imported ${doc.kind} formatter`);
    } catch (e) {
      onToast(`Import failed: ${(e as Error).message}`);
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
    if (reason !== 'selection' && reason !== 'theme') { dirty = false; regenerate(); }
  });
  regenerate();
  renderLint([]);

  return { refreshLint: renderLint };
}
