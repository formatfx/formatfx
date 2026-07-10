/**
 * inject.ts — bundled to inject.js and run in the page's MAIN world (so it
 * can read `window._spPageContextInfo` and fetch with the page's own
 * cookies). It is a tiny request/response worker over `window.postMessage`:
 * the popup loads it once, then posts {action:'extract'|'apply'} requests and
 * awaits the matching response. All real work lives in the audited,
 * node-tested src/bridge runtime — this file only wires it to the page.
 */

import { captureSnapshot, applyFormatters } from '../../src/bridge/spClient';
import { parseApplyPayload } from '../../src/bridge/applyPayload';

interface RequestMessage {
  __formatfx: 'request';
  id: string;
  action: 'extract' | 'apply';
  opts?: { listTitle?: string; includeData?: boolean };
  text?: string;
}

const w = window as unknown as Record<string, unknown>;

// Re-injection is harmless but must not stack listeners.
if (!w.__formatfxInjected) {
  w.__formatfxInjected = true;

  window.addEventListener('message', async (ev: MessageEvent) => {
    if (ev.source !== window) return;
    const msg = ev.data as RequestMessage | undefined;
    if (!msg || msg.__formatfx !== 'request') return;

    const reply = (payload: Record<string, unknown>): void => {
      window.postMessage({ __formatfx: 'response', id: msg.id, ...payload }, '*');
    };

    try {
      if (msg.action === 'extract') {
        const snapshot = await captureSnapshot(msg.opts ?? {});
        reply({ ok: true, snapshot });
      } else if (msg.action === 'apply') {
        const payload = parseApplyPayload(msg.text ?? '');
        // The single batched confirm uses the page's native dialog.
        const outcomes = await applyFormatters(payload, { confirm: (m) => window.confirm(m) });
        reply({ ok: true, outcomes });
      }
    } catch (e) {
      reply({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
}
