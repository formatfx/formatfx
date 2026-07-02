/**
 * editor/shareUi.ts — Share links: the dialog that mints them and the boot
 * path that opens them safely.
 *
 * The whole workspace travels INSIDE the URL fragment (core/share.ts) — no
 * server, no account, and the fragment never leaves the browser in an HTTP
 * request. The safety design on the receiving end is the important part
 * (the frozen-keys house rule: never wipe anyone's autosaved work):
 *
 *   1. Opening a share link loads the shared workspace with autosave PAUSED
 *      (state.pauseAutosave) — the recipient's own autosave key is untouched.
 *   2. A persistent banner offers the only two writes: "Save a copy" (backs
 *      the previous autosave up to the additive `….bak` key first, then
 *      resumes autosave) or "Discard" (reloads their own work, writes nothing).
 *   3. The fragment is stripped via history.replaceState after a successful
 *      load, so a later refresh doesn't resurrect stale shared state.
 *
 * A share payload is normally a full project file, but a bare formatter JSON
 * (column / row / tile — e.g. a raw pnp/List-Formatting sample) also opens:
 * it gets wrapped in a default workspace with plausible sample data, which is
 * what makes "open this sample live" links possible from a repo of formatter
 * files (docs/SHARE-URL.md).
 */

import { state, defaultFields, EditorState } from './state';
import { createOverlay, type OverlayHandle } from './overlay';
import { importJson } from '../core/serializer';
import { buildSampleRows } from '../core/schemaImport';
import { PROJECT_FILE_NAME } from '../branding';
import {
  parseShareHash, decodeShareFragment, buildShareUrl, canDeflate, SHARE_URL_WARN_LENGTH,
} from '../core/share';
import type { MockField } from '../core/types';

/** Additive backup key — the frozen autosave key itself is never renamed. */
export const BACKUP_STORAGE_KEY = `${EditorState.STORAGE_KEY}.bak`;

export interface ShareUiOptions {
  toast: (msg: string) => void;
}

// ─── the Share dialog ────────────────────────────────────────────────────────

let dialogHandle: OverlayHandle | null = null;

export function openShareDialog(opts: ShareUiOptions): void {
  dialogHandle?.close();
  const close = (): void => { dialogHandle?.close(); dialogHandle = null; };
  dialogHandle = createOverlay('wb-share-overlay', close);
  const overlay = dialogHandle.overlay;

  const panel = document.createElement('div');
  panel.className = 'wb-share-panel';
  panel.innerHTML = `
    <div class="wb-share-head">
      <span class="wb-share-title"><i class="ms-Icon ms-Icon--Share" aria-hidden="true"></i> Share this workspace</span>
      <button class="wb-share-close" title="Close (Esc)" aria-label="Close">✕</button>
    </div>
    <p class="wb-share-note">The whole workspace — formatter, columns, mock rows, theme — is encoded
      <strong>inside the link itself</strong>. Nothing is uploaded anywhere: URL fragments are never sent to a
      server, so the link only lives with whoever you give it to. Whoever opens it lands in exactly this
      workspace, and their own saved work stays untouched until they choose to keep yours.</p>
    <label class="wb-check wb-share-data-toggle" title="Uncheck to share the formatter and column schema only — your sample rows (including any names, emails and values) stay out of the link">
      <input type="checkbox" id="wb-share-include-data" checked> Include mock data rows
    </label>
    <div class="wb-share-linkrow">
      <input id="wb-share-url" readonly spellcheck="false" aria-label="Share link">
      <button id="wb-share-copy" class="wb-json-primary">Copy link</button>
    </div>
    <div id="wb-share-size" class="wb-share-size" aria-live="polite"></div>
  `;
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  panel.querySelector('.wb-share-close')!.addEventListener('click', close);

  const urlEl = panel.querySelector('#wb-share-url') as HTMLInputElement;
  const sizeEl = panel.querySelector('#wb-share-size') as HTMLDivElement;
  const includeDataEl = panel.querySelector('#wb-share-include-data') as HTMLInputElement;
  const copyBtn = panel.querySelector('#wb-share-copy') as HTMLButtonElement;

  let generation = 0;
  const regenerate = async (): Promise<void> => {
    const mine = ++generation;
    urlEl.value = '';
    sizeEl.textContent = 'Building the link…';
    sizeEl.classList.remove('wb-share-size-warn');
    try {
      const url = await buildShareUrl(appBaseUrl(), sharePayload(includeDataEl.checked));
      if (mine !== generation) return; // a newer toggle superseded this run
      urlEl.value = url;
      const rows = includeDataEl.checked ? state.rows.length : 0;
      const inclusions = `formatter + ${state.fields.length} columns + ${rows} mock row${rows === 1 ? '' : 's'}`;
      if (url.length > SHARE_URL_WARN_LENGTH) {
        sizeEl.classList.add('wb-share-size-warn');
        sizeEl.textContent = `⚠ ${url.length.toLocaleString()} characters (${inclusions}) — very long links get truncated by some chat apps and older browsers, which breaks them. `
          + `Safer for this much data: ${includeDataEl.checked ? 'untick "Include mock data rows", or ' : ''}share the ${PROJECT_FILE_NAME} file instead (☰ → Save project).`;
      } else {
        sizeEl.textContent = `${url.length.toLocaleString()} characters — ${inclusions}${canDeflate() ? ', compressed' : ''}. Works anywhere a link works.`;
      }
    } catch (e) {
      if (mine !== generation) return;
      sizeEl.textContent = `Could not build the link: ${(e as Error).message}`;
    }
  };
  includeDataEl.addEventListener('change', () => { void regenerate(); });
  void regenerate();

  copyBtn.addEventListener('click', async () => {
    if (!urlEl.value) return;
    try {
      await navigator.clipboard.writeText(urlEl.value);
      opts.toast('Share link copied — whoever opens it lands in this exact workspace');
    } catch {
      urlEl.select();
      opts.toast('Copy failed — clipboard access blocked (the link is selected; press Ctrl/Cmd+C)');
    }
  });
}

