/**
 * tree.ts — the panel's navigation tree (spec §2.4, §5), pure. Root = the
 * list; branches = its views and its columns. Badge on anything formatted,
 * dot on anything with a draft, and the scope stated in words: column
 * formats apply to every view, view formats to this view only.
 */
import type { ListShape, ShapeView } from './targetIo';
import { targetKey, type TargetRef } from './journal';

export interface TreeNode {
  key: string; target: TargetRef; label: string; scope: string;
  formatted: boolean; draft: boolean; current: boolean; url?: string;
}
export interface TreeModel { views: TreeNode[]; columns: TreeNode[] }

export const COLUMN_SCOPE = 'applies to every view of this list';
export const VIEW_SCOPE = 'applies to this view only';

export function currentViewOf(shape: ListShape, viewId: string | null): ShapeView | undefined {
  return (viewId ? shape.views.find((v) => v.id === viewId) : undefined)
    ?? shape.views.find((v) => v.isDefault) ?? shape.views[0];
}

export function buildTree(shape: ListShape, draftKeys: Set<string>, currentViewId: string | null): TreeModel {
  const current = currentViewOf(shape, currentViewId);
  const views = shape.views.map((v): TreeNode => {
    const target: TargetRef = { kind: 'View', id: v.id };
    const key = targetKey(target);
    return { key, target, label: v.title, scope: VIEW_SCOPE, formatted: !!v.customFormatter, draft: draftKeys.has(key), current: v.id === current?.id, url: v.url };
  });
  const columns = shape.fields.map((f): TreeNode => {
    const target: TargetRef = { kind: 'Field', id: f.internalName };
    const key = targetKey(target);
    return { key, target, label: f.displayName || f.internalName, scope: COLUMN_SCOPE, formatted: !!f.customFormatter, draft: draftKeys.has(key), current: false };
  });
  return { views, columns };
}
