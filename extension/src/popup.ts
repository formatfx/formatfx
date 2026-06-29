/**
 * popup.ts — the two-button UI. Extract copies a List Snapshot to the
 * clipboard (paste into FormatFX → Data → Import schema). Apply reads a
 * FormatFX "apply" payload from the clipboard and writes it back to the
 * list's columns/views, behind one batched confirm.
 *
 * Permissioning: clicking the toolbar action grants `activeTab`, so we can
 * inject into the current SharePoint tab with no standing host permission —
 * the user authorizes exactly the tab they're looking at, nothing else.
 */

import type { ListSnapshot, ApplyOutcome } from '../../src/bridge/spClient';
import { selectFromSnapshot } from '../../src/bridge/spClient';
import { serializeApplyPayload } from '../../src/bridge/applyPayload';
import { STAGE_KEY, PUSH_KEY, type StagedApply, type PushedSnapshot } from './staging';
import { classifyUrl } from './pageKind';

interface WorkerResponse {
  ok: boolean;
  error?: string;
  snapshot?: ListSnapshot;
  outcomes?: ApplyOutcome[];
}

const statusEl = (): HTMLElement => document.getElementById('status')!;
function setStatus(text: string, kind: 'idle' | 'busy' | 'ok' | 'err' = 'idle'): void {
  const el = statusEl();
  el.textContent = text;
  el.className = kind;
}

async function activeTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab.');
  return tab.id;
}

/**
 * Runs in the page MAIN world (injected as a self-contained function): posts
 * one request to inject.js and resolves with the matching response. Must not
 * reference anything outside its own body.
 */
function callWorker(request: { action: string; opts?: unknown; text?: string }): Promise<WorkerResponse> {
  return new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2);
    const onMsg = (ev: MessageEvent): void => {
      if (ev.source !== window) return;
      const m = ev.data as { __formatfx?: string; id?: string };
      if (m && m.__formatfx === 'response' && m.id === id) {
        window.removeEventListener('message', onMsg);
        resolve(ev.data as WorkerResponse);
      }
    };
    window.addEventListener('message', onMsg);
    window.postMessage({ __formatfx: 'request', id, ...request }, '*');
  });
}

async function runInPage(request: { action: string; text?: string }): Promise<WorkerResponse> {
  const tabId = await activeTabId();
  // 1) ensure the MAIN-world worker is present (idempotent), then 2) call it.
  await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', files: ['inject.js'] });
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId }, world: 'MAIN', func: callWorker, args: [request],
  });
  return result;
}

// ── extract: capture, then a column/view picker, then push or copy ──
let captured: ListSnapshot | null = null;

function showPicker(show: boolean): void {
  (document.getElementById('main') as HTMLElement).hidden = show;
  (document.getElementById('picker') as HTMLElement).hidden = !show;
}

async function onExtract(): Promise<void> {
  setStatus('Capturing the list…', 'busy');
  try {
    const res = await runInPage({ action: 'extract' });
    if (!res.ok || !res.snapshot) throw new Error(res.error || 'Capture failed.');
    captured = res.snapshot;
    renderPicker(captured);
    showPicker(true);
    setStatus('Choose what to capture, then send.', 'idle');
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e), 'err');
  }
}

function renderPicker(snap: ListSnapshot): void {
  const list = document.getElementById('picker-fields') as HTMLElement;
  list.replaceChildren();
  for (const f of snap.fields) {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true; // "All columns" default
    cb.value = f.internalName;
    cb.className = 'fld';
    const text = document.createElement('span');
    text.textContent = ` ${f.displayName || f.internalName}`;
    if (f.displayName && f.displayName !== f.internalName) {
      const iname = document.createElement('span');
      iname.className = 'iname';
      iname.textContent = ` [${f.internalName}]`;
      text.appendChild(iname);
    }
    label.append(cb, text);
    list.appendChild(label);
  }
  // current view toggle, default on; hidden when there's no view to include
  const viewRow = document.getElementById('picker-view-row') as HTMLElement;
  const viewCb = document.getElementById('picker-view') as HTMLInputElement;
  const viewLabel = document.getElementById('picker-view-label') as HTMLElement;
  const current = snap.views.find((v) => v.id && v.id === snap.currentViewId);
  if (current) {
    viewRow.hidden = false;
    viewCb.checked = true;
    viewLabel.textContent = `Include current view: "${current.title}"`;
  } else {
    viewRow.hidden = true;
    viewCb.checked = false;
  }

  // The capture couldn't read this list's rows: say so plainly instead of
  // letting synthetic sample data pose as the real thing. With no real rows to
  // ship, the data toggle is off and disabled.
  const dataCb = document.getElementById('picker-data') as HTMLInputElement;
  const dataWarn = document.getElementById('picker-data-warn') as HTMLElement;
  if (snap.rowsError) {
    dataCb.checked = false;
    dataCb.disabled = true;
    dataWarn.hidden = false;
    dataWarn.textContent = `⚠ Couldn't read this list's rows (${snap.rowsError}). FormatFX will use synthetic sample data.`;
  } else {
    dataCb.checked = true;
    dataCb.disabled = false;
    dataWarn.hidden = true;
  }
}

