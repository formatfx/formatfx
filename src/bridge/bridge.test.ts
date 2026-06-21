import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildExtractSnippet, EXPAND_CAP } from './extractSnippet';
import { buildDeploySnippet } from './deploySnippet';
import {
  buildApplyPayload, parseApplyPayload, serializeApplyPayload, APPLY_PAYLOAD_VERSION,
} from './applyPayload';
import {
  captureSnapshot, applyFormatters, selectFromSnapshot, detectCurrentViewId,
  type ApplyHooks, type ListSnapshot,
} from './spClient';
import {
  isPageToExt, isExtToPage, pingMessage, stageApplyMessage, ackMessage,
  readyMessage, snapshotMessage, validateStagedPayload, EXT_CHANNEL_VERSION,
} from './extChannel';
import { importSchema } from '../core/schemaImport';
import type { PersonValue, LookupValue } from '../core/types';

/**
 * The contract here is stronger than string assertions: the GENERATED
 * snippets are executed against stubbed fetch/_spPageContextInfo/clipboard
 * fixtures, and the extract snippet's captured payload is fed straight back
 * through importSchema() — a generator → parser round trip, fully headless.
 */

interface FetchCall { url: string; init?: RequestInit }

const PAGE_CTX = {
  webAbsoluteUrl: 'https://contoso.sharepoint.com/sites/team',
  pageListId: '{11111111-2222-3333-4444-555555555555}',
  listTitle: 'Tasks',
};

const STATUS_FORMATTER = JSON.stringify({
  elmType: 'div', txtContent: '@currentField',
  style: { 'background-color': "=if(@currentField=='Done','#107c10','#737a7f')" },
});
const VIEW_FORMATTER = JSON.stringify({
  $schema: 'https://developer.microsoft.com/json-schemas/sp/view-formatting.schema.json',
  rowFormatter: { elmType: 'div', txtContent: '[$Title]' },
});

const FIELDS_RES = {
  value: [
    { InternalName: 'Title', Title: 'Task name', TypeAsString: 'Text', ReadOnlyField: false, Hidden: false },
    {
      InternalName: 'Status', Title: 'Status', TypeAsString: 'Choice',
      Choices: ['Not started', 'Done'], CustomFormatter: STATUS_FORMATTER,
      ReadOnlyField: false, Hidden: false,
    },
    { InternalName: 'DueDate', Title: 'Due', TypeAsString: 'DateTime', ReadOnlyField: false, Hidden: false },
    { InternalName: 'AssignedTo', Title: 'Assigned to', TypeAsString: 'UserMulti', ReadOnlyField: false, Hidden: false },
    {
      InternalName: 'Project', Title: 'Project', TypeAsString: 'Lookup',
      LookupList: '{99999999-aaaa-bbbb-cccc-dddddddddddd}', LookupField: 'Title',
      ReadOnlyField: false, Hidden: false,
    },
    { InternalName: 'Done', Title: 'Done?', TypeAsString: 'Boolean', ReadOnlyField: false, Hidden: false },
  ],
};

const VIEWS_RES = {
  value: [
    {
      Title: 'All Items', Id: 'view-1', DefaultView: true,
      CustomFormatter: VIEW_FORMATTER, ViewFields: { Items: ['LinkTitle', 'Status'] },
    },
    { Title: 'Board', Id: 'view-2', DefaultView: false, ViewFields: { Items: ['Status'] } },
  ],
};

const ITEMS_RES = {
  value: [
    {
      Title: 'Launch intranet', Status: 'Done', DueDate: '2026-06-20T07:00:00Z',
      AssignedTo: [{ Id: 7, Title: 'Ada Lovelace', EMail: 'ada@contoso.com' }],
      Project: { Id: 3, Title: 'Apollo' }, Done: true,
    },
    {
      Title: 'Migrate shares', Status: 'Not started', DueDate: null,
      AssignedTo: [], Project: null, Done: false,
    },
  ],
};

let calls: FetchCall[] = [];
let clipboard: string | null = null;

