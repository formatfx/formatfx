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

import { isPageToExt, readyMessage, ackMessage, snapshotMessage, requestFormatterMessage, validateStagedPayload } from '../../src/bridge/extChannel';
import type { ApplyPayload } from '../../src/bridge/applyPayload';
import { STAGE_KEY, PUSH_KEY, type StagedApply, type PushedSnapshot } from './staging';

const origin = window.location.origin;

/** Pending "Grab this formatter" relays, keyed by request id (popup ⇄ page). */
const pendingGrabs = new Map<string, (r: { ok: boolean; payload?: ApplyPayload; error?: string }) => void>();

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

// Tell the background this tab is FormatFX (for the FX badge) — fire and
// forget, and never let a missing/sleeping service worker throw into the page.
try {
  void chrome.runtime.sendMessage({ type: 'formatfxTabHello' }).catch(() => {});
} catch { /* extension context gone (e.g. reloaded) — harmless */ }

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
    return;
  }

  if (data.kind === 'formatter') {
    // the page's reply to a "Grab this formatter" request we relayed
    const resolve = pendingGrabs.get(data.id);
    if (resolve) { pendingGrabs.delete(data.id); resolve({ ok: data.ok, payload: data.payload, error: data.error }); }
  }
});

/**
 * The popup (on this formatfx.dev tab) asks us to grab the formatter the page
 * is editing. We request it from the page over the channel and relay the reply.
 * Reuses the page's lint gate — an erroring formatter comes back as an error.
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const msg = message as { action?: string };
  if (msg?.action !== 'grabFormatter') return undefined;
  const id = Math.random().toString(36).slice(2);
  const timer = setTimeout(() => {
    if (pendingGrabs.delete(id)) sendResponse({ ok: false, error: "FormatFX didn't answer — this formatfx.dev tab may be an older version that predates Grab. Use the in-app “Send to extension” button instead, or reload FormatFX." });
  }, 4000);
  pendingGrabs.set(id, (r) => { clearTimeout(timer); sendResponse(r); });
  window.postMessage(requestFormatterMessage(id), origin);
  return true; // keep the message channel open for the async sendResponse
});
