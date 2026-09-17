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
import { buildTree, currentViewOf, type TreeNode } from './tree';
import { targetKey, type TargetRef } from './journal';
import { formatterHash } from './hash';
import { mountShell, type Shell } from './panelShell';
import { readReopen, writeReopen, viewIdFromUrl, watchUrl, REOPEN_KEY } from './urlState';
import { mountApply } from './panelApply';

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
}

const PANEL_EXTRA_CSS = `
#wb-deploy-panel, #wb-json-deploy, #wb-json-compbar { display: none !important; }
.ffx-node { display: flex; align-items: center; gap: 6px; width: 100%; text-align: left; padding: 4px 10px; border: 0; background: none; color: inherit; font: inherit; cursor: pointer; }
.ffx-node:hover, .ffx-node.ffx-open { background: var(--wb-surface); }
.ffx-node.ffx-open { font-weight: 600; }
.ffx-group { padding: 8px 10px 2px; color: var(--wb-text-2); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
.ffx-badge { margin-left: auto; font-size: 10px; padding: 0 5px; border-radius: 8px; background: var(--wb-accent); color: var(--wb-accent-text); }
.ffx-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--wb-accent); flex: none; }
.ffx-current .ffx-label::after { content: ' · on screen'; color: var(--wb-text-2); font-weight: 400; }
`;

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

  state.pauseAutosave(); // never touch the frozen key on the tenant origin
  const shell = mountShell(shadow, APP_CSS + PANEL_EXTRA_CSS, {
    onClose: () => { void close(); },
    onUndo: () => state.undo(),
    onRedo: () => state.redo(),
  });
  let toastTimer = 0;
  const toast = (m: string): void => {
    shell.status.textContent = m;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { if (shell.status.textContent === m) shell.status.textContent = ''; }, 6000);
  };
  const jsonApi = mountJsonPanel(shell.editor, toast);
  const refreshChrome = (): void => {
    shell.undoBtn.disabled = !state.canUndo;
    shell.redoBtn.disabled = !state.canRedo;
    jsonApi.refreshLint([]);
  };
  const unsub = state.subscribe((reason) => { if (reason === 'document' || reason === 'load' || reason === 'kind') refreshChrome(); });

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
  const renderTree = async (): Promise<void> => {
    draftKeys = journal ? await journal.listDraftKeys() : new Set();
    const model = buildTree(shape, draftKeys, viewId);
    shell.tree.replaceChildren();
    const group = (title: string, nodes: TreeNode[]): void => {
      const g = document.createElement('div');
      g.className = 'ffx-group';
      g.textContent = title;
      shell.tree.appendChild(g);
      for (const n of nodes) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ffx-node' + (n.formatted ? ' ffx-formatted' : '') + (n.draft ? ' ffx-draft' : '') + (n.current ? ' ffx-current' : '') + (current && targetKey(current) === n.key ? ' ffx-open' : '');
        b.dataset.key = n.key;
        b.title = `${n.label} — ${n.scope}`;
        b.innerHTML = `<span class="ffx-label"></span>${n.draft ? '<span class="ffx-dot" title="you have a draft"></span>' : ''}${n.formatted ? '<span class="ffx-badge">formatted</span>' : ''}`;
        b.querySelector('.ffx-label')!.textContent = n.label;
        b.addEventListener('click', () => { void pick(n); });
        shell.tree.appendChild(b);
      }
    };
    group('Views', model.views);
    group('Columns', model.columns);
  };

  const pick = async (n: TreeNode): Promise<void> => {
    if (n.target.kind === 'View' && !n.current && n.url) {
      // §2.4: the list on screen must match the target — navigate, reopen there
      await stashDraft();
      writeReopen(storage, { listId, targetKey: n.key });
      navigate(n.url);
      return;
    }
    await openTarget(n.target);
  };

  // ── targets and drafts ───────────────────────────────────────────────────
  const stashDraft = async (): Promise<void> => {
    if (!current || !journal) return;
    if (!state.isDirtySinceSave && !openedFromDraft) return;
    const after = exportJson(state.doc, { sanitizeWhitespace: true, keepMeta: true });
    await journal.saveDraft(current, after, basedOn);
  };

  const openTarget = async (t: TargetRef): Promise<void> => {
    await stashDraft();
    current = t;
    writeReopen(storage, { listId, targetKey: targetKey(t) });
    const live = await readFormatter(rest, listId, t);
    setLiveFormatter(t, live);
    const draft = journal ? await journal.loadDraft(t) : null;
    const text = draft ? draft.after : live;
    basedOn = draft ? draft.basedOn : formatterHash(live);
    openedFromDraft = !!draft;
    const { doc, error } = docFor(t, text);
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
    const { doc } = docFor(current, f);
    state.loadDocument(doc);
    state.markSavepoint();
    basedOn = formatterHash(f);
    openedFromDraft = false;
    shell.notice(null);
  };

  const core: PanelCore = {
    rest, listId, shell, journal: () => journal!, current: () => current, basedOn: () => basedOn,
    setBasedOn: (h) => { basedOn = h; openedFromDraft = false; }, setLiveFormatter, loadLive, toast, renderTree,
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
    await stashDraft();
    writeReopen(storage, null);
    unsub();
    // the JSON pane's own teardown (the repo's `_unsub` mount convention):
    // its state subscription and IDE observers must not outlive the host
    (shell.editor as unknown as { _unsub?: () => void })._unsub?.();
    shell.destroy();
    state.resumeAutosave();
    ctx.onClose?.();
  };

  return {
    ready,
    setViewId(id) {
      viewId = id;
      const now = currentViewOf(shape, id)?.id ?? null;
      if (current?.kind === 'View' && now && current.id !== now) void openTarget({ kind: 'View', id: now });
      else void renderTree();
    },
    openTarget,
    close,
  };
}
