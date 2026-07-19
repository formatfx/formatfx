// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Sam Yost

/**
 * bridge/extChannel.ts — the FormatFX page ↔ companion-extension message
 * contract (v1). It carries an apply payload from the formatfx.dev tab to
 * the extension so the user no longer has to round-trip through the
 * clipboard. The actual SharePoint write stays gesture-bound on the list tab
 * (the extension's popup, under activeTab) — this channel only *stages* the
 * payload; it never triggers a write by itself. That keeps the project's
 * click-only safety and minimal-permission posture intact.
 *
 * Transport is `window.postMessage` between the page and a content script the
 * extension runs on formatfx.dev — so no hardcoded extension id, and the page
 * works unchanged when the extension is absent. This module is just the typed
 * vocabulary + guards; the postMessage wiring lives in the app
 * (editor/extensionBridge.ts) and the extension (src/web.ts). Pure,
 * node-tested.
 */

import type { ApplyPayload } from './applyPayload';
import { parseApplyPayload } from './applyPayload';

export const EXT_CHANNEL = 'formatfx-channel';
/**
 * v2 (context-aware companion): adds `requestSnapshot`/`snapshotResult`
 * (the app pulls a fresh read-only capture from an open, connected list tab)
 * and `spTabs` (live presence: which connected list tabs are open). The
 * version is ANNOUNCEMENT-ONLY — v1 messages are still valid v2 messages;
 * the app feature-detects `version >= 2` before showing v2 affordances.
 */
export const EXT_CHANNEL_VERSION = 2;

/** One open, connected SharePoint list tab (presence metadata — no REST). */
export interface SpTabInfo {
  url: string;
  /** Best-effort human label derived from the URL path. */
  label: string;
}

/**
 * Page → extension. `id` correlates a request with its ack/response.
 * `formatter` is the page's reply to a `requestFormatter` (the extension's
 * "Grab this formatter" button): the current editor formatter as an apply
 * payload, or a teaching error. `requestSnapshot` (v2) asks for a fresh
 * read-only capture of the list open in a connected tab on `siteUrl`.
 */
export type PageToExt =
  | { channel: typeof EXT_CHANNEL; dir: 'page->ext'; kind: 'ping'; id: string }
  | { channel: typeof EXT_CHANNEL; dir: 'page->ext'; kind: 'stageApply'; id: string; payload: ApplyPayload }
  | { channel: typeof EXT_CHANNEL; dir: 'page->ext'; kind: 'formatter'; id: string; ok: boolean; payload?: ApplyPayload; error?: string }
  | { channel: typeof EXT_CHANNEL; dir: 'page->ext'; kind: 'requestSnapshot'; id: string; siteUrl: string };

/**
 * Extension → page. `snapshot` carries a captured List Snapshot (raw JSON);
 * `requestFormatter` asks the page to reply with the formatter it is editing.
 * v2: `snapshotResult` answers a `requestSnapshot`; `spTabs` announces which
 * connected list tabs are open right now (presence, pushed on change).
 */
export type ExtToPage =
  | { channel: typeof EXT_CHANNEL; dir: 'ext->page'; kind: 'ready'; version: number }
  | { channel: typeof EXT_CHANNEL; dir: 'ext->page'; kind: 'ack'; id: string; ok: boolean; staged?: number; error?: string }
  | { channel: typeof EXT_CHANNEL; dir: 'ext->page'; kind: 'snapshot'; text: string }
  | { channel: typeof EXT_CHANNEL; dir: 'ext->page'; kind: 'requestFormatter'; id: string }
  | { channel: typeof EXT_CHANNEL; dir: 'ext->page'; kind: 'snapshotResult'; id: string; ok: boolean; text?: string; error?: string }
  | { channel: typeof EXT_CHANNEL; dir: 'ext->page'; kind: 'spTabs'; tabs: SpTabInfo[] };

function isChannelMessage(data: unknown): data is Record<string, unknown> {
  return !!data && typeof data === 'object' && (data as Record<string, unknown>).channel === EXT_CHANNEL;
}

