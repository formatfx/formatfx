/**
 * modernLens.ts — the pure classifier behind the companion's **Modern lens**:
 * on a connected site's classic settings pages (settings.aspx / listedit.aspx)
 * the lens dims (or hides) links whose EFFECT is classic-experience-only,
 * retired, or superseded — so a modern-SharePoint admin sees at a glance which
 * settings still matter. Pure string work, no chrome APIs, no DOM — unit
 * tested from the root suite (src/bridge/modernLens.test.ts).
 *
 * Classification is by the link's `_layouts` page filename (or `_catalogs`
 * gallery segment) — never by link text, so it survives localization.
 *
 * The bias is deliberate: a wrongly-dimmed setting that modern still depends
 * on is the worst failure, so anything not provably classic-only stays
 * 'keep'/'unknown' (untouched). Notable keeps that LOOK legacy but aren't:
 *   - appprincipals.aspx     lists live Entra app grants (Sites.Selected),
 *                            not just retired ACS principals
 *   - navoptions.aspx        its "Enable Quick Launch" toggles the MODERN
 *                            left nav (only the Tree view option is classic)
 *   - listqueryrules.aspx    promoted results still show in modern search
 *   - metanavsettings.aspx   key filters feed the modern Filters pane and
 *                            auto-create the indexes big lists need
 *   - htmlfieldsecurity.aspx governs the modern Embed web part's domains
 *   - audience targeting     powers modern News/Highlighted-content targeting
 * Verdicts grounded against Microsoft Learn, July 2026 (see the PR that
 * introduced this file for the evidence trail).
 */

export type LensVerdict = 'keep' | 'dim';

/** How the lens renders dim-classified links on the page. */
export type LensMode = 'dim' | 'hide' | 'off';

export interface LensClassification {
  verdict: LensVerdict | 'unknown';
  /** Tooltip-ready explanation — present exactly when verdict is 'dim'. */
  reason?: string;
}

/** localStorage key for the per-tenant lens mode (tenant origin, not app). */
export const LENS_MODE_KEY = 'fxcompanion-lens-mode';

/**
 * Classic-only / retired / superseded `_layouts` pages, keyed by lowercase
 * filename → tooltip reason. Dates are retirement facts, not guesses.
 */
