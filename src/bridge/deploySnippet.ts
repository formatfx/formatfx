/**
 * bridge/deploySnippet.ts — generates the deploy snippet: the current
 * formatter baked in, pasted into devtools on the list page, applied to a
 * field's or view's CustomFormatter via the page's own session (cookies +
 * /_api/contextinfo digest). Confirm-with-echo before writing, teaching
 * copy on every failure class, re-GET echo after. One write, no surprises.
 *
 * The caller is responsible for lint-gating (the Deploy panel refuses to
 * generate while the document has lint errors — SP would accept the write
 * and render blank). CSOM-safe escaping must NOT be applied: REST stores
 * the raw string. Pure module, node-tested like extractSnippet.
 */

export interface DeploySnippetOptions {
  /** What receives the formatter: one column or one (shared) view. */
  target: 'field' | 'view';
  /** Field internal name, or the view's title. */
  name: string;
  /** The exported formatter JSON (sanitized, NOT csom-escaped). */
  formatterJson: string;
  /** Target another list on the same web; default = the list you're on. */
  listTitle?: string;
}

function restTitleSegment(title: string): string {
  return encodeURIComponent(title.replace(/'/g, "''"));
}

export function buildDeploySnippet(opts: DeploySnippetOptions): string {
  // JSON.stringify keeps the baked literals valid JS even when the REST
  // escaping doubled apostrophes in a title
  const bakedList = opts.listTitle ? JSON.stringify(restTitleSegment(opts.listTitle)) : 'null';
  const targetPath = JSON.stringify(opts.target === 'field'
    ? `/fields/getByInternalNameOrTitle('${restTitleSegment(opts.name)}')`
    : `/views/getByTitle('${restTitleSegment(opts.name)}')`);
  const what = opts.target === 'field'
    ? `the [$${opts.name}] column`
    : `the "${opts.name}" view (row formatting)`;
  return `/* FormatFX — deploy formatter to ${what}.
 *
 * 1. Open the SharePoint LIST page this formatter belongs to.
 * 2. Open the browser console (F12 → Console), paste, press Enter.
 *    (Chrome may ask you to type "allow pasting" first.)
 * 3. It shows you what will change and asks before writing. ONE write:
 *    the CustomFormatter property of ${what}. Nothing else is touched.
 *
 * Permissions: writing a formatter needs "Manage Lists", which the
 * default Edit permission level already includes on most sites.
 */
(async () => {
  // baked by FormatFX at copy time:
  var TARGET_LIST = ${bakedList}; // null = the list this page shows
  var TARGET_PATH = ${targetPath};
  var FORMATTER = ${JSON.stringify(opts.formatterJson)};

  var ctx = window._spPageContextInfo;
  if (!ctx || !ctx.webAbsoluteUrl) {
    throw new Error('FormatFX deploy: this does not look like a SharePoint page (no _spPageContextInfo). Open your list page first.');
  }
  var web = ctx.webAbsoluteUrl;
  var listPath;
  if (TARGET_LIST) {
    listPath = web + "/_api/web/lists/getByTitle('" + TARGET_LIST + "')";
  } else if (ctx.pageListId) {
    listPath = web + "/_api/web/lists(guid'" + ctx.pageListId.replace(/[{}]/g, '') + "')";
  } else {
    throw new Error('FormatFX deploy: no list on this page — open the list itself, or regenerate the snippet with a list title from FormatFX.');
  }
  var target = listPath + TARGET_PATH;

  var explain = function (status) {
    if (status === 401 || status === 403) {
      return 'you need Edit on this list (formatters require "Manage Lists", part of the default Edit level). Ask the site owner.';
    }
    if (status === 404) {
      return 'target not found \\u2014 fields go by INTERNAL name (no spaces, what FormatFX shows), views by their exact title. Check both on the list.';
    }
    if (status === 412) {
      return 'the request digest went stale \\u2014 just run the snippet again.';
    }
    return 'unexpected HTTP ' + status + ' \\u2014 check the Network tab for the response body.';
  };

  // 1) look before writing
  var pre = await fetch(target + '?$select=CustomFormatter', {
    headers: { Accept: 'application/json;odata=nometadata' },
    credentials: 'same-origin',
  });
  if (!pre.ok) throw new Error('FormatFX deploy: could not read the target (' + explain(pre.status) + ')');
  var current = (await pre.json()).CustomFormatter || '';

  // 2) say exactly what changes, then ask
  var msg = 'FormatFX deploy to ' + (TARGET_LIST || ctx.listTitle || 'this list') + '\\n'
    + 'Target: ' + decodeURIComponent(TARGET_PATH) + '\\n\\n'
    + (current
      ? 'It CURRENTLY HAS a formatter (' + current.length + ' chars) \\u2014 it will be REPLACED.'
      : 'It currently has no formatter.')
    + '\\n\\nApply the new formatter (' + FORMATTER.length + ' chars)?';
  if (!confirm(msg)) {
    console.log('FormatFX deploy: cancelled \\u2014 nothing was written.');
    return { applied: false };
  }

  // 3) a write needs a fresh form digest
  var digestRes = await fetch(web + '/_api/contextinfo', {
    method: 'POST',
    headers: { Accept: 'application/json;odata=nometadata' },
    credentials: 'same-origin',
  });
  if (!digestRes.ok) throw new Error('FormatFX deploy: could not get a request digest (' + explain(digestRes.status) + ')');
  var digest = (await digestRes.json()).FormDigestValue;

  // 4) THE write — a MERGE of one property
  var put = await fetch(target, {
    method: 'POST',
    headers: {
      'Accept': 'application/json;odata=nometadata',
      'Content-Type': 'application/json;odata=nometadata',
      'X-RequestDigest': digest,
      'IF-MATCH': '*',
      'X-HTTP-Method': 'MERGE',
    },
    credentials: 'same-origin',
    body: JSON.stringify({ CustomFormatter: FORMATTER }),
  });
  if (!put.ok) throw new Error('FormatFX deploy: the write failed (' + explain(put.status) + ')');

  // 5) trust, then verify
  var post = await fetch(target + '?$select=CustomFormatter', {
    headers: { Accept: 'application/json;odata=nometadata' },
    credentials: 'same-origin',
  });
  var now = post.ok ? ((await post.json()).CustomFormatter || '') : '(could not re-read)';
  console.log('FormatFX deploy: \\u2714 applied \\u2014 ' + (current ? current.length : 0)
    + ' \\u2192 ' + now.length + ' chars. Refresh the list to see it.');
  return { applied: true, previousLength: current ? current.length : 0, newLength: now.length };
})();
`;
}
