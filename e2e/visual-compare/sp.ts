/**
 * SharePoint REST helpers for the visual-compare harness. Every call runs
 * INSIDE the authenticated page via page.evaluate — the page's cookies are
 * the auth (there is no other kind: docs/CONNECTIVITY.md §1). Write requests
 * mirror src/bridge/deploySnippet.ts exactly (contextinfo digest → MERGE),
 * minus the confirm prompt: this rig only ever touches the sacrificial
 * SP_LIST, per the README ground rules.
 *
 * Plain fetch, zero dependencies, readable end to end — same auditability
 * bar as src/bridge.
 */
import type { Page } from '@playwright/test';

type Json = Record<string, unknown>;

const NOMETA = 'application/json;odata=nometadata';

/** GET under the page's session; returns { status, body } (body null on non-JSON). */
export async function spGet(page: Page, url: string): Promise<{ status: number; body: Json | null }> {
  return page.evaluate(async ({ url, accept }) => {
    const r = await fetch(url, { headers: { Accept: accept }, credentials: 'same-origin' });
    let body: Record<string, unknown> | null = null;
    try { body = await r.json(); } catch { /* non-JSON (e.g. 404 page) */ }
    return { status: r.status, body };
  }, { url, accept: NOMETA });
}

/** POST under the page's session with a fresh form digest; MERGE via method override. */
export async function spPost(
  page: Page, web: string, url: string, body: Json, merge = false,
): Promise<{ status: number; body: Json | null }> {
  return page.evaluate(async ({ web, url, body, merge, accept }) => {
    const d = await fetch(web + '/_api/contextinfo', {
      method: 'POST', headers: { Accept: accept }, credentials: 'same-origin',
    });
    if (!d.ok) throw new Error(`contextinfo failed (HTTP ${d.status}) — session expired? Re-run visual:auth.`);
    const digest = (await d.json()).FormDigestValue as string;
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': accept,
        'Content-Type': accept,
        'X-RequestDigest': digest,
        ...(merge ? { 'IF-MATCH': '*', 'X-HTTP-Method': 'MERGE' } : {}),
      },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });
    let resBody: Record<string, unknown> | null = null;
    try { resBody = await r.json(); } catch { /* MERGE returns 204 no body */ }
    return { status: r.status, body: resBody };
  }, { web, url, body, merge, accept: NOMETA });
}

/**
 * Ensure the sacrificial list exists with a Status choice column and the
 * given rows. Idempotent-ish: creates what's missing, adds rows only while
 * the list has fewer items than asked for (it never deletes).
 *
 * ⚠ first-live-run watch spot #1: field creation uses createfieldasxml with
 * a nometadata body — some tenants insist on odata=verbose here. If you get
 * HTTP 400, wrap the body as
 * { parameters: { __metadata: { type: 'SP.XmlSchemaFieldCreationInformation' }, SchemaXml } }
 * and switch both headers to application/json;odata=verbose for this call.
 */
export async function ensureList(
  page: Page, web: string, title: string, rows: ReadonlyArray<{ Title: string; Status: string }>,
): Promise<string> {
  const listUrl = `${web}/_api/web/lists/getByTitle('${encodeURIComponent(title)}')`;

  const probe = await spGet(page, `${listUrl}?$select=ItemCount`);
  if (probe.status === 404) {
    const made = await spPost(page, web, `${web}/_api/web/lists`, { Title: title, BaseTemplate: 100 });
    if (made.status >= 400) throw new Error(`Could not create list "${title}" (HTTP ${made.status}) — you need Manage Lists on the site.`);
    const choices = [...new Set(rows.map((r) => r.Status))]
      .map((c) => `<CHOICE>${c}</CHOICE>`).join('');
    const xml = `<Field Type="Choice" Name="Status" DisplayName="Status"><CHOICES>${choices}</CHOICES></Field>`;
    const field = await spPost(page, web, `${listUrl}/fields/createfieldasxml`, { parameters: { SchemaXml: xml } });
    if (field.status >= 400) throw new Error(`Could not add the Status column (HTTP ${field.status}) — see the watch-spot note in sp.ts.`);
    // show Status on the default view so the formatter has a cell to paint
    await spPost(page, web, `${listUrl}/defaultview/viewfields/addviewfield('Status')`, {});
  } else if (probe.status >= 400) {
    throw new Error(`Could not read list "${title}" (HTTP ${probe.status}).`);
  }

  const count = (probe.body?.ItemCount as number | undefined) ?? 0;
  if (count < rows.length) {
    for (const row of rows.slice(count)) {
      const added = await spPost(page, web, `${listUrl}/items`, row as unknown as Json);
      if (added.status >= 400) throw new Error(`Could not add a row (HTTP ${added.status}).`);
    }
  }
  return listUrl;
}

/** MERGE the fixture into the Status column's CustomFormatter (deploySnippet's write, step 4). */
export async function applyColumnFormatter(page: Page, web: string, listUrl: string, formatterJson: string): Promise<void> {
  const target = `${listUrl}/fields/getByInternalNameOrTitle('Status')`;
  const put = await spPost(page, web, target, { CustomFormatter: formatterJson }, true);
  if (put.status >= 400) throw new Error(`Formatter write failed (HTTP ${put.status}) — formatters need Manage Lists (part of Edit).`);
}