const DIM_LAYOUTS: Record<string, string> = {
  // ── automation & notifications ──────────────────────────────────────────
  'wrkmng.aspx': 'SharePoint 2010/2013 workflows retired (2013: Apr 2, 2026) — workflows no longer run; use Power Automate.',
  'wrksetng.aspx': 'SharePoint 2010/2013 workflows retired (2013: Apr 2, 2026) — workflows no longer run; use Power Automate.',
  'sitesubs.aspx': 'SharePoint alerts retired: creation blocked Jan 2026, delivery stops from Jul 2026 — use list Rules or Power Automate.',
  'siterss.aspx': 'RSS is classic-experience-only — no modern UI surfaces feeds; use news, Rules, or Power Automate.',
  'listsyndication.aspx': 'RSS feeds are classic-experience-only — modern lists never surface them; use Rules or Power Automate.',
  // ── designer tooling & templates ────────────────────────────────────────
  'sharepointdesignersettings.aspx': 'SharePoint Designer 2013 support ended Jul 14, 2026, and its workflows retired Apr 2026 — modern sites block SPD.',
  'savetmpl.aspx': 'Save as template needs custom script (blocked by default) and is unsupported on modern sites — use site/list templates or "from existing list".',
  'reghost.aspx': 'Reset to site definition re-ghosts classic customized pages — it has no effect on modern pages.',
  // ── classic branding & publishing chrome ────────────────────────────────
  'designwelcomepage.aspx': 'Design Manager brands classic publishing (master pages, page layouts) — modern pages ignore them.',
  'changesitemasterpage.aspx': 'Master page selection applies to classic pages only — modern pages ignore master pages.',
  'areatemplatesettings.aspx': 'Restricts classic page layouts and subsite templates — modern pages do not use page layouts.',
  'imagerenditionsettings.aspx': 'Image renditions serve classic publishing pages — modern pages handle image sizing automatically.',
  // ── navigation & structure ──────────────────────────────────────────────
  'topnav.aspx': 'The top link bar renders on classic pages only — modern sites use site nav and hub nav.',
  'areanavigationsettings.aspx': 'Managed/structural navigation drives classic publishing pages — modern sites use site/hub navigation.',
  'sitenavigationsettings.aspx': 'Caching for classic structural navigation — modern navigation never uses it.',
  'mngsubwebs.aspx': 'Classic subsite manager — Site contents covers subsites; modern guidance favors hubs over subsites.',
  'vsubwebs.aspx': 'Classic subsite hierarchy listing — use Site contents (or Active sites in the admin center).',
  'portal.aspx': 'Portal site connection feeds only the classic breadcrumb — modern navigation uses hub association.',
  'sitemanager.aspx': 'Content and Structure was deprecated Oct 2018 — use Site contents and modern move/copy.',
  // ── classic search plumbing ─────────────────────────────────────────────
  'enhancedsearch.aspx': 'Search Center settings steer the classic search box only — the modern Microsoft Search box ignores them.',
  'manageresultsources.aspx': 'Result sources scope classic search web parts only — Microsoft Search verticals replace them.',
  'manageresulttypes.aspx': 'Result types style classic search results only — modern results are not customizable this way.',
  'seosettings.aspx': 'Classic publishing SEO meta tags (public-site era) — modern pages ignore them.',
  'reporting.aspx': 'Classic Excel usage/audit reports retired — use the Site usage page, Search insights, or Purview Audit.',
  // ── compliance & records (Purview supersedes) ───────────────────────────
  'projectpolicies.aspx': 'Site closure & deletion policies retired Apr 2026 — use Purview retention / site lifecycle policies.',
  'sitepolicies.aspx': 'Site policies retired Apr 2026 — use Purview retention and Microsoft 365 group expiration.',
  'auditsettings.aspx': 'Classic audit settings were cut back in 2021 — SharePoint auditing flows to Purview Audit instead.',
  'policylist.aspx': 'Classic information management policies retired Apr 2026 — use Purview retention labels.',
  'infopol.aspx': 'Information management policies retired Apr 2026 — use Purview retention labels/policies.',
  'inplacerecordssettings.aspx': 'In-place records management retired Apr 2026 — declare records with Purview retention labels.',
  'listrecordsettings.aspx': 'Library record declaration (in-place records) retired Apr 2026 — use Purview retention labels.',
  'documentroutersettings.aspx': 'Content Organizer retired Jan 2025 — route documents with Power Automate; records via Purview.',
  'hold.aspx': 'Classic Hold & eDiscovery retired Aug 2025 — use Purview eDiscovery.',
  'searchandaddtohold.aspx': 'Classic discover-and-hold retired Aug 2025 — use Purview eDiscovery.',
  'holdreport.aspx': 'Reports for classic holds — classic eDiscovery retired Aug 2025; use Purview eDiscovery.',
  // ── upgrade-era & server-era leftovers ──────────────────────────────────
  'sitehealthcheck.aspx': '2010-to-2013 upgrade-era health checks — SharePoint Online has nothing to check.',
  'siteupgrade.aspx': '2010-to-2013 upgrade-era page — SharePoint Online sites are always current.',
  'helpsettings.aspx': 'Classic help collections (SharePoint Server era) — the modern help pane ignores them.',
  // ── classic publishing caches, variations, cross-site publishing ────────
  'areacachesettings.aspx': 'Classic publishing output cache — modern pages never use it.',
  'sitecachesettings.aspx': 'Classic publishing output cache — modern pages never use it.',
  'objectcachesettings.aspx': 'Classic publishing object cache — modern pages never use it.',
  'variationsettings.aspx': 'Variations are deprecated classic publishing — modern multilingual pages replace them.',
  'variationlabels.aspx': 'Variations are deprecated classic publishing — modern multilingual pages replace them.',
  'variationlogs.aspx': 'Variations are deprecated classic publishing — modern multilingual pages replace them.',
  'translationstatus.aspx': 'Machine Translation Service retired Jul 2022 — translation jobs no longer run; use modern multilingual pages.',
  'catalogconnectionmanager.aspx': 'Cross-site publishing is not available in SharePoint Online — catalog connections do nothing.',
  // ── list/library classic leftovers ──────────────────────────────────────
  'perlocationviewdefaults.aspx': 'Per-location view defaults apply in classic views only — modern views ignore them.',
  'scheduling.aspx': 'Classic publishing item scheduling — modern pages schedule via the Pages library Scheduling feature.',
};

/**
 * Still-modern-relevant `_layouts` pages (lowercase filenames). Functionally
 * identical to 'unknown' — the lens touches neither — but listing them keeps
 * the diagnostics honest: an 'unknown' is a page we haven't classified yet,
 * a 'keep' is a page we checked and vouch for.
 */
