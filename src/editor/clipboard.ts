// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * editor/clipboard.ts — node copy/paste for the structure tree + context menu.
 *
 * Copy serializes the selected node(s) to the system clipboard as JSON (so they
 * survive across tabs) and keeps an in-memory fallback for environments where
 * the async clipboard is unavailable (tests, http). Paste reads either source,
 * validates it looks like an SPElement, deep-clones, and inserts via the
 * sanctioned state.insertNode path (one undoable step per inserted node).
 */

import { state } from './state';
import type { NodePath, SPElement } from '../core/types';

/** In-memory fallback when navigator.clipboard is unavailable / denied. */
let memoryClip: SPElement[] | null = null;

function looksLikeElement(x: unknown): x is SPElement {
  return !!x && typeof x === 'object' && typeof (x as { elmType?: unknown }).elmType === 'string';
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** Copy the nodes at the given paths. Returns how many were copied. */
export async function copyNodes(paths: NodePath[]): Promise<number> {
  const nodes = paths
    .map((p) => state.nodeAt(p))
    .filter((n): n is SPElement => n != null)
    .map(clone);
  if (!nodes.length) return 0;
  memoryClip = nodes;
  try {
    const payload = nodes.length === 1 ? nodes[0] : nodes;
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  } catch { /* memory fallback already set */ }
  return nodes.length;
}

/** Read the clipboard (system first, memory fallback) into a node list. */
async function readClipNodes(): Promise<SPElement[] | null> {
  try {
    const text = await navigator.clipboard.readText();
    const parsed = JSON.parse(text) as unknown;
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    if (arr.length && arr.every(looksLikeElement)) return arr as SPElement[];
  } catch { /* fall through to memory */ }
  return memoryClip;
}

/**
 * Paste the clipboard nodes into the container at `targetPath` (defaults to the
 * current selection / root). Returns how many were inserted.
 */
export async function pasteNodes(targetPath?: NodePath): Promise<number> {
  const nodes = await readClipNodes();
  if (!nodes?.length) return 0;
  const at = targetPath ?? state.selection ?? [];
  let count = 0;
  for (const node of nodes) {
    state.insertNode(clone(node), at);
    count++;
  }
  return count;
}

/** Whether a paste would currently insert anything (best-effort, sync part). */
export function hasMemoryClip(): boolean {
  return !!memoryClip?.length;
}