export function isPageToExt(data: unknown): data is PageToExt {
  if (!isChannelMessage(data) || data.dir !== 'page->ext' || typeof data.id !== 'string') return false;
  if (data.kind === 'requestSnapshot') return typeof data.siteUrl === 'string' && data.siteUrl.length > 0;
  return data.kind === 'ping' || data.kind === 'stageApply' || data.kind === 'formatter';
}

function isSpTabInfo(v: unknown): v is SpTabInfo {
  return !!v && typeof v === 'object'
    && typeof (v as Record<string, unknown>).url === 'string'
    && typeof (v as Record<string, unknown>).label === 'string';
}

// Validates required fields PER KIND: window.postMessage is a shared bus, so
// any same-page script can put `formatfx-channel` shapes on it — a malformed
// message must fail here, not crash a consumer later.
export function isExtToPage(data: unknown): data is ExtToPage {
  if (!isChannelMessage(data) || data.dir !== 'ext->page') return false;
  switch (data.kind) {
    case 'ready': return typeof data.version === 'number';
    case 'ack': return typeof data.id === 'string' && typeof data.ok === 'boolean';
    case 'snapshot': return typeof data.text === 'string';
    case 'requestFormatter': return typeof data.id === 'string';
    case 'snapshotResult': return typeof data.id === 'string' && typeof data.ok === 'boolean';
    case 'spTabs': return Array.isArray(data.tabs) && (data.tabs as unknown[]).every(isSpTabInfo);
    default: return false;
  }
}

export function readyMessage(): Extract<ExtToPage, { kind: 'ready' }> {
  return { channel: EXT_CHANNEL, dir: 'ext->page', kind: 'ready', version: EXT_CHANNEL_VERSION };
}

export function pingMessage(id: string): Extract<PageToExt, { kind: 'ping' }> {
  return { channel: EXT_CHANNEL, dir: 'page->ext', kind: 'ping', id };
}

export function stageApplyMessage(id: string, payload: ApplyPayload): Extract<PageToExt, { kind: 'stageApply' }> {
  return { channel: EXT_CHANNEL, dir: 'page->ext', kind: 'stageApply', id, payload };
}

export function ackMessage(id: string, result: { ok: boolean; staged?: number; error?: string }): Extract<ExtToPage, { kind: 'ack' }> {
  return { channel: EXT_CHANNEL, dir: 'ext->page', kind: 'ack', id, ...result };
}

export function snapshotMessage(text: string): Extract<ExtToPage, { kind: 'snapshot' }> {
  return { channel: EXT_CHANNEL, dir: 'ext->page', kind: 'snapshot', text };
}

export function requestFormatterMessage(id: string): Extract<ExtToPage, { kind: 'requestFormatter' }> {
  return { channel: EXT_CHANNEL, dir: 'ext->page', kind: 'requestFormatter', id };
}

export function formatterMessage(id: string, result: { ok: boolean; payload?: ApplyPayload; error?: string }): Extract<PageToExt, { kind: 'formatter' }> {
  return { channel: EXT_CHANNEL, dir: 'page->ext', kind: 'formatter', id, ...result };
}

export function requestSnapshotMessage(id: string, siteUrl: string): Extract<PageToExt, { kind: 'requestSnapshot' }> {
  return { channel: EXT_CHANNEL, dir: 'page->ext', kind: 'requestSnapshot', id, siteUrl };
}

export function snapshotResultMessage(id: string, result: { ok: boolean; text?: string; error?: string }): Extract<ExtToPage, { kind: 'snapshotResult' }> {
  return { channel: EXT_CHANNEL, dir: 'ext->page', kind: 'snapshotResult', id, ...result };
}

export function spTabsMessage(tabs: SpTabInfo[]): Extract<ExtToPage, { kind: 'spTabs' }> {
  return { channel: EXT_CHANNEL, dir: 'ext->page', kind: 'spTabs', tabs };
}

/**
 * Re-validate a staged payload on the extension side — the page is only
 * semi-trusted, so we run it back through the same teaching parser (and reuse
 * its version guard) rather than trusting the object shape off the wire.
 */
export function validateStagedPayload(payload: unknown): ApplyPayload {
  return parseApplyPayload(JSON.stringify(payload));
}
