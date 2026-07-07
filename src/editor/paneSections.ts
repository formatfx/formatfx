/**
 * editor/paneSections.ts — collapse/expand state for the three big Left Edit
 * Pane sections: Columns, Components, and the Inspector. Pure persistence, no
 * DOM (leftPane.ts owns the wiring).
 *
 * The state rides its OWN frozen localStorage key rather than the `wb-ui-prefs`
 * blob main.ts owns: that blob is read once at load into a private in-memory
 * object, so a cross-module read-modify-write into it would race — a mid-session
 * toggle here would be clobbered the next time main.ts re-saved its own copy.
 * A dedicated key is race-free and purely additive (frozen-keys rule: never
 * rename/wipe an existing key; adding a new one is fine).
 */

/** The three top-level pane sections. Nested foldables (e.g. the Components
 *  library's own "In this project" / "Add components" groups) use their own
 *  string ids under the same store — hence the functions take a plain string. */
export type PaneSectionId = 'columns' | 'components' | 'inspector';

/** Frozen — never rename (would silently reset everyone's collapsed sections). */
export const PANE_SECTIONS_KEY = 'wb-lp-sections.v1';

type CollapseMap = Record<string, boolean>;

function read(): CollapseMap {
  try {
    const raw = JSON.parse(localStorage.getItem(PANE_SECTIONS_KEY) ?? '{}');
    // must be a plain object: an array is also typeof 'object', but writing a
    // named flag onto it and re-serializing (JSON.stringify) would silently
    // drop it — treat it (and any non-object) as malformed → "all expanded".
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as CollapseMap) : {};
  } catch {
    // malformed JSON or storage blocked — behave as "all expanded"
    return {};
  }
}

function write(map: CollapseMap): void {
  try {
    localStorage.setItem(PANE_SECTIONS_KEY, JSON.stringify(map));
  } catch {
    /* private mode / storage full — the pane still works, state just won't persist */
  }
}

/** Default is EXPANDED — a section is collapsed only when explicitly stored true. */
export function isSectionCollapsed(id: string): boolean {
  return read()[id] === true;
}

export function setSectionCollapsed(id: string, collapsed: boolean): void {
  const map = read();
  map[id] = collapsed;
  write(map);
}
