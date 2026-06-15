/**
 * Shared between web.ts (writer, on formatfx.dev) and popup.ts (reader, on the
 * list tab): the chrome.storage.local key under which a payload sent over the
 * page channel waits until the user clicks Apply on their SharePoint tab.
 * Its own file so popup.ts can import the key/type without pulling in web.ts's
 * content-script side effects.
 */
import type { ApplyPayload } from '../../src/bridge/applyPayload';

export const STAGE_KEY = 'formatfx.stagedApply';

export interface StagedApply {
  payload: ApplyPayload;
  stagedAt: string;
}

/**
 * Extract-push: a captured snapshot the popup hands off for an opening
 * formatfx.dev tab to pick up and auto-load. web.ts (on formatfx.dev) reads
 * it; nothing on a tenant ever touches it.
 */
export const PUSH_KEY = 'formatfx.pushedSnapshot';

export interface PushedSnapshot {
  snapshotJson: string;
  pushedAt: string;
}
