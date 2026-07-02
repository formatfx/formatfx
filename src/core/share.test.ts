/**
 * The share-link codec contract: byte-exact round trips, versioned fragment
 * parsing, honest failures on damaged payloads. Encode/decode is pure and
 * runs identically in node (Compression Streams are global in node ≥18) and
 * the browser — which is exactly why the codec lives in core/.
 */
import { describe, it, expect } from 'vitest';
import {
  encodeShareFragment, decodeShareFragment, parseShareHash, buildShareUrl,
  toBase64Url, fromBase64Url, canDeflate,
  SHARE_SCHEME_DEFLATE, SHARE_SCHEME_RAW,
} from './share';

describe('base64url', () => {
  it('round-trips every byte value', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
  });

  it('round-trips awkward lengths (1 and 2 trailing bytes)', () => {
    for (const len of [0, 1, 2, 3, 4, 5]) {
      const bytes = new Uint8Array(len).map((_, i) => (i * 37) % 256);
      expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
    }
  });

  it('emits only URL-safe characters (no + / =)', () => {
    const bytes = new Uint8Array(300).map((_, i) => (i * 251) % 256);
    expect(toBase64Url(bytes)).toMatch(/^[A-Za-z0-9_-]*$/);
  });

  it('rejects characters outside the alphabet and truncated input', () => {
    expect(() => fromBase64Url('ab$c')).toThrow(/Invalid base64url/);
    expect(() => fromBase64Url('abcde')).toThrow(/Truncated/);
  });
});

describe('parseShareHash', () => {
  it('parses both schemes, with or without the leading #', () => {
    expect(parseShareHash('#w1=abc')).toEqual({ scheme: SHARE_SCHEME_DEFLATE, data: 'abc' });
    expect(parseShareHash('w1r=abc')).toEqual({ scheme: SHARE_SCHEME_RAW, data: 'abc' });
  });

  it('returns null for non-share hashes (someone else’s anchors stay theirs)', () => {
    expect(parseShareHash('')).toBeNull();
    expect(parseShareHash('#')).toBeNull();
    expect(parseShareHash('#section-2')).toBeNull();
    expect(parseShareHash('#w2=abc')).toBeNull(); // future scheme — not ours yet
    expect(parseShareHash('#w1=')).toBeNull(); // empty payload
  });
});

describe('encode/decode', () => {
  const PROJECT = JSON.stringify({
    version: 1,
    doc: { kind: 'column', root: { elmType: 'div', txtContent: "=if([$Status]=='Done','✓','…')" } },
    fields: [{ name: 'Status', type: 'choice' }],
    rows: [{ Status: 'Done' }],
    note: 'unicode survives: Zürich 東京 🚀',
  });

  it('prefers the compressed scheme where Compression Streams exist', async () => {
    expect(canDeflate()).toBe(true); // node ≥18 — the environment this suite pins
    const frag = await encodeShareFragment(PROJECT);
    expect(frag.startsWith(`${SHARE_SCHEME_DEFLATE}=`)).toBe(true);
  });

  it('round-trips the exact string, unicode included', async () => {
    const frag = await encodeShareFragment(PROJECT);
    const parsed = parseShareHash(`#${frag}`)!;
    expect(await decodeShareFragment(parsed)).toBe(PROJECT);
  });

  it('the raw fallback scheme decodes too', async () => {
    const raw = `${SHARE_SCHEME_RAW}=${toBase64Url(new TextEncoder().encode(PROJECT))}`;
    const parsed = parseShareHash(raw)!;
    expect(await decodeShareFragment(parsed)).toBe(PROJECT);
  });

  it('compression actually pays for itself on real project JSON', async () => {
    const repetitive = JSON.stringify({ rows: Array.from({ length: 40 }, (_, i) => ({ Title: `Task ${i}`, Status: 'In Progress' })) });
    const deflated = await encodeShareFragment(repetitive);
    const rawLen = toBase64Url(new TextEncoder().encode(repetitive)).length;
    expect(deflated.length).toBeLessThan(rawLen / 2);
  });

  it('refuses damaged payloads with a human explanation, never garbage output', async () => {
    await expect(decodeShareFragment({ scheme: SHARE_SCHEME_DEFLATE, data: '$$$' }))
      .rejects.toThrow(/damaged/);
    // valid base64url, but not deflate data underneath
    await expect(decodeShareFragment({ scheme: SHARE_SCHEME_DEFLATE, data: toBase64Url(new TextEncoder().encode('not-deflate')) }))
      .rejects.toThrow(/damaged|truncated/i);
  });
});

describe('buildShareUrl', () => {
  it('appends the fragment and replaces any existing one', async () => {
    const url = await buildShareUrl('https://formatfx.dev/#old-anchor', '{"a":1}');
    expect(url).toMatch(/^https:\/\/formatfx\.dev\/#w1=[A-Za-z0-9_-]+$/);
  });
});