const KEEP_LAYOUTS: string[] = [
  // permissions & people
  'people.aspx', 'user.aspx', 'mngsiteadmin.aspx', 'role.aspx', 'permsetup.aspx',
  'appprincipals.aspx', // modern Entra grants (Sites.Selected) list here too
  // schema
  'mngfield.aspx', 'mngctype.aspx', 'managefeatures.aspx',
  'contenttypesyndicationhubs.aspx', 'termstoremanager.aspx',
  // regional & languages (MUI labels render in modern per user language)
  'regionalsetng.aspx', 'muisetng.aspx', 'exporttranslations.aspx', 'importtranslations.aspx',
  // search facts that still feed the shared index / modern search
  'srchvis.aspx', 'nocrawlsettings.aspx', 'listmanagedproperties.aspx',
  'listqueryrules.aspx', 'importsearchconfiguration.aspx', 'exportsearchconfiguration.aspx',
  'searchresultremoval.aspx',
  // site basics
  'prjsetng.aspx', 'quiklnch.aspx', 'navoptions.aspx', 'designgallery.aspx',
  'changethelook.aspx', 'deleteweb.aspx', 'areawelcomepage.aspx', 'mcontent.aspx',
  'adminrecyclebin.aspx', 'recyclebin.aspx', 'storman.aspx',
  'docidsettings.aspx', 'htmlfieldsecurity.aspx',
  // list/library settings that bind modern behavior
  'listgensettings.aspx', 'lstsetng.aspx', 'advsetng.aspx', 'listvalidation.aspx',
  'columndefaults.aspx', 'audiencetargetingsettings.aspx', 'ratings.aspx',
  'metanavsettings.aspx', 'metadatacolsettings.aspx', 'managecheckedoutfiles.aspx',
  'indexedcolumns.aspx', 'formsettings.aspx', 'formedt.aspx', 'irm.aspx',
];

/** Classic gallery catalogs (`/_catalogs/<segment>`) → tooltip reason. */
const DIM_CATALOGS: Record<string, string> = {
  wp: 'Classic web part gallery — modern pages use SPFx web parts from the app catalog.',
  lt: 'Classic .stp list templates (custom-script era) — use "from existing list" or list designs.',
  masterpage: 'Master pages and page layouts apply to classic pages only — modern pages ignore them.',
  theme: 'Classic .spcolor/.spfont theme gallery — modern sites theme via Change the look.',
  solutions: 'Sandboxed solutions are retired — ship customizations as SPFx via the app catalog.',
  design: 'Composed looks are classic-only — modern sites use Change the look.',
};

const KEEP_SET = new Set(KEEP_LAYOUTS);

/** Exported for the contract test — not for runtime use. */
export const LENS_RULES = { DIM_LAYOUTS, KEEP_LAYOUTS, DIM_CATALOGS } as const;

/**
 * Which classic settings hub is this URL, if any?
 * 'site' = settings.aspx (site settings), 'list' = listedit.aspx (list AND
 * document-library settings — same page). Anything else → null.
 */
export function settingsPageKind(url: string): 'site' | 'list' | null {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (!path.includes('/_layouts/')) return null;
    if (path.endsWith('/settings.aspx')) return 'site';
    if (path.endsWith('/listedit.aspx')) return 'list';
    return null;
  } catch {
    return null;
  }
}

/**
 * Classify one settings-page link. `base` is the page URL relative hrefs
 * resolve against (pass `location.href`). Returns null for links that cannot
 * carry a verdict at all (javascript:, mailto:, #, malformed) — as opposed to
 * 'unknown', which is a real page we simply have no rule for.
 */
export function classifySettingsLink(href: string, base: string): LensClassification | null {
  let u: URL;
  try {
    u = new URL(href, base);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const path = u.pathname.toLowerCase();

  const catalogs = path.indexOf('/_catalogs/');
  if (catalogs >= 0) {
    const segment = path.slice(catalogs + '/_catalogs/'.length).split('/')[0] ?? '';
    const why = DIM_CATALOGS[segment];
    return why ? { verdict: 'dim', reason: why } : { verdict: 'unknown' };
  }

  if (!path.includes('/_layouts/')) return { verdict: 'unknown' };
  const file = path.split('/').pop() ?? '';
  const why = DIM_LAYOUTS[file];
  if (why) return { verdict: 'dim', reason: why };
  return KEEP_SET.has(file) ? { verdict: 'keep' } : { verdict: 'unknown' };
}

/** Parse a stored mode; anything unrecognized falls back to 'dim'. */
export function parseLensMode(raw: unknown): LensMode {
  return raw === 'hide' || raw === 'off' ? raw : 'dim';
}
