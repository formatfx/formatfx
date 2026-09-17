/**
 * rest.ts — the panel's SharePoint REST client. Same-origin fetch with the
 * page's cookies plus a request digest from POST /_api/contextinfo (spec §4,
 * §7.3): the digest is fetched lazily before the first write, reused, and
 * refreshed ONCE when a write comes back 403 "security validation".
 *
 * The fetch is injected so every caller is node-testable with a fake; the
 * default is the page's own fetch. This is the WRITE path of the product
 * (spec §7) — it lives here, never in src/bridge, whose extraction stays
 * read-only.
 */
const ACCEPT = 'application/json;odata=nometadata';
const SECURITY_VALIDATION = /security validation/i;

export class SpRestError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string, message: string) {
    super(message);
    this.name = 'SpRestError';
    this.status = status;
    this.body = body;
  }
}

export interface SpRest {
  readonly webUrl: string;
  getJson(path: string): Promise<Record<string, unknown>>;
  postJson(path: string, body: unknown, headers?: Record<string, string>): Promise<Record<string, unknown> | null>;
  merge(path: string, body: unknown): Promise<void>;
  del(path: string): Promise<void>;
}

/** Spec §7.7 — errors teach. */
export function explainHttp(status: number, body = ''): string {
  if (status === 403 && SECURITY_VALIDATION.test(body)) {
    return 'the request digest expired — it is refreshed automatically once; try the action again if this persists.';
  }
  if (status === 401 || status === 403) {
    return 'you need Manage Lists on this list (part of the default Edit level). Ask the site owner.';
  }
  if (status === 404) {
    return 'target not found — columns go by internal name, views by their id; the list may also have been deleted.';
  }
  return 'unexpected HTTP ' + status + ' — check the Network tab for the response body.';
}

export function createSpRest(webUrl: string, fetchImpl?: typeof fetch): SpRest {
  const f = fetchImpl ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a));
  const base = webUrl.replace(/\/+$/, '');
  let digest: string | null = null;

  const fail = async (res: Response): Promise<never> => {
    const body = await res.text().catch(() => '');
    throw new SpRestError(res.status, body, 'FormatFX: ' + explainHttp(res.status, body));
  };

  const fetchDigest = async (): Promise<string> => {
    const res = await f(base + '/_api/contextinfo', {
      method: 'POST', headers: { Accept: ACCEPT }, credentials: 'same-origin',
    });
    if (!res.ok) return fail(res);
    digest = ((await res.json()) as { FormDigestValue: string }).FormDigestValue;
    return digest;
  };

  const write = async (path: string, body: unknown, headers: Record<string, string>): Promise<Response> => {
    const send = async (): Promise<Response> => f(base + path, {
      method: 'POST',
      headers: {
        Accept: ACCEPT, 'Content-Type': ACCEPT,
        'X-RequestDigest': digest ?? (await fetchDigest()),
        ...headers,
      },
      credentials: 'same-origin',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let res = await send();
    if (res.status === 403 && SECURITY_VALIDATION.test(await res.clone().text().catch(() => ''))) {
      await fetchDigest();
      res = await send();
    }
    if (!res.ok) return fail(res);
    return res;
  };

  return {
    webUrl: base,
    async getJson(path) {
      const res = await f(base + path, { headers: { Accept: ACCEPT }, credentials: 'same-origin' });
      if (!res.ok) return fail(res);
      return (await res.json()) as Record<string, unknown>;
    },
    async postJson(path, body, headers = {}) {
      const res = await write(path, body, headers);
      const text = await res.text();
      return text ? (JSON.parse(text) as Record<string, unknown>) : null;
    },
    async merge(path, body) {
      await write(path, body, { 'X-HTTP-Method': 'MERGE', 'IF-MATCH': '*' });
    },
    async del(path) {
      await write(path, undefined, { 'X-HTTP-Method': 'DELETE', 'IF-MATCH': '*' });
    },
  };
}
