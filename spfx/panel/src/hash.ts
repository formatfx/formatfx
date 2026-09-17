/**
 * hash.ts — content identity for journal rows (spec §6 `BasedOn`). Not a
 * security hash: FNV-1a 32-bit plus the length, enough to tell "the
 * formatter you started from" apart from "what the list holds now". The apply
 * flow compares full strings wherever it has them; the hash is what a draft
 * row can carry.
 */
export function contentHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0') + '-' + text.length.toString(36);
}

/** SharePoint stores a cleared formatter as ''/null — hash both the same. */
export function formatterHash(formatter: string | null): string {
  return contentHash(formatter ?? '');
}
