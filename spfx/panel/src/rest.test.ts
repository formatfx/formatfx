import { describe, it, expect } from 'vitest';
import { createSpRest, explainHttp, SpRestError } from './rest';

interface Call { url: string; init?: RequestInit }

/** A fake fetch: `routes` maps (url, init) → status number | JSON body | { __status, body }. */
function fakeFetch(routes: (url: string, init?: RequestInit) => unknown): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = routes(url, init);
    if (typeof r === 'number') return new Response('', { status: r });
    if (r && typeof r === 'object' && '__status' in (r as Record<string, unknown>)) {
      const b = r as { __status: number; body?: string };
      return new Response(b.body ?? '', { status: b.__status });
    }
    return new Response(JSON.stringify(r), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}
const hdr = (c: Call, name: string): string | undefined => (c.init?.headers as Record<string, string> | undefined)?.[name];

describe('createSpRest', () => {
  it('GETs with the nometadata Accept header and same-origin cookies', async () => {
    const { fetch, calls } = fakeFetch(() => ({ value: [1] }));
    const rest = createSpRest('https://t.sharepoint.com/sites/x/', fetch);
    expect(await rest.getJson('/_api/web/lists')).toEqual({ value: [1] });
    expect(calls[0].url).toBe('https://t.sharepoint.com/sites/x/_api/web/lists');
    expect(hdr(calls[0], 'Accept')).toBe('application/json;odata=nometadata');
    expect(calls[0].init?.credentials).toBe('same-origin');
    expect(calls[0].init?.method).toBeUndefined();
  });

  it('fetches ONE digest lazily before the first write and reuses it', async () => {
    const { fetch, calls } = fakeFetch((url) => (url.endsWith('/_api/contextinfo') ? { FormDigestValue: 'D1' } : { Id: 5 }));
    const rest = createSpRest('https://t.sharepoint.com/sites/x', fetch);
    expect(await rest.postJson('/_api/web/lists/getbytitle(\'FormatFX\')/items', { Title: 'a' })).toEqual({ Id: 5 });
    await rest.merge('/_api/web/lists/getbytitle(\'FormatFX\')/items(5)', { Kind: 'Applied' });
    const digests = calls.filter((c) => c.url.endsWith('/_api/contextinfo'));
    expect(digests).toHaveLength(1);
    expect(digests[0].init?.method).toBe('POST');
    const post = calls[1];
    expect(hdr(post, 'X-RequestDigest')).toBe('D1');
    expect(hdr(post, 'Content-Type')).toBe('application/json;odata=nometadata');
    expect(post.init?.body).toBe('{"Title":"a"}');
    const merge = calls[2];
    expect(hdr(merge, 'X-HTTP-Method')).toBe('MERGE');
    expect(hdr(merge, 'IF-MATCH')).toBe('*');
  });

  it('refreshes the digest once on a 403 "security validation" and retries that write', async () => {
    let n = 0;
    const { fetch, calls } = fakeFetch((url, init) => {
      if (url.endsWith('/_api/contextinfo')) return { FormDigestValue: 'D' + (++n) };
      if (init?.method === 'POST' && (init.headers as Record<string, string>)['X-RequestDigest'] === 'D1') {
        return { __status: 403, body: '{"odata.error":{"message":{"value":"The security validation for this page is invalid and might be corrupted."}}}' };
      }
      return 204;
    });
    const rest = createSpRest('https://t.sharepoint.com/sites/x', fetch);
    await rest.merge('/_api/web/lists(guid\'a\')/fields/getbyinternalnameortitle(\'Status\')', { CustomFormatter: '{}' });
    const writes = calls.filter((c) => c.init?.method === 'POST' && !c.url.endsWith('/_api/contextinfo'));
    expect(writes.map((c) => hdr(c, 'X-RequestDigest'))).toEqual(['D1', 'D2']);
  });

  it('DELETEs through X-HTTP-Method with no body', async () => {
    const { fetch, calls } = fakeFetch((url) => (url.endsWith('/_api/contextinfo') ? { FormDigestValue: 'D' } : 204));
    const rest = createSpRest('https://t.sharepoint.com/sites/x', fetch);
    await rest.del('/_api/web/lists/getbytitle(\'FormatFX\')/items(3)');
    const d = calls[1];
    expect(hdr(d, 'X-HTTP-Method')).toBe('DELETE');
    expect(d.init?.body).toBeUndefined();
  });

  it('throws a teaching SpRestError on failure', async () => {
    const { fetch } = fakeFetch(() => 403);
    const rest = createSpRest('https://t.sharepoint.com/sites/x', fetch);
    const err = await rest.getJson('/_api/web/lists').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SpRestError);
    expect((err as SpRestError).status).toBe(403);
    expect((err as SpRestError).message).toContain('Manage Lists');
  });
});

describe('explainHttp', () => {
  it('teaches per status (spec §7.7)', () => {
    expect(explainHttp(401)).toContain('Manage Lists');
    expect(explainHttp(403, 'security validation')).toContain('digest');
    expect(explainHttp(404)).toContain('internal name');
    expect(explainHttp(500)).toContain('HTTP 500');
  });
});
