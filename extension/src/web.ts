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

import { isPageToExt, readyMessage, ackMessage, snapshotMessage, validateStagedPayload } from '../../src/bridge/extChannel';
import { STAGE_KEY, PUSH_KEY, type StagedApply, type PushedSnapshot } from './staging';

const origin = window.location.origin;

/**
 * Deliver a pushed snapshot (extract-push) to the page, then clear it so it
 * loads exactly once. Called on load (the popup wrote it before opening this
 * tab) and on each ping (covers the fresh-tab race where the page's listener
 * attaches after we'd otherwise have posted).
 */
async function deliverPushedSnapshot(): Promise<void> {
  const got = await chrome.storage.local.get(PUSH_KEY);
  const pushed = got[PUSH_KEY] as PushedSnapshot | undefined;
  if (!pushed) return;
  await chrome.storage.local.remove(PUSH_KEY);
  window.postMessage(snapshotMessage(pushed.snapshotJson), origin);
}

// Announce on load; the page also pings, which we answer below.
window.postMessage(readyMessage(), origin);
void deliverPushedSnapshot();

window.addEventListener('message', async (ev: MessageEvent) => {
  if (ev.source !== window) return;
  const data = ev.data as unknown;
  if (!isPageToExt(data)) return;

  if (data.kind === 'ping') {
    window.postMessage(readyMessage(), origin);
    void deliverPushedSnapshot();
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