function stubEnvironment(opts: {
  routes: (url: string, init?: RequestInit) => unknown;
  confirmResult?: boolean;
  confirmSink?: string[];
  pageCtx?: Record<string, unknown> | null;
  clipboardFails?: boolean;
}): void {
  calls = [];
  clipboard = null;
  const ctx = opts.pageCtx === undefined ? PAGE_CTX : opts.pageCtx;
  vi.stubGlobal('_spPageContextInfo', ctx ?? undefined);
  (window as unknown as Record<string, unknown>)['_spPageContextInfo'] = ctx ?? undefined;
  vi.stubGlobal('confirm', (m: string) => { opts.confirmSink?.push(m); return opts.confirmResult ?? true; });
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const body = opts.routes(url, init);
    if (typeof body === 'number') return new Response('', { status: body });
    return new Response(JSON.stringify(body), { status: 200 });
  });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (t: string) => {
        if (opts.clipboardFails) throw new Error('denied');
        clipboard = t;
      },
    },
  });
}

afterEach(() => vi.unstubAllGlobals());

const run = (snippet: string): Promise<unknown> => (0, eval)(snippet) as Promise<unknown>;

const extractRoutes = (url: string): unknown => {
  if (url.includes('/fields?')) return FIELDS_RES;
  if (url.includes('/views?')) return VIEWS_RES;
  if (url.includes('/items?')) return ITEMS_RES;
  throw new Error(`unexpected fetch: ${url}`);
};

describe('extract snippet', () => {
  it('is GET-only by construction (string contract)', () => {
    const s = buildExtractSnippet();
    expect(s).toContain('READ-ONLY');
    expect(s).not.toContain('X-HTTP-Method');
    expect(s).not.toMatch(/method:\s*'POST'/);
    expect(s).toContain('/fields?');
    expect(s).toContain('$top=10');
  });

  it('executes: captures the list, copies the payload, never sends a write', async () => {
    stubEnvironment({ routes: extractRoutes });
    const payload = await run(buildExtractSnippet()) as Record<string, unknown>;
    expect(payload.formatfx).toBe('list-snapshot');
    expect(payload.version).toBe(1);
    expect(clipboard).not.toBeNull();
    // every actual request was a plain GET against the page's own list
    for (const c of calls) expect(c.init?.method).toBeUndefined();
    expect(calls[0].url).toContain("lists(guid'11111111-2222-3333-4444-555555555555')");
  });

  it('round-trips: the captured payload imports through importSchema()', async () => {
    stubEnvironment({ routes: extractRoutes });
    await run(buildExtractSnippet());
    const schema = importSchema(clipboard!);

    expect(schema.listName).toBe('Tasks');
    expect(schema.fields.map((f) => f.name))
      .toEqual(['Title', 'Status', 'DueDate', 'AssignedTo', 'Project', 'Done']);
    const status = schema.fields.find((f) => f.name === 'Status')!;
    expect(status.type).toBe('choice');
    expect(status.choices).toEqual(['Not started', 'Done']);
    // the live column formatter arrives parsed and registered
    expect(schema.columnFormatters?.Status?.elmType).toBe('div');
    // views arrive with the row formatter kept as raw text
    expect(schema.views).toHaveLength(2);
    expect(schema.views![0].isDefault).toBe(true);
    expect(schema.views![0].customFormatter).toBe(VIEW_FORMATTER);
    // OData row shapes are coerced into the mock-data model
    const row = schema.rows![0];
    expect((row.AssignedTo as PersonValue[])[0]).toEqual({ title: 'Ada Lovelace', email: 'ada@contoso.com' });
    expect(row.Project as LookupValue).toEqual({ lookupId: 3, lookupValue: 'Apollo' });
    expect(row.Done).toBe(true);
    // blank date stays null; empty multi stays []
    expect(schema.rows![1].DueDate).toBeNull();
    expect(schema.rows![1].AssignedTo).toEqual([]);
  });

  it(`caps $expand at ${EXPAND_CAP} and the import gap-fills the columns beyond it`, async () => {
    const many = {
      value: Array.from({ length: 16 }, (_, i) => ({
        InternalName: `P${i}`, Title: `P${i}`, TypeAsString: 'User',
        ReadOnlyField: false, Hidden: false,
      })),
    };
    stubEnvironment({
      routes: (url) => {
        if (url.includes('/fields?')) return many;
        if (url.includes('/views?')) return { value: [] };
        if (url.includes('/items?')) {
          const expands = /\$expand=([^&]*)/.exec(url)?.[1]?.split(',') ?? [];
          expect(expands.length).toBeLessThanOrEqual(EXPAND_CAP);
          // SP returns only what was selected — capped-out columns are absent
          return { value: [{ P0: [{ Id: 1, Title: 'Ada', EMail: 'a@c.com' }] }] };
        }
        throw new Error(`unexpected fetch: ${url}`);
      },
    });
    await run(buildExtractSnippet());
    const schema = importSchema(clipboard!);
    // P15 was beyond the cap: absent from the row, gap-filled at import
    expect(schema.rows![0]['P15']).toBeDefined();
  });

  it('teaches when run outside a list page; falls back to console when clipboard is blocked', async () => {
    stubEnvironment({ routes: extractRoutes, pageCtx: { webAbsoluteUrl: PAGE_CTX.webAbsoluteUrl } });
    await expect(run(buildExtractSnippet())).rejects.toThrow(/no list on this page/);

    stubEnvironment({ routes: extractRoutes, clipboardFails: true });
    const logs: string[] = [];
    const orig = console.log;
    console.log = (m: unknown) => { logs.push(String(m)); };
    try {
      await run(buildExtractSnippet());
    } finally {
      console.log = orig;
    }
    expect(logs.join('\n')).toContain('FORMATFX SNAPSHOT START');
  });

  it('a baked list title targets that list, apostrophes doubled for REST', async () => {
    stubEnvironment({ routes: extractRoutes });
    await run(buildExtractSnippet({ listTitle: "Bob's Tasks" }));
    expect(calls[0].url).toContain("getByTitle('Bob''s%20Tasks')");
  });
});