/** The app URL a share link should point at (current origin/path, no hash). */
function appBaseUrl(): string {
  return location.origin + location.pathname + location.search;
}

/** The project JSON to encode — minified (loadProject doesn't care about
 *  whitespace, and it keeps the raw-fallback links meaningfully shorter). */
function sharePayload(includeData: boolean): string {
  const project = JSON.parse(state.serializeProject());
  if (!includeData) project.rows = [];
  return JSON.stringify(project);
}

// ─── opening a share link (boot path) ────────────────────────────────────────

/**
 * Check location.hash for a share payload; when present, decode and load it
 * WITHOUT touching the recipient's autosave, then show the keep/discard
 * banner. Call after the panels have mounted (loadProject re-renders them).
 */
export async function openSharedWorkspaceFromHash(opts: ShareUiOptions): Promise<boolean> {
  const frag = parseShareHash(location.hash);
  if (!frag) return false;
  let projectJson: string;
  try {
    projectJson = normalizeSharedPayload(await decodeShareFragment(frag));
  } catch (e) {
    opts.toast(`This share link could not be opened: ${(e as Error).message}`);
    return false;
  }
  let hadOwnWork = false;
  try {
    hadOwnWork = localStorage.getItem(EditorState.STORAGE_KEY) != null;
  } catch { /* private mode — even reads can throw; treat as no prior work */ }
  try {
    state.pauseAutosave(); // BEFORE loadProject — its emits schedule autosaves
    state.loadProject(projectJson);
    state.markSavepoint();
  } catch (e) {
    state.resumeAutosave();
    opts.toast(`This share link could not be opened: ${(e as Error).message}`);
    return false;
  }
  // strip the fragment so a refresh doesn't resurrect stale shared state
  history.replaceState(null, '', appBaseUrl());
  showSharedBanner(opts, hadOwnWork);
  return true;
}

/**
 * A shared payload is normally a project file; a bare formatter JSON (e.g. a
 * raw pnp/List-Formatting sample) is wrapped in a default workspace so the
 * link still opens live. Anything else throws (refuse, don't guess).
 */
export function normalizeSharedPayload(json: string): string {
  const parsed = JSON.parse(json);
  if (parsed && typeof parsed === 'object' && parsed.doc?.root?.elmType) {
    return json; // already a project file — loadProject validates the rest
  }
  const doc = importJson(json); // throws with its own teaching message
  const fields = fieldsForFormatter(json);
  return JSON.stringify({
    version: 1,
    doc,
    fields,
    rows: buildSampleRows(fields, 3),
    currentFieldName: fields.find((f) => f.name === 'Status')?.name ?? fields[0].name,
    columnRefs: {},
    viewName: 'Shared formatter',
  });
}

