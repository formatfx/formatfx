/**
 * background.ts — the MV3 service worker: the extension's thin coordinator.
 * It owns exactly three jobs and no business logic:
 *   1. storage schema migration on install/update (staging.migrateStorage),
 *   2. the per-tab badge on connected sites + formatfx.dev (Stage 2),
 *   3. routing runtime messages between popup / web.ts (bgProtocol).
 *
 * Heavy lifting stays in the audited, node-tested src/bridge runtime and the
 * pure extension modules — this file only wires chrome events to them.
 *
 * Privacy boundary: chrome only exposes tab URLs to the listeners below for
 * origins the user has explicitly connected (chrome.permissions.request in
 * the popup) — on every other tab the events carry no URL and we do nothing.
 */

import { isFormatfxTabHello } from './bgProtocol';
import { SCHEMA_KEY, migrateStorage } from './staging';

// ── storage migration ──────────────────────────────────────────────────────

async function runMigration(): Promise<void> {
  const current = await chrome.storage.local.get(null);
  const changes = migrateStorage(current);
  if (Object.keys(changes).length) await chrome.storage.local.set(changes);
}

chrome.runtime.onInstalled.addListener(() => { void runMigration(); });

// ── message routing (grows in later stages) ────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (isFormatfxTabHello(message)) {
    // A formatfx.dev tab announced itself; badge wiring lands in Stage 2.
    void sender;
    sendResponse({ ok: true });
    return undefined;
  }
  return undefined;
});

// Referenced so the bundle keeps the constant exported for future stages;
// harmless in a service worker.
void SCHEMA_KEY;
