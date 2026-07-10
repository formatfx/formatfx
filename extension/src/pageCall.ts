/**
 * pageCall.ts — the two-step "run the bridge runtime in a SharePoint tab"
 * dance, shared by popup.ts (active tab, under activeTab) and background.ts
 * (a connected tab, under its granted host permission):
 *   1. inject inject.js into the tab's MAIN world (idempotent),
 *   2. post one request to it over window.postMessage and await the response.
 */
import type { ListSnapshot, ApplyOutcome, TargetFormatter } from '../../src/bridge/spClient';

export interface WorkerRequest {
  action: string;
  opts?: unknown;
  text?: string;
}

export interface WorkerResponse {
  ok: boolean;
  error?: string;
  snapshot?: ListSnapshot;
  outcomes?: ApplyOutcome[];
  formatters?: TargetFormatter[];
}

/**
 * Runs in the page MAIN world (injected as a self-contained function): posts
 * one request to inject.js and resolves with the matching response. Must not
 * reference anything outside its own body.
 */
export function callWorker(request: WorkerRequest): Promise<WorkerResponse> {
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

/** Ensure the MAIN-world worker is present in the tab, then call it once. */
export async function runInTab(tabId: number, request: WorkerRequest): Promise<WorkerResponse> {
  await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', files: ['inject.js'] });
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId }, world: 'MAIN', func: callWorker, args: [request],
  });
  return result;
}