/** Default fields, extended with text stubs for every [$Field] the shared
 *  formatter references — so a bare sample renders instead of flagging
 *  unknown-field lint on arrival. */
function fieldsForFormatter(json: string): MockField[] {
  const fields = defaultFields();
  const known = new Set(fields.map((f) => f.name));
  for (const m of json.matchAll(/\[\$([A-Za-z0-9_]+)/g)) {
    if (!known.has(m[1])) {
      known.add(m[1]);
      fields.push({ name: m[1], type: 'text' });
    }
  }
  return fields;
}

// ─── the keep / discard banner ───────────────────────────────────────────────

function showSharedBanner(opts: ShareUiOptions, hadOwnWork: boolean): void {
  document.querySelector('.wb-share-banner')?.remove();
  const banner = document.createElement('div');
  banner.className = 'wb-share-banner';
  banner.setAttribute('role', 'status');
  banner.innerHTML = `
    <span class="wb-share-banner-text"><strong>You're viewing a shared workspace.</strong>
      ${hadOwnWork ? 'Your own work is safe — nothing here is saved over it' : 'Nothing here is saved'} until you choose.</span>
    <span class="wb-share-banner-actions">
      <button class="wb-share-keep" title="${hadOwnWork
        ? 'Keep this shared workspace as your working copy — your previous work is backed up first, restorable from the ☰ menu'
        : 'Keep this shared workspace as your working copy (autosaves from now on)'}">Save a copy</button>
      <button class="wb-share-discard" title="${hadOwnWork
        ? 'Close the shared workspace and go back to your own saved work'
        : 'Close the shared workspace and start from the default example'}">Discard</button>
    </span>
  `;
  document.querySelector('.wb-topbar')?.after(banner);

  banner.querySelector('.wb-share-keep')!.addEventListener('click', () => {
    let backedUp = false;
    try {
      const previous = localStorage.getItem(EditorState.STORAGE_KEY);
      if (previous != null) {
        localStorage.setItem(BACKUP_STORAGE_KEY, previous);
        backedUp = true;
      }
    } catch { /* private mode — proceed; resumeAutosave will no-op the same way */ }
    state.resumeAutosave(true);
    banner.remove();
    refreshRestoreBackupItem();
    opts.toast(backedUp
      ? 'Saved — this workspace autosaves from now on. Your previous work is backed up: ☰ → Restore backed-up work.'
      : 'Saved — this workspace autosaves from now on.');
  });

  banner.querySelector('.wb-share-discard')!.addEventListener('click', () => {
    banner.remove();
    state.resumeAutosave();
    if (hadOwnWork && state.restore()) {
      opts.toast('Back to your own work — the shared workspace was discarded');
    } else {
      state.resetAll();
      opts.toast('Shared workspace discarded');
    }
  });
}

// ─── backup restore (☰ menu) ─────────────────────────────────────────────────

/** Show the ☰ "Restore backed-up work" item only when a backup exists. */
export function refreshRestoreBackupItem(): void {
  const btn = document.getElementById('wb-restore-backup');
  if (!btn) return;
  let has = false;
  try { has = localStorage.getItem(BACKUP_STORAGE_KEY) != null; } catch { /* private mode */ }
  btn.hidden = !has;
}

export function wireRestoreBackup(opts: ShareUiOptions): void {
  const btn = document.getElementById('wb-restore-backup');
  if (!btn) return;
  btn.addEventListener('click', () => {
    let backup: string | null = null;
    try { backup = localStorage.getItem(BACKUP_STORAGE_KEY); } catch { /* private mode */ }
    if (backup == null) { refreshRestoreBackupItem(); return; }
    if (!confirm('Restore the work that was backed up when you saved a shared workspace?\n\nYour current workspace swaps into the backup slot, so nothing is lost — you can restore it the same way.')) return;
    try {
      const current = state.serializeProject();
      state.loadProject(backup);
      // swap: the replaced workspace becomes the new backup — never a silent loss
      localStorage.setItem(BACKUP_STORAGE_KEY, current);
      state.flushAutosave();
      opts.toast('Backed-up work restored — the workspace it replaced is now the backup');
    } catch (e) {
      opts.toast(`Restore failed: ${(e as Error).message}`);
    }
    refreshRestoreBackupItem();
  });
  refreshRestoreBackupItem();
}