describe('deploy snippet', () => {
  const deployRoutes = (url: string, init?: RequestInit): unknown => {
    if (url.includes('/_api/contextinfo')) return { FormDigestValue: 'digest-123' };
    if (init?.method === 'POST') return 204; // the MERGE
    if (url.includes('CustomFormatter')) return { CustomFormatter: '' };
    throw new Error(`unexpected fetch: ${url}`);
  };

  it('bakes the formatter and the ceremony into the string', () => {
    const s = buildDeploySnippet({ target: 'field', name: 'Status', formatterJson: STATUS_FORMATTER });
    expect(s).toContain('X-HTTP-Method');
    expect(s).toContain('MERGE');
    expect(s).toContain('contextinfo');
    expect(s).toContain(JSON.stringify(STATUS_FORMATTER)); // double-encoded payload
    expect(s).toContain("getByInternalNameOrTitle('Status')");
  });

  it('neutralizes a comment-break sequence in the target name (no code injection)', () => {
    // A crafted view title (free text, attacker-influenceable on a shared list)
    // must not close the snippet's /* ... */ banner early and turn the trailing
    // text into executable JS in the maker's authenticated console.
    const evil = 'Sprint */;globalThis.__pwned=1;/*';
    const s = buildDeploySnippet({ target: 'view', name: evil, formatterJson: '{}' });
    // The banner runs to its real terminator: its 'Permissions:' line appears
    // BEFORE the first '*/' in the snippet (the banner's own close).
    expect(s.indexOf('Permissions:')).toBeLessThan(s.indexOf('*/'));
    // The payload never appears as an un-commented, executable sequence.
    expect(s).not.toContain('*/;globalThis.__pwned=1');
  });

  it('executes: digest before MERGE, right headers, right body, verify after', async () => {
    stubEnvironment({ routes: deployRoutes });
    const result = await run(buildDeploySnippet({
      target: 'field', name: 'Status', formatterJson: STATUS_FORMATTER,
    })) as Record<string, unknown>;
    expect(result.applied).toBe(true);

    const merge = calls.find((c) => (c.init?.headers as Record<string, string>)?.['X-HTTP-Method'] === 'MERGE')!;
    const digestCall = calls.find((c) => c.url.includes('contextinfo'))!;
    expect(calls.indexOf(digestCall)).toBeLessThan(calls.indexOf(merge));
    const headers = merge.init!.headers as Record<string, string>;
    expect(headers['X-RequestDigest']).toBe('digest-123');
    expect(headers['IF-MATCH']).toBe('*');
    expect(JSON.parse(merge.init!.body as string)).toEqual({ CustomFormatter: STATUS_FORMATTER });
  });

  it('confirm = cancel means zero writes', async () => {
    stubEnvironment({ routes: deployRoutes, confirmResult: false });
    const result = await run(buildDeploySnippet({
      target: 'field', name: 'Status', formatterJson: STATUS_FORMATTER,
    })) as Record<string, unknown>;
    expect(result.applied).toBe(false);
    expect(calls).toHaveLength(1); // only the look-before-write GET
  });

  it('403 on the write surfaces the permissions lesson', async () => {
    stubEnvironment({
      routes: (url, init) => {
        if (url.includes('contextinfo')) return { FormDigestValue: 'd' };
        if (init?.method === 'POST') return 403;
        return { CustomFormatter: '' };
      },
    });
    await expect(run(buildDeploySnippet({
      target: 'field', name: 'Status', formatterJson: STATUS_FORMATTER,
    }))).rejects.toThrow(/Manage Lists/);
  });

  it('view targets go by title', async () => {
    stubEnvironment({ routes: deployRoutes });
    await run(buildDeploySnippet({ target: 'view', name: 'All Items', formatterJson: VIEW_FORMATTER }));
    expect(calls[0].url).toContain("views/getByTitle('All%20Items')");
  });

  it('clobber guard: overwriting an EXISTING view formatter warns about the whole-view replace', async () => {
    const sink: string[] = [];
    stubEnvironment({
      routes: (url, init) => {
        if (url.includes('/_api/contextinfo')) return { FormDigestValue: 'd' };
        if (init?.method === 'POST') return 204;
        if (url.includes('CustomFormatter')) return { CustomFormatter: '{"rowFormatter":{"elmType":"div"}}' }; // a foreign formatter is already there
        throw new Error(`unexpected fetch: ${url}`);
      },
      confirmSink: sink,
    });
    await run(buildDeploySnippet({ target: 'view', name: 'All Items', formatterJson: VIEW_FORMATTER }));
    expect(sink).toHaveLength(1);
    expect(sink[0]).toContain('REPLACES THE ENTIRE view formatter');
  });

  it('clobber guard: a column deploy over existing content gets the mild field-level prompt, not the view warning', async () => {
    const sink: string[] = [];
    stubEnvironment({
      routes: (url, init) => {
        if (url.includes('/_api/contextinfo')) return { FormDigestValue: 'd' };
        if (init?.method === 'POST') return 204;
        if (url.includes('CustomFormatter')) return { CustomFormatter: STATUS_FORMATTER };
        throw new Error(`unexpected fetch: ${url}`);
      },
      confirmSink: sink,
    });
    await run(buildDeploySnippet({ target: 'field', name: 'Status', formatterJson: STATUS_FORMATTER }));
    expect(sink[0]).toContain('it will be REPLACED');
    expect(sink[0]).not.toContain('ENTIRE view');
  });

  it('clobber guard: a brand-new (empty) view target is NOT a clobber', async () => {
    const sink: string[] = [];
    stubEnvironment({ routes: deployRoutes, confirmSink: sink }); // deployRoutes returns empty CustomFormatter
    await run(buildDeploySnippet({ target: 'view', name: 'All Items', formatterJson: VIEW_FORMATTER }));
    expect(sink[0]).toContain('no formatter');
    expect(sink[0]).not.toContain('ENTIRE view');
  });
});

