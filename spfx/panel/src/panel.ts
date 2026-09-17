/**
 * panel.ts — the Format panel's controller and the bundle's entry point.
 *
 * One target at a time (spec §2.3): the open column or view is the editor
 * state's only document (single-target mode, Task 9), edited through the
 * JSON IDE pane mounted in the shadow root. Switching targets stashes the
 * draft silently in the journal (§2.6); picking another view navigates the
 * page and the panel reopens on it from a per-tab record (§2.4). The host
 * feeds URL `viewid` changes in through setViewId (spike answer 1).
 */
import { APP_CSS } from './appCss.gen';
import { state } from '../../../src/editor/state';
import { mountJsonPanel } from '../../../src/editor/jsonPanel';
import { importJson, exportJson } from '../../../src/core/serializer';
import { importSchema, buildSampleRows, LIST_SNAPSHOT_VERSION } from '../../../src/core/schemaImport';
import type { FormatterDocument } from '../../../src/core/types';
import { createSpRest, type SpRest } from './rest';
import { openJournal, type JournalBackend } from './journalStore';
import { loadListShape, readFormatter, writeFormatter, type ListShape } from './targetIo';
import { buildTree, currentViewOf, type TreeNode, type TreeModel } from './tree';
import { targetKey, type TargetRef } from './journal';
import { formatterHash } from './hash';
import { mountShell, type Shell } from './panelShell';
import { readReopen, writeReopen, viewIdFromUrl, watchUrl, REOPEN_KEY } from './urlState';
import { mountApply } from './panelApply';
import { resolveTheme, readStoredTheme, writeStoredTheme, spThemeInverted } from './panelTheme';

export { viewIdFromUrl, watchUrl, readReopen, REOPEN_KEY };
export type { TargetRef };

export const PANEL_HOST_ID = 'ffx-format-panel';

export interface PanelContext {
  webUrl: string; listId: string; listTitle?: string; viewId: string | null;
  fetchImpl?: typeof fetch; storage?: Storage; navigate?: (url: string) => void; onClose?: () => void;
}
export interface PanelApi {
  ready: Promise<void>;
  setViewId(id: string | null): void;
  openTarget(t: TargetRef): Promise<void>;
  close(): Promise<void>;
}

/** What the controller shares with the Apply/History module (Task 12). */
export interface PanelCore {
  rest: SpRest; listId: string; shell: Shell; journal: () => JournalBackend;
  current: () => TargetRef | null; basedOn: () => string; setBasedOn: (h: string) => void;
  setLiveFormatter: (t: TargetRef, f: string | null) => void; loadLive: (f: string | null) => void;
  toast: (m: string) => void; renderTree: () => Promise<void>;
  /** Reload the page so the list re-renders with what was just written; the
   *  reopen record brings the panel back on the same target (spec §2.4). */
  reload: () => void;
  /** Run a fire-and-forget promise from a UI handler; failures toast. */
  guard: (p: Promise<unknown>) => void;
  /** True while the open target's LIVE formatter could not be parsed. */
  parseBlocked: () => boolean;
  /** The JSON pane: hand edits not yet parsed, and the parse itself (#321). */
  bufferDirty: () => boolean;
  commitBuffer: () => { ok: true } | { ok: false; error: string };
}

const PANEL_EXTRA_CSS = `
#wb-deploy-panel, #wb-json-deploy, #wb-json-compbar { display: none !important; }
/* the editor shell shrinks to what is left under the Problems list instead
   of forcing the slot to scroll (a scrolling slot nudged the caret line to
   the bottom edge on every keystroke — owner smoke, round 5) */
.wb-json-shell { min-height: 0; resize: none; }
/* the completion popup is a SIBLING of .ffx-app in the shadow root (acMenu
   mounts in the editor's root) — the app's z-index: 56 sat under the panel's
   1000000, so the menu opened invisibly (owner smoke 2026-09-17) */
.wb-fx-acmenu { z-index: 1000001; }
option.ffx-open { font-weight: 600; }
`;

/** localStorage on the tenant origin, or null where access itself throws. */
function safeLocalStorage(): Storage | null {
  try { return localStorage; } catch { return null; }
}

const emptyDoc = (kind: 'column' | 'row'): FormatterDocument => (kind === 'column'
  ? { kind: 'column', root: { elmType: 'div', txtContent: '@currentField' } }
  : { kind: 'row', root: { elmType: 'div' } });

