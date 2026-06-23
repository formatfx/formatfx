/**
 * editor/subtypes.ts — the custom-subtype store (the new `wb-subtypes`
 * localStorage key). A subtype is a reusable column-rendering recipe (see
 * `Subtype` in core/types): a saved formatter that may carry typed knobs
 * (apply-time fill-ins) and the fx-bar vocabulary to offer.
 *
 * This module owns persistence for MAKER-AUTHORED subtypes only. Built-in seeds
 * live in code (added in US-2) and are never stored here. Every read and write
 * is try/catch-guarded (private-mode safe, exactly like `wb-ui-prefs`): a
 * corrupt, missing, or version-incompatible key yields an empty catalog and
 * never throws — a misread can never wipe or block a maker's work.
 */

import type { Subtype } from '../core/types';

/** localStorage key for maker-authored (custom) subtypes. Frozen + additive —
 *  the only new key this feature introduces. */
export const SUBTYPES_KEY = 'wb-subtypes';

/** Envelope schema version — bump ONLY on an incompatible shape change. */
const STORE_VERSION = 1;

interface SubtypeStore {
  version: number;
  subtypes: Subtype[];
}

/**
 * The custom catalog from storage. Empty on a missing, corrupt, or
 * version-incompatible key; individually malformed records are dropped so one
 * bad entry can never poison the rest.
 */
export function listSubtypes(): Subtype[] {
  try {
    const raw = localStorage.getItem(SUBTYPES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<SubtypeStore> | null;
    if (!parsed || parsed.version !== STORE_VERSION || !Array.isArray(parsed.subtypes)) return [];
    return parsed.subtypes.filter(isSubtype);
  } catch {
    return [];
  }
}

/** One custom subtype by id, or undefined. */
export function getSubtype(id: string): Subtype | undefined {
  return listSubtypes().find((s) => s.id === id);
}

/** Upsert a custom subtype by id (in place — order preserved), then persist
 *  (swallowed in private mode). Built-in seeds live in code and are refused. */
export function saveSubtype(subtype: Subtype): void {
  if (subtype.origin !== 'custom') return; // seeds are never stored (refuse-don't-guess)
  const all = listSubtypes();
  const i = all.findIndex((s) => s.id === subtype.id);
  if (i >= 0) all[i] = subtype; else all.push(subtype);
  persist(all);
}

/** Remove a custom subtype by id, then persist (swallowed in private mode). */
export function deleteSubtype(id: string): void {
  persist(listSubtypes().filter((s) => s.id !== id));
}

function persist(subtypes: Subtype[]): void {
  try {
    const store: SubtypeStore = { version: STORE_VERSION, subtypes };
    localStorage.setItem(SUBTYPES_KEY, JSON.stringify(store));
  } catch {
    /* quota / private mode — best-effort, like wb-ui-prefs autosave */
  }
}

/** Minimal shape guard so a corrupt record can't crash or poison the catalog. */
function isSubtype(s: unknown): s is Subtype {
  if (!s || typeof s !== 'object') return false;
  const o = s as Record<string, unknown>;
  return typeof o.id === 'string'
    && typeof o.name === 'string'
    && o.origin === 'custom' // the store holds maker-authored subtypes only
    && Array.isArray(o.baseTypes)
    && !!o.formatter && typeof o.formatter === 'object'
    && Array.isArray(o.knobs)
    && !!o.vocab && typeof o.vocab === 'object';
}
