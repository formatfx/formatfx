/**
 * panelApply.ts — the footer's Apply + History (spec §5, §6, §7).
 * Apply is lint-gated and runs applyFlow over the open target; a stale
 * result shows both versions in the drawer with Overwrite / Reload theirs.
 * The History drawer lists the target's journal rows newest first: Applied
 * rows roll back (an apply of their Before), Pending rows are "unconfirmed"
 * with a Check action, Failed rows are informational.
 */
import type { PanelCore } from './panel';
import type { TargetRef, JournalRow } from './journal';
import { applyTarget, checkPending, type ApplyDeps, type ApplyResult } from './applyFlow';
import { formatterHash } from './hash';
import { state } from '../../../src/editor/state';
import { exportJson } from '../../../src/core/serializer';
import { lintDocument } from '../../../src/core/linter';

/** Spec §7: writing a document FormatFX invented over one it could not read is data loss. */
const PARSE_BLOCKED_MESSAGE = "Not applying: this target's live formatter could not be parsed, so writing"
  + ' would replace it with a document FormatFX invented. Roll back from History, or paste the corrected JSON and'
  + ' Apply again.';

export interface ApplyIo { read(t: TargetRef): Promise<string | null>; write(t: TargetRef, f: string | null): Promise<void> }
export interface ApplyUi { refresh(): void }

const APPLY_CSS = `
.ffx-stale pre, .ffx-hist pre { max-height: 120px; overflow: auto; background: var(--wb-surface); padding: 6px; margin: 4px 0; font-size: 11px; }
.ffx-stale-cols { display: flex; gap: 12px; } .ffx-stale-cols > div { flex: 1; min-width: 0; }
.ffx-hist-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; border-bottom: 1px solid var(--wb-border); }
.ffx-hist-row .ffx-when { color: var(--wb-text-2); }
.ffx-hist-row button { font: inherit; padding: 2px 8px; }
`;

/** The buffer as it would be written — the same text Apply sends. */
const bufferText = (): string => exportJson(state.doc, { sanitizeWhitespace: true, keepMeta: true });