describe('apply payload (extension wire format)', () => {
  it('builds v1, preserves target order, refuses an empty set', () => {
    const p = buildApplyPayload([
      { target: 'field', name: 'Status', formatterJson: STATUS_FORMATTER },
      { target: 'view', name: 'All Items', formatterJson: VIEW_FORMATTER },
    ]);
    expect(p.formatfx).toBe('apply');
    expect(p.version).toBe(APPLY_PAYLOAD_VERSION);
    expect(p.targets.map((t) => t.name)).toEqual(['Status', 'All Items']);
    expect(() => buildApplyPayload([])).toThrow(/at least one/);
  });

  it('round-trips through serialize → parse', () => {
    const p = buildApplyPayload([{ target: 'field', name: 'Status', formatterJson: STATUS_FORMATTER }], {
      listTitle: 'Tasks',
    });
    const back = parseApplyPayload(serializeApplyPayload(p));
    expect(back.listTitle).toBe('Tasks');
    expect(back.targets[0]).toEqual({ target: 'field', name: 'Status', formatterJson: STATUS_FORMATTER });
  });

  it('refuses a newer version (friendly, never a silent misread)', () => {
    const future = JSON.stringify({ formatfx: 'apply', version: APPLY_PAYLOAD_VERSION + 1, targets: [] });
    expect(() => parseApplyPayload(future)).toThrow(/newer than this extension understands/);
  });

  it('every malformed input is a teaching error', () => {
    expect(() => parseApplyPayload('not json')).toThrow(/not FormatFX apply data/);
    expect(() => parseApplyPayload(JSON.stringify({ formatfx: 'list-snapshot', version: 1 }))).toThrow(/no "apply" marker/);
    expect(() => parseApplyPayload(JSON.stringify({ formatfx: 'apply', version: 1, targets: [] }))).toThrow(/no targets/);
    expect(() => parseApplyPayload(JSON.stringify({
      formatfx: 'apply', version: 1, targets: [{ target: 'column', name: 'X', formatterJson: '{}' }],
    }))).toThrow(/neither a column nor a view/);
    expect(() => parseApplyPayload(JSON.stringify({
      formatfx: 'apply', version: 1, targets: [{ target: 'field', name: '', formatterJson: '{}' }],
    }))).toThrow(/missing a column\/view name/);
    expect(() => parseApplyPayload(JSON.stringify({
      formatfx: 'apply', version: 1, targets: [{ target: 'field', name: 'Status' }],
    }))).toThrow(/carries no formatter/);
  });
});

