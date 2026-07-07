// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

import type { DocumentKind } from '../core/types';

/**
 * Where the formatter currently being edited will be saved — derived from its
 * kind, not chosen up front. `columnField` is the field name (e.g. "Status")
 * when a column formatter's target is known, else null.
 */
export function formatterDestination(
  kind: DocumentKind,
  columnField: string | null,
): { label: string; title: string } {
  if (kind === 'column') {
    return {
      label: columnField ? `Saves to the ${columnField} column` : 'Saves to a column',
      title: "This is a column formatter — it paints every row of one column and saves to that column's CustomFormatter.",
    };
  }
  const viewTitle =
    "This is a view formatter — it lays out the whole row and saves to the view's CustomFormatter, replacing any formatting the view already has.";
  if (kind === 'tile') {
    return { label: 'Saves to the view (tile layout)', title: viewTitle };
  }
  // 'row' and 'grid' both export as a view formatter
  return { label: 'Saves to the view', title: viewTitle };
}
