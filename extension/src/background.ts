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

import { isFormatfxTabHello, isRefreshSnapshotRequest, isSpTabsQuery, type SpTabInfo, type RefreshSnapshotResponse } from './bgProtocol';
import { STAGE_KEY, migrateStorage, type StagedApply } from './staging';
import { classifyUrl, listLabelFromUrl } from './pageKind';
import { badgeFor } from './badge';
import { originPatternFor } from './connections';
import { runInTab } from './pageCall';

// ── storage migration ──────────────────────────────────────────────────────

async function runMigration(): Promise<void> {
  const current = await chrome.storage.local.get(null);
  const changes = migrateStorage(current);
  if (Object.keys(changes).length) await chrome.storage.local.set(changes);
}

chrome.runtime.onInstalled.addListener(() => { void runMigration(); void syncLensRegistration(); });

// ── the Modern lens: declutter classic settings pages on connected sites ───

const LENS_SCRIPT_ID = 'fxlens';

/**
 * (Re)register the lens content script against exactly the granted SharePoint
 * origins. Like the connected-sites list, registration is DERIVED from
 * chrome.permissions.getAll() and re-synced on every permission change — so a
 * revoke (popup or chrome://extensions) instantly stops injection, and
 * nothing about the lens is stored anywhere.
 */
async function syncLensRegistration(): Promise<void> {
  const granted = await chrome.permissions.getAll();
  const patterns = (granted.origins ?? []).filter((o) => o.includes('.sharepoint.com'));
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [LENS_SCRIPT_ID] });
  } catch { /* was not registered — first run or no sites connected */ }
  if (!patterns.length) return;
  await chrome.scripting.registerContentScripts([{
    id: LENS_SCRIPT_ID,
    matches: patterns,
    js: ['lens.js'],
    runAt: 'document_idle',
    persistAcrossSessions: true,
  }]);
}

// Belt and braces for the persisted registration: re-derive after every
// browser start (covers grants revoked while the browser was closed).
chrome.runtime.onStartup.addListener(() => { void syncLensRegistration(); });

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
  if (changeInfo.url || changeInfo.status === 'complete') {
    void refreshBadge(tabId, tab.url);
    void broadcastSpTabs();
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void chrome.tabs.get(tabId).then((tab) => refreshBadge(tabId, tab.url)).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  formatfxTabs.delete(tabId);
  void broadcastSpTabs();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[STAGE_KEY]) void refreshAllBadges();
});

chrome.permissions.onAdded.addListener(() => { void refreshAllBadges(); void broadcastSpTabs(); void syncLensRegistration(); });
chrome.permissions.onRemoved.addListener(() => { void refreshAllBadges(); void broadcastSpTabs(); void syncLensRegistration(); });

// ── presence: which connected list tabs are open (for the formatfx.dev app) ─

/**
 * Metadata only — URL + a label derived from it, no REST, no page access.
 * The query itself is bounded by granted origins: tabs.query with URL
 * patterns can only see tabs we hold host permission for.
 */
async function connectedListTabs(): Promise<SpTabInfo[]> {
  const granted = await chrome.permissions.getAll();
  const patterns = (granted.origins ?? []).filter((o) => o.includes('.sharepoint.com'));
  if (!patterns.length) return [];
  const tabs = await chrome.tabs.query({ url: patterns });
  return tabs
    .filter((t) => classifyUrl(t.url) === 'sharepoint')
    .map((t) => ({ url: t.url!, label: listLabelFromUrl(t.url!) }));
}

/** Push fresh presence to every formatfx.dev tab (fire-and-forget). */
async function broadcastSpTabs(): Promise<void> {
  if (!formatfxTabs.size) return;
  const tabs = await connectedListTabs();
  for (const tabId of formatfxTabs) {
    void chrome.tabs.sendMessage(tabId, { type: 'spTabsChanged', tabs }).catch(() => {
      formatfxTabs.delete(tabId); // tab gone or content script unloaded
    });
  }
}

// ── the refresh channel: a fresh read-only capture from a connected tab ────

/**
 * The app asked (via web.ts) for a fresh snapshot of the list open on
 * `siteUrl`. Read-only end to end; requires the site to be connected AND a
 * list tab to be open there — each miss is a teaching error naming the fix.
 */
async function handleRefreshSnapshot(siteUrl: string): Promise<RefreshSnapshotResponse> {
  const pattern = originPatternFor(siteUrl);
  if (!pattern) return { ok: false, error: 'That is not a SharePoint site URL the extension can reach.' };
  if (!(await chrome.permissions.contains({ origins: [pattern] }))) {
    return { ok: false, error: `This site isn't connected — open the extension on the list page and click "Connect ${pattern.replace(/^https:\/\//, '').replace(/\/\*$/, '')}" first.` };
  }
  const tabs = await chrome.tabs.query({ url: pattern });
  const listTabs = tabs.filter((t) => t.id && classifyUrl(t.url) === 'sharepoint');
  const target = listTabs.find((t) => t.active) ?? listTabs[0];
  if (!target?.id) return { ok: false, error: 'No list tab is open on that site — open your SharePoint list in a tab first.' };
  try {
    // rules stay out of the refresh read: this is a schema/rows context pull
    const res = await runInTab(target.id, { action: 'extract', opts: { includeRules: false } });
    if (!res.ok || !res.snapshot) return { ok: false, error: res.error || 'The capture failed.' };
    return { ok: true, text: JSON.stringify(res.snapshot) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

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
  if (isSpTabsQuery(message)) {
    void connectedListTabs().then((tabs) => sendResponse({ tabs }));
    return true; // async sendResponse
  }
  if (isRefreshSnapshotRequest(message)) {
    void handleRefreshSnapshot(message.siteUrl).then(sendResponse);
    return true; // async sendResponse
  }
  return undefined;
});
