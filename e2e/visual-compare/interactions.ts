/**
 * Interactive-surface coverage. A formatter isn't just paint: hover cards
 * (customCardProps), action buttons (customRowAction) and inline editors
 * (inlineEditField) only exist when you hover and click — so the harness
 * MUST hover and click (owner requirement, 2026-07-04). This module finds
 * every interactive feature in a workspace so the spec can drive each one
 * on both surfaces and capture the effect.
 */
import type { SPElement } from '../../src/core/types';
import type { WorkspaceFixture } from './workspace';

export type InteractionKind = 'hoverCard' | 'rowAction' | 'inlineEdit';

export interface InteractionPoint {
  kind: InteractionKind;
  /** Field internal name of the column formatter carrying it, or '' for the view formatter. */
  field: string;
  /** For hover cards: how SP opens it (customCardProps.openOnEvent; SP defaults to hover). */
  openOn: 'hover' | 'click';
  /** For rowAction: the declared action name (defaultClick, executeCustomAction ids, …). */
  action?: string;
}

function scanTree(root: SPElement, field: string, out: InteractionPoint[]): void {
  const walk = (el: SPElement): void => {
    if (el.customCardProps) {
      const openOn = (el.customCardProps as { openOnEvent?: string }).openOnEvent === 'click' ? 'click' : 'hover';
      out.push({ kind: 'hoverCard', field, openOn });
    }
    const bag = el as unknown as Record<string, unknown>;
    const custom = bag.customRowAction as { action?: string } | undefined;
    if (custom) out.push({ kind: 'rowAction', field, openOn: 'click', action: custom.action });
    if (bag.inlineEditField) out.push({ kind: 'inlineEdit', field, openOn: 'click' });
    for (const child of el.children ?? []) walk(child);
    if (el.customCardProps?.formatter) walk(el.customCardProps.formatter as SPElement);
  };
  walk(root);
}

/** Every interactive feature in the workspace, column formatters first. */
export function findInteractions(ws: WorkspaceFixture): InteractionPoint[] {
  const out: InteractionPoint[] = [];
  for (const [field, root] of Object.entries(ws.columnRefs)) scanTree(root, field, out);
  scanTree(ws.doc.root, '', out);
  // one drive per (kind, field, openOn) — the same card on 3 rows is one feature
  const seen = new Set<string>();
  return out.filter((p) => {
    const key = `${p.kind}:${p.field}:${p.openOn}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
