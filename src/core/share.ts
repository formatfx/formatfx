// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Sam Yost

/**
 * core/share.ts — the share-link codec: a whole workspace in a URL fragment.
 *
 * The payload is exactly what `EditorState.serializeProject()` emits (and
 * `loadProject()` validates) — this module never invents its own project
 * schema, so share links inherit the project file's forward compatibility
 * for free. The codec's only job is bytes: UTF-8 → deflate-raw → base64url,
 * carried in the URL *fragment* so it never reaches any server (fragments
 * are not sent in HTTP requests — the workspace stays on the two machines).
 *
 * Fragment grammar (documented for third parties in docs/SHARE-URL.md):
 *   #w1=<base64url of deflate-raw-compressed UTF-8 project JSON>
 *   #w1r=<base64url of raw UTF-8 project JSON>          (no-compression fallback)
 *
 * The scheme name is the version knob: a future incompatible encoding gets
 * `w2`, and this decoder keeps understanding `w1`/`w1r` forever. Compression
 * uses the browser-native CompressionStream('deflate-raw') — zero runtime
 * dependencies, per the house rule. The `w1r` fallback exists for the small
 * set of engines without Compression Streams; every decoder accepts both.
 *
 * Pure and node-testable: no DOM, no editor imports.
 */

/** Compressed scheme: deflate-raw bytes, base64url-encoded. */
export const SHARE_SCHEME_DEFLATE = 'w1';
/** Fallback scheme: raw UTF-8 bytes, base64url-encoded (longer, always works). */
export const SHARE_SCHEME_RAW = 'w1r';

/**
 * Above this many characters the Share dialog warns: modern browsers are
 * fine into the hundreds of thousands, but chat apps, older proxies and
 * some link scanners truncate long URLs — warn + offer the project file,
 * never silently truncate (definitely-works ethos).
 */
export const SHARE_URL_WARN_LENGTH = 8000;

export interface ShareFragment {
  scheme: typeof SHARE_SCHEME_DEFLATE | typeof SHARE_SCHEME_RAW;
  /** The base64url payload (never decoded here — decode is async). */
  data: string;
}

// ─── base64url (hand-rolled: works identically in browser + node, no deps) ───

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_REVERSE: Record<string, number> = {};
for (let i = 0; i < B64_ALPHABET.length; i++) B64_REVERSE[B64_ALPHABET[i]] = i;

/** Bytes → unpadded base64url. */
export function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[((b0 & 0b11) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 === undefined) break;
    out += B64_ALPHABET[((b1 & 0b1111) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 === undefined) break;
    out += B64_ALPHABET[b2 & 0b111111];
  }
  return out;
}

/** Unpadded base64url → bytes. Throws on characters outside the alphabet. */
export function fromBase64Url(text: string): Uint8Array {
  const clean = text.replace(/=+$/, ''); // tolerate padded input
  if (clean.length % 4 === 1) throw new Error('Truncated base64url payload.');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let acc = 0, bits = 0, o = 0;
  for (const ch of clean) {
    const v = B64_REVERSE[ch];
    if (v === undefined) throw new Error(`Invalid base64url character '${ch}'.`);
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}

// ─── deflate-raw via the native Compression Streams API ─────────────────────

/** Whether this engine can produce compressed (`w1`) links. */
export function canDeflate(): boolean {
  return typeof CompressionStream !== 'undefined';
}

async function pipeBytes(
  bytes: Uint8Array,
  transform: { readable: ReadableStream; writable: WritableStream },
): Promise<Uint8Array> {
  // Blob→stream→Response keeps this dependency-free and identical in
  // browsers and node ≥18 (all three are standard globals).
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(transform as ReadableWritablePair);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ─── the codec ───────────────────────────────────────────────────────────────

/**
 * Project JSON → fragment body ("w1=…" or "w1r=…", no leading '#').
 * Prefers deflate; falls back to the raw scheme where Compression Streams
 * are unavailable — the link is longer but still valid everywhere.
 */
export async function encodeShareFragment(projectJson: string): Promise<string> {
  const utf8 = new TextEncoder().encode(projectJson);
  if (canDeflate()) {
    const packed = await pipeBytes(utf8, new CompressionStream('deflate-raw'));
    return `${SHARE_SCHEME_DEFLATE}=${toBase64Url(packed)}`;
  }
  return `${SHARE_SCHEME_RAW}=${toBase64Url(utf8)}`;
}

/**
 * A location.hash (with or without the leading '#') → the share payload,
 * or null when the hash is empty / not a share link (someone else's anchor).
 */
export function parseShareHash(hash: string): ShareFragment | null {
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  const eq = body.indexOf('=');
  if (eq <= 0) return null;
  const scheme = body.slice(0, eq);
  const data = body.slice(eq + 1);
  if (!data) return null;
  if (scheme === SHARE_SCHEME_DEFLATE || scheme === SHARE_SCHEME_RAW) {
    return { scheme, data };
  }
  return null;
}

/**
 * Fragment payload → the original project JSON string.
 * Throws a plain-language error on corrupt/truncated payloads or when a
 * compressed link meets an engine without Decompression Streams.
 */
export async function decodeShareFragment(frag: ShareFragment): Promise<string> {
  let bytes: Uint8Array;
  try {
    bytes = fromBase64Url(frag.data);
  } catch (e) {
    throw new Error(`This share link is damaged (${(e as Error).message}) — ask for the link again, or for the ${'formatfx-project.json'} file instead.`);
  }
  if (frag.scheme === SHARE_SCHEME_RAW) {
    return new TextDecoder().decode(bytes);
  }
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot open compressed share links (no Compression Streams support) — open it in a current Edge/Chrome/Firefox/Safari, or ask for the project file.');
  }
  try {
    const unpacked = await pipeBytes(bytes, new DecompressionStream('deflate-raw'));
    return new TextDecoder().decode(unpacked);
  } catch {
    throw new Error('This share link is damaged (its compressed payload does not decompress) — it was probably truncated by whatever carried it. Ask for the link again, or for the project file.');
  }
}

/**
 * Convenience: full share URL for a project. `baseUrl` is the app URL
 * without a fragment (any existing fragment is replaced).
 */
export async function buildShareUrl(baseUrl: string, projectJson: string): Promise<string> {
  const fragment = await encodeShareFragment(projectJson);
  return `${baseUrl.split('#')[0]}#${fragment}`;
}
