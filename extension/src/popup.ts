/**
 * popup.ts — the two-button UI. Extract copies a List Snapshot to the
 * clipboard (paste into FormatFX → Data → Import schema). Apply reads a
 * FormatFX "apply" payload from the clipboard and writes it back to the
 * list's columns/views, behind one batched confirm.
 *
 * Permissioning: clicking the toolbar action grants `activeTab`, so we can
 * inject into the current SharePoint tab with no standing host permission —
 * the user authorizes exactly the tab they're looking at, nothing else.
 */

import type { ListSnapshot, ApplyOutcome } from '../../src/bridge/spClient';

interface WorkerResponse {
  ok: boolean;
  error?: string;
  snapshot?: ListSnapshot;
  outcomes?: ApplyOutcome[];
}

const statusEl = (): HTMLElement => document.getElementById('status')!;
function setStatus(text: string, kind: 'idle' | 'busy' | 'ok' | 'err' = 'idle'): void {
  const el = statusEl();
  el.textContent = text;
  el.className = kind;
}

async function activeTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab.');
  return tab.id;
}

/**
 * Runs in the page MAIN world (injected as a self-contained function): posts
 * one request to inject.js and resolves with the matching response. Must not
 * reference anything outside its own body.
 */
function callWorker(request: { action: string; opts?: unknown; text?: string }): Promise<WorkerResponse> {
  return new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2);
    const onMsg = (ev: MessageEvent): void => {
      if (ev.source !== window) return;
      const m = ev.data as { __formatfx?: string; id?: string };
      if (m && m.__formatfx === 'response' && m.id === id) {
        window.removeEventListener('message', onMsg);
        resolve(ev.data as WorkerResponse);
      }
    };
    window.addEventListener('message', onMsg);
    window.postMessage({ __formatfx: 'request', id, ...request }, '*');
  });
}

async function runInPage(request: { action: string; text?: string }): Promise<WorkerResponse> {
  const tabId = await activeTabId();
  // 1) ensure the MAIN-world worker is present (idempotent), then 2) call it.
  await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', files: ['inject.js'] });
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId }, world: 'MAIN', func: callWorker, args: [request],
  });
  return result;
}

async function onExtract(): Promise<void> {
  setStatus('Capturing the list…', 'busy');
  try {
    const res = await runInPage({ action: 'extract' });
    if (!res.ok || !res.snapshot) throw new Error(res.error || 'Capture failed.');
    const snap = res.snapshot;
    await navigator.clipboard.writeText(JSON.stringify(snap, null, 1));
    const cf = snap.fields.filter((f) => f.customFormatter).length;
    const vf = snap.views.filter((v) => v.customFormatter).length;
    setStatus(`Copied: ${snap.fields.length} fields (${cf} formatted), ${snap.views.length} views (${vf} formatted), ${snap.rows.length} rows. Paste into FormatFX → Data → Import schema.`, 'ok');
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e), 'err');
  }
}

async function onApply(): Promise<void> {
  setStatus('Reading clipboard…', 'busy');
  try {
    const text = await navigator.clipboard.readText();
    const res = await runInPage({ action: 'apply', text });
    if (!res.ok || !res.outcomes) throw new Error(res.error || 'Apply failed or was cancelled.');
    const applied = res.outcomes.filter((o) => o.applied);
    const failed = res.outcomes.filter((o) => !o.applied && o.error);
    if (!applied.length && !failed.length) {
      setStatus('Cancelled — nothing was written.', 'idle');
      return;
    }
    const parts = [`Applied ${applied.length} of ${res.outcomes.length}. Refresh the list to see it.`];
    for (const f of failed) parts.push(`✗ ${f.name}: ${f.error}`);
    setStatus(parts.join('\n'), failed.length ? 'err' : 'ok');
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e), 'err');
  }
}

document.getElementById('extract')!.addEventListener('click', onExtract);
document.getElementById('apply')!.addEventListener('click', onApply);
