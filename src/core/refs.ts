// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * core/refs.ts — reference-string helpers shared by the engine and the editor.
 *
 * Lives in core (UI-free) so renderer.ts can use it without an editor→core
 * import inversion; the editor modules import it from here too.
 */

/** Field name a reference targets: '[$Status]' / '$Status' / 'Status' → 'Status'. */
export function cfrFieldName(refText: string): string {
  return refText.replace(/^\[\$?/, '').replace(/\]$/, '').replace(/^\$/, '');
}
