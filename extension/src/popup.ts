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

import type { ListSnapshot, ApplyOutcome, TargetFormatter } from '../../src/bridge/spClient';
import { selectFromSnapshot } from '../../src/bridge/spClient';
import { runInTab, type WorkerRequest, type WorkerResponse } from './pageCall';
import { serializeApplyPayload, parseApplyPayload, type ApplyPayload } from '../../src/bridge/applyPayload';
import { STAGE_KEY, PUSH_KEY, BACKUPS_KEY, type StagedApply, type PushedSnapshot, type BackupsFile, type BackupEntry } from './staging';
import { makeBackupEntry, pushBounded, restorePayloadFrom, describeEntry } from './backups';
import { classifyUrl } from './pageKind';
import { originPatternFor, hostFromPattern } from './connections';
import { dashboardFrom, viewGrabFields, type Dashboard } from './context';

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

/** Run a bridge request in the active tab (inject + call — pageCall.ts). */
async function runInPage(request: WorkerRequest): Promise<WorkerResponse> {
  return runInTab(await activeTabId(), request);
}

// ── the context dashboard: a cheap schema-only read on popup open ──────────

/** The schema-only snapshot behind the dashboard (rows deliberately empty). */
let dashSnap: ListSnapshot | null = null;

/** Push a narrowed snapshot to a fresh formatfx.dev tab (extract-push). */
async function pushSnapshot(sel: ListSnapshot, doneMsg: string): Promise<void> {
  const pushed: PushedSnapshot = { snapshotJson: JSON.stringify(sel), pushedAt: new Date().toISOString() };
  await chrome.storage.local.set({ [PUSH_KEY]: pushed }); // written before the tab opens
  await chrome.tabs.create({ url: 'https://formatfx.dev' });
  setStatus(doneMsg, 'ok');
}

function dashRow(name: string, chars: number, grabTitle: string, onGrab: () => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'dash-row';
  const label = document.createElement('span');
  label.className = 'dash-name';
  label.textContent = name;
  label.title = name;
  const size = document.createElement('span');
  size.className = 'dash-size';
  size.textContent = `${chars} ch`;
  const btn = document.createElement('button');
  btn.className = 'secondary';
  btn.textContent = '⬇ Grab';
  btn.title = grabTitle;
  btn.addEventListener('click', onGrab);
  row.append(label, size, btn);
  return row;
}

function renderDashboard(dash: Dashboard): void {
  (document.getElementById('dash') as HTMLElement).hidden = false;
  const title = document.getElementById('dash-title') as HTMLElement;
  title.textContent = `${dash.listLabel} — ${dash.totalColumns} columns, ${dash.totalViews} views`
    + (dash.currentViewTitle ? ` (viewing "${dash.currentViewTitle}")` : '');
  (document.getElementById('main-lede') as HTMLElement).hidden = true;

  const sections = document.getElementById('dash-sections') as HTMLElement;
  sections.replaceChildren();

  const addSection = (heading: string, rows: HTMLElement[], emptyText: string): void => {
    const h = document.createElement('h2');
    h.textContent = heading;
    sections.appendChild(h);
    if (!rows.length) {
      const p = document.createElement('p');
      p.className = 'dash-empty';
      p.textContent = emptyText;
      sections.appendChild(p);
      return;
    }
    for (const r of rows) sections.appendChild(r);
  };

  addSection('Formatted columns', dash.formattedColumns.map((c) =>
    dashRow(c.displayName, c.formatterChars, `Open [${c.internalName}] and its formatter in FormatFX`, () => {
      if (!dashSnap) return;
      const sel = selectFromSnapshot(dashSnap, { fieldNames: [c.internalName], includeCurrentView: false });
      void pushSnapshot(sel, `Sent [${c.internalName}] + its formatter — FormatFX is opening with it loaded.`);
    })), 'No column formatters on this list yet.');

  addSection('Formatted views', dash.formattedViews.map((v) =>
    dashRow(v.isCurrent ? `${v.title} (current)` : v.title, v.formatterChars, `Open the "${v.title}" view formatter in FormatFX`, () => {
      if (!dashSnap) return;
      const sel = selectFromSnapshot(dashSnap, {
        fieldNames: viewGrabFields(dashSnap, v.id), includeCurrentView: true, viewId: v.id,
      });
      void pushSnapshot(sel, `Sent the "${v.title}" view + its formatter — FormatFX is opening with it loaded.`);
    })), 'No view formatters on this list yet.');
}

/**
 * Populate the dashboard with a schema-only capture (2 GETs: fields + views —
 * no rows, so it's fast and cheap). Best-effort: any failure leaves the plain
 * two-button popup exactly as v0.1 — the dashboard must never block
 * Extract/Apply.
 */
