// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Sam Yost

/**
 * bridge/extractSnippet.ts — generates the "⚡ Live from SharePoint" extract
 * snippet: a commented, unminified, READ-ONLY script the user pastes into
 * devtools ON their list page. It captures fields (+choices +live column
 * formatters), views (+view formatters), up to 10 rows, and the list's
 * Rules/Quick Steps into a FormatFX List Snapshot (docs/CONNECTIVITY.md
 * §3.1) and copies it to the clipboard.
 *
 * Read-only, not GET-only (owner decision 2026-07-07, CONNECTIVITY §8,
 * landed via #214): two POSTs are reads SharePoint requires as POST — the
 * form digest (/contextinfo) and GetAllRules(). Nothing is ever written.
 *
 * Auditability is the product feature here: a maker — or their IT — can
 * read every line before running it. No library blob, no mutating verbs.
 * Pure module (node-tested): the generated code itself is executed in
 * bridge.test.ts against stubbed fetch/_spPageContextInfo/clipboard.
 */

import { LIST_SNAPSHOT_VERSION } from '../core/schemaImport';

export interface ExtractSnippetOptions {
  /** Target another list on the same web; default = the list you're on. */
  listTitle?: string;
}

/** SPO rejects queries expanding more lookup/person columns than this. */
export const EXPAND_CAP = 12;

