/**
 * bgProtocol.ts — the message vocabulary between the extension's own contexts
 * (popup / web.ts content script ⇄ background service worker), sent over
 * chrome.runtime.sendMessage. Pure types + guards, no chrome APIs, so the
 * root vitest suite can pin the contract (src/bridge/extStorage.test.ts).
 *
 * Distinct from src/bridge/extChannel.ts, which is the page ⇄ extension
 * window.postMessage protocol — this one never leaves the extension.
 */

/** web.ts announces "this tab is a formatfx.dev tab" so the badge can show FX. */
export interface FormatfxTabHello {
  type: 'formatfxTabHello';
}

/**
 * web.ts relays the page's requestSnapshot (extChannel v2): the app asks for
 * a fresh read-only capture from an open, connected SharePoint list tab.
 */
export interface RefreshSnapshotRequest {
  type: 'refreshSnapshot';
  /** The site the app wants a snapshot from (its https://host origin or any URL on it). */
  siteUrl: string;
}

export interface RefreshSnapshotResponse {
  ok: boolean;
  /** Serialized ListSnapshot JSON on success. */
  text?: string;
  /** Teaching error on failure (not connected, no list tab open, capture failed). */
  error?: string;
}

/**
 * web.ts asks which connected SharePoint list tabs are open right now, so the
 * app can show live presence ("your Projects list is open"). Metadata only —
 * answering this never touches a tenant.
 */
export interface SpTabsQuery {
  type: 'spTabsQuery';
}

/** One open list/library-view tab on a connected site. */
export interface SpTabInfo {
  url: string;
  /** Best-effort human label derived from the URL path (no REST call). */
  label: string;
}

export interface SpTabsResponse {
  tabs: SpTabInfo[];
}

/**
 * background → web.ts (chrome.tabs.sendMessage): the set of open connected
 * list tabs changed — forward fresh presence to the page.
 */
export interface SpTabsChanged {
  type: 'spTabsChanged';
  tabs: SpTabInfo[];
}

export type BgMessage = FormatfxTabHello | RefreshSnapshotRequest | SpTabsQuery;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export function isFormatfxTabHello(v: unknown): v is FormatfxTabHello {
  return isRecord(v) && v.type === 'formatfxTabHello';
}

export function isRefreshSnapshotRequest(v: unknown): v is RefreshSnapshotRequest {
  return isRecord(v) && v.type === 'refreshSnapshot' && typeof v.siteUrl === 'string' && v.siteUrl.length > 0;
}

export function isSpTabsQuery(v: unknown): v is SpTabsQuery {
  return isRecord(v) && v.type === 'spTabsQuery';
}

export function isSpTabsChanged(v: unknown): v is SpTabsChanged {
  return isRecord(v) && v.type === 'spTabsChanged' && Array.isArray(v.tabs);
}