describe('spClient.captureSnapshot (extension runtime)', () => {
  it('captures GET-only and round-trips through importSchema()', async () => {
    stubEnvironment({ routes: extractRoutes });
    const snap = await captureSnapshot();
    expect(snap.formatfx).toBe('list-snapshot');
    expect(snap.version).toBe(1);
    for (const c of calls) expect(c.init?.method).toBeUndefined(); // every request a plain GET
    expect(calls[0].url).toContain("lists(guid'11111111-2222-3333-4444-555555555555')");

    const schema = importSchema(JSON.stringify(snap));
    expect(schema.listName).toBe('Tasks');
    expect(schema.fields.map((f) => f.name))
      .toEqual(['Title', 'Status', 'DueDate', 'AssignedTo', 'Project', 'Done']);
    expect(schema.columnFormatters?.Status?.elmType).toBe('div');
    expect(schema.views![0].customFormatter).toBe(VIEW_FORMATTER);
  });

  it('teaches when run off a SharePoint page', async () => {
    stubEnvironment({ routes: extractRoutes, pageCtx: null });
    await expect(captureSnapshot()).rejects.toThrow(/SharePoint page/);
  });
});

describe('spClient.applyFormatters (extension runtime)', () => {
  const okConfirm = (sink?: string[]): ApplyHooks => ({
    confirm: (m: string) => { sink?.push(m); return true; },
  });
  const applyRoutes = (url: string, init?: RequestInit): unknown => {
    if (url.includes('/_api/contextinfo')) return { FormDigestValue: 'digest-123' };
    if ((init?.headers as Record<string, string>)?.['X-HTTP-Method'] === 'MERGE') return 204;
    if (url.includes('CustomFormatter')) return { CustomFormatter: '' };
    throw new Error(`unexpected fetch: ${url}`);
  };
  const batch = () => buildApplyPayload([
    { target: 'field', name: 'Status', formatterJson: STATUS_FORMATTER },
    { target: 'view', name: 'All Items', formatterJson: VIEW_FORMATTER },
  ]);

  it('one confirm lists every target; digest precedes the MERGEs; bodies are right', async () => {
    stubEnvironment({ routes: applyRoutes });
    const prompts: string[] = [];
    const outcomes = await applyFormatters(batch(), okConfirm(prompts));

    expect(outcomes.every((o) => o.applied)).toBe(true);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('column [Status]');
    expect(prompts[0]).toContain('view "All Items"');

    const merges = calls.filter((c) => (c.init?.headers as Record<string, string>)?.['X-HTTP-Method'] === 'MERGE');
    expect(merges).toHaveLength(2);
    const digestCall = calls.find((c) => c.url.includes('contextinfo'))!;
    expect(calls.indexOf(digestCall)).toBeLessThan(calls.indexOf(merges[0]));
    expect(JSON.parse(merges[0].init!.body as string)).toEqual({ CustomFormatter: STATUS_FORMATTER });
    expect(JSON.parse(merges[1].init!.body as string)).toEqual({ CustomFormatter: VIEW_FORMATTER });
  });

  it('a declined confirm writes nothing', async () => {
    stubEnvironment({ routes: applyRoutes });
    const outcomes = await applyFormatters(batch(), { confirm: () => false });
    expect(outcomes.every((o) => !o.applied)).toBe(true);
    expect(calls.some((c) => (c.init?.headers as Record<string, string>)?.['X-HTTP-Method'] === 'MERGE')).toBe(false);
  });

  it('a per-target 403 is reported but its siblings still apply', async () => {
    stubEnvironment({
      routes: (url, init) => {
        if (url.includes('contextinfo')) return { FormDigestValue: 'd' };
        if ((init?.headers as Record<string, string>)?.['X-HTTP-Method'] === 'MERGE') {
          return url.includes("getByInternalNameOrTitle('Status')") ? 403 : 204;
        }
        return { CustomFormatter: '' };
      },
    });
    const outcomes = await applyFormatters(batch(), okConfirm());
    const status = outcomes.find((o) => o.name === 'Status')!;
    const view = outcomes.find((o) => o.name === 'All Items')!;
    expect(status.applied).toBe(false);
    expect(status.error).toMatch(/Manage Lists/);
    expect(view.applied).toBe(true);
  });

  it('a stale digest (412) is refreshed once and the write retried', async () => {
    let merges = 0;
    let digests = 0;
    stubEnvironment({
      routes: (url, init) => {
        if (url.includes('contextinfo')) { digests++; return { FormDigestValue: 'd' + digests }; }
        if ((init?.headers as Record<string, string>)?.['X-HTTP-Method'] === 'MERGE') {
          merges++; return merges === 1 ? 412 : 204;
        }
        return { CustomFormatter: '' };
      },
    });
    const single = buildApplyPayload([{ target: 'field', name: 'Status', formatterJson: STATUS_FORMATTER }]);
    const outcomes = await applyFormatters(single, okConfirm());
    expect(outcomes[0].applied).toBe(true);
    expect(merges).toBe(2);
    expect(digests).toBe(2); // initial + one refresh
  });

  it('a cross-list payload resolves the named list by title', async () => {
    stubEnvironment({ routes: applyRoutes });
    const p = buildApplyPayload([{ target: 'field', name: 'Status', formatterJson: STATUS_FORMATTER }], {
      listTitle: "Bob's Tasks",
    });
    await applyFormatters(p, okConfirm());
    expect(calls[0].url).toContain("lists/getByTitle('Bob''s%20Tasks')");
  });
});

