import { describe, it, expect } from 'vitest';
import { createSpRest } from './rest';
import { listPath, targetPath, normalizeGuid, loadListShape, readFormatter, writeFormatter } from './targetIo';

const LIST = '{E481B50B-EBF9-4CBD-804F-A5276AFB23AB}';
const VIEW = 'f24ba2a8-1111-2222-3333-444444444444';
interface Call { url: string; init?: RequestInit }
function fake(routes: (url: string, init?: RequestInit) => unknown): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = routes(url, init);
    return typeof r === 'number' ? new Response('', { status: r }) : new Response(JSON.stringify(r), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}

describe('paths', () => {
  it('normalizes guids and builds list/target paths', () => {
    expect(normalizeGuid(LIST)).toBe('e481b50b-ebf9-4cbd-804f-a5276afb23ab');
    expect(listPath(LIST)).toBe("/_api/web/lists(guid'e481b50b-ebf9-4cbd-804f-a5276afb23ab')");
    expect(targetPath(LIST, { kind: 'Field', id: "O'Brien" })).toBe(listPath(LIST) + "/fields/getbyinternalnameortitle('O''Brien')");
    expect(targetPath(LIST, { kind: 'View', id: VIEW })).toBe(listPath(LIST) + `/views(guid'${VIEW}')`);
  });
});

describe('loadListShape', () => {
  it('maps fields and views the way captureSnapshot does, plus the view url', async () => {
    const { fetch, calls } = fake((url) => {
      if (url.includes('/fields?')) return { value: [{ InternalName: 'Status', Title: 'Status', TypeAsString: 'Choice', Choices: ['A', 'B'], CustomFormatter: '{"elmType":"div"}', ReadOnlyField: false, Hidden: false }] };
      if (url.includes('/views?')) return { value: [{ Title: 'All Items', Id: VIEW, DefaultView: true, CustomFormatter: '', ServerRelativeUrl: '/sites/x/Lists/L/AllItems.aspx', ViewFields: { Items: ['Title', 'Status'] } }] };
      throw new Error('unexpected ' + url);
    });
    const shape = await loadListShape(createSpRest('https://t/sites/x', fetch), LIST);
    expect(shape.fields[0]).toEqual({ internalName: 'Status', displayName: 'Status', type: 'Choice', choices: ['A', 'B'], lookupList: undefined, lookupColumn: undefined, readOnly: false, hidden: false, customFormatter: '{"elmType":"div"}' });
    expect(shape.views[0]).toEqual({ title: 'All Items', id: VIEW, isDefault: true, viewFields: ['Title', 'Status'], customFormatter: undefined, url: '/sites/x/Lists/L/AllItems.aspx' });
    expect(calls[0].url).toContain('$filter=Hidden eq false');
    expect(calls[1].url).toContain('ServerRelativeUrl');
  });
});

describe('read/write', () => {
  it('reads null for an empty formatter and writes "" to clear', async () => {
    const { fetch, calls } = fake((url) => (url.endsWith('/_api/contextinfo') ? { FormDigestValue: 'D' } : url.includes('?$select=CustomFormatter') ? { CustomFormatter: '' } : 204));
    const rest = createSpRest('https://t/sites/x', fetch);
    expect(await readFormatter(rest, LIST, { kind: 'Field', id: 'Status' })).toBeNull();
    await writeFormatter(rest, LIST, { kind: 'View', id: VIEW }, null);
    const w = calls[calls.length - 1];
    expect(w.url).toBe(`https://t/sites/x${listPath(LIST)}/views(guid'${VIEW}')`);
    expect((w.init?.headers as Record<string, string>)['X-HTTP-Method']).toBe('MERGE');
    expect(w.init?.body).toBe('{"CustomFormatter":""}');
  });
});

describe('HTML entities in a stored formatter', () => {
  // Owner smoke 2026-09-17: a formatter authored in SharePoint's own pane came
  // back from REST with &gt; where the native editor shows >. SharePoint
  // stores the entity and decodes it at render time, so the panel decodes on
  // read (both the tree's shape and the open target) and writes the raw
  // character back — the linter would otherwise flag every comparison.
  const ENC = '{"elmType":"div","txtContent":"=if([$Amount] &gt; 5 &amp;&amp; [$Flag], &quot;hi&quot;, &apos;&lt;&apos;)"}';
  const DEC = '{"elmType":"div","txtContent":"=if([$Amount] > 5 && [$Flag], "hi", \'<\')"}';
  it('readFormatter decodes them', async () => {
    const { fetch } = fake((url) => (url.includes('?$select=CustomFormatter') ? { CustomFormatter: ENC } : 404));
    const rest = createSpRest('https://t/sites/x', fetch);
    expect(await readFormatter(rest, LIST, { kind: 'Field', id: 'Amount' })).toBe(DEC);
  });
  it('loadListShape decodes field and view formatters alike', async () => {
    const { fetch } = fake((url) => {
      if (url.includes('/fields?')) return { value: [{ InternalName: 'Amount', Title: 'Amount', TypeAsString: 'Number', CustomFormatter: ENC, ReadOnlyField: false, Hidden: false }] };
      if (url.includes('/views?')) return { value: [{ Title: 'All Items', Id: VIEW, DefaultView: true, CustomFormatter: ENC, ServerRelativeUrl: '/sites/x/Lists/L/AllItems.aspx', ViewFields: { Items: ['Amount'] } }] };
      return 404;
    });
    const shape = await loadListShape(createSpRest('https://t/sites/x', fetch), LIST);
    expect(shape.fields[0].customFormatter).toBe(DEC);
    expect(shape.views[0].customFormatter).toBe(DEC);
  });
});