function selectedSnapshot(): ListSnapshot {
  const names = Array.from(document.querySelectorAll<HTMLInputElement>('#picker-fields .fld:checked')).map((c) => c.value);
  const includeCurrentView = (document.getElementById('picker-view') as HTMLInputElement).checked;
  const includeData = (document.getElementById('picker-data') as HTMLInputElement).checked;
  const sel = selectFromSnapshot(captured!, { fieldNames: names, includeCurrentView });
  // "Include sample data" off → ship schema/formatters only; the app fills
  // synthetic sample rows at import (dataPanel: schema.rows ?? buildSampleRows).
  return includeData ? sel : { ...sel, rows: [] };
}

function setAllFields(checked: boolean): void {
  for (const c of document.querySelectorAll<HTMLInputElement>('#picker-fields .fld')) c.checked = checked;
}

async function onPickerOpen(): Promise<void> {
  const sel = selectedSnapshot();
  if (!sel.fields.length) { setStatus('Pick at least one column.', 'err'); return; }
  setStatus('Opening FormatFX…', 'busy');
  const pushed: PushedSnapshot = { snapshotJson: JSON.stringify(sel), pushedAt: new Date().toISOString() };
  await chrome.storage.local.set({ [PUSH_KEY]: pushed }); // written before the tab opens
  await chrome.tabs.create({ url: 'https://formatfx.dev' });
  setStatus(`Sent ${sel.fields.length} columns${sel.views.length ? ' + the current view' : ''}${sel.rows.length ? '' : ' (no data)'} — FormatFX is opening with it loaded.`, 'ok');
}

async function onPickerCopy(): Promise<void> {
  const sel = selectedSnapshot();
  if (!sel.fields.length) { setStatus('Pick at least one column.', 'err'); return; }
  await navigator.clipboard.writeText(JSON.stringify(sel, null, 1));
  setStatus(`Copied ${sel.fields.length} columns${sel.views.length ? ' + the current view' : ''}${sel.rows.length ? '' : ' (no data)'}. Paste into FormatFX → Data → Import schema.`, 'ok');
}

function onPickerCancel(): void {
  showPicker(false);
  setStatus('', 'idle');
}

/** Run the apply against the list tab from a payload string, then report. */
async function applyText(text: string): Promise<boolean> {
  const res = await runInPage({ action: 'apply', text });
  if (!res.ok || !res.outcomes) throw new Error(res.error || 'Apply failed or was cancelled.');
  const applied = res.outcomes.filter((o) => o.applied);
  const failed = res.outcomes.filter((o) => !o.applied && o.error);
  if (!applied.length && !failed.length) {
    setStatus('Cancelled — nothing was written.', 'idle');
    return false;
  }
  const parts = [`Applied ${applied.length} of ${res.outcomes.length}. Refresh the list to see it.`];
  for (const f of failed) parts.push(`✗ ${f.name}: ${f.error}`);
  setStatus(parts.join('\n'), failed.length ? 'err' : 'ok');
  return applied.length > 0 && failed.length === 0;
}

async function onApply(): Promise<void> {
  setStatus('Reading clipboard…', 'busy');
  try {
    await applyText(await navigator.clipboard.readText());
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e), 'err');
  }
}

async function readStaged(): Promise<StagedApply | null> {
  const got = await chrome.storage.local.get(STAGE_KEY);
  return (got[STAGE_KEY] as StagedApply | undefined) ?? null;
}

async function onApplyStaged(): Promise<void> {
  setStatus('Applying staged formatter…', 'busy');
  try {
    const staged = await readStaged();
    if (!staged) { setStatus('Nothing staged — send one from FormatFX first.', 'idle'); return; }
    const clean = await applyText(serializeApplyPayload(staged.payload));
    if (clean) await chrome.storage.local.remove(STAGE_KEY); // consume only on a clean apply
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e), 'err');
  }
}

/** Reveal the "Apply staged" button when FormatFX has sent something. */
async function refreshStagedButton(): Promise<void> {
  const btn = document.getElementById('apply-staged') as HTMLButtonElement;
  const staged = await readStaged();
  if (staged) {
    const n = staged.payload.targets.length;
    btn.textContent = `✓ Apply staged (${n} formatter${n === 1 ? '' : 's'})`;
    btn.hidden = false;
  } else {
    btn.hidden = true;
  }
}

document.getElementById('extract')!.addEventListener('click', onExtract);
document.getElementById('apply')!.addEventListener('click', onApply);
document.getElementById('apply-staged')!.addEventListener('click', onApplyStaged);
document.getElementById('picker-open')!.addEventListener('click', onPickerOpen);
document.getElementById('picker-copy')!.addEventListener('click', onPickerCopy);
document.getElementById('picker-cancel')!.addEventListener('click', onPickerCancel);
document.getElementById('picker-all')!.addEventListener('click', () => setAllFields(true));
document.getElementById('picker-none')!.addEventListener('click', () => setAllFields(false));

/** Show the right panel based on the active tab's URL. */
async function initPageState(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const kind = classifyUrl(tab?.url);
  const main = document.getElementById('main') as HTMLElement;
  const fxState = document.getElementById('state-formatfx') as HTMLElement;
  const otherState = document.getElementById('state-other') as HTMLElement;
  main.hidden = kind !== 'sharepoint';
  fxState.hidden = kind !== 'formatfx';
  otherState.hidden = kind !== 'other';
  if (kind === 'sharepoint') void refreshStagedButton();
}

void initPageState();
