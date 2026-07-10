/**
 * extChannelV2.test.ts — the v2 additions to the page ↔ extension channel:
 * requestSnapshot/snapshotResult (the app pulls a fresh read-only capture
 * from a connected tab) and spTabs (live presence). v1 compatibility is a
 * hard requirement — the version bump is announcement-only.
 */
import { describe, it, expect } from 'vitest';
import {
  EXT_CHANNEL_VERSION, isPageToExt, isExtToPage,
  pingMessage, readyMessage, snapshotMessage,
  requestSnapshotMessage, snapshotResultMessage, spTabsMessage,
} from './extChannel';
import { isSpTabsChanged } from '../../extension/src/bgProtocol';
import { listLabelFromUrl } from '../../extension/src/pageKind';
import { requestSnapshotFromExtension } from '../editor/extensionBridge';

describe('extChannel v2', () => {
  it('announces version 2', () => {
    expect(EXT_CHANNEL_VERSION).toBe(2);
    expect(readyMessage().version).toBe(2);
  });

  it('v1 messages still validate (the bump is announcement-only)', () => {
    expect(isPageToExt(pingMessage('a'))).toBe(true);
    expect(isExtToPage(snapshotMessage('{}'))).toBe(true);
  });

  it('accepts the new kinds with their required fields', () => {
    expect(isPageToExt(requestSnapshotMessage('id1', 'https://contoso.sharepoint.com/sites/T/Lists/L/AllItems.aspx'))).toBe(true);
    expect(isExtToPage(snapshotResultMessage('id1', { ok: true, text: '{}' }))).toBe(true);
    expect(isExtToPage(snapshotResultMessage('id1', { ok: false, error: 'nope' }))).toBe(true);
    expect(isExtToPage(spTabsMessage([{ url: 'https://x.sharepoint.com/Lists/L/A.aspx', label: 'L' }]))).toBe(true);
    expect(isExtToPage(spTabsMessage([]))).toBe(true);
  });

  it('rejects malformed v2 messages', () => {
    // requestSnapshot without a siteUrl is not a valid ask
    expect(isPageToExt({ channel: 'formatfx-channel', dir: 'page->ext', kind: 'requestSnapshot', id: 'x' })).toBe(false);
    expect(isPageToExt({ channel: 'formatfx-channel', dir: 'page->ext', kind: 'requestSnapshot', id: 'x', siteUrl: '' })).toBe(false);
    // spTabs must carry an array
    expect(isExtToPage({ channel: 'formatfx-channel', dir: 'ext->page', kind: 'spTabs' })).toBe(false);
    expect(isExtToPage({ channel: 'formatfx-channel', dir: 'ext->page', kind: 'spTabs', tabs: 'nope' })).toBe(false);
  });

  it('validates required fields per kind — a shared postMessage bus is spoofable', () => {
    // spTabs entries must be {url: string, label: string}; a malformed entry
    // must fail the guard, not crash the Data panel later
    expect(isExtToPage({ channel: 'formatfx-channel', dir: 'ext->page', kind: 'spTabs', tabs: [{ url: 42 }] })).toBe(false);
    expect(isExtToPage({ channel: 'formatfx-channel', dir: 'ext->page', kind: 'spTabs', tabs: [null] })).toBe(false);
    expect(isExtToPage({ channel: 'formatfx-channel', dir: 'ext->page', kind: 'spTabs', tabs: [{ url: 'x', label: 'y' }, 'junk'] })).toBe(false);
    // snapshotResult needs its correlation id and verdict
    expect(isExtToPage({ channel: 'formatfx-channel', dir: 'ext->page', kind: 'snapshotResult', ok: true })).toBe(false);
    expect(isExtToPage({ channel: 'formatfx-channel', dir: 'ext->page', kind: 'snapshotResult', id: 'x' })).toBe(false);
    // v1 kinds are field-checked too (a ready without a version is garbage)
    expect(isExtToPage({ channel: 'formatfx-channel', dir: 'ext->page', kind: 'ready' })).toBe(false);
    expect(isExtToPage({ channel: 'formatfx-channel', dir: 'ext->page', kind: 'snapshot' })).toBe(false);
    expect(isExtToPage({ channel: 'formatfx-channel', dir: 'ext->page', kind: 'ack', id: 'x' })).toBe(false);
  });
});

describe('bgProtocol spTabsChanged (background → web.ts push)', () => {
  it('guards the presence push', () => {
    expect(isSpTabsChanged({ type: 'spTabsChanged', tabs: [] })).toBe(true);
    expect(isSpTabsChanged({ type: 'spTabsChanged' })).toBe(false);
    expect(isSpTabsChanged({ type: 'other', tabs: [] })).toBe(false);
  });
});

describe('listLabelFromUrl (presence labels — pure string work, no REST)', () => {
  it('names lists from the /Lists/ segment and libraries from the /Forms/ parent', () => {
    expect(listLabelFromUrl('https://c.sharepoint.com/sites/Team/Lists/Projects/AllItems.aspx')).toBe('Projects');
    expect(listLabelFromUrl('https://c.sharepoint.com/sites/Team/Lists/My%20Tasks/By%20Status.aspx')).toBe('My Tasks');
    expect(listLabelFromUrl('https://c.sharepoint.com/sites/Team/Shared%20Documents/Forms/AllItems.aspx')).toBe('Shared Documents');
  });

  it('falls back to the hostname, then the raw string', () => {
    expect(listLabelFromUrl('https://c.sharepoint.com/sites/Team')).toBe('c.sharepoint.com');
    expect(listLabelFromUrl('not a url')).toBe('not a url');
  });
});

describe('requestSnapshotFromExtension (app side, postMessage loopback)', () => {
  // happy-dom's postMessage delivers with source: null; the bridge (rightly)
  // filters on source === window, so the fake extension's reply is dispatched
  // as a MessageEvent with an explicit source — same shape as a real browser.
  const replyWith = (result: { ok: boolean; text?: string; error?: string }): void => {
    const answer = (ev: MessageEvent): void => {
      const d = ev.data as { kind?: string; id?: string };
      if (d?.kind !== 'requestSnapshot') return;
      window.removeEventListener('message', answer);
      window.dispatchEvent(new MessageEvent('message', {
        data: snapshotResultMessage(d.id!, result),
        source: window as unknown as MessageEventSource,
      }));
    };
    window.addEventListener('message', answer);
  };

  it('resolves with the snapshot text a fake extension answers with', async () => {
    replyWith({ ok: true, text: '{"formatfx":"list-snapshot"}' });
    await expect(requestSnapshotFromExtension('https://contoso.sharepoint.com', 2000))
      .resolves.toBe('{"formatfx":"list-snapshot"}');
  });

  it('rejects with the extension teaching error', async () => {
    replyWith({ ok: false, error: "This site isn't connected" });
    await expect(requestSnapshotFromExtension('https://contoso.sharepoint.com', 2000))
      .rejects.toThrow(/isn't connected/);
  });
});
