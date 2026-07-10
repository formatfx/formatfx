/**
 * context.ts — the popup dashboard's view-model, computed from a captured
 * List Snapshot. Pure (no chrome APIs, no DOM) so every rendering decision
 * is unit-tested from the root suite; popup.ts just paints the result.
 *
 * The dashboard answers, at a glance: what list am I on, which of its
 * columns and views already carry formatting, and what can I grab?
 */
import type { ListSnapshot } from '../../src/bridge/spClient';

export interface DashboardColumn {
  internalName: string;
  displayName: string;
  /** Size of the live CustomFormatter, in characters. */
  formatterChars: number;
}

export interface DashboardView {
  title: string;
  id?: string;
  formatterChars: number;
  isCurrent: boolean;
}

export interface Dashboard {
  /** Human label for the list ("Projects", or the site URL as a fallback). */
  listLabel: string;
  /** Title of the view the tab is showing, when known. */
  currentViewTitle?: string;
  totalColumns: number;
  totalViews: number;
  /** Columns carrying a live formatter, in snapshot order. */
  formattedColumns: DashboardColumn[];
  /** Views carrying a live formatter, current view first. */
  formattedViews: DashboardView[];
}

export function dashboardFrom(snap: ListSnapshot): Dashboard {
  const currentView = snap.views.find((v) => v.id && v.id === snap.currentViewId);
  const formattedColumns = snap.fields
    .filter((f) => !!f.customFormatter)
    .map((f) => ({
      internalName: f.internalName,
      displayName: f.displayName || f.internalName,
      formatterChars: f.customFormatter!.length,
    }));
  const formattedViews = snap.views
    .filter((v) => !!v.customFormatter)
    .map((v) => ({
      title: v.title,
      id: v.id,
      formatterChars: v.customFormatter!.length,
      isCurrent: !!v.id && v.id === snap.currentViewId,
    }))
    .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent));
  return {
    listLabel: snap.list || snap.siteUrl,
    currentViewTitle: currentView?.title,
    totalColumns: snap.fields.length,
    totalViews: snap.views.length,
    formattedColumns,
    formattedViews,
  };
}

/**
 * The field set a per-view grab should carry: the view's own columns,
 * narrowed to fields that actually exist in the snapshot (view field lists
 * can reference hidden/system columns the capture filtered out). Falls back
 * to every captured field when the intersection is empty — a view grab must
 * never arrive column-less.
 */
export function viewGrabFields(snap: ListSnapshot, viewId: string | undefined): string[] {
  const view = snap.views.find((v) => v.id && v.id === viewId);
  const have = new Set(snap.fields.map((f) => f.internalName));
  const wanted = (view?.viewFields ?? []).filter((n) => have.has(n));
  return wanted.length ? wanted : snap.fields.map((f) => f.internalName);
}
