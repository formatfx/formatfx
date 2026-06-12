/**
 * editor/guideContent.ts — the field guide's pages.
 *
 * A developer-audience intro to SharePoint lists: what they really are (SQL
 * tables behind a React UI), the column type system and its constraints
 * (joins, calculated columns, single-vs-multi capability cliffs), the
 * formatting JSON layer, and the field-tested gotchas this product's linter
 * encodes. Written to set up a base mental model to build on — not to teach
 * lists from zero, and not Excel translation.
 *
 * Every factual claim about SharePoint behavior is either live-verified
 * (docs/HANDOFF.md §3, src/core/linter.ts) or grounded in the linked
 * Microsoft documentation. Keep it that way: no folklore without a source.
 */

export interface GuidePage {
  id: string;
  /** Left-nav group. */
  chapter: string;
  /** Short title for the nav tree. */
  title: string;
  /** Article HTML. h2 elements need ids (they feed the "In this article" rail). */
  body: string;
}

/** External Microsoft Learn / support links, marked up consistently. */
const ext = (url: string, label: string): string =>
  `<a class="wb-guide-ext" href="${url}" target="_blank" rel="noreferrer noopener">${label}</a>`;

const MS = {
  columnFormatting: 'https://learn.microsoft.com/en-us/sharepoint/dev/declarative-customization/column-formatting',
  viewFormatting: 'https://learn.microsoft.com/en-us/sharepoint/dev/declarative-customization/view-formatting',
  syntaxRef: 'https://learn.microsoft.com/en-us/sharepoint/dev/declarative-customization/formatting-syntax-reference',
  advanced: 'https://learn.microsoft.com/en-us/sharepoint/dev/declarative-customization/formatting-advanced',
  conditionalForms: 'https://learn.microsoft.com/en-us/sharepoint/dev/declarative-customization/list-form-conditional-show-hide',
  listRelationships: 'https://support.microsoft.com/en-us/office/create-list-relationships-by-using-unique-and-lookup-columns-80a3e0a6-8016-41fb-ad09-8bf16d490632',
  commonFormulas: 'https://support.microsoft.com/en-us/office/examples-of-common-formulas-in-lists-d81f5f21-2b4e-45ce-b170-bf7ebf6988b3',
  calcData: 'https://support.microsoft.com/en-us/office/calculate-data-in-lists-or-libraries-c5261743-667f-4833-bede-e516cef2a0e1',
  largeLists: 'https://support.microsoft.com/en-us/office/manage-large-lists-and-libraries-b8588dae-9387-48c2-9248-c24122f07c59',
  spoLimits: 'https://learn.microsoft.com/en-us/office365/servicedescriptions/sharepoint-online-service-description/sharepoint-online-limits',
  mmVsLookup: 'https://learn.microsoft.com/en-us/microsoft-365/community/information-architecture-managed-metadata-vs-lookup-column',
  managedMetadata: 'https://learn.microsoft.com/en-us/sharepoint/managed-metadata',
  pnpSamples: 'https://github.com/pnp/List-Formatting',
};

/** Severity chip, mirroring the linter's vocabulary. */
const sev = (level: 'error' | 'warning' | 'info'): string =>
  `<span class="wb-guide-sev wb-guide-sev-${level}">${level}</span>`;

/** "Our linter catches this" tag for gotchas encoded in core/linter.ts. */
const lintRule = (rule: string): string =>
  `<span class="wb-guide-lintrule" title="FormatFX's built-in linter flags this — see the JSON tab">linter: ${rule}</span>`;

// ─── inline SVG diagrams (theme-aware via the wb-* CSS variables) ────────────

const FIG_STACK = `
<figure class="wb-guide-fig">
<svg viewBox="0 0 640 260" width="640" height="260" role="img" aria-label="The list stack: a React grid on top, fed by SQL tables on one side and your formatting JSON on the other">
  <style>
    .gf-box { fill: var(--wb-surface); stroke: var(--wb-border); rx: 6; }
    .gf-t { font: 600 12px 'Segoe UI', sans-serif; fill: var(--wb-text); }
    .gf-s { font: 11px 'Segoe UI', sans-serif; fill: var(--wb-text-2); }
    .gf-m { font: 10px Consolas, monospace; fill: var(--wb-text-2); }
    .gf-a { stroke: var(--wb-accent); stroke-width: 1.5; fill: none; marker-end: url(#gf-arr); }
    .gf-row { fill: var(--wb-bg); stroke: var(--wb-border); }
  </style>
  <defs><marker id="gf-arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
    <path d="M0,0 L8,4 L0,8 z" fill="var(--wb-accent)"/></marker></defs>
  <rect class="gf-box" x="160" y="12" width="320" height="84"/>
  <text class="gf-t" x="320" y="32" text-anchor="middle">The grid you see</text>
  <text class="gf-s" x="320" y="48" text-anchor="middle">Microsoft Lists UI — a React app</text>
  <rect class="gf-row" x="184" y="58" width="272" height="13"/>
  <rect class="gf-row" x="184" y="75" width="272" height="13"/>
  <rect x="190" y="60.5" width="54" height="8" rx="4" fill="var(--wb-accent)" opacity=".75"/>
  <rect x="190" y="77.5" width="54" height="8" rx="4" fill="#107c10" opacity=".75"/>
  <rect class="gf-box" x="24" y="156" width="280" height="88"/>
  <text class="gf-t" x="164" y="176" text-anchor="middle">What it is: SQL Server tables</text>
  <text class="gf-m" x="164" y="194" text-anchor="middle">SELECT … FROM Items</text>
  <text class="gf-m" x="164" y="210" text-anchor="middle">JOIN Projects ON Items.ProjectId = Projects.ID</text>
  <text class="gf-s" x="164" y="230" text-anchor="middle">rows, typed columns, real joins, real limits</text>
  <rect class="gf-box" x="336" y="156" width="280" height="88"/>
  <text class="gf-t" x="476" y="176" text-anchor="middle">What you program: formatting JSON</text>
  <text class="gf-m" x="476" y="194" text-anchor="middle">{ "elmType": "div", "style": { … } }</text>
  <text class="gf-s" x="476" y="212" text-anchor="middle">allow-listed CSS + a small set of</text>
  <text class="gf-s" x="476" y="228" text-anchor="middle">commands (actions, inline edit, cards)</text>
  <path class="gf-a" d="M 164 156 C 164 120, 230 110, 252 96"/>
  <path class="gf-a" d="M 476 156 C 476 120, 410 110, 388 96"/>
  <text class="gf-s" x="150" y="118">data (rows &amp; joins)</text>
  <text class="gf-s" x="424" y="118">presentation</text>
</svg>
<figcaption>One list, three layers. The grid is React; the data underneath is SQL; the part you
program is a JSON description of elements and styles that the React renderer agrees to draw.</figcaption>
</figure>`;