/** Parse a stored formatter into a document of the target's kind. */
function docFor(t: TargetRef, text: string | null): { doc: FormatterDocument; error?: string } {
  const want = t.kind === 'Field' ? 'column' : 'row';
  if (!text) return { doc: emptyDoc(want) };
  try {
    const doc = importJson(text);
    if (t.kind === 'Field') return { doc: { kind: 'column', root: doc.root } };
    return { doc: doc.kind === 'tile' ? doc : { ...doc, kind: 'row' } };
  } catch (e) {
    return { doc: emptyDoc(want), error: `This formatter could not be parsed (${(e as Error).message}) — showing an empty ${want} document. Paste the JSON to fix it, or roll back from History.` };
  }
}

export function mountFormatPanel(shadow: ShadowRoot, ctx: PanelContext): PanelApi {
  const storage = ctx.storage ?? sessionStorage;
  const navigate = ctx.navigate ?? ((url: string) => location.assign(url));
  const rest = createSpRest(ctx.webUrl, ctx.fetchImpl);
  const listId = ctx.listId;
  let shape: ListShape = { fields: [], views: [] };
  let journal: JournalBackend | null = null;
  let viewId = ctx.viewId;
  let current: TargetRef | null = null;
  let basedOn = formatterHash(null);
  let openedFromDraft = false;
  let draftKeys = new Set<string>();
  /** Bumped by every openTarget; a call whose token is stale must touch nothing. */
  let gen = 0;
  /** The open target's live formatter could not be parsed — Apply must refuse. */
  let parseError: string | null = null;
  /** Set just before openTargetDocument so its own 'load' does not clear the flag. */
  let openingTarget = false;

  state.pauseAutosave(); // never touch the frozen key on the tenant origin
  const shell = mountShell(shadow, APP_CSS + PANEL_EXTRA_CSS, {
    onClose: () => { guard(close()); },
    onUndo: () => state.undo(),
    onRedo: () => state.redo(),
    onTheme: () => {
      const dark = !shadow.host.classList.contains('wb-dark');
      const local = safeLocalStorage();
      if (local) writeStoredTheme(local, dark ? 'dark' : 'light');
      applyDark(dark);
    },
  });
  // Issue #321: dark mode. The host class drives the app CSS; the editor
  // state's themeMode + 'theme' emit re-seed the JSON pane's syntax colors.
  const applyDark = (dark: boolean): void => {
    shell.setDark(dark);
    state.themeMode = dark ? 'dark' : 'light';
    state.emit('theme');
  };
  {
    const local = safeLocalStorage();
    const prefersDark = typeof matchMedia === 'function' && !!matchMedia('(prefers-color-scheme: dark)')?.matches;
    applyDark(resolveTheme({ stored: local ? readStoredTheme(local) : null, spInverted: spThemeInverted(window), prefersDark }) === 'dark');
  }
  let toastTimer = 0;
  const toast = (m: string): void => {
    shell.status.textContent = m;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { if (shell.status.textContent === m) shell.status.textContent = ''; }, 6000);
  };
  /**
   * Every async path a click starts ends here: a rejected promise must teach in
   * the status line, never become an unhandled rejection that leaves the panel
   * half-updated and silent. REST errors already carry the FormatFX prefix.
   */
  const guard = (p: Promise<unknown>): void => {
    p.catch((e: unknown) => {
      const m = e instanceof Error ? e.message : String(e);
      toast(m.startsWith('FormatFX') ? m : 'FormatFX: ' + m);
    });
  };
  const jsonApi = mountJsonPanel(shell.editor, toast);
  const refreshChrome = (): void => {
    shell.undoBtn.disabled = !state.canUndo;
    shell.redoBtn.disabled = !state.canRedo;
    jsonApi.refreshLint([]);
  };
  const unsub = state.subscribe((reason) => {
    // a 'load' that is NOT the target opening is an apply-to-canvas: the buffer
    // is now the person's own parsable JSON, so Apply is no longer blocked
    if (reason === 'load') {
      if (openingTarget) openingTarget = false;
      else parseError = null;
    }
    if (reason === 'document' || reason === 'load' || reason === 'kind') refreshChrome();
  });

  const labelOf = (t: TargetRef): string => {
    if (t.kind === 'Field') {
      const f = shape.fields.find((x) => x.internalName === t.id);
      return `${f?.displayName ?? t.id} — column · applies to every view of this list`;
    }
    const v = shape.views.find((x) => x.id === t.id);
    return `${v?.title ?? t.id} — view · applies to this view only`;
  };
  const setLiveFormatter = (t: TargetRef, f: string | null): void => {
    if (t.kind === 'Field') { const x = shape.fields.find((y) => y.internalName === t.id); if (x) x.customFormatter = f ?? undefined; }
    else { const x = shape.views.find((y) => y.id === t.id); if (x) x.customFormatter = f ?? undefined; }
  };

  // ── tree ─────────────────────────────────────────────────────────────────
  // Issue #321: two selects instead of a rail. Each option carries the same
  // state the rail's node did (data-key, ffx-* classes, a scope title) with
  // the badge/dot folded into its label; the select that owns the open
  // target shows it, the other its placeholder.
  let model: TreeModel = { views: [], columns: [] };
  const renderTree = async (): Promise<void> => {
    draftKeys = journal ? await journal.listDraftKeys() : new Set();
    model = buildTree(shape, draftKeys, viewId);
    const fill = (select: HTMLSelectElement, placeholder: string, nodes: TreeNode[]): void => {
      select.replaceChildren();
      const ph = document.createElement('option');
      ph.value = '';
      ph.textContent = placeholder;
      select.appendChild(ph);
      let open = '';
      for (const n of nodes) {
        const o = document.createElement('option');
        const isOpen = !!current && targetKey(current) === n.key;
        o.value = n.key;
        o.dataset.key = n.key;
        o.className = 'ffx-node' + (n.formatted ? ' ffx-formatted' : '') + (n.draft ? ' ffx-draft' : '') + (n.current ? ' ffx-current' : '') + (isOpen ? ' ffx-open' : '');
        o.title = `${n.label} — ${n.scope}`;
        o.textContent = n.label + (n.current ? ' · on screen' : '') + (n.formatted ? ' · formatted' : '') + (n.draft ? ' · draft' : '');
        select.appendChild(o);
        if (isOpen) open = n.key;
      }
      select.value = open;
    };
    fill(shell.viewSelect, '— pick a view —', model.views);
    fill(shell.columnSelect, '— pick a column —', model.columns);
  };
  const onPick = (select: HTMLSelectElement): void => {
    const n = [...model.views, ...model.columns].find((x) => x.key === select.value);
    if (n) guard(pick(n));
  };
  shell.viewSelect.addEventListener('change', () => onPick(shell.viewSelect));
  shell.columnSelect.addEventListener('change', () => onPick(shell.columnSelect));

  const pick = async (n: TreeNode): Promise<void> => {
    if (n.target.kind === 'View' && !n.current && n.url) {
      // §2.4: the list on screen must match the target — navigate, reopen there
      await stashDraft(draftSnapshot());
      writeReopen(storage, { listId, targetKey: n.key });
      navigate(n.url);
      return;
    }
    await openTarget(n.target);
  };

  // ── targets and drafts ───────────────────────────────────────────────────
  interface DraftSnapshot { target: TargetRef; after: string; basedOn: string }

  /** Everything a stash needs, read SYNCHRONOUSLY: by the time the write runs,
   *  another openTarget may already have moved `current`, `basedOn` and the
   *  editor buffer on — and the draft would land under the wrong target. */
  const draftSnapshot = (): DraftSnapshot | null => {
    if (!current || !journal) return null;
    if (!state.isDirtySinceSave && !openedFromDraft) return null;
    return { target: current, after: exportJson(state.doc, { sanitizeWhitespace: true, keepMeta: true }), basedOn };
  };

  const stashDraft = async (snap: DraftSnapshot | null): Promise<void> => {
    if (!snap || !journal) return;
    await journal.saveDraft(snap.target, snap.after, snap.basedOn);
  };

  const openTarget = async (t: TargetRef): Promise<void> => {
    const snap = draftSnapshot();
    const mine = ++gen; // two fast clicks: only the LAST one may paint
    await stashDraft(snap);
    if (mine !== gen) return;
    writeReopen(storage, { listId, targetKey: targetKey(t) });
    const live = await readFormatter(rest, listId, t);
    if (mine !== gen) return;
    const draft = journal ? await journal.loadDraft(t) : null;
    if (mine !== gen) return;
    current = t;
    setLiveFormatter(t, live);
    const text = draft ? draft.after : live;
    basedOn = draft ? draft.basedOn : formatterHash(live);
    openedFromDraft = !!draft;
    const { doc, error } = docFor(t, text);
    parseError = error ?? null;
    openingTarget = true;
    state.openTargetDocument(doc, labelOf(t));
    shell.title.textContent = labelOf(t);
    shell.notice(error
      ?? (draft && draft.basedOn !== formatterHash(live)
        ? 'Your draft was restored, but this formatter has changed since you started it — Apply will show both versions.'
        : (journal && !journal.durable ? journal.reason ?? null : null)));
    refreshChrome();
    apply.refresh();
    await renderTree();
  };

  const loadLive = (f: string | null): void => {
    if (!current) return;
    const { doc, error } = docFor(current, f);
    state.loadDocument(doc);
    state.markSavepoint();
    basedOn = formatterHash(f);
    openedFromDraft = false;
    // normally this clears the block; reloading a formatter that is ITSELF
    // unparseable (rollback, "reload theirs") must keep it
    parseError = error ?? null;
    shell.notice(error ?? null);
  };

  const core: PanelCore = {
    rest, listId, shell, journal: () => journal!, current: () => current, basedOn: () => basedOn,
    setBasedOn: (h) => { basedOn = h; openedFromDraft = false; }, setLiveFormatter, loadLive, toast, renderTree,
    reload: () => navigate(location.href),
    guard, parseBlocked: () => parseError !== null,
    bufferDirty: () => jsonApi.isDirty(), commitBuffer: () => jsonApi.commitBuffer(),
  };
  const apply = mountApply(core, { read: (t) => readFormatter(rest, listId, t), write: (t, f) => writeFormatter(rest, listId, t, f) });

  // ── boot ─────────────────────────────────────────────────────────────────
  const boot = async (): Promise<void> => {
    shell.title.textContent = ctx.listTitle ? `FormatFX — ${ctx.listTitle}` : 'FormatFX';
    shape = await loadListShape(rest, listId);
    const schema = importSchema(JSON.stringify({
      formatfx: 'list-snapshot', version: LIST_SNAPSHOT_VERSION, capturedAt: new Date().toISOString(),
      siteUrl: ctx.webUrl, listId, fields: shape.fields, views: [], rows: [],
    }));
    state.fields = schema.fields;
    state.rows = buildSampleRows(schema.fields, 3);
    journal = await openJournal(rest, listId, storage);
    if (!journal.durable) shell.notice(journal.reason ?? null);
    const remembered = readReopen(storage, listId)?.targetKey;
    const tree = buildTree(shape, new Set(), viewId);
    const rememberedNode = remembered ? [...tree.views, ...tree.columns].find((n) => n.key === remembered) : undefined;
    const first: TargetRef = rememberedNode?.target ?? { kind: 'View', id: currentViewOf(shape, viewId)?.id ?? '' };
    if (first.id) await openTarget(first);
    else await renderTree();
  };
  const ready = boot().catch((e: unknown) => { shell.notice(`FormatFX could not load this list: ${e instanceof Error ? e.message : String(e)}`); });

  const close = async (): Promise<void> => {
    // a failed stash must never strand the panel: teardown always completes
    try {
      await stashDraft(draftSnapshot());
    } catch (e) {
      toast(`FormatFX: your draft could not be saved (${e instanceof Error ? e.message : String(e)}).`);
    }
    writeReopen(storage, null);
    unsub();
    // the JSON pane's own teardown (the repo's `_unsub` mount convention):
    // its state subscription and IDE observers must not outlive the host
    (shell.editor as unknown as { _unsub?: () => void })._unsub?.();
    shell.destroy();
    // autosave stays paused: nothing in the SPFx bundle may ever write the web
    // app's frozen localStorage key from the tenant origin
    ctx.onClose?.();
  };

  return {
    ready,
    setViewId(id) {
      viewId = id;
      const now = currentViewOf(shape, id)?.id ?? null;
      if (current?.kind === 'View' && now && current.id !== now) guard(openTarget({ kind: 'View', id: now }));
      else guard(renderTree());
    },
    openTarget,
    close,
  };
}
