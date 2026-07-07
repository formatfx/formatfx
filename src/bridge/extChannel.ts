// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

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
export const EXT_CHANNEL_VERSION = 1;

/**
 * Page → extension. `id` correlates a request with its ack/response.
 * `formatter` is the page's reply to a `requestFormatter` (the extension's
 * "Grab this formatter" button): the current editor formatter as an apply
 * payload, or a teaching error.
 */
export type PageToExt =
  | { channel: typeof EXT_CHANNEL; dir: 'page->ext'; kind: 'ping'; id: string }
  | { channel: typeof EXT_CHANNEL; dir: 'page->ext'; kind: 'stageApply'; id: string; payload: ApplyPayload }
  | { channel: typeof EXT_CHANNEL; dir: 'page->ext'; kind: 'formatter'; id: string; ok: boolean; payload?: ApplyPayload; error?: string };

/**
 * Extension → page. `snapshot` carries a captured List Snapshot (raw JSON);
 * `requestFormatter` asks the page to reply with the formatter it is editing.
 */
export type ExtToPage =
  | { channel: typeof EXT_CHANNEL; dir: 'ext->page'; kind: 'ready'; version: number }
  | { channel: typeof EXT_CHANNEL; dir: 'ext->page'; kind: 'ack'; id: string; ok: boolean; staged?: number; error?: string }
  | { channel: typeof EXT_CHANNEL; dir: 'ext->page'; kind: 'snapshot'; text: string }
  | { channel: typeof EXT_CHANNEL; dir: 'ext->page'; kind: 'requestFormatter'; id: string };

function isChannelMessage(data: unknown): data is Record<string, unknown> {
  return !!data && typeof data === 'object' && (data as Record<string, unknown>).channel === EXT_CHANNEL;
}

export function isPageToExt(data: unknown): data is PageToExt {
  return isChannelMessage(data) && data.dir === 'page->ext'
    && (data.kind === 'ping' || data.kind === 'stageApply' || data.kind === 'formatter')
    && typeof data.id === 'string';
}

export function isExtToPage(data: unknown): data is ExtToPage {
  return isChannelMessage(data) && data.dir === 'ext->page'
    && (data.kind === 'ready' || data.kind === 'ack' || data.kind === 'snapshot' || data.kind === 'requestFormatter');
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

/**
 * Re-validate a staged payload on the extension side — the page is only
 * semi-trusted, so we run it back through the same teaching parser (and reuse
 * its version guard) rather than trusting the object shape off the wire.
 */
export function validateStagedPayload(payload: unknown): ApplyPayload {
  return parseApplyPayload(JSON.stringify(payload));
}
