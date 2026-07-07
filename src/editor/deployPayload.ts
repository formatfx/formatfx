/**
 * editor/deployPayload.ts — build "the formatter currently being edited" into
 * a one-target apply payload, lint-gated. Extracted from jsonPanel so the
 * three callers that now need it share one source of truth: the Advanced
 * deploy buttons, the top-level "Send to extension" button, and the channel
 * responder that answers the extension's "Grab this formatter" request.
 *
 * Pure of DOM: it reads `state` and optional view/list titles, never the
 * panel's inputs — so it works the same whether the JSON pane is open or not.
 */

import { state } from './state';
import { exportJson } from '../core/serializer';
import { lintDocument } from '../core/linter';
import { buildApplyPayload, type ApplyPayload } from '../bridge/applyPayload';

/** Where the current document deploys: the canvas doc is always a surface
 *  (grid/row/tile) now, and it ships as a view's row/tile formatting.
 *  Per-column JSON compiles on demand from columnLooks (toColumnFormatter)
 *  in the column's header menu — never through the deploy payload. */
export function deployTargetOf(viewTitle?: string): { target: 'view'; name: string } {
  return { target: 'view', name: (viewTitle || '').trim() || 'All Items' };
}

/** Count of blocking (error-severity) lint issues on the current document. */
export function lintErrorCount(): number {
  return lintDocument(
    state.doc,
    state.fields.map((f) => f.name),
    Object.fromEntries(state.fields.map((f) => [f.name, f.type])),
  ).filter((i) => i.severity === 'error').length;
}

export interface BuildPayloadOpts {
  viewTitle?: string;
  listTitle?: string;
  sanitize?: boolean;
  keepMeta?: boolean;
}

/**
 * The current formatter as an apply payload, or a teaching error when the
 * document has lint errors (SP would accept the write and render blank).
 * REST stores the raw string, so never csom-escape here.
 */
export function buildCurrentApplyPayload(opts: BuildPayloadOpts = {}): { payload?: ApplyPayload; error?: string } {
  const errors = lintErrorCount();
  if (errors) {
    return { error: `Not deploying with ${errors} lint error${errors === 1 ? '' : 's'} — SP would accept the write and render blank. Fix the red items in the JSON pane first.` };
  }
  const t = deployTargetOf(opts.viewTitle);
  const formatterJson = exportJson(state.doc, {
    sanitizeWhitespace: opts.sanitize ?? true,
    keepMeta: opts.keepMeta ?? true,
  });
  const payload = buildApplyPayload(
    [{ target: t.target, name: t.name, formatterJson }],
    opts.listTitle && opts.listTitle.trim() ? { listTitle: opts.listTitle.trim() } : {},
  );
  return { payload };
}
