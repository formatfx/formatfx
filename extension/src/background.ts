/**
 * background.ts — the MV3 service worker: the extension's thin coordinator.
 * It owns exactly three jobs and no business logic:
 *   1. storage schema migration on install/update (staging.migrateStorage),
 *   2. the per-tab badge on connected sites + formatfx.dev tabs,
 *   3. routing runtime messages between popup / web.ts (bgProtocol).
 *
 * Heavy lifting stays in the audited, node-tested src/bridge runtime and the
 * pure extension modules (badge.ts, connections.ts) — this file only wires
 * chrome events to them.
 *
 * Privacy boundary: chrome only exposes tab URLs to the listeners below for
 * origins the user has explicitly connected (chrome.permissions.request in
 * the popup) — on every other tab the events carry no URL and we do nothing.
 * formatfx.dev tabs are the one exception: web.ts (already a content script
 * there) announces itself with one runtime message, so no URL access is
 * needed for the FX badge either.
 */

import { isFormatfxTabHello } from './bgProtocol';
import { STAGE_KEY, migrateStorage, type StagedApply } from './staging';
import { classifyUrl } from './pageKind';
import { badgeFor } from './badge';
import { originPatternFor } from './connections';

// ── storage migration ──────────────────────────────────────────────────────

async function runMigration(): Promise<void> {
  const current = await chrome.storage.local.get(null);
  const changes = migrateStorage(current);
  if (Object.keys(changes).length) await chrome.storage.local.set(changes);
}

chrome.runtime.onInstalled.addListener(() => { void runMigration(); });

// ── badge ──────────────────────────────────────────────────────────────────

/**
 * Tabs where web.ts said hello (formatfx.dev). A Set survives for the service
 * worker's lifetime; after an SW restart web.ts pings again on the next page
 * load, and the badge is per-tab so a lost entry only costs the FX marker.
 */
const formatfxTabs = new Set<number>();

async function stagedCount(): Promise<number> {
  const got = await chrome.storage.local.get(STAGE_KEY);
  const staged = got[STAGE_KEY] as StagedApply | undefined;
  return staged?.payload?.targets?.length ?? 0;
}

async function refreshBadge(tabId: number, url: string | undefined): Promise<void> {
  const kind = formatfxTabs.has(tabId) ? 'formatfx' : classifyUrl(url);
  const pattern = originPatternFor(url);
  const connected = pattern ? await chrome.permissions.contains({ origins: [pattern] }) : false;
  const state = badgeFor({ kind, connected, stagedCount: await stagedCount() });
  await chrome.action.setBadgeText({ text: state.text, tabId });
  if (state.text) await chrome.action.setBadgeBackgroundColor({ color: state.color, tabId });
  await chrome.action.setTitle({ title: state.title, tabId });
}

/**
 * Recompute the badge on every tab we can see: connected SharePoint origins
 * (tabs.query with URL patterns only returns matches we hold permission for)
 * plus the self-announced formatfx.dev tabs. Called when staged state or the
 * permission set changes.
 */
async function refreshAllBadges(): Promise<void> {
  const granted = await chrome.permissions.getAll();
  const patterns = (granted.origins ?? []).filter((o) => o.includes('.sharepoint.com'));
  if (patterns.length) {
    const tabs = await chrome.tabs.query({ url: patterns });
    for (const t of tabs) if (t.id) void refreshBadge(t.id, t.url);
  }
  for (const tabId of formatfxTabs) void refreshBadge(tabId, undefined);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // URL is only present for connected origins; SPA navigations fire here too.
  if (changeInfo.url || changeInfo.status === 'complete') void refreshBadge(tabId, tab.url);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void chrome.tabs.get(tabId).then((tab) => refreshBadge(tabId, tab.url)).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => { formatfxTabs.delete(tabId); });

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[STAGE_KEY]) void refreshAllBadges();
});

chrome.permissions.onAdded.addListener(() => { void refreshAllBadges(); });
chrome.permissions.onRemoved.addListener(() => { void refreshAllBadges(); });

// ── message routing ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (isFormatfxTabHello(message)) {
    const tabId = sender.tab?.id;
    if (tabId) {
      formatfxTabs.add(tabId);
      void refreshBadge(tabId, sender.tab?.url);
    }
    sendResponse({ ok: true });
    return undefined;
  }
  return undefined;
});