describe('extChannel (page ↔ extension protocol)', () => {
  it('guards accept their own direction and reject foreign/garbage messages', () => {
    expect(isPageToExt(pingMessage('a'))).toBe(true);
    expect(isPageToExt(stageApplyMessage('b', buildApplyPayload([
      { target: 'field', name: 'Status', formatterJson: STATUS_FORMATTER },
    ])))).toBe(true);
    expect(isExtToPage(readyMessage())).toBe(true);
    expect(isExtToPage(ackMessage('b', { ok: true, staged: 1 }))).toBe(true);

    // wrong direction, wrong channel, and non-objects are all rejected
    expect(isPageToExt(readyMessage())).toBe(false);
    expect(isExtToPage(pingMessage('a'))).toBe(false);
    expect(isPageToExt({ channel: 'someone-else', dir: 'page->ext', kind: 'ping', id: 'x' })).toBe(false);
    expect(isPageToExt(null)).toBe(false);
    expect(isPageToExt({ channel: 'formatfx-channel', dir: 'page->ext', kind: 'ping' })).toBe(false); // no id
  });

  it('readyMessage carries the protocol version', () => {
    expect(readyMessage().version).toBe(EXT_CHANNEL_VERSION);
  });

  it('validateStagedPayload re-checks an off-the-wire object with the real parser', () => {
    const good = buildApplyPayload([{ target: 'field', name: 'Status', formatterJson: STATUS_FORMATTER }]);
    expect(validateStagedPayload(good).targets[0].name).toBe('Status');

    // the same teaching refusals as the clipboard path, now over the channel
    expect(() => validateStagedPayload({ formatfx: 'apply', version: 1, targets: [] })).toThrow(/no targets/);
    expect(() => validateStagedPayload({ formatfx: 'apply', version: EXT_CHANNEL_VERSION + 99, targets: [] }))
      .toThrow(/newer than this extension understands/);
    expect(() => validateStagedPayload({ nope: true })).toThrow(/not a FormatFX apply payload/);
  });

  it('snapshotMessage is an ext→page message carrying raw text', () => {
    const m = snapshotMessage('{"formatfx":"list-snapshot"}');
    expect(isExtToPage(m)).toBe(true);
    expect(isPageToExt(m)).toBe(false);
    expect(m.kind).toBe('snapshot');
    expect(m.text).toContain('list-snapshot');
  });
});