async function loadDashboard(): Promise<void> {
  try {
    // schema-only AND rules-free: the dashboard read stays 2 cheap GETs
    const res = await runInPage({ action: 'extract', opts: { includeData: false, includeRules: false } });
    if (!res.ok || !res.snapshot) return;
    dashSnap = res.snapshot;
    renderDashboard(dashboardFrom(res.snapshot));
  } catch {
    // e.g. the page isn't fully loaded yet — the buttons still work
  }
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
    // columns that carry a live formatter get a second checkbox to opt out of
    // pulling that formatter in (the column itself still comes across)
    if (f.customFormatter) {
      const fmtWrap = document.createElement('span');
      fmtWrap.className = 'fmt-opt';
      fmtWrap.title = `Pull in this column's existing formatter. Uncheck to capture the column without its formatter.`;
      const fmtCb = document.createElement('input');
      fmtCb.type = 'checkbox';
      fmtCb.checked = true;
      fmtCb.value = f.internalName;
      fmtCb.className = 'fmt';
      fmtCb.setAttribute('aria-label', `Capture formatter for ${f.displayName || f.internalName}`);
      fmtWrap.append(fmtCb, document.createTextNode(' formatter'));
      label.appendChild(fmtWrap);
    }
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
  // formatter boxes left unchecked → drop those columns' formatters at capture
  const dropFormatterFor = Array.from(document.querySelectorAll<HTMLInputElement>('#picker-fields .fmt:not(:checked)')).map((c) => c.value);
  const sel = selectFromSnapshot(captured!, { fieldNames: names, includeCurrentView, dropFormatterFor });
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
  await pushSnapshot(sel, `Sent ${sel.fields.length} columns${sel.views.length ? ' + the current view' : ''}${sel.rows.length ? '' : ' (no data)'} — FormatFX is opening with it loaded.`);
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

// ── pre-apply backup & restore ──────────────────────────────────────────────

/**
 * File a backup entry from the apply's OWN look-before-write read — each
 * outcome carries `previousFormatter` verbatim, so the safety net costs no
 * extra REST pass (one read per target total, review feedback on #274). The
 * values were captured before any write, even for targets whose write then
 * failed. A cancelled confirm writes nothing → nothing to file.
 */
async function fileBackupFromOutcomes(payload: ApplyPayload, outcomes: ApplyOutcome[]): Promise<void> {
  const attempted = outcomes.some((o) => o.applied || o.error);
  if (!attempted) return; // cancelled — nothing was written
  const read: TargetFormatter[] = outcomes.map((o) => ({
    target: o.target, name: o.name, formatter: o.previousFormatter ?? null,
  }));
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const siteUrl = tab?.url ? new URL(tab.url).origin : '';
  const listLabel = payload.listTitle ?? dashSnap?.list ?? siteUrl;
  const entry = makeBackupEntry(siteUrl, listLabel, read, new Date().toISOString());
  const got = await chrome.storage.local.get(BACKUPS_KEY);
  const file = pushBounded(got[BACKUPS_KEY] as BackupsFile | undefined, entry);
  await chrome.storage.local.set({ [BACKUPS_KEY]: file });
}

/** The popup's History section: recent backups with one-click restore. */
async function refreshHistory(): Promise<void> {
  const wrap = document.getElementById('history') as HTMLElement;
  const list = document.getElementById('history-list') as HTMLElement;
  const got = await chrome.storage.local.get(BACKUPS_KEY);
  const file = got[BACKUPS_KEY] as BackupsFile | undefined;
  const entries = (file?.entries ?? []).slice(0, 5);
  wrap.hidden = entries.length === 0;
  list.replaceChildren();
  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = 'dash-row';
    const label = document.createElement('span');
    label.className = 'dash-name';
    label.textContent = describeEntry(entry);
    label.title = `${describeEntry(entry)} — ${entry.takenAt}`;
    const when = document.createElement('span');
    when.className = 'dash-size';
    when.textContent = entry.takenAt.slice(0, 16).replace('T', ' ');
    const btn = document.createElement('button');
    btn.className = 'secondary';
    btn.textContent = '↩ Restore';
    btn.title = 'Write these formatters back exactly as they were (confirm first)';
    btn.addEventListener('click', () => void onRestore(entry));
    row.append(label, when, btn);
    list.appendChild(row);
  }
}

async function onRestore(entry: BackupEntry): Promise<void> {
  setStatus('Restoring…', 'busy');
  try {
    // the same backup-then-confirm-then-apply pipeline: a restore backs up
    // what IT overwrites, so restore-of-a-restore works
    await applyText(serializeApplyPayload(restorePayloadFrom(entry)));
    void refreshHistory();
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e), 'err');
  }
}

