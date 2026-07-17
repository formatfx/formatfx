// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * core/serializer.ts — Bidirectional JSON ⇄ editor-document conversion.
 *
 * Import accepts any of the three formatter shapes (column element root,
 * view rowFormatter wrapper, tile formatter wrapper) and normalizes into a
 * FormatterDocument. Export rebuilds SP-compliant JSON, optionally applying
 * the Zero-Whitespace sanitization and CSOM-safe character escaping.
 */

import type { SPElement, FormatterDocument, DocumentKind } from './types';
import { SCHEMA_URLS } from './types';
import { stripExpressionWhitespace } from './linter';

export interface ExportOptions {
  /** Strip spaces from =expressions outside quoted literals. Default true. */
  sanitizeWhitespace?: boolean;
  /** Escape & and < as & / < in the JSON text (safe for CSOM deploys). */
  csomSafe?: boolean;
  /** Keep _elmName/_factory/_component provenance metadata. Default TRUE
   *  (SharePoint ignores them) — pass false for schema-pristine output. */
  keepMeta?: boolean;
  indent?: number;
}

// ─── Import ──────────────────────────────────────────────────────────────────

export function importJson(text: string): FormatterDocument {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON: ${(e as Error).message}`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Formatter JSON must be an object.');
  }

  // View (row) formatter wrapper
  if ('rowFormatter' in parsed) {
    // Keep any wrapper siblings the editor can't represent (footerFormatter,
    // groupProps, commandBarProps, additionalRowClass, hideListHeader, …) so a
    // tweak-and-re-export of the rowFormatter doesn't silently discard them.
    const { rowFormatter, hideSelection, hideColumnHeader, $schema, ...extras } = parsed;
    void $schema; // export emits its own $schema
    return {
      kind: 'row',
      root: rowFormatter as SPElement,
      hideSelection: hideSelection as boolean | undefined,
      hideColumnHeader: hideColumnHeader as boolean | undefined,
      ...(Object.keys(extras).length ? { viewExtras: extras } : {}),
    };
  }
  // Modern tile syntax: everything nested under tileProps (what the current
  // view-formatting panel and community samples emit — the legacy bare
  // {formatter, height, width} shape below remains accepted)
  if ('tileProps' in parsed && typeof parsed.tileProps === 'object' && parsed.tileProps !== null
    && !('elmType' in parsed)) {
    const tp = parsed.tileProps as Record<string, unknown>;
    return {
      kind: 'tile',
      root: tp.formatter as SPElement,
      tileWidth: tp.width as number | undefined,
      tileHeight: tp.height as number | undefined,
      hideSelection: (tp.hideSelection ?? parsed.hideSelection) as boolean | undefined,
      fillHorizontally: tp.fillHorizontally as boolean | undefined,
    };
  }
  // Tile formatter wrapper
  if ('formatter' in parsed && !('elmType' in parsed)) {
    return {
      kind: 'tile',
      root: parsed.formatter as SPElement,
      tileWidth: parsed.width as number | undefined,
      tileHeight: parsed.height as number | undefined,
      hideSelection: parsed.hideSelection as boolean | undefined,
      fillHorizontally: parsed.fillHorizontally as boolean | undefined,
    };
  }
  // Bare element root → column formatter
  if ('elmType' in parsed) {
    return { kind: 'column', root: parsed as unknown as SPElement };
  }
  if ('sections' in parsed || 'fieldsettings' in parsed) {
    throw new Error('This is a form layout (header/body/footer sections) JSON — the sandbox edits column, view and tile formatters, not form configurations.');
  }
  if ('footerFormatter' in parsed || 'groupProps' in parsed) {
    throw new Error('This view formatter only contains footer/group formatting (no rowFormatter) — footer and group editing are not supported yet.');
  }
  throw new Error('Unrecognized formatter shape — expected an element root (elmType), a rowFormatter wrapper, or a tile formatter wrapper.');
}

// ─── Export ──────────────────────────────────────────────────────────────────

function cloneTree(el: SPElement, opts: ExportOptions): SPElement {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(el)) {
    if (opts.keepMeta === false && (key === '_elmName' || key === '_factory' || key === '_debug' || key === '_component' || key === '_embed')) continue;
    if (key === 'children' && Array.isArray(value)) {
      out.children = value.map((c) => cloneTree(c as SPElement, opts));
    } else if (key === 'customCardProps' && value && typeof value === 'object') {
      const card = { ...(value as Record<string, unknown>) };
      if (card.formatter) card.formatter = cloneTree(card.formatter as SPElement, opts);
      out.customCardProps = card;
    } else if ((key === 'style' || key === 'attributes') && value && typeof value === 'object') {
      const obj: Record<string, string> = {};
      for (const [k, v] of Object.entries(value as Record<string, string>)) {
        obj[k] = opts.sanitizeWhitespace !== false && typeof v === 'string' ? stripExpressionWhitespace(v) : v;
      }
      out[key] = obj;
    } else if (typeof value === 'string' && opts.sanitizeWhitespace !== false) {
      out[key] = stripExpressionWhitespace(value);
    } else {
      out[key] = value;
    }
  }
  return out as unknown as SPElement;
}

/** Assemble the export payload — the exact object tree JSON.stringify renders —
 *  plus the cloned root element inside it. Exposed so core/jsonMap.ts can walk
 *  the same payload and map text offsets back to element paths (#218); the
 *  clone means the returned objects are never the live document's. */
export function exportPayload(doc: FormatterDocument, opts: ExportOptions = {}): { payload: Record<string, unknown>; root: SPElement } {
  const root = cloneTree(doc.root, opts);
  let payload: Record<string, unknown>;
  switch (doc.kind) {
    case 'row':
    case 'grid': // the grid is editor presentation; the wrapper is a view formatter
      payload = {
        $schema: SCHEMA_URLS.row,
        ...(doc.hideSelection !== undefined ? { hideSelection: doc.hideSelection } : {}),
        ...(doc.hideColumnHeader !== undefined ? { hideColumnHeader: doc.hideColumnHeader } : {}),
        ...(doc.viewExtras ?? {}), // verbatim passthrough of unmodeled wrapper keys
        rowFormatter: root,
      };
      break;
    case 'tile':
      payload = {
        $schema: SCHEMA_URLS.tile,
        height: doc.tileHeight ?? 220,
        width: doc.tileWidth ?? 254,
        ...(doc.hideSelection !== undefined ? { hideSelection: doc.hideSelection } : {}),
        ...(doc.fillHorizontally !== undefined ? { fillHorizontally: doc.fillHorizontally } : {}),
        formatter: root,
      };
      break;
    default:
      payload = { $schema: SCHEMA_URLS.column, ...root };
  }
  return { payload, root };
}

export function exportJson(doc: FormatterDocument, opts: ExportOptions = {}): string {
  const { payload } = exportPayload(doc, opts);
  let text = JSON.stringify(payload, null, opts.indent ?? 2);
  if (opts.csomSafe) {
    text = text.replace(/&/g, '\\u0026').replace(/</g, '\\u003c');
  }
  return text;
}

/** Does any element in the tree carry a friendly _elmName? (Drives the
 *  "applying name-less JSON over a named design" soft confirms.) */
export function treeHasNames(el: SPElement): boolean {
  return !!el._elmName
    || (el.children ?? []).some(treeHasNames)
    || (el.customCardProps?.formatter ? treeHasNames(el.customCardProps.formatter) : false);
}

export function detectKindLabel(kind: DocumentKind): string {
  return kind === 'column' ? 'Column formatter'
    : kind === 'row' ? 'View (row) formatter'
    : kind === 'grid' ? 'View (row) formatter — grid'
    : 'Tile / Gallery formatter';
}