/** `'` doubles inside SP REST string literals; the rest percent-encodes. */
function restTitleSegment(title: string): string {
  return encodeURIComponent(title.replace(/'/g, "''"));
}

export function buildExtractSnippet(opts: ExtractSnippetOptions = {}): string {
  // JSON.stringify produces a valid double-quoted JS literal even though the
  // REST escaping doubled any apostrophes in the title
  const baked = opts.listTitle ? JSON.stringify(restTitleSegment(opts.listTitle)) : 'null';
  return `/* FormatFX — live list extract (READ-ONLY: nothing is written).
 *
 * Two requests below are POSTs because SharePoint only serves these READS
 * as POST: /_api/contextinfo (a token, required by GetAllRules) and
 * GetAllRules() (the list's Rules/Quick Steps). Neither changes anything.
 *
 * 1. Open your SharePoint LIST page (the one you want in FormatFX).
 * 2. Open the browser console (F12 → Console).
 * 3. Paste this whole snippet and press Enter.
 *    (Chrome may ask you to type "allow pasting" first — that is Chrome's
 *    own safety prompt for pasted code, and exactly why this snippet is
 *    plain, readable, comment-heavy JavaScript. Read it!)
 * 4. It copies a "List Snapshot" to your clipboard — paste that into
 *    FormatFX → Data → Import schema.
 */
(async () => {
  // baked at copy time by FormatFX; null = "the list this page shows"
  var TARGET_LIST = ${baked};
  var ctx = window._spPageContextInfo;
  if (!ctx || !ctx.webAbsoluteUrl) {
    throw new Error('FormatFX extract: this does not look like a SharePoint page (no _spPageContextInfo). Open your list page first.');
  }
  var web = ctx.webAbsoluteUrl;
  var listPath;
  if (TARGET_LIST) {
    listPath = web + "/_api/web/lists/getByTitle('" + TARGET_LIST + "')";
  } else if (ctx.pageListId) {
    listPath = web + "/_api/web/lists(guid'" + ctx.pageListId.replace(/[{}]/g, '') + "')";
  } else {
    throw new Error('FormatFX extract: no list on this page — open the list itself (not a site home page), or bake a list title into the snippet from FormatFX.');
  }

  // every request: same-origin cookies + nometadata (plain JSON, no ceremony)
  var get = async function (url) {
    var r = await fetch(url, {
      headers: { Accept: 'application/json;odata=nometadata' },
      credentials: 'same-origin',
    });
    if (!r.ok) throw new Error('FormatFX extract: GET failed (HTTP ' + r.status + ') — ' + url);
    return r.json();
  };

  // 1) fields — including each column's live CustomFormatter
  var fieldsRes = await get(listPath + '/fields?$filter=Hidden eq false'
    + '&$select=InternalName,Title,TypeAsString,Choices,CustomFormatter,LookupList,LookupField,ReadOnlyField,Hidden');
  var fields = (fieldsRes.value || []).map(function (f) {
    return {
      internalName: f.InternalName,
      displayName: f.Title,
      type: f.TypeAsString,
      choices: f.Choices && f.Choices.length ? f.Choices : undefined,
      lookupList: f.LookupList ? String(f.LookupList).replace(/[{}]/g, '') : undefined,
      lookupColumn: f.LookupField || undefined,
      readOnly: !!f.ReadOnlyField,
      hidden: !!f.Hidden,
      customFormatter: f.CustomFormatter || undefined,
    };
  });

  // 2) views — including each view's CustomFormatter (row formatting)
  var viewsRes = await get(listPath + '/views?$expand=ViewFields'
    + '&$select=Title,Id,DefaultView,CustomFormatter,ViewFields/Items');
  var views = (viewsRes.value || []).map(function (v) {
    return {
      title: v.Title,
      id: v.Id,
      isDefault: !!v.DefaultView,
      viewFields: v.ViewFields && v.ViewFields.Items ? v.ViewFields.Items : [],
      customFormatter: v.CustomFormatter || undefined,
    };
  });

  // 3) up to 10 real rows. Person/lookup columns need $expand — SharePoint
  // rejects more than ${EXPAND_CAP} expands per query (its lookup threshold), so we
  // cap there; FormatFX fills any skipped columns with sample data.
  var rows = [];
  try {
    var selects = [];
    var expands = [];
    var expanded = 0;
    fields.forEach(function (f) {
      var t = f.type || '';
      if (t === 'User' || t === 'UserMulti') {
        if (expanded < ${EXPAND_CAP}) {
          expanded++;
          expands.push(f.internalName);
          selects.push(f.internalName + '/Title', f.internalName + '/EMail', f.internalName + '/Id');
        }
      } else if (t === 'Lookup' || t === 'LookupMulti') {
        if (expanded < ${EXPAND_CAP}) {
          expanded++;
          expands.push(f.internalName);
          selects.push(f.internalName + '/Id', f.internalName + '/' + (f.lookupColumn || 'Title'));
        }
      } else {
        selects.push(f.internalName);
      }
    });
    var itemsRes = await get(listPath + '/items?$top=10'
      + '&$select=' + selects.join(',')
      + (expands.length ? '&$expand=' + expands.join(',') : ''));
    rows = itemsRes.value || [];
  } catch (e) {
    console.warn('FormatFX extract: rows skipped (' + e.message + ') — fields and formatters still captured; FormatFX will generate sample rows.');
  }

  // 4) Rules & Quick Steps — a READ SharePoint requires as POST (it mutates
  // nothing; the digest is just a token SharePoint demands for any POST).
  // Best-effort: a failure is reported and skipped, never fatal.
  var rules;
  var quickstepsProperties;
  try {
    var digestRes = await fetch(web + '/_api/contextinfo', {
      method: 'POST',
      headers: { Accept: 'application/json;odata=nometadata' },
      credentials: 'same-origin',
    });
    if (!digestRes.ok) throw new Error('HTTP ' + digestRes.status + ' getting the request digest');
    var digest = (await digestRes.json()).FormDigestValue;
    var rulesRes = await fetch(listPath + '/GetAllRules()', {
      method: 'POST',
      headers: {
        Accept: 'application/json;odata=nometadata',
        'Content-Type': 'application/json',
        'X-RequestDigest': digest,
      },
      credentials: 'same-origin',
      body: JSON.stringify({ includeQuicksteps: true, includeAutomaticRules: true }),
    });
    if (!rulesRes.ok) throw new Error('HTTP ' + rulesRes.status + ' reading rules');
    var rawRules = (await rulesRes.json()).value || [];
    if (rawRules.length) {
      rules = rawRules.map(function (r) {
        return {
          id: String(r.ID || ''),
          ruleTemplateId: r.RuleTemplateId ? String(r.RuleTemplateId) : undefined,
          title: r.Title || undefined,
          condition: r.Condition || undefined,
          triggerType: Number(r.TriggerType || 0),
          actionType: Number(r.ActionType || 0),
          actionParams: r.ActionParams || undefined,
          outcome: r.Outcome == null ? undefined : String(r.Outcome),
          isActive: r.IsActive == null ? undefined : !!r.IsActive,
        };
      });
      // button colors/order live in the RootFolder property bag (plain GET);
      // a nice-to-have — silently skipped when unreadable
      try {
        var bag = await get(listPath + '/RootFolder/Properties?$select=QuickstepsProperties');
        if (bag.QuickstepsProperties) quickstepsProperties = bag.QuickstepsProperties;
      } catch (e2) { /* rules still captured */ }
    }
  } catch (e) {
    console.warn('FormatFX extract: Rules/Quick Steps skipped (' + e.message + ') — everything else still captured.');
  }

  var payload = {
    formatfx: 'list-snapshot',
    version: ${LIST_SNAPSHOT_VERSION},
    capturedAt: new Date().toISOString(),
    siteUrl: web,
    list: ctx.listTitle || TARGET_LIST || undefined,
    listId: ctx.pageListId ? ctx.pageListId.replace(/[{}]/g, '') : undefined,
    fields: fields,
    views: views,
    rows: rows,
    rules: rules,
    quickstepsProperties: quickstepsProperties,
  };

  var text = JSON.stringify(payload, null, 1);
  var cf = fields.filter(function (f) { return f.customFormatter; }).length;
  var vf = views.filter(function (v) { return v.customFormatter; }).length;
  var summary = '\\u2714 ' + fields.length + ' fields (' + cf + ' formatted), '
    + views.length + ' views (' + vf + ' formatted), ' + rows.length + ' rows';
  try {
    await navigator.clipboard.writeText(text);
    console.log('FormatFX extract: ' + summary + ' \\u2014 snapshot COPIED. Paste it into FormatFX \\u2192 Data \\u2192 Import schema.');
  } catch (e) {
    console.log('FormatFX extract: ' + summary + ' \\u2014 clipboard blocked; copy the JSON between the markers below.');
    console.log('----- FORMATFX SNAPSHOT START -----');
    console.log(text);
    console.log('----- FORMATFX SNAPSHOT END -----');
  }
  return payload;
})();
`;
}
