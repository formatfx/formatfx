/**
 * editor/extensionBridge.ts — the app's side of the page ↔ companion-extension
 * channel (protocol in bridge/extChannel.ts). Feature-detected and fully
 * optional: when the extension isn't installed, nothing here fires and the
 * app behaves exactly as before (clipboard/snippet paths unchanged).
 *
 * It only ever *stages* an apply payload to the extension — the SharePoint
 * write still happens behind the user's click on the list tab. No write is
 * ever triggered from here.
 */

import type { ApplyPayload } from '../bridge/applyPayload';
import {
  EXT_CHANNEL_VERSION, isExtToPage, pingMessage, stageApplyMessage,
} from '../bridge/extChannel';

let detected = false;
let detectedVersion = EXT_CHANNEL_VERSION;
const readyListeners = new Set<(version: number) => void>();

// The extension's content script posts a `ready` when it loads; we also ping
// in case the page's listener attached after that. Either path flips presence.
window.addEventListener('message', (ev: MessageEvent) => {
  if (ev.source !== window) return;
  const data = ev.data as unknown;
  if (!isExtToPage(data)) return;
  if (data.kind === 'ready') {
    detected = true;
    detectedVersion = data.version;
    for (const cb of readyListeners) cb(data.version);
  }
});

/** Register a callback fired when the extension announces itself (or already has). */
export function onExtensionReady(cb: (version: number) => void): void {
  readyListeners.add(cb);
  if (detected) cb(detectedVersion);
  // nudge the extension to (re)announce
  window.postMessage(pingMessage(newId()), window.location.origin);
}

export function isExtensionDetected(): boolean {
  return detected;
}

/**
 * Stage one apply payload to the extension; resolves with the extension's ack
 * (or rejects on timeout when nothing answers — i.e. no extension present).
 */
export function stageApplyToExtension(payload: ApplyPayload, timeoutMs = 4000): Promise<{ staged: number }> {
  return new Promise((resolve, reject) => {
    const id = newId();
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', onMsg);
      reject(new Error('The FormatFX extension did not respond — is it installed and enabled?'));
    }, timeoutMs);
    const onMsg = (ev: MessageEvent): void => {
      if (ev.source !== window) return;
      const data = ev.data as unknown;
      if (!isExtToPage(data) || data.kind !== 'ack' || data.id !== id) return;
      window.clearTimeout(timer);
      window.removeEventListener('message', onMsg);
      if (data.ok) resolve({ staged: data.staged ?? payload.targets.length });
      else reject(new Error(data.error || 'The extension rejected the payload.'));
    };
    window.addEventListener('message', onMsg);
    window.postMessage(stageApplyMessage(id, payload), window.location.origin);
  });
}

function newId(): string {
  return Math.random().toString(36).slice(2);
}