const FIG_JOINS = `
<figure class="wb-guide-fig">
<svg viewBox="0 0 660 250" width="660" height="250" role="img" aria-label="Lookup, person and managed metadata columns all join to another list by ID">
  <style>
    .gj-box { fill: var(--wb-surface); stroke: var(--wb-border); rx: 6; }
    .gj-hid { fill: var(--wb-surface); stroke: var(--wb-border); stroke-dasharray: 4 3; rx: 6; }
    .gj-t { font: 600 12px 'Segoe UI', sans-serif; fill: var(--wb-text); }
    .gj-s { font: 10.5px 'Segoe UI', sans-serif; fill: var(--wb-text-2); }
    .gj-m { font: 10px Consolas, monospace; fill: var(--wb-text-2); }
    .gj-chip { fill: var(--wb-bg); stroke: var(--wb-border); rx: 4; }
    .gj-a { stroke: var(--wb-accent); stroke-width: 1.5; fill: none; marker-end: url(#gj-arr); }
  </style>
  <defs><marker id="gj-arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
    <path d="M0,0 L8,4 L0,8 z" fill="var(--wb-accent)"/></marker></defs>
  <rect class="gj-box" x="20" y="60" width="200" height="130"/>
  <text class="gj-t" x="120" y="82" text-anchor="middle">Tasks (your list)</text>
  <rect class="gj-chip" x="36" y="94" width="168" height="22"/>
  <text class="gj-m" x="44" y="109">Project        lookup</text>
  <rect class="gj-chip" x="36" y="122" width="168" height="22"/>
  <text class="gj-m" x="44" y="137">AssignedTo     person</text>
  <rect class="gj-chip" x="36" y="150" width="168" height="22"/>
  <text class="gj-m" x="44" y="165">Category       metadata</text>
  <rect class="gj-box" x="420" y="16" width="220" height="56"/>
  <text class="gj-t" x="530" y="36" text-anchor="middle">Projects (another list)</text>
  <text class="gj-s" x="530" y="54" text-anchor="middle">stored on the row: just the ID</text>
  <rect class="gj-hid" x="420" y="96" width="220" height="56"/>
  <text class="gj-t" x="530" y="116" text-anchor="middle">User Information List</text>
  <text class="gj-s" x="530" y="134" text-anchor="middle">hidden, one per site collection</text>
  <rect class="gj-hid" x="420" y="176" width="220" height="56"/>
  <text class="gj-t" x="530" y="196" text-anchor="middle">TaxonomyHiddenList</text>
  <text class="gj-s" x="530" y="214" text-anchor="middle">hidden, synced from the term store</text>
  <path class="gj-a" d="M 204 105 C 320 100, 340 60, 416 46"/>
  <path class="gj-a" d="M 204 133 C 310 130, 330 124, 416 124"/>
  <path class="gj-a" d="M 204 161 C 320 166, 340 200, 416 202"/>
  <text class="gj-s" x="288" y="66">JOIN by ID</text>
  <text class="gj-s" x="288" y="120">JOIN by ID</text>
  <text class="gj-s" x="288" y="196">JOIN by ID</text>
</svg>
<figcaption>Three column types, one mechanism. Person and managed metadata columns are lookups
into hidden system lists — which is why all three share the same powers and the same limits.</figcaption>
</figure>`;

const FIG_CALC = `
<figure class="wb-guide-fig">
<svg viewBox="0 0 640 200" width="640" height="200" role="img" aria-label="A calculated column can read scalar cells on its own row, but not join columns and not other rows">
  <style>
    .gc-cell { fill: var(--wb-surface); stroke: var(--wb-border); }
    .gc-calc { fill: var(--wb-bg); stroke: var(--wb-accent); }
    .gc-t { font: 600 11px 'Segoe UI', sans-serif; fill: var(--wb-text); }
    .gc-s { font: 10.5px 'Segoe UI', sans-serif; fill: var(--wb-text-2); }
    .gc-ok { stroke: #107c10; stroke-width: 1.6; fill: none; marker-end: url(#gc-ok-arr); }
    .gc-no { stroke: #d13438; stroke-width: 1.6; fill: none; stroke-dasharray: 5 3; marker-end: url(#gc-no-arr); }
    .gc-okt { font: 600 11px 'Segoe UI', sans-serif; fill: #107c10; }
    .gc-not { font: 600 11px 'Segoe UI', sans-serif; fill: #d13438; }
  </style>
  <defs>
    <marker id="gc-ok-arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#107c10"/></marker>
    <marker id="gc-no-arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#d13438"/></marker>
  </defs>
  <g>
    <rect class="gc-cell" x="20"  y="80" width="110" height="34"/><text class="gc-t" x="75"  y="101" text-anchor="middle">Title (text)</text>
    <rect class="gc-cell" x="130" y="80" width="100" height="34"/><text class="gc-t" x="180" y="101" text-anchor="middle">Due (date)</text>
    <rect class="gc-cell" x="230" y="80" width="100" height="34"/><text class="gc-t" x="280" y="101" text-anchor="middle">Done (yes/no)</text>
    <rect class="gc-cell" x="330" y="80" width="110" height="34"/><text class="gc-t" x="385" y="101" text-anchor="middle">Project ⤳ join</text>
    <rect class="gc-calc" x="490" y="80" width="130" height="34"/><text class="gc-t" x="555" y="101" text-anchor="middle">= Calculated</text>
  </g>
  <path class="gc-ok" d="M 520 80 C 460 36, 240 36, 182 76"/>
  <path class="gc-ok" d="M 530 80 C 490 50, 320 50, 284 76"/>
  <path class="gc-no" d="M 545 114 C 520 150, 440 150, 392 118"/>
  <text class="gc-okt" x="330" y="32">reads scalar cells on its own row ✓</text>
  <text class="gc-not" x="408" y="158">join columns ✗</text>
  <rect class="gc-cell" x="20" y="138" width="310" height="30" opacity=".55"/>
  <text class="gc-s" x="175" y="157" text-anchor="middle">any other row — invisible ✗</text>
  <path class="gc-no" d="M 510 114 C 440 180, 320 186, 200 170"/>
</svg>
<figcaption>A calculated column's whole world is the scalar cells of its own row — evaluated when
the row is saved, never on a schedule, and never across the join.</figcaption>
</figure>`;

// ─── the pages ───────────────────────────────────────────────────────────────

