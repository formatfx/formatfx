import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountFormatPanel, PANEL_HOST_ID, type PanelApi } from './panel';
import { JOURNAL_PATH } from './journalStore';
import { REOPEN_KEY } from './urlState';
import { state } from '../../../src/editor/state';

const WEB = 'https://t.sharepoint.com/sites/x';
const LIST = 'e481b50b-ebf9-4cbd-804f-a5276afb23ab';
const V1 = 'f24ba2a8-0000-0000-0000-000000000001';
const V2 = 'f24ba2a8-0000-0000-0000-000000000002';
const COL_JSON = '{"elmType":"div","txtContent":"@currentField"}';
// A real view formatter: the serializer only recognizes a `rowFormatter`
// wrapper, a tile wrapper or a bare element root — `additionalRowClass` rides
// along as an unmodeled wrapper sibling (viewExtras) and round-trips verbatim.
const VIEW_JSON = '{"$schema":"https://developer.microsoft.com/json-schemas/sp/v2/row-formatting.schema.json","hideSelection":true,"additionalRowClass":"x","rowFormatter":{"elmType":"div","txtContent":"[$Title]"}}';

interface Call { url: string; init?: RequestInit }
/** A fake tenant: one list with two views and two columns, a FormatFX journal list, and mutable formatters. */
function tenant() {
  const formatters: Record<string, string> = { 'Field:Status': COL_JSON, [`View:${V1}`]: VIEW_JSON, 'Field:Title': '', [`View:${V2}`]: '' };
  const items: Record<string, unknown>[] = [];
  const calls: Call[] = [];
  let nextId = 1;
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const h = (init?.headers ?? {}) as Record<string, string>;
    if (url.endsWith('/_api/contextinfo')) return json({ FormDigestValue: 'D' });
    if (url.endsWith('/_api/web/currentuser?$select=Id')) return json({ Id: 12 });
    if (url.includes(JOURNAL_PATH)) {
      if (url.includes('/items(') && h['X-HTTP-Method'] === 'MERGE') { const id = Number(/items\((\d+)\)/.exec(url)![1]); Object.assign(items.find((i) => i.Id === id)!, JSON.parse(init!.body as string)); return new Response('', { status: 204 }); }
      if (url.includes('/items(') && h['X-HTTP-Method'] === 'DELETE') { const id = Number(/items\((\d+)\)/.exec(url)![1]); items.splice(items.findIndex((i) => i.Id === id), 1); return new Response('', { status: 204 }); }
      if (url.includes('/items') && init?.method === 'POST') { const it = { Id: nextId++, Created: new Date(nextId * 1000).toISOString(), AuthorId: 12, Author: { Title: 'Me' }, ...JSON.parse(init!.body as string) }; items.push(it); return json(it, 201); }
      if (url.includes('/items')) {
        const filter = decodeURIComponent(new URL(url).searchParams.get('$filter') ?? '');
        const rows = items.filter((i) => ['Kind', 'ListId', 'TargetKind', 'TargetId'].every((c) => { const m = new RegExp(c + " eq '([^']*)'").exec(filter); return !m || i[c] === m[1]; }) && !(/Kind ne 'Draft'/.test(filter) && i.Kind === 'Draft'));
        return json({ value: (new URL(url).searchParams.get('$orderby') ?? '').includes('desc') ? [...rows].reverse() : rows });
      }
      return json({ Id: 'journal' });
    }
    if (url.includes('/fields?')) return json({ value: [
      { InternalName: 'Title', Title: 'Title', TypeAsString: 'Text', CustomFormatter: formatters['Field:Title'] },
      { InternalName: 'Status', Title: 'Status', TypeAsString: 'Choice', Choices: ['A', 'B'], CustomFormatter: formatters['Field:Status'] },
    ] });
    if (url.includes('/views?')) return json({ value: [
      { Title: 'All Items', Id: V1, DefaultView: true, CustomFormatter: formatters[`View:${V1}`], ServerRelativeUrl: '/sites/x/Lists/L/AllItems.aspx', ViewFields: { Items: ['Title', 'Status'] } },
      { Title: 'Mine', Id: V2, DefaultView: false, CustomFormatter: formatters[`View:${V2}`], ServerRelativeUrl: '/sites/x/Lists/L/Mine.aspx', ViewFields: { Items: ['Title'] } },
    ] });
    const key = /fields\/getbyinternalnameortitle\('([^']+)'\)/.exec(url)?.[1] ? 'Field:' + /fields\/getbyinternalnameortitle\('([^']+)'\)/.exec(url)![1] : /views\(guid'([^']+)'\)/.exec(url)?.[1] ? 'View:' + /views\(guid'([^']+)'\)/.exec(url)![1] : null;
    if (key && h['X-HTTP-Method'] === 'MERGE') { formatters[key] = (JSON.parse(init!.body as string) as { CustomFormatter: string }).CustomFormatter; return new Response('', { status: 204 }); }
    if (key) return json({ CustomFormatter: formatters[key] });
    return new Response('', { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls, items, formatters };
}

function mount(t: ReturnType<typeof tenant>, viewId: string | null = null, extra: Partial<Parameters<typeof mountFormatPanel>[1]> = {}) {
  const host = document.createElement('div');
  host.id = PANEL_HOST_ID;
  document.body.appendChild(host);
  const navigate = vi.fn();
  const api: PanelApi = mountFormatPanel(host.attachShadow({ mode: 'open' }), { webUrl: WEB, listId: LIST, listTitle: 'L', viewId, fetchImpl: t.fetchImpl, storage: sessionStorage, navigate, ...extra });
  const $ = <T extends HTMLElement>(sel: string): T => host.shadowRoot!.querySelector<T>(sel)!;
  const $$ = (sel: string): HTMLElement[] => Array.from(host.shadowRoot!.querySelectorAll<HTMLElement>(sel));
  const textarea = (): HTMLTextAreaElement => $('#wb-json-text');
  const typeAndApply = (text: string): void => {
    const ta = textarea();
    ta.value = text;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    $('#wb-json-apply').click();
  };
  return { api, host, $, $$, textarea, typeAndApply, navigate };
}

beforeEach(() => { sessionStorage.clear(); state.resetAll(); });
afterEach(() => { document.body.innerHTML = ''; });

describe('mountFormatPanel — boot and tree', () => {
  it('loads the list shape, renders views then columns, opens the current view', async () => {
    const m = mount(tenant());
    await m.api.ready;
    expect(m.$$('.ffx-node').map((n) => n.dataset.key)).toEqual([`View:${V1}`, `View:${V2}`, 'Field:Title', 'Field:Status']);
    expect(m.$(`.ffx-node[data-key="View:${V1}"]`).classList.contains('ffx-current')).toBe(true);
    expect(m.$('.ffx-node[data-key="Field:Status"]').classList.contains('ffx-formatted')).toBe(true);
    expect(m.$('.ffx-node[data-key="Field:Status"]').title).toContain('every view of this list');
    expect(m.$('.ffx-title').textContent).toContain('All Items');
    expect(m.$('.ffx-title').textContent).toContain('this view only');
    expect(m.textarea().value).toContain('"additionalRowClass": "x"');
    expect(state.singleTargetKind).toBe('row');
    expect(state.isAutosavePaused).toBe(true);
    expect(state.fields.map((f) => f.name)).toEqual(['Title', 'Status']);
  });

  it('marks the URL view current and opens it', async () => {
    const m = mount(tenant(), V2);
    await m.api.ready;
    expect(m.$(`.ffx-node[data-key="View:${V2}"]`).classList.contains('ffx-current')).toBe(true);
    expect(m.$('.ffx-title').textContent).toContain('Mine');
  });

  it('hides the web app deploy chrome inside the pane', async () => {
    const m = mount(tenant());
    await m.api.ready;
    expect(getComputedStyle(m.$('#wb-deploy-panel')).display).toBe('none');
  });
});

describe('mountFormatPanel — targets and drafts', () => {
  it('opens a column as a column document and remembers it for reopen', async () => {
    const m = mount(tenant());
    await m.api.ready;
    m.$('.ffx-node[data-key="Field:Status"]').click();
    await m.api.ready; // openTarget is awaited inside; flush
    await vi.waitFor(() => expect(m.$('.ffx-title').textContent).toContain('Status'));
    expect(state.singleTargetKind).toBe('column');
    expect(m.textarea().value).toContain('column-formatting.schema.json');
    expect(JSON.parse(sessionStorage.getItem(REOPEN_KEY)!)).toEqual({ listId: LIST, targetKey: 'Field:Status' });
  });

  it('opens an unformatted target with an empty document of the right kind', async () => {
    const m = mount(tenant());
    await m.api.ready;
    await m.api.openTarget({ kind: 'Field', id: 'Title' });
    expect(state.doc.kind).toBe('column');
    expect(m.textarea().value).toContain('"@currentField"');
  });

  it('stashes an edited target as a draft on switch, dots the tree, and restores it on return', async () => {
    const t = tenant();
    const m = mount(t);
    await m.api.ready;
    m.typeAndApply('{"elmType":"div","txtContent":"edited"}');
    expect(state.isDirtySinceSave).toBe(true);
    await m.api.openTarget({ kind: 'Field', id: 'Status' });
    const draft = t.items.find((i) => i.Kind === 'Draft')!;
    expect(draft).toMatchObject({ TargetKind: 'View', TargetId: V1 });
    expect(String(draft.After)).toContain('"edited"');
    expect(m.$(`.ffx-node[data-key="View:${V1}"]`).classList.contains('ffx-draft')).toBe(true);
    await m.api.openTarget({ kind: 'View', id: V1 });
    expect(m.textarea().value).toContain('"edited"');
    expect(m.$('.ffx-banner').hidden).toBe(true);
  });

  it('warns when a restored draft was based on an older formatter', async () => {
    const t = tenant();
    const m = mount(t);
    await m.api.ready;
    m.typeAndApply('{"elmType":"div","txtContent":"edited"}');
    await m.api.openTarget({ kind: 'Field', id: 'Status' });
    t.formatters[`View:${V1}`] = '{"elmType":"div","txtContent":"someone else"}';
    await m.api.openTarget({ kind: 'View', id: V1 });
    expect(m.$('.ffx-banner').hidden).toBe(false);
    expect(m.$('.ffx-banner').textContent).toContain('changed since');
  });

  it('picking another view stashes, records the reopen target and navigates', async () => {
    const t = tenant();
    const m = mount(t);
    await m.api.ready;
    m.typeAndApply('{"elmType":"div","txtContent":"edited"}');
    m.$(`.ffx-node[data-key="View:${V2}"]`).click();
    await vi.waitFor(() => expect(m.navigate).toHaveBeenCalledWith('/sites/x/Lists/L/Mine.aspx'));
    expect(t.items.some((i) => i.Kind === 'Draft')).toBe(true);
    expect(JSON.parse(sessionStorage.getItem(REOPEN_KEY)!)).toEqual({ listId: LIST, targetKey: `View:${V2}` });
  });

  it('reopens the remembered target after a navigation', async () => {
    sessionStorage.setItem(REOPEN_KEY, JSON.stringify({ listId: LIST, targetKey: 'Field:Status' }));
    const m = mount(tenant(), V2);
    await m.api.ready;
    expect(m.$('.ffx-title').textContent).toContain('Status');
  });

  it('follows a URL view change when a view target is open', async () => {
    const m = mount(tenant());
    await m.api.ready;
    m.api.setViewId(V2);
    await vi.waitFor(() => expect(m.$('.ffx-title').textContent).toContain('Mine'));
    expect(m.$(`.ffx-node[data-key="View:${V2}"]`).classList.contains('ffx-current')).toBe(true);
  });

  it('says so when the journal is per-tab only', async () => {
    const t = tenant();
    const failing = (async (url: string, init?: RequestInit) => (url.includes(JOURNAL_PATH) ? new Response('', { status: 403 }) : t.fetchImpl(url, init))) as unknown as typeof fetch;
    const m = mount(t, null, { fetchImpl: failing });
    await m.api.ready;
    expect(m.$('.ffx-banner').textContent).toContain('this browser tab only');
  });

  it('close stashes the draft, clears the reopen record and removes the host', async () => {
    const t = tenant();
    const onClose = vi.fn();
    const m = mount(t, null, { onClose });
    await m.api.ready;
    m.typeAndApply('{"elmType":"div","txtContent":"edited"}');
    await m.api.close();
    expect(t.items.some((i) => i.Kind === 'Draft')).toBe(true);
    expect(sessionStorage.getItem(REOPEN_KEY)).toBeNull();
    expect(document.getElementById(PANEL_HOST_ID)).toBeNull();
    expect(onClose).toHaveBeenCalled();
  });
});