describe('extract-push selection (spClient)', () => {
  const SNAP: ListSnapshot = {
    formatfx: 'list-snapshot', version: 1, capturedAt: 't', siteUrl: 's',
    fields: [
      { internalName: 'Title', displayName: 'Task', type: 'Text', readOnly: false, hidden: false },
      { internalName: 'Status', displayName: 'Status', type: 'Choice', readOnly: false, hidden: false, customFormatter: STATUS_FORMATTER },
    ],
    views: [
      { title: 'All Items', id: 'v1', isDefault: true, viewFields: ['Title'], customFormatter: VIEW_FORMATTER },
      { title: 'Board', id: 'v2', isDefault: false, viewFields: ['Status'] },
    ],
    rows: [{ Title: 'a', Status: 'Done' }, { Title: 'b', Status: 'New' }],
    currentViewId: 'v2',
  };

  it('keeps only the chosen columns and their row cells, and drops views when unticked', () => {
    const out = selectFromSnapshot(SNAP, { fieldNames: ['Status'], includeCurrentView: false });
    expect(out.fields.map((f) => f.internalName)).toEqual(['Status']);
    expect(out.rows).toEqual([{ Status: 'Done' }, { Status: 'New' }]);
    expect(out.views).toEqual([]);
  });

  it('includes just the current view, flagged isDefault so it auto-loads', () => {
    const out = selectFromSnapshot(SNAP, { fieldNames: ['Title', 'Status'], includeCurrentView: true });
    expect(out.views).toHaveLength(1);
    expect(out.views[0].title).toBe('Board');     // the current view (v2), not the default
    expect(out.views[0].isDefault).toBe(true);
  });

  it('falls back to the default view when no current view is known', () => {
    const out = selectFromSnapshot({ ...SNAP, currentViewId: undefined }, { fieldNames: ['Title'], includeCurrentView: true });
    expect(out.views[0].title).toBe('All Items');
  });

  it('detectCurrentViewId reads ?viewid=, else the default view', () => {
    expect(detectCurrentViewId(SNAP.views)).toBe('v1'); // no URL in node → default
    vi.stubGlobal('location', { search: '?env=WebView&viewid=V2' });
    expect(detectCurrentViewId(SNAP.views)).toBe('v2'); // matched, case-insensitive
  });
});
