/**
 * editor/styleScope.ts — Pure brain for the "violet = shared" legibility work.
 * Derives WHAT an edit will hit (the fx-bar scope chip) and the drilled-in
 * banner copy from state-shaped inputs. No DOM, no state imports —
 * node-testable, like cfr.ts. The returned strings are UI contracts: e2e
 * specs locate elements by them, so change them test-first.
 */

import type { SPElement } from '../core/types';
import { cfrBlastRadius } from './cfr';
import { cfrFieldName } from '../core/refs';

export type Scope =
  | { kind: 'view' }
  | { kind: 'grid' }
  | { kind: 'host'; field: string; surface: 'view' | 'grid' }
  | { kind: 'style'; field: string; places: number };

/** What the next edit hits: the view (or, on the grid floor, the grid — a
 *  grid is the list itself, not a view, so the chip must never say "view"
 *  there), the selected host cell, or (when drilled — or when a column-kind
 *  formatter IS the main document, e.g. an imported/example column formatter
 *  opened standalone) the shared style — with its blast count, clamped to ≥1. */
export function scopeFor(
  activeDocKey: string,
  docKind: string,
  currentFieldName: string,
  selected: SPElement | null,
  mainRoot: SPElement | undefined,
  columnRefs: Record<string, SPElement>,
): Scope {
  if (activeDocKey !== 'main') {
    const blast = cfrBlastRadius(activeDocKey, mainRoot, columnRefs);
    return { kind: 'style', field: activeDocKey, places: Math.max(blast.count, 1) };
  }
  if (docKind === 'column') {
    const blast = cfrBlastRadius(currentFieldName, mainRoot, columnRefs);
    return { kind: 'style', field: currentFieldName, places: Math.max(blast.count, 1) };
  }
  const surface = docKind === 'grid' ? 'grid' as const : 'view' as const;
  if (selected?.columnFormatterReference) {
    return { kind: 'host', field: cfrFieldName(selected.columnFormatterReference), surface };
  }
  return { kind: surface };
}

export function scopeChipLabel(s: Scope, display: (name: string) => string): string {
  switch (s.kind) {
    case 'view': return 'This view only';
    case 'grid': return 'This grid only';
    case 'host': return `Host cell · this ${s.surface} only`;
    case 'style': return `${display(s.field)} style · ${s.places} ${s.places === 1 ? 'place' : 'places'}`;
  }
}

/** Banner copy while drilled in. `field` is already display-resolved. */
export function styleBannerLabel(field: string, places: number): string {
  return places > 1
    ? `Editing the ${field} style — used in ${places} places · changes apply everywhere`
    : `Editing the ${field} style — changes apply everywhere it's used`;
}