export function mountApply(core: PanelCore, io: ApplyIo): ApplyUi {
  const { shell } = core;
  const style = document.createElement('style');
  style.textContent = APPLY_CSS;
  shell.app.prepend(style);
  shell.footer.insertAdjacentHTML('beforeend',
    '<button class="ffx-history" title="Drafts and every apply for this target, with one-click rollback">History</button>'
    + '<button class="ffx-apply" title="Write this formatter to the list — one MERGE, journaled first">Apply</button>');
  const applyBtn = shell.footer.querySelector<HTMLButtonElement>('.ffx-apply')!;
  const histBtn = shell.footer.querySelector<HTMLButtonElement>('.ffx-history')!;
  let drawerMode: 'closed' | 'history' | 'stale' = 'closed';

  const depsFor = (t: TargetRef): ApplyDeps => ({
    read: () => io.read(t), write: (f) => io.write(t, f), journal: core.journal(),
  });

  const lintErrors = (): number => lintDocument(
    state.doc, state.fields.map((f) => f.name), Object.fromEntries(state.fields.map((f) => [f.name, f.type])),
  ).filter((i) => i.severity === 'error').length;

  const finish = async (t: TargetRef, after: string | null, result: ApplyResult, yoursText: string | null): Promise<void> => {
    if (result.status === 'applied') {
      core.setBasedOn(formatterHash(after));
      core.setLiveFormatter(t, after);
      state.markSavepoint();
      // a rollback's After is an earlier row's Before, not this buffer — the
      // editor must follow what actually landed on the list
      if (after !== bufferText()) core.loadLive(after);
      state.markSavepoint();
      await core.journal().deleteDraft(t);
      core.toast(after === null ? 'Applied — formatter cleared' : 'Applied');
      await core.renderTree();
      if (drawerMode === 'history') await showHistory();
      else closeDrawer();
      return;
    }
    if (result.status === 'stale') { showStale(t, result.live, yoursText); return; }
    core.toast(`Not applied — ${result.message}`);
  };

  const run = async (after: string | null, force = false): Promise<void> => {
    const t = core.current();
    if (!t) return;
    applyBtn.disabled = true;
    try {
      const result = await applyTarget(depsFor(t), { listId: core.listId, target: t, after, basedOn: core.basedOn(), force });
      await finish(t, after, result, after);
    } finally {
      applyBtn.disabled = false;
    }
  };

  applyBtn.addEventListener('click', () => {
    // before the lint gate: a buffer FormatFX invented (the live formatter did
    // not parse) must never be written over the real one
    if (core.parseBlocked()) { core.toast(PARSE_BLOCKED_MESSAGE); return; }
    const n = lintErrors();
    if (n) { core.toast(`Not applying with ${n} lint error${n === 1 ? '' : 's'} — SharePoint would accept the write and render blank. Fix the red items first.`); return; }
    core.guard(run(bufferText()));
  });

  // ── drawer ───────────────────────────────────────────────────────────────
  const closeDrawer = (): void => { drawerMode = 'closed'; shell.drawer.hidden = true; shell.drawer.replaceChildren(); };

  const showStale = (t: TargetRef, live: string | null, yours: string | null): void => {
    drawerMode = 'stale';
    shell.drawer.hidden = false;
    shell.drawer.innerHTML = `<div class="ffx-stale">
      <p><strong>Someone changed this since you started.</strong> Choose: overwrite with yours, or reload theirs (yours stays one undo away).</p>
      <div class="ffx-stale-cols">
        <div><div>Theirs (on the list now)</div><pre class="ffx-stale-theirs"></pre></div>
        <div><div>Yours</div><pre class="ffx-stale-yours"></pre></div>
      </div>
      <button class="ffx-overwrite">Overwrite with mine</button>
      <button class="ffx-reload">Reload theirs</button>
      <button class="ffx-cancel">Cancel</button>
    </div>`;
    shell.drawer.querySelector('.ffx-stale-theirs')!.textContent = live ?? '(no formatter)';
    shell.drawer.querySelector('.ffx-stale-yours')!.textContent = yours ?? '(no formatter)';
    shell.drawer.querySelector('.ffx-overwrite')!.addEventListener('click', () => { core.guard(run(yours, true)); });
    shell.drawer.querySelector('.ffx-reload')!.addEventListener('click', () => { core.setLiveFormatter(t, live); core.loadLive(live); closeDrawer(); });
    shell.drawer.querySelector('.ffx-cancel')!.addEventListener('click', closeDrawer);
  };

  const showHistory = async (): Promise<void> => {
    const t = core.current();
    if (!t) return;
    drawerMode = 'history';
    shell.drawer.hidden = false;
    const rows = await core.journal().history(t);
    shell.drawer.replaceChildren();
    const head = document.createElement('div');
    head.className = 'ffx-hist';
    head.textContent = rows.length ? (core.journal().durable ? 'History for this target (shared, on the site)' : 'History for this target (this browser tab only)') : 'No applies recorded for this target yet.';
    shell.drawer.appendChild(head);
    for (const r of rows) shell.drawer.appendChild(historyRow(t, r));
  };

  const historyRow = (t: TargetRef, r: JournalRow): HTMLElement => {
    const el = document.createElement('div');
    el.className = 'ffx-hist-row';
    el.dataset.kind = r.kind;
    const when = r.created ? new Date(r.created).toLocaleString() : '';
    const size = (s: string | null): string => (s === null ? 'no formatter' : `${s.length} chars`);
    el.innerHTML = '<span class="ffx-when"></span><span class="ffx-kind"></span><span class="ffx-who"></span><span class="ffx-size"></span>';
    el.querySelector('.ffx-when')!.textContent = when;
    el.querySelector('.ffx-kind')!.textContent = r.kind === 'Pending' ? 'unconfirmed' : r.kind;
    el.querySelector('.ffx-who')!.textContent = r.author ?? '';
    el.querySelector('.ffx-size')!.textContent = `${size(r.before)} → ${size(r.after)}`;
    if (r.kind === 'Applied') {
      const b = document.createElement('button');
      b.className = 'ffx-rollback';
      b.textContent = 'Roll back to before this';
      b.title = 'Apply this row\'s Before — journaled like any other apply';
      b.addEventListener('click', () => { core.guard(run(r.before)); });
      el.appendChild(b);
    } else if (r.kind === 'Pending') {
      const b = document.createElement('button');
      b.className = 'ffx-check';
      b.textContent = 'Check';
      b.title = 'Re-read the target: Applied if it holds this row\'s After, otherwise Failed';
      b.addEventListener('click', () => { core.guard(checkPending(depsFor(t), r).then(showHistory)); });
      el.appendChild(b);
    }
    return el;
  };

  histBtn.addEventListener('click', () => { if (drawerMode === 'history') closeDrawer(); else core.guard(showHistory()); });

  return {
    refresh() { if (drawerMode === 'history') core.guard(showHistory()); else closeDrawer(); },
  };
}