export const GUIDE_PAGES: GuidePage[] = [
  {
    id: 'overview',
    chapter: 'Start here',
    title: 'What a list really is',
    body: `
<h1>What a list really is</h1>
<p class="wb-guide-lede">A SharePoint list looks like a spreadsheet and gets sold as one
("if you can use Excel…"). It isn't one. It's a <strong>typed table in a SQL database, rendered
by a React app, with a JSON-programmable presentation layer</strong>. Holding those three layers
apart is the single most useful mental model for everything else in this guide.</p>

${FIG_STACK}

<h2 id="ov-table">A list is a table</h2>
<p>Items are rows. Columns are typed fields — text, number, date, choice, person, lookup — and the
type system is enforced, unlike a spreadsheet where any cell can hold anything. Views are stored
queries over that table: a column selection, a filter, a sort, a grouping. None of this is
metaphor: the list you see is backed by tables in a SQL Server content database, and every view
you open runs a real SQL query.</p>

<h2 id="ov-sql">Because it's SQL, the limits are real…</h2>
<p>The famous constraints of lists aren't arbitrary product decisions — they're SQL operational
limits surfacing through the UI:</p>
<ul>
  <li><strong>The list view threshold (5,000)</strong>. SQL Server uses row-level locks and
  escalates to a table lock when a single query touches too many rows — which would block every
  other user of that table. SharePoint refuses to run view queries past 5,000 items instead.
  The data is fine; it's the <em>query</em> that gets rejected. Indexed columns plus filtered
  views are the way through (${ext(MS.largeLists, 'Manage large lists and libraries')}).</li>
  <li><strong>The list view lookup threshold (12)</strong>. Each lookup, person, or managed
  metadata column in a view is a SQL <em>join</em> — Microsoft's limits documentation literally
  defines this threshold as "join operations per query". More than 12 and the view is throttled
  (${ext(MS.spoLimits, 'SharePoint Online limits')}).</li>
  <li><strong>Column type constraints</strong> — which types can be looked up, calculated over,
  indexed, or filtered. These all trace back to how each type is stored and queried. The whole
  <a href="#" data-guide-page="single-vs-multi">capability matrix</a> chapter exists because of this.</li>
</ul>

<h2 id="ov-joins">…but so is the relational power</h2>
<p>The same SQL underneath gives you, through a picker UI, things that are genuinely tedious to
hand-build on a raw database:</p>
<ul>
  <li><strong>Joins without writing joins.</strong> A lookup column relates two lists by ID. Pick
  the source list, pick the column to display — done. <em>Additional (projected) fields</em> pull
  more columns across the same join, read-only, no extra configuration.</li>
  <li><strong>Referential integrity as a checkbox.</strong> "Enforce relationship behavior" gives
  you restrict-delete or cascade-delete — the things you'd otherwise write foreign-key constraints
  and triggers for (${ext(MS.listRelationships, 'Create list relationships')}).</li>
  <li><strong>Versioning, permissions, audit, attachments, forms</strong> on every row, for free.</li>
</ul>

<h2 id="ov-react">The UI is React, and you can program it with JSON</h2>
<p>The modern Lists experience is a React application. <strong>List formatting</strong> is the
official way to program it: you hand SharePoint a JSON description of elements
(<code>elmType</code>, children, <code>txtContent</code>) plus styling, and the renderer builds
real React elements from it. Two things to internalize early:</p>
<ul>
  <li>The styling vocabulary is <strong>allow-listed CSS</strong>. SharePoint keeps a whitelist of
  style properties; anything not on it is <em>silently dropped</em> — no error, the property just
  doesn't paint. (This guide's <a href="#" data-guide-page="formatting">JSON layer</a> chapter
  carries the list, including the things people keep reaching for that don't exist there:
  <code>var()</code>, <code>calc()</code>, grid, transitions.)</li>
  <li>Beyond looks, the JSON carries a small set of <strong>commands</strong> — click actions
  (<code>customRowAction</code>: set field values, start a Power Automate flow, share, delete…),
  inline editing (<code>inlineEditField</code>), and hover cards (<code>customCardProps</code>).
  Details in <a href="#" data-guide-page="actions">Commands &amp; actions</a>.</li>
</ul>

<div class="wb-guide-note wb-guide-note-info"><strong>Who this is for.</strong> This guide assumes
you've used a list before. It won't teach you how to add an item; it sets up the mechanics —
storage, types, joins, the formatting runtime — so the constraints you'll hit have reasons
instead of feeling like trivia. Past this page, it's written for developers.</div>
`,
  },

  {
    id: 'column-types',
    chapter: 'The column system',
    title: 'Columns as a type system',
    body: `
<h1>Columns as a type system</h1>
<p class="wb-guide-lede">Treat SharePoint's column types as a real type system with three families.
Which family a column belongs to predicts almost everything it can and can't do.</p>

<h2 id="ct-families">The three families</h2>
<table class="wb-guide-table">
<thead><tr><th>Family</th><th>Types</th><th>What's stored on the row</th></tr></thead>
<tbody>
<tr><td><strong>Scalars</strong></td>
  <td>Single line of text, Multiple lines of text, Number, Currency, Date and Time, Yes/No,
  Choice, Hyperlink/Picture, Location, Image</td>
  <td>The value itself, inline on the row. Choice is stored as plain text that happens to be
  validated against a menu — it is <em>not</em> a relation.</td></tr>
<tr><td><strong>Joins</strong></td>
  <td>Lookup, Person or Group, Managed Metadata</td>
  <td>An ID reference to a row in another list (a foreign key). The display value lives in the
  source list and is joined in at query time. See
  <a href="#" data-guide-page="joins">Everything that joins is a lookup</a>.</td></tr>
<tr><td><strong>Computed</strong></td>
  <td>Calculated (plus read-only system columns: ID, Created, Modified, Author/Editor…)</td>
  <td>A formula evaluated when the row is saved; the result is stored. See
  <a href="#" data-guide-page="calculated">Calculated columns</a>.</td></tr>
</tbody>
</table>

<h2 id="ct-single-multi">Single vs multi is a second axis</h2>
<p>Choice, Lookup, Person, and Managed Metadata each come in single-value and multi-value flavors.
Think <em>scalar vs set</em>. A single-value column holds one comparable value — it can be sorted,
indexed, joined on, used in formulas. A multi-value column holds a set, and almost every engine
feature that needs "one value per row" falls away: no indexing, no use in calculated formulas, no
being a lookup target, no use in form conditional formulas. The cliff is steep enough that it gets
its <a href="#" data-guide-page="single-vs-multi">own page with the full matrix</a>.</p>

<div class="wb-guide-note wb-guide-note-warning"><strong>Choose single unless you truly need
multi.</strong> Converting single→multi is one click; once real data exists, multi→single is not
cleanly reversible. Multi-value also exports oddly (an empty multi-lookup leaves SharePoint's own
CSV-with-schema export as the literal string <code>"[]"</code> — verified here on 2026-06-11).</div>

<h2 id="ct-formatting-view">How the formatting layer sees each type</h2>
<p>In formatting JSON, <code>@currentField</code> and <code>[$Field]</code> resolve differently by
family — this is where the type system becomes visible to your code:</p>
<ul>
  <li><strong>Scalars</strong> arrive as plain values: text, numbers, booleans. Dates arrive as
  date values with one live-verified quirk: a truly <em>empty</em> date is <code>null</code>, and
  <code>null == ''</code> is <strong>false</strong> — while empty text cells and absent fields
  <em>do</em> equal <code>''</code>. (See <a href="#" data-guide-page="gotchas">gotchas</a>.)</li>
  <li><strong>Joins</strong> arrive as objects: <code>@currentField.lookupValue</code> /
  <code>.lookupId</code> for lookups; person fields add <code>.title</code>, <code>.email</code>,
  <code>.picture</code>; multi-value joins arrive as arrays you walk with <code>forEach</code>.</li>
  <li><strong>Calculated</strong> columns are formattable like any other column
  (${ext(MS.columnFormatting, 'supported column types')}), but remember the value was computed at
  save time — for "now"-relative logic, compute in the formatter with <code>@now</code> instead.</li>
</ul>

<p>Nearly every column type supports column formatting — including calculated, lookup, person and
managed metadata. The notable exceptions: Filename in document libraries, retention labels, sealed
columns, and enhanced-rich-text multiline (${ext(MS.columnFormatting, 'Use column formatting')}).</p>
`,
  },

  {
    id: 'joins',
    chapter: 'The column system',
    title: 'Everything that joins is a lookup',
    body: `
<h1>Everything that joins is a lookup</h1>
<p class="wb-guide-lede">Lookup columns, person columns, and managed metadata columns look like
three features. Mechanically they are one feature: a foreign-key reference to a row in another
list, joined in at query time. In SQL speak, a join — and Microsoft's own threshold documentation
counts them exactly that way.</p>

${FIG_JOINS}

<h2 id="jn-three">The three faces of the join</h2>
<ul>
  <li><strong>Lookup</strong> — the honest one. You pick the source list yourself (same site
  only). The row stores the target item's ID; the display value is joined from the source column
  you chose.</li>
  <li><strong>Person or Group</strong> — a lookup wearing a trench coat. The source list is the
  hidden <em>User Information List</em> (one per site collection). That's why person columns
  behave like lookups everywhere: in thresholds, in indexing rules, in formatting
  (<code>.lookupId</code> works on them too, alongside <code>.title</code>/<code>.email</code>).</li>
  <li><strong>Managed Metadata</strong> — a lookup into the hidden <em>TaxonomyHiddenList</em>,
  which syncs from the tenant term store (${ext(MS.managedMetadata, 'managed metadata overview')}).
  Same join mechanics, plus taxonomy services on top: hierarchy, synonyms, multilingual labels,
  reuse across every site collection.</li>
</ul>

<div class="wb-guide-note wb-guide-note-info"><strong>Why you should care:</strong> each of these
in a view is one join in the view's SQL query, and the
<em>list view lookup threshold</em> caps a view at <strong>12 joins</strong>
(${ext(MS.spoLimits, 'SharePoint Online limits')}). A view with 6 lookups, 4 person columns and
3 metadata columns is over the line, even though it "only" has 13 columns.</div>

<h2 id="jn-targets">What a lookup may point at</h2>
<p>Only some source-column types can be the displayed column of a lookup
(${ext(MS.listRelationships, 'Create list relationships')}):</p>
<table class="wb-guide-table">
<thead><tr><th>Supported as lookup source</th><th>Not supported</th></tr></thead>
<tbody><tr>
<td>Single line of text<br>Number<br>Date and Time<br>Lookup (single value)<br>
<span class="wb-guide-dim">…and ID, which is always implicitly the join key</span></td>
<td>Multiple lines of text<br>Choice<br>Calculated<br>Hyperlink or Picture<br>Person<br>
Yes/No<br>Currency<br>Lookup (multi-valued)</td>
</tr></tbody>
</table>
<p>The pattern: a lookup target must be a simple, comparable scalar. Choice misses the cut —
the standard workaround is a single-line-of-text column in the source list (or a calculated
text copy of the choice… which also can't be a target; see below. Text column it is).</p>

<h2 id="jn-projected">Projected fields (the "additional columns")</h2>
<p>When you create a lookup, "More options" lets you project <em>additional</em> columns from the
source list into your view — read-only columns that ride along on the same join, no second
configuration. Two mechanics worth knowing:</p>
<ul>
  <li>Internally each projected field is a <em>secondary lookup</em> keyed off the primary one
  (the Graph API models it as <code>primaryLookupColumnId</code>). Delete the primary lookup and
  the projections go with it.</li>
  <li>Projections obey the same source-type table above — you can project the source's text,
  number, and date columns, not its choice or person columns.</li>
</ul>

<h2 id="jn-which">Choice vs lookup vs managed metadata — picking one</h2>
<table class="wb-guide-table">
<thead><tr><th></th><th>Choice</th><th>Lookup</th><th>Managed metadata</th></tr></thead>
<tbody>
<tr><td>Vocabulary lives in</td><td>the column settings</td><td>a list you own, same site</td>
<td>the tenant term store</td></tr>
<tr><td>Reuse scope</td><td>this column only</td><td>this site</td><td>every site collection</td></tr>
<tr><td>Extra data per value</td><td>—</td><td>yes: source list columns + projections</td>
<td>term properties, synonyms, hierarchy</td></tr>
<tr><td>Who maintains values</td><td>column owner</td><td>anyone who can edit the source list</td>
<td>term store managers</td></tr>
<tr><td>Costs a join</td><td>no</td><td>yes</td><td>yes</td></tr>
</tbody>
</table>
<p>Rules of thumb: a short, stable menu → choice. Values that are themselves <em>records</em>
(have owners, dates, budgets…) or need projections → lookup. A controlled vocabulary shared
across sites, with hierarchy or synonyms → managed metadata
(${ext(MS.mmVsLookup, 'managed metadata vs lookup columns')}).</p>

<div class="wb-guide-note wb-guide-note-warning"><strong>Export blind spot (verified here):</strong>
SharePoint's own <em>Export to CSV with schema</em> omits calculated <em>and</em> lookup columns
from the schema XML. If you import a list into FormatFX and a column formatter reference comes
back unresolved, this omission is the usual reason.</div>
`,
  },

  {
    id: 'calculated',
    chapter: 'The column system',
    title: 'Calculated columns',
    body: `
<h1>Calculated columns</h1>
<p class="wb-guide-lede">A calculated column stores a formula result on the row. Its powers are
narrow and exactly defined: <strong>scalar inputs, own row only, evaluated at save time</strong>.
Most calculated-column surprises are one of those three boundaries being met.</p>

${FIG_CALC}

<h2 id="ca-refs">What a formula may reference</h2>
<p>From Microsoft's own note on the subject: "Calculated fields can only operate on their own row,
so you can't reference a value in another row, or columns contained in another list or library.
Lookup fields are not supported in a formula, and the ID of a newly inserted row can't be used"
(${ext(MS.commonFormulas, 'Examples of common formulas in lists')}).</p>
<p>Unpacked against the type system, a calculated formula can reference the
<strong>basic scalar types</strong> only:</p>
<ul>
  <li><strong>OK:</strong> single line of text, Number, Currency, Date and Time, Yes/No,
  Choice (single) — and other calculated columns.</li>
  <li><strong>Not available:</strong> every join column — Lookup, Person, Managed Metadata
  (they aren't materialized scalars on the row; they're IDs into another table) — plus
  multi-value Choice, multiple lines of text, and <code>[ID]</code> at creation time
  (the ID doesn't exist yet when the first evaluation runs).</li>
</ul>

<h2 id="ca-language">It speaks Excel, not formatting JSON</h2>
<p>Calculated columns use the Excel-style dialect — <code>=IF(AND([Due]&lt;[Today],NOT([Done])),
"Late","")</code> with <code>CONCATENATE</code>, <code>DATEDIF</code>, <code>PROPER</code> and
friends (${ext(MS.calcData, 'Calculate data in lists or libraries')}). This is a
<strong>different language</strong> from the expressions inside formatting JSON, and mixing
their idioms is a classic time sink:</p>
<table class="wb-guide-table">
<thead><tr><th></th><th>Calculated column</th><th>Formatting / conditional formulas</th></tr></thead>
<tbody>
<tr><td>Dialect</td><td>Excel-style: <code>=IF(…)</code>, <code>NOT(…)</code>, <code>&amp;</code>
concatenation</td><td>lowercase <code>=if(…)</code>, <code>!</code> for not
(<code>not()</code> doesn't exist), <code>+</code> concatenation</td></tr>
<tr><td>Field refs</td><td><code>[Column Name]</code></td><td><code>[$InternalName]</code>,
<code>@currentField</code></td></tr>
<tr><td>Whitespace</td><td>fine</td><td>spaces outside quotes can kill the formatter
(<a href="#" data-guide-page="gotchas">Zero Whitespace Rule</a>)</td></tr>
<tr><td>Evaluated</td><td>once, when the row is saved; result stored</td>
<td>live, every render, in the browser</td></tr>
<tr><td>Sees</td><td>own row's scalars</td><td>own row incl. join values
(<code>.lookupValue</code>), <code>@me</code>, <code>@now</code>, <code>@currentWeb</code></td></tr>
</tbody>
</table>

<div class="wb-guide-note wb-guide-note-warning"><strong>The TODAY drift.</strong> "Evaluated at
save time" means a calculated "days until due" is frozen the moment the row last changed — it
does not tick over at midnight. Anything time-relative belongs in the formatting layer, where
<code>@now</code> is evaluated at render time on every view.</div>

<h2 id="ca-engine">Engine-level consequences</h2>
<ul>
  <li><strong>Not indexable</strong> — a calculated column can't power a threshold-friendly
  filtered view on a large list.</li>
  <li><strong>Not a lookup target</strong>, and not available in list form conditional formulas
  (${ext(MS.conditionalForms, 'conditional show/hide')}).</li>
  <li><strong>Invisible to schema export</strong> — SharePoint's Export-to-CSV-with-schema omits
  calculated columns entirely (verified here 2026-06-11); don't expect them to round-trip through
  schema tooling.</li>
  <li><strong>Formattable</strong> — column formatting works on calculated columns
  (${ext(MS.columnFormatting, 'supported column types')}), so a common pattern is: calculated
  column produces a stable scalar at save time; formatting JSON handles presentation and anything
  live.</li>
</ul>
`,
  },

  {
    id: 'single-vs-multi',
    chapter: 'The column system',
    title: 'The capability matrix',
    body: `
<h1>Single vs multi: the capability matrix</h1>
<p class="wb-guide-lede">The reference table. Rows are column types; columns are the engine
features that quietly refuse multi-value (and a few other) types. ✓ means documented as
supported; — means documented as unsupported <em>or absent from Microsoft's supported list</em>
(in SharePoint those are the same thing in practice).</p>

<table class="wb-guide-table wb-guide-matrix">
<thead><tr>
  <th>Column type</th>
  <th title="Can be the displayed source column of a lookup">Lookup target</th>
  <th title="Can be referenced in a calculated column formula">In calculated</th>
  <th title="Can be referenced in list form conditional show/hide formulas">Form conditionals</th>
  <th title="Can be indexed (and so power threshold-friendly filtered views)">Indexable</th>
  <th title="Can enforce unique values">Unique</th>
  <th title="inlineEditField in formatting JSON loads an editor for it">Inline edit</th>
  <th title="customRowAction setValue can write it">setValue</th>
</tr></thead>
<tbody>
<tr><td>Single line of text</td><td>✓</td><td>✓</td><td>✓</td><td>✓</td><td>✓</td><td>✓</td><td>✓</td></tr>
<tr><td>Multiple lines of text</td><td>—</td><td>—</td><td>✓</td><td>—</td><td>—</td><td>✓ <sup>1</sup></td><td>✓ <sup>1</sup></td></tr>
<tr><td>Number</td><td>✓</td><td>✓</td><td>✓</td><td>✓</td><td>✓</td><td>✓</td><td>✓</td></tr>
<tr><td>Currency</td><td>—</td><td>✓</td><td>—</td><td>✓</td><td>✓</td><td>—</td><td>—</td></tr>
<tr><td>Date and Time</td><td>✓</td><td>✓</td><td>✓ <sup>2</sup></td><td>✓</td><td>✓</td><td>✓</td><td>✓</td></tr>
<tr><td>Yes/No</td><td>—</td><td>✓</td><td>✓</td><td>✓</td><td>—</td><td>—</td><td>—</td></tr>
<tr><td>Choice</td><td>—</td><td>✓</td><td>✓</td><td>✓</td><td>✓</td><td>✓</td><td>✓</td></tr>
<tr><td>Choice (multi)</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>✓</td><td>✓ <sup>3</sup></td></tr>
<tr><td>Lookup</td><td>✓</td><td>—</td><td>✓</td><td>✓</td><td>✓</td><td>✓</td><td>—</td></tr>
<tr><td>Lookup (multi)</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>
<tr><td>Person or Group</td><td>—</td><td>—</td><td>✓</td><td>✓</td><td>✓</td><td>✓</td><td>✓</td></tr>
<tr><td>Person (multi)</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>✓</td><td>✓ <sup>3</sup></td></tr>
<tr><td>Managed metadata</td><td>—</td><td>—</td><td>—</td><td>✓</td><td>—</td><td>—</td><td>—</td></tr>
<tr><td>Managed metadata (multi)</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>
<tr><td>Calculated</td><td>—</td><td>✓ <sup>4</sup></td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>
</tbody>
</table>
<p class="wb-guide-footnotes">
<sup>1</sup> Plain text only — enhanced rich text isn't supported for inline edit or setValue.&ensp;
<sup>2</sup> Date comparisons yes; time-of-day calculations are explicitly unsupported in form
conditionals.&ensp;
<sup>3</sup> Multi-value setValue needs an array value (and supports
<code>appendTo</code>/<code>removeFrom</code>).&ensp;
<sup>4</sup> A calculated formula may reference other calculated columns (not itself).</p>

<p>Sources: ${ext(MS.listRelationships, 'list relationships (lookup targets, unique columns)')},
${ext(MS.commonFormulas, 'calculated formulas')},
${ext(MS.conditionalForms, 'form conditional formulas')},
${ext(MS.advanced, 'advanced formatting (inline edit, setValue)')},
${ext(MS.largeLists, 'large lists (indexing)')}.</p>

<h2 id="sm-why">Why the cliff exists</h2>
<p>Single-value columns store one comparable value per row — something SQL can index, join on,
and evaluate in a row-scoped formula. A multi-value column stores a <em>set</em> against the row.
Every feature in the table above assumes "one value per row" somewhere in its machinery, so the
multi flavor drops out. This isn't SharePoint being capricious; it's the relational model showing
through.</p>

<h2 id="sm-practice">Practical consequences</h2>
<ul>
  <li><strong>Sort/filter/group degrade on multi.</strong> Multi-value columns can't be indexed,
  which on a large list also means they can't carry the first filter of a threshold-friendly view.</li>
  <li><strong>Formatting is the escape hatch.</strong> The formatting layer handles multi-value
  fine — <code>forEach</code> over the array, render a chip per value. Presentation copes where
  the query engine refuses.</li>
  <li><strong>Plan conversions.</strong> Single→multi is a click. Multi→single with data in place
  is not a clean operation. Start single.</li>
  <li><strong>Mind the export.</strong> Empty multi-lookups leave SharePoint's CSV-with-schema
  export as the literal string <code>"[]"</code> (verified here) — schema tooling has to
  special-case it, and FormatFX's importer does.</li>
</ul>
`,
  },

  {
    id: 'formatting',
    chapter: 'The JSON layer',
    title: 'Formatting JSON ≈ allow-listed CSS',
    body: `
<h1>Formatting JSON: programming the React UI</h1>
<p class="wb-guide-lede">A formatter is a JSON tree describing elements for SharePoint's React
renderer to build: an <code>elmType</code>, optional <code>txtContent</code>, a
<code>style</code> map, an <code>attributes</code> map, and <code>children</code>. The style map
is the heart of it — and it is best understood as <strong>CSS filtered through a whitelist</strong>.</p>

<h2 id="fm-shape">The shape of a formatter</h2>
<pre><code>{
  "$schema": "https://developer.microsoft.com/json-schemas/sp/v2/column-formatting.schema.json",
  "elmType": "div",
  "style": { "display": "flex", "gap": "8px", "padding": "2px 10px" },
  "attributes": { "class": "sp-field-severity--good" },
  "children": [
    { "elmType": "span",
      "txtContent": "=if(@currentField &gt; 90, 'On track', 'At risk')" }
  ]
}</code></pre>
<p>Nine element types exist: <code>div</code>, <code>span</code>, <code>a</code>,
<code>img</code>, <code>button</code>, <code>p</code>, <code>svg</code>, <code>path</code>,
<code>filepreview</code>. Any string value can instead be an <code>=expression</code> evaluated
per row — there's a full operator/function vocabulary, field references
(<code>[$InternalName]</code>, <code>[$Lookup.lookupValue]</code>), and tokens
(<code>@currentField</code>, <code>@me</code>, <code>@now</code>, <code>@rowIndex</code>…).
Column formatters style one column; view (row) formatters lay out the whole row and can embed
column formatters by reference (<code>columnFormatterReference</code>); tile formatters drive the
gallery layout. References: ${ext(MS.columnFormatting, 'column formatting')} ·
${ext(MS.viewFormatting, 'view formatting')} · ${ext(MS.syntaxRef, 'syntax reference')} ·
${ext(MS.pnpSamples, 'pnp/List-Formatting samples')}.</p>

<h2 id="fm-allowlist">The style allow-list (and the silent drop)</h2>
<p>SharePoint validates every <code>style</code> key against a whitelist. On the list: the box
model (margin/padding/border/outline/box-shadow), flexbox (<code>display:flex</code>,
direction/wrap/align/justify, per-child <code>flex</code>, and <code>gap</code> — yes, gap is
supported in modern SP; that was live-verified here against an older internal rule that said
otherwise), typography (<code>font-*</code>, <code>text-*</code>, line-height, white-space),
paint (color, background-*, opacity, visibility), positioning (position/top/left/z-index/float),
sizing (width/height/min/max), overflow and ellipsis tools, SVG fill/stroke, table-layout
properties, <code>transform</code>, <code>object-fit</code>, and the line-clamp pair.</p>
<p><strong>Everything else is dropped silently.</strong> Not an error — the property simply never
paints, exactly like the emulation in this app's preview. The repeat offenders, the things
developers keep expecting to work:</p>
<table class="wb-guide-table">
<thead><tr><th>You reach for</th><th>What happens</th><th>Do instead</th></tr></thead>
<tbody>
<tr><td><code>var(--custom-prop)</code></td><td>dropped — custom properties aren't honored
<sup>†</sup></td><td>repeat literal values; use theme classes (<code>ms-bgColor-themePrimary</code>)
for theme-awareness</td></tr>
<tr><td><code>calc(…)</code></td><td>dropped</td><td>compute in the expression language:
<code>"=(@currentField * 100 / 120) + '%'"</code></td></tr>
<tr><td><code>display: grid</code> + <code>grid-template-*</code></td><td>dropped</td>
<td>flexbox, or <code>display: table</code></td></tr>
<tr><td><code>transition</code>, <code>animation</code></td><td>dropped</td>
<td>none — there is no motion in the formatting layer</td></tr>
<tr><td><code>filter</code>, <code>backdrop-filter</code>, <code>clip-path</code>,
<code>mask</code>, <code>aspect-ratio</code></td><td>dropped</td><td>opacity, border-radius,
explicit sizes</td></tr>
<tr><td><code>align-self</code>, <code>justify-self</code>, <code>order</code>,
<code>align-content</code>, <code>justify-items</code></td><td>dropped</td>
<td>restructure: alignment lives on the parent (<code>align-items</code>/<code>justify-content</code>);
order lives in the children array</td></tr>
<tr><td><code>pointer-events</code></td><td>dropped</td><td>structure around it (overlay buttons,
<code>cursor</code> for affordance)</td></tr>
<tr><td><code>transform: rotate(…)/scale(…)</code></td><td>treat as suspect — this app's linter
flags non-<code>translate</code> transforms because they've been seen to drop on real
tenants</td><td><code>translate(…)</code> for nudges; pre-rotated SVG paths for chevrons</td></tr>
</tbody>
</table>
<p class="wb-guide-footnotes"><sup>†</sup> One pinhole exception: the four
<code>--inline-editor-border-*</code> custom properties, which exist specifically to style the
inline-edit affordance (${ext(MS.advanced, 'advanced formatting')}).</p>

<h2 id="fm-classes">Classes: the theme-aware alternative</h2>
<p><code>attributes.class</code> accepts SharePoint's utility classes —
<code>ms-bgColor-*</code> / <code>ms-fontColor-*</code> palette tokens,
<code>sp-field-severity--*</code> states, <code>sp-css-borderColor-*</code>, the
<code>sp-card-*</code> family for galleries. Prefer them over hex codes when you want dark mode
and tenant themes to keep working — a hardcoded <code>#ffffff</code> background looks fine right
up until the tenant flips dark. (Note it's <code>class</code>, not <code>className</code> —
this is JSON for a renderer, not JSX.)</p>

<h2 id="fm-expressions">Two expression syntaxes</h2>
<p>Excel-style strings (<code>"=if([$Status] == 'Done', '#107c10', '#a80000')"</code>) and the
older object/AST form (<code>{"operator": "?", "operands": […]}</code>) are both legal and both
common in community samples. They're equivalent in power; the string form reads better. This
app's engine implements both, so pasted samples in either dialect render and lint.</p>
<p>For the dialect's sharp edges — whitespace, <code>not()</code>, nested <code>=</code>,
XML-escaped operators — go straight to <a href="#" data-guide-page="gotchas">the gotchas</a>.</p>
`,
  },

  {
    id: 'actions',
    chapter: 'The JSON layer',
    title: 'Commands & actions',
    body: `
<h1>Commands &amp; actions</h1>
<p class="wb-guide-lede">Styling is half the formatting layer. The other half is a small command
vocabulary that makes formatters <em>do</em> things: row actions, inline editing, and hover
cards. All of it declarative, all of it inside the same JSON
(${ext(MS.advanced, 'advanced formatting concepts')}).</p>

<h2 id="ac-rowaction">customRowAction</h2>
<p>Attach <code>customRowAction</code> to a <code>button</code> (or <code>a</code>) and the
element becomes a live control on the row:</p>
<table class="wb-guide-table">
<thead><tr><th>action</th><th>What it does</th></tr></thead>
<tbody>
<tr><td><code>defaultClick</code></td><td>what clicking the row would do — open the item
(or the document)</td></tr>
<tr><td><code>setValue</code></td><td>write one or more field values on the item directly from
the view — no form. <code>actionInput</code> maps internal names to values, including
expressions and <code>@now</code>; multi-value fields take arrays plus
<code>appendTo</code>/<code>removeFrom</code>. Supported types: text, plain multiline, number,
date/time, choice + multi-choice, person + multi-person.</td></tr>
<tr><td><code>executeFlow</code></td><td>start a Power Automate flow for the item
(<code>actionParams</code> carries the flow ID)</td></tr>
<tr><td><code>share</code> / <code>delete</code> / <code>editProps</code> /
<code>openContextMenu</code></td><td>the standard item commands, as buttons you place</td></tr>
<tr><td><code>embed</code></td><td>open the file's embed experience</td></tr>
</tbody>
</table>
<pre><code>{
  "elmType": "button",
  "txtContent": "Mark done",
  "customRowAction": {
    "action": "setValue",
    "actionInput": { "Status": "Done", "CompletedOn": "@now" }
  }
}</code></pre>

<h2 id="ac-inline">inlineEditField</h2>
<p>Put <code>"inlineEditField": "[$FieldName]"</code> on an element and clicking it opens the
real field editor in place — view stays put, no form. Supported field types: single-line text,
plain multiline, number, date/time, choice and multi-choice, person and multi-person, lookup.
The hover affordance is stylable through the four <code>--inline-editor-border-*</code>
properties (the only custom properties on the entire style allow-list).</p>
<pre><code>{
  "elmType": "div",
  "inlineEditField": "[$Status]",
  "txtContent": "[$Status]"
}</code></pre>
<div class="wb-guide-note wb-guide-note-info">In this app's preview, inline edit renders as an
affordance indicator only — the real field editors are SharePoint's, and faking them would
teach the wrong muscle memory. Test the real interaction on a real list.</div>

<h2 id="ac-cards">customCardProps and defaultHoverField</h2>
<p><code>customCardProps</code> attaches a hover/click flyout whose content is — recursively —
another formatter (<code>formatter</code>, <code>openOnEvent</code>, <code>directionalHint</code>,
<code>isBeakVisible</code>). <code>defaultHoverField</code> is the zero-effort sibling: point it
at a person column for the standard profile card, or at <code>[$FileLeafRef]</code> for the file
card.</p>
<p>Two structural traps live here (details in <a href="#" data-guide-page="gotchas">gotchas</a>):
the card-trigger element wants to be a <code>button</code> with direct <code>txtContent</code> —
child elements hijack the click registration — and <code>columnFormatterReference</code> inside
a card formatter renders blank.</p>

<h2 id="ac-foreach">forEach — the loop that pairs with all of this</h2>
<p><code>"forEach": "_item in [$MultiValueField]"</code> repeats an element per value — the
standard way to render multi-value joins as chips, facepiles, tag rows. Convention: prefix the
iterator with an underscore so it can't shadow a field reference. One hard scope rule:
<code>forEach</code> over a <code>split()</code> expression only works inside
<code>customCardProps</code> — at the top level it kills the whole formatter.</p>
`,
  },

  {
    id: 'gotchas',
    chapter: 'Field notes',
    title: 'The gotchas',
    body: `
<h1>The gotchas</h1>
<p class="wb-guide-lede">Field-tested failure modes, most of which fail <em>silently</em> on real
SharePoint — the element just renders blank and nothing tells you why. Each entry names the rule
in this app's linter where there is one; several semantics were verified against a live tenant
with screenshot comparison (2026-06-11).</p>

<h2 id="go-expr">Expression language</h2>

<div class="wb-guide-gotcha">${sev('warning')}<h3>The Zero Whitespace Rule</h3>${lintRule('zero-whitespace')}
<p>Spaces in an <code>=expression</code> outside quoted literals can silently kill the formatter
in production. <code>=if([$a] == 1, 'x', 'y')</code> reads beautifully and may render nothing.
Author readable, ship sanitized — this app's exports strip unquoted whitespace for you.</p></div>

<div class="wb-guide-gotcha">${sev('error')}<h3>not() does not exist</h3>${lintRule('no-not-function')}
<p>The formatting dialect has no <code>not()</code> function — that's the calculated-column
Excel dialect bleeding over. Use the <code>!</code> prefix: <code>=!([$Done])</code>.</p></div>

<div class="wb-guide-gotcha">${sev('error')}<h3>Nested '=' inside an expression</h3>${lintRule('nested-equals')}
<p>The <code>=</code> prefix means "this whole string is a formula" and goes at the very start,
once. Nesting a function does not restart the prefix — correct:
<code>=if(a,b,if(c,d,e))</code>; wrong: <code>=if(a,b,=if(c,d,e))</code>. No error; blank
element.</p></div>

<div class="wb-guide-gotcha">${sev('error')}<h3>XML-escaped operators</h3>${lintRule('xml-entity-escape')}
<p>Copy JSON through anything XML-ish and <code>&amp;&amp;</code> can arrive as
<code>&amp;amp;&amp;amp;</code>. SharePoint stores the entity literally and the formatter breaks
at render with no diagnostics. Use raw characters; escape as <code>\\u0026</code> only at CSOM
deploy time.</p></div>

<div class="wb-guide-gotcha">${sev('warning')}<h3>if() depth caps at ~10</h3>${lintRule('if-depth')}
<p>Nested <code>if()</code> beyond ten deep may silently fail. Past a handful, restructure —
or move the decision into the data (a calculated column) and keep formatting presentational.</p></div>

<div class="wb-guide-gotcha">${sev('info')}<h3>Non-ASCII garbles via CSOM</h3>${lintRule('ascii-only')}
<p>Em-dashes, smart quotes and emoji in formatter strings can garble when deployed through CSOM
pipelines. Prefer ASCII or an <code>iconName</code>.</p></div>

<h2 id="go-data">Data semantics (live-verified)</h2>

<div class="wb-guide-gotcha">${sev('info')}<h3>Empty dates are null — and null == '' is FALSE</h3>${lintRule('empty-date-compare')}
<p>A truly empty Date cell is <code>null</code>, and <code>null == ''</code> evaluates
<strong>false</strong> — while empty <em>text</em> cells and absent fields <em>do</em> equal
<code>''</code>. So <code>=if([$Due] == '', 'no date', …)</code> never takes the blank branch on
date columns. Verified against a real tenant 2026-06-10; several community samples assume
otherwise. Related: <code>toLocaleDateString()</code> on an empty date renders empty text, not
the 1970 epoch.</p></div>

<div class="wb-guide-gotcha">${sev('info')}<h3>@currentField swaps inside a CFR</h3>
<p>Inside a resolved <code>columnFormatterReference</code>, <code>@currentField</code> is the
<em>referenced</em> column, not the host's. Correct and convenient — until you forget while
reading someone else's row formatter.</p></div>

<div class="wb-guide-gotcha">${sev('info')}<h3>The calculated TODAY drift</h3>
<p>Calculated columns evaluate at save time only. A stored "days late" goes stale the moment
midnight passes. Time-relative logic belongs in formatting expressions with <code>@now</code>
(evaluated per render). See <a href="#" data-guide-page="calculated">Calculated columns</a>.</p></div>

<h2 id="go-structure">Structure, cards and loops</h2>

<div class="wb-guide-gotcha">${sev('warning')}<h3>Card triggers want a button</h3>${lintRule('card-trigger-button')}
<p><code>customCardProps</code> on a <code>div</code> with children: the child spans hijack click
registration and the card never opens. Use <code>elmType "button"</code> with direct
<code>txtContent</code>, or an absolutely-positioned overlay div as the trigger.</p></div>

<div class="wb-guide-gotcha">${sev('error')}<h3>No CFR inside a card</h3>${lintRule('cfr-in-card')}
<p><code>columnFormatterReference</code> inside a <code>customCardProps</code> formatter renders
blank. Inline the markup instead. (Also: CFRs don't nest multi-level, and references to
multi-choice template formatters aren't supported —
${ext(MS.syntaxRef, 'syntax reference')}.)</p></div>

<div class="wb-guide-gotcha">${sev('error')}<h3>forEach + split() scope</h3>${lintRule('foreach-split-scope')}
<p><code>forEach</code> over a <code>split()</code> expression works only inside
<code>customCardProps</code>. At the top level of a formatter it kills the whole thing. Iterate
real multi-value fields at the top level; save string-splitting for card content. Convention:
underscore-prefix iterators (<code>_tag in [$Tags]</code>) so they can't shadow field refs
${lintRule('foreach-iterator-underscore')}. And <code>inlineEditField</code> inside a
<code>forEach</code> is unreliable ${lintRule('inline-edit-foreach')}.</p></div>

<div class="wb-guide-gotcha">${sev('error')}<h3>_comment placement</h3>${lintRule('comment-placement')}
<p>A <code>_comment</code> key as a sibling of <code>elmType</code> breaks rendering. It is only
safe inside <code>style</code> objects.</p></div>

<div class="wb-guide-gotcha">${sev('error')}<h3>class, not className</h3>${lintRule('class-not-classname')}
<p>The schema uses HTML attribute names: <code>attributes.class</code>. <code>className</code>
is a JSX habit the renderer ignores.</p></div>

<h2 id="go-css">CSS layer</h2>

<div class="wb-guide-gotcha">${sev('warning')}<h3>Off-list styles drop silently</h3>${lintRule('css-unknown / css-unsupported')}
<p>Anything not on the allow-list — <code>var()</code>, <code>calc()</code>, grid, transitions,
animations, filters, <code>align-self</code>, <code>order</code>, <code>pointer-events</code> —
silently never paints. The full table lives in
<a href="#" data-guide-page="formatting">the JSON layer</a>. Non-<code>translate</code>
transforms: treat as suspect ${lintRule('css-transform')}.</p></div>

<div class="wb-guide-gotcha">${sev('info')}<h3>.sp-card-formatterRef is invisible by design</h3>
<p>In LIST row context, real SharePoint renders <code>.sp-card-formatterRef</code> with
<code>visibility: hidden</code> — it occupies layout and never paints. Looks like a bug; it's
fidelity, and this app's preview reproduces it.</p></div>

<h2 id="go-platform">Platform &amp; tooling</h2>

<div class="wb-guide-gotcha">${sev('warning')}<h3>Schema export omits calculated and lookup columns</h3>
<p>SharePoint's <em>Export to CSV with schema</em> leaves calculated and lookup columns out of
the schema XML, and exports empty multi-lookups as the literal string <code>"[]"</code>
(verified 2026-06-11). An "unresolved column reference" after importing a list here usually
means exactly this — re-add those columns by hand in the Data tab.</p></div>

<div class="wb-guide-gotcha">${sev('info')}<h3>gap IS supported</h3>
<p>Older internal guidance said flex <code>gap</code>/<code>row-gap</code>/<code>column-gap</code>
weren't honored. Live-verified: modern SharePoint supports them. Use gap; stop margin-hacking
children apart.</p></div>
`,
  },

  {
    id: 'formatfx',
    chapter: 'Field notes',
    title: 'Putting it to work here',
    body: `
<h1>Putting it to work in FormatFX</h1>
<p class="wb-guide-lede">Everything in this guide is wired into the app you're standing in.
The short version of where each idea lives:</p>

<h2 id="fx-import">Bring your actual list in</h2>
<p><strong>Data tab → Import schema…</strong> takes the file SharePoint produces from
<em>Export → Export to CSV</em> with <em>Include schema</em> checked. One file yields your
columns (types, choices, read-only flags), up to ten real rows, and every live column formatter —
the grid workspace rebuilds around it. Remember the export blind spot from the
<a href="#" data-guide-page="gotchas">gotchas</a>: calculated and lookup columns won't be in the
schema XML; add them in the Data tab if your formatters reference them.</p>

<h2 id="fx-linter">Let the linter teach</h2>
<p>The JSON tab's diagnostics are the <a href="#" data-guide-page="gotchas">gotchas page</a> in
executable form — Zero Whitespace, <code>not()</code>, nested <code>=</code>, XML entities,
forEach scope, card traps, the style allow-list, unknown field references against your imported
schema, empty-date comparisons. Each finding explains <em>why</em> in plain language and marks
the exact spot (▶) in the formula.</p>

<h2 id="fx-playground">Learn the CSS by clicking it</h2>
<p>The <strong>⚗ Style playground</strong> (☰ menu, or "Restyle in playground" on any selected
element) is a consequence-free room: every allow-listed property as rows of clickable value
chips, applied live to sample elements — or to a masked render of your real element. Nothing
touches your formatter until you hit Apply, and Apply is one undo step.</p>

<h2 id="fx-preview">Trust the preview's honesty</h2>
<p>The canvas emulates the real renderer's behavior — including the unflattering parts: it
silently drops off-list styles exactly like SharePoint, hides <code>.sp-card-formatterRef</code>
in list context, treats empty dates as null. Where emulation ends (inline-edit editors are
indicated, not hosted; <code>defaultHoverField</code> round-trips but doesn't render), it says
so rather than faking it. The exported JSON is the product: <strong>always verify on a real list
before shipping</strong>.</p>

<div class="wb-guide-note wb-guide-note-info"><strong>Going deeper:</strong>
${ext(MS.columnFormatting, 'column formatting')} ·
${ext(MS.viewFormatting, 'view formatting')} ·
${ext(MS.syntaxRef, 'formatting syntax reference')} ·
${ext(MS.advanced, 'advanced concepts')} ·
${ext(MS.pnpSamples, 'pnp/List-Formatting community samples')} — paste any sample into the JSON
tab and take it apart visually.</div>
`,
  },
];

/** Flat order = reading order; chapters derive from page order. */
export const GUIDE_CHAPTERS: Array<{ chapter: string; pages: GuidePage[] }> = (() => {
  const out: Array<{ chapter: string; pages: GuidePage[] }> = [];
  for (const page of GUIDE_PAGES) {
    const last = out[out.length - 1];
    if (last?.chapter === page.chapter) last.pages.push(page);
    else out.push({ chapter: page.chapter, pages: [page] });
  }
  return out;
})();
