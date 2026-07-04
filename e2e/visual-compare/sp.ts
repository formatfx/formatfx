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
import type { ProvisionPlan } from './workspace';

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
 * Provision the sacrificial list FROM SCRATCH out of a workspace plan:
 * delete any previous run's list, recreate it, create every creatable
 * column, add the data rows, MERGE each column formatter onto its field,
 * and put the view formatter on a SECOND view ("FormatFX View Compare") so
 * the default view keeps SharePoint's native cell DOM for symmetric
 * per-cell crops.
 *
 * DESTRUCTIVE BY DESIGN toward SP_LIST — the README's "sacrificial list"
 * rule is load-bearing. Nothing else on the site is touched.
 *
 * ⚠ first-live-run watch spot #1: field creation uses createfieldasxml with
 * a nometadata body — some tenants insist on odata=verbose here. If you get
 * HTTP 400, wrap the body as
 * { parameters: { __metadata: { type: 'SP.XmlSchemaFieldCreationInformation' }, SchemaXml } }
 * and switch both headers to application/json;odata=verbose for this call.
 */
export interface ProvisionResult {
  listUrl: string;
  defaultViewUrl: string;
  /** Server-relative URL of the view carrying the view formatter. */
  formatterViewUrl: string;
  notes: string[];
}

export async function provisionList(
  page: Page, web: string, title: string, plan: ProvisionPlan,
): Promise<ProvisionResult> {
  const notes: string[] = plan.skipped.map((s) => `skipped ${s.name}: ${s.reason}`);
  const listUrl = `${web}/_api/web/lists/getByTitle('${encodeURIComponent(title)}')`;

  // a previous run's list starts every run from zero — sacrificial by contract
  const existing = await spGet(page, `${listUrl}?$select=Id`);
  if (existing.status === 200) {
    const gone = await spPost(page, web, `${listUrl}/deleteObject`, {});
    if (gone.status >= 400) throw new Error(`Could not delete the previous "${title}" list (HTTP ${gone.status}).`);
  }

  const made = await spPost(page, web, `${web}/_api/web/lists`, { Title: title, BaseTemplate: 100 });
  if (made.status >= 400) throw new Error(`Could not create list "${title}" (HTTP ${made.status}) — you need Manage Lists on the site.`);

  for (const f of plan.fieldsXml) {
    const field = await spPost(page, web, `${listUrl}/fields/createfieldasxml`, { parameters: { SchemaXml: f.xml } });
    if (field.status >= 400) throw new Error(`Could not create the ${f.name} column (HTTP ${field.status}) — see watch spot #1 in sp.ts.`);
    const shown = await spPost(page, web, `${listUrl}/defaultview/viewfields/addviewfield('${encodeURIComponent(f.name)}')`, {});
    if (shown.status >= 400) throw new Error(`Could not add ${f.name} to the default view (HTTP ${shown.status}).`);
  }

  for (const item of plan.items) {
    const added = await spPost(page, web, `${listUrl}/items`, item as Json);
    if (added.status >= 400) throw new Error(`Could not add a row (HTTP ${added.status}) — payload keys: ${Object.keys(item).join(', ')}.`);
  }

  for (const cf of plan.columnFormatters) {
    const put = await spPost(page, web,
      `${listUrl}/fields/getByInternalNameOrTitle('${encodeURIComponent(cf.name)}')`,
      { CustomFormatter: cf.json }, true);
    if (put.status >= 400) throw new Error(`Column-formatter write on ${cf.name} failed (HTTP ${put.status}) — formatters need Manage Lists (part of Edit).`);
  }

  // the view formatter goes on its OWN view so the default view stays native
  const view = await spPost(page, web, `${listUrl}/views`, { Title: 'FormatFX View Compare' });
  if (view.status >= 400) throw new Error(`Could not create the view-formatter view (HTTP ${view.status}).`);
  const viewUrl = String(view.body?.ServerRelativeUrl ?? '');
  for (const f of plan.fieldsXml) {
    await spPost(page, web, `${listUrl}/views/getByTitle('FormatFX%20View%20Compare')/viewfields/addviewfield('${encodeURIComponent(f.name)}')`, {});
  }
  const vf = await spPost(page, web, `${listUrl}/views/getByTitle('FormatFX%20View%20Compare')`,
    { CustomFormatter: plan.viewFormatterJson }, true);
  if (vf.status >= 400) throw new Error(`View-formatter write failed (HTTP ${vf.status}).`);

  const dv = await spGet(page, `${listUrl}?$select=DefaultViewUrl`);
  const defaultViewUrl = dv.body?.DefaultViewUrl;
  if (dv.status >= 400 || typeof defaultViewUrl !== 'string') {
    throw new Error(`Could not read the list's DefaultViewUrl (HTTP ${dv.status}) — session expired? Re-run visual:auth.`);
  }
  return { listUrl, defaultViewUrl, formatterViewUrl: viewUrl, notes };
}
