/**
 * web.ts — content script on formatfx.dev (the app's own origin, not a
 * tenant). It is the extension's half of the page channel
 * (src/bridge/extChannel.ts): it announces the extension to the page, and
 * when the page sends an apply payload it re-validates it and stashes it in
 * chrome.storage.local for the popup to apply later, on the list tab.
 *
 * It never writes to SharePoint and never touches a tenant origin — the write
 * stays gesture-bound to the popup under activeTab. This script only moves a
 * payload from the page into local storage.
 */

import { isPageToExt, readyMessage, ackMessage, validateStagedPayload } from '../../src/bridge/extChannel';
import { STAGE_KEY, type StagedApply } from './staging';

const origin = window.location.origin;

// Announce on load; the page also pings, which we answer below.
window.postMessage(readyMessage(), origin);

window.addEventListener('message', async (ev: MessageEvent) => {
  if (ev.source !== window) return;
  const data = ev.data as unknown;
  if (!isPageToExt(data)) return;

  if (data.kind === 'ping') {
    window.postMessage(readyMessage(), origin);
    return;
  }

  if (data.kind === 'stageApply') {
    try {
      const payload = validateStagedPayload(data.payload); // re-validate off the wire
      const staged: StagedApply = { payload, stagedAt: new Date().toISOString() };
      await chrome.storage.local.set({ [STAGE_KEY]: staged });
      window.postMessage(ackMessage(data.id, { ok: true, staged: payload.targets.length }), origin);
    } catch (e) {
      window.postMessage(ackMessage(data.id, { ok: false, error: e instanceof Error ? e.message : String(e) }), origin);
    }
  }
});