/** Run the apply against the list tab from a payload string, then report. */
async function applyText(text: string): Promise<boolean> {
  const payload = parseApplyPayload(text); // teaching errors before any I/O
  const res = await runInPage({ action: 'apply', text });
  if (!res.ok || !res.outcomes) throw new Error(res.error || 'Apply failed or was cancelled.');
  // safety net first: the outcomes carry each target's pre-apply formatter
  await fileBackupFromOutcomes(payload, res.outcomes);
  const applied = res.outcomes.filter((o) => o.applied);
  const failed = res.outcomes.filter((o) => !o.applied && o.error);
  if (!applied.length && !failed.length) {
    setStatus('Cancelled — nothing was written.', 'idle');
    return false;
  }
  const parts = [`Applied ${applied.length} of ${res.outcomes.length}. Refresh the list to see it.`];
  for (const f of failed) parts.push(`✗ ${f.name}: ${f.error}`);
  setStatus(parts.join('\n'), failed.length ? 'err' : 'ok');
  void refreshHistory(); // the apply just filed a backup — show it
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

/** On a formatfx.dev tab: ask the page for the formatter it's editing and stage it. */
async function onGrabFormatter(): Promise<void> {
  setStatus('Grabbing the current formatter…', 'busy');
  try {
    const tabId = await activeTabId();
    const res = await chrome.tabs.sendMessage<{ ok: boolean; payload?: ApplyPayload; error?: string }>(
      tabId, { action: 'grabFormatter' },
    );
    if (!res?.ok || !res.payload) throw new Error(res?.error || 'FormatFX did not return a formatter.');
    const payload = parseApplyPayload(serializeApplyPayload(res.payload)); // re-validate off the wire
    const staged: StagedApply = { payload, stagedAt: new Date().toISOString() };
    await chrome.storage.local.set({ [STAGE_KEY]: staged });
    const t = payload.targets[0];
    setStatus(`Got ${t.target === 'field' ? `[${t.name}]` : `the "${t.name}" view`} — switch to your SharePoint list tab and click Apply staged.`, 'ok');
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e), 'err');
  }
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
document.getElementById('grab-formatter')!.addEventListener('click', onGrabFormatter);
document.getElementById('picker-open')!.addEventListener('click', onPickerOpen);
document.getElementById('picker-copy')!.addEventListener('click', onPickerCopy);
document.getElementById('picker-cancel')!.addEventListener('click', onPickerCancel);
document.getElementById('picker-all')!.addEventListener('click', () => setAllFields(true));
document.getElementById('picker-none')!.addEventListener('click', () => setAllFields(false));

// ── per-site opt-in (Connect / Disconnect) ──────────────────────────────────

/**
 * The connect footer, shown on any SharePoint page. Connected state is
 * DERIVED from chrome.permissions (never stored), so a revoke from
 * chrome://extensions is immediately reflected here.
 */
async function refreshConnectFooter(url: string | undefined): Promise<void> {
  const footer = document.getElementById('connect') as HTMLElement;
  const pattern = originPatternFor(url);
  if (!pattern) { footer.hidden = true; return; }
  const host = hostFromPattern(pattern);
  const connected = await chrome.permissions.contains({ origins: [pattern] });
  footer.hidden = false;
  (document.getElementById('connect-off') as HTMLElement).hidden = connected;
  (document.getElementById('connect-on') as HTMLElement).hidden = !connected;
  if (connected) {
    (document.getElementById('connected-host') as HTMLElement).textContent = host;
  } else {
    (document.getElementById('connect-host') as HTMLElement).textContent = host;
  }
}

async function onConnectToggle(grant: boolean): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const pattern = originPatternFor(tab?.url);
  if (!pattern) return;
  try {
    if (grant) {
      const ok = await chrome.permissions.request({ origins: [pattern] });
      if (!ok) { setStatus('', 'idle'); return; } // declined — no nagging
      setStatus(`Connected. The badge now tracks ${hostFromPattern(pattern)}.`, 'ok');
    } else {
      await chrome.permissions.remove({ origins: [pattern] });
      setStatus('Disconnected — this site is back to click-only access.', 'ok');
    }
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e), 'err');
  }
  void refreshConnectFooter(tab?.url);
}

document.getElementById('connect-btn')!.addEventListener('click', () => void onConnectToggle(true));
document.getElementById('disconnect-btn')!.addEventListener('click', () => void onConnectToggle(false));

/** Show the right panel based on the active tab's URL. */
async function initPageState(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const kind = classifyUrl(tab?.url);
  const main = document.getElementById('main') as HTMLElement;
  const fxState = document.getElementById('state-formatfx') as HTMLElement;
  const spSiteState = document.getElementById('state-sp-site') as HTMLElement;
  const otherState = document.getElementById('state-other') as HTMLElement;
  main.hidden = kind !== 'sharepoint';
  fxState.hidden = kind !== 'formatfx';
  spSiteState.hidden = kind !== 'sharepoint-site';
  otherState.hidden = kind !== 'other';
  if (kind === 'sharepoint') {
    void refreshStagedButton();
    void loadDashboard(); // best-effort; never blocks the buttons
    void refreshHistory();
  }
  if (kind === 'sharepoint' || kind === 'sharepoint-site') void refreshConnectFooter(tab?.url);
}

void initPageState();
