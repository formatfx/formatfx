// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Sam Yost

/**
 * editor/guideContent.ts — the field guide's pages.
 *
 * SharePoint lists & libraries, arranged by technicality. The guide is a
 * gradient: it starts at a plain-language floor (what a list is, what a
 * library is) and runs steadily deeper — SQL under the React UI, the column
 * type system and its constraints (joins, calculated columns, single-vs-multi
 * capability cliffs), the formatting JSON layer, and the field-tested gotchas
 * this product's linter encodes. The gradient is structural, not just tonal:
 * reading order (page/chapter position) descends basic → complex, and the nav
 * tree nests — a page's `parent` chain IS its technicality; the deeper a page
 * sits in the tree, the more it assumes.
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
  /**
   * Id of the page this one nests under in the nav tree. Nesting encodes
   * technicality: a chapter's depth-0 page is its plainest on-ramp and each
   * level down assumes more. A parent must appear earlier in GUIDE_PAGES and
   * share its child's chapter (guideContent.test.ts enforces both).
   */
  parent?: string;
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
  // Basics-floor links (standard support-article ids; see HANDOFF §1.9 sourcing note).
  introLists: 'https://support.microsoft.com/en-us/office/introduction-to-lists-0a1c3ace-def0-44af-b225-cfa8d92c52d7',
  whatIsLibrary: 'https://support.microsoft.com/en-us/office/what-is-a-document-library-3b5976dd-65cf-4c9e-bf5a-713c10ca2872',
  createView: 'https://support.microsoft.com/en-us/office/create-change-or-delete-a-view-of-a-list-or-library-27ae65b8-bc5b-4949-b29b-4ee87144a9c9',
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

const FIG_BASICS = `
<figure class="wb-guide-fig">
<svg viewBox="0 0 640 236" width="640" height="236" role="img" aria-label="A list holds rows of information, a library holds rows that are files; both run on the same machinery of typed columns, views, versioning and formatting">
  <style>
    .gb-box { fill: var(--wb-surface); stroke: var(--wb-border); rx: 6; }
    .gb-t { font: 600 12px 'Segoe UI', sans-serif; fill: var(--wb-text); }
    .gb-s { font: 11px 'Segoe UI', sans-serif; fill: var(--wb-text-2); }
    .gb-row { fill: var(--wb-bg); stroke: var(--wb-border); }
    .gb-bar { fill: var(--wb-text-2); opacity: .35; }
    .gb-file { fill: var(--wb-bg); stroke: var(--wb-accent); stroke-width: 1.2; }
    .gb-a { stroke: var(--wb-accent); stroke-width: 1.5; fill: none; marker-end: url(#gb-arr); }
  </style>
  <defs><marker id="gb-arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
    <path d="M0,0 L8,4 L0,8 z" fill="var(--wb-accent)"/></marker></defs>
  <rect class="gb-box" x="24" y="14" width="284" height="132"/>
  <text class="gb-t" x="166" y="36" text-anchor="middle">A list</text>
  <text class="gb-s" x="166" y="52" text-anchor="middle">rows of information</text>
  <g>
    <rect class="gb-row" x="44" y="64" width="244" height="20"/>
    <rect class="gb-bar" x="52" y="70" width="90" height="8" rx="4"/>
    <rect x="200" y="70" width="54" height="8" rx="4" fill="#107c10" opacity=".75"/>
    <rect class="gb-row" x="44" y="90" width="244" height="20"/>
    <rect class="gb-bar" x="52" y="96" width="72" height="8" rx="4"/>
    <rect x="200" y="96" width="54" height="8" rx="4" fill="var(--wb-accent)" opacity=".75"/>
    <rect class="gb-row" x="44" y="116" width="244" height="20"/>
    <rect class="gb-bar" x="52" y="122" width="104" height="8" rx="4"/>
    <rect x="200" y="122" width="54" height="8" rx="4" fill="#d13438" opacity=".75"/>
  </g>
  <rect class="gb-box" x="332" y="14" width="284" height="132"/>
  <text class="gb-t" x="474" y="36" text-anchor="middle">A library</text>
  <text class="gb-s" x="474" y="52" text-anchor="middle">rows that are files</text>
  <g>
    <rect class="gb-row" x="352" y="64" width="244" height="20"/>
    <path class="gb-file" d="M 360 67 h 8 l 4 4 v 10 h -12 z"/>
    <rect class="gb-bar" x="380" y="70" width="120" height="8" rx="4"/>
    <rect class="gb-row" x="352" y="90" width="244" height="20"/>
    <path class="gb-file" d="M 360 93 h 8 l 4 4 v 10 h -12 z"/>
    <rect class="gb-bar" x="380" y="96" width="88" height="8" rx="4"/>
    <rect class="gb-row" x="352" y="116" width="244" height="20"/>
    <path class="gb-file" d="M 360 119 h 8 l 4 4 v 10 h -12 z"/>
    <rect class="gb-bar" x="380" y="122" width="132" height="8" rx="4"/>
  </g>
  <rect class="gb-box" x="110" y="192" width="420" height="34"/>
  <text class="gb-s" x="320" y="213" text-anchor="middle">same machinery: typed columns · views · versioning · formatting</text>
  <path class="gb-a" d="M 166 146 C 166 168, 200 182, 226 190"/>
  <path class="gb-a" d="M 474 146 C 474 168, 440 182, 414 190"/>
</svg>
<figcaption>The two containers. A library is a list whose rows are files — everything this guide
covers (columns, views, formatting) applies to both.</figcaption>
</figure>`;

// ─── the pages ───────────────────────────────────────────────────────────────

export const GUIDE_PAGES: GuidePage[] = [
  {
    id: 'basics',
    chapter: 'Lists & libraries',
    title: 'The basics',
    body: `
<h1>Lists &amp; libraries: the basics</h1>
<p class="wb-guide-lede">Everything in SharePoint's data world lives in one of two containers: a
<strong>list</strong> (rows of information) or a <strong>library</strong> (rows that are files).
This page is the guide's plain-language floor — no SQL, no JSON. The deeper you go from here,
the more technical it gets: <strong>down the page order, and down the tree on the left, where a
nested page always assumes more than its parent</strong>.</p>

${FIG_BASICS}

<h2 id="ba-list">A list: rows of information</h2>
<p>A list is a set of <strong>items</strong> — one per row — described by <strong>columns</strong>.
A task list has an item per task, with columns like Title, Due date, Assigned to, Status. You can
add, edit and delete items in a grid or through a form, and share the whole thing with a team
(${ext(MS.introLists, 'Introduction to lists')}). If that sounds like a spreadsheet: it looks like
one on purpose, and the resemblance is the single most misleading thing about it — a list is much
stricter, and much better at being shared. The pages below this one explain what it actually is.</p>

<h2 id="ba-library">A library: a list where every row is a file</h2>
<p>A document library is the same idea with one twist: <strong>each item is a file</strong> — the
document, image, or folder itself — plus whatever columns you add to describe it
(${ext(MS.whatIsLibrary, 'What is a document library?')}). Status, Owner, Review date on a
contracts library work exactly like columns on a task list. Nearly everything in this guide
applies to both containers equally: columns, views, and formatting don't care whether the row is
an item or a file. The differences that do exist are small and called out where they bite (for
one: a library's <em>Name</em> column — the filename — can't be formatted).</p>

<h2 id="ba-columns">Columns give every value a type</h2>
<p>Each column declares what kind of value it holds: a line of text, a number, a date, a choice
from a menu, a person, a yes/no, a link to an item in another list. The type is enforced — you
can't put "next Tuesday" in a number column — and the type decides what SharePoint can do with
the column: sort it, filter it, total it, validate it. Choosing good column types is most of the
craft of designing a list; the <a href="#" data-guide-page="column-types">column system
chapter</a> treats them as what they really are, a type system.</p>

<h2 id="ba-views">Views: saved ways of looking</h2>
<p>A view is a saved way of looking at the same list: which columns show, in what order, filtered
and sorted and grouped how (${ext(MS.createView, 'Create, change, or delete a view')}). "My open
tasks", "Everything due this week", "Grouped by owner" — three views, one list, zero copies of
the data. Views never change the items; deleting a view deletes nothing but the viewpoint.</p>

<h2 id="ba-free">What every list and library gives you for free</h2>
<ul>
  <li><strong>Version history</strong> — edits keep the old value; you can see who changed what,
  and roll back.</li>
  <li><strong>Permissions</strong> — who can see and edit, down to the individual item when
  needed.</li>
  <li><strong>Forms</strong> — an add/edit form for every list, generated from the columns.</li>
  <li><strong>Alerts and automation hooks</strong> — notify or trigger a flow when things
  change.</li>
</ul>
<p>Building any one of these by hand is a project. Here they're the default — which is the honest
answer to "why not just use a spreadsheet?".</p>

<h2 id="ba-formatting">Formatting: rules that paint</h2>
<p>Every column and view can carry <strong>formatting rules</strong> — paint the Status cell green
when it says Done, show a red flag when the due date is past, turn a number into a progress bar.
The rules travel with the list and apply for everyone who opens it. Writing those rules well is
what FormatFX is for, and what the <a href="#" data-guide-page="formatting">JSON layer
chapter</a> is about.</p>

<div class="wb-guide-note wb-guide-note-info"><strong>How to read this guide.</strong> This page
is the floor. One level down the tree, <a href="#" data-guide-page="overview">Under the hood</a>
opens the machinery — from there on the guide is written for developers, and every further level
of nesting (and every later chapter) assumes more. Go as deep as your problem requires and no
deeper.</div>
`,
  },

  {
    id: 'overview',
    chapter: 'Lists & libraries',
    title: 'Under the hood: SQL + React',
    parent: 'basics',
    body: `
<h1>Under the hood: what a list really is</h1>
<p class="wb-guide-lede">A SharePoint list looks like a spreadsheet. It isn't one. It's a <strong>typed table in a SQL database, rendered
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
  <li><strong>The list view threshold (5,000)</strong> and <strong>the list view lookup
  threshold (12)</strong> — both are the query engine protecting itself, not a storage cap.
  The full engine story (lock escalation, joins per query, and how indexes get you through)
  lives one level deeper: <a href="#" data-guide-page="limits">Limits &amp; thresholds</a>.</li>
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

<div class="wb-guide-note wb-guide-note-info"><strong>Who this is for.</strong> From this page
down, the guide is written for developers — <a href="#" data-guide-page="basics">the basics
page</a> above is the plain-language floor. This page sets up the mechanics — storage, types,
joins, the formatting runtime — so the constraints you'll hit have reasons instead of feeling
like trivia; each level deeper in the tree assumes you've absorbed the level above it.</div>
`,
  },

  {
    id: 'limits',
    chapter: 'Lists & libraries',
    title: 'Limits & thresholds',
    parent: 'overview',
    body: `
<h1>Limits &amp; thresholds, from the engine</h1>
<p class="wb-guide-lede">The deepest page of this chapter: why the numbers are what they are.
Both famous thresholds are the SQL query engine protecting every other user of the content
database — <strong>the data is never the problem; the query is</strong>.</p>

<h2 id="li-5000">The list view threshold: 5,000</h2>
<p>SQL Server takes row-level locks while it works, and <strong>escalates to a table lock</strong>
when a single query touches too many rows — which would block every other user of that table,
and lists share tables in the content database. SharePoint's defense is to refuse to run view
queries that would touch more than 5,000 items
(${ext(MS.largeLists, 'Manage large lists and libraries')}).</p>
<p>Read the fine print in that sentence: the threshold rejects the <em>query</em>, not the data.
A list can hold up to <strong>30 million items</strong>
(${ext(MS.spoLimits, 'SharePoint Online limits')}) — you just can't ask one view to sweep more
than 5,000 of them unindexed. In
SharePoint Online the threshold isn't yours to raise; the way through is query design, not a
bigger number.</p>

<h2 id="li-12">The list view lookup threshold: 12 joins per query</h2>
<p>Each lookup, person, or managed metadata column in a view is a SQL <em>join</em> —
Microsoft's limits documentation literally defines this threshold as "join operations per
query" (${ext(MS.spoLimits, 'SharePoint Online limits')}). More than 12 in one view and the
view is throttled. The arithmetic sneaks up on people because the three column types look
unrelated: a view with 6 lookups, 4 person columns and 3 metadata columns is over the line at
13, even though it "only" has 13 columns total. Why those three types are secretly the same
feature is the <a href="#" data-guide-page="joins">joins page</a>.</p>

<h2 id="li-indexes">Indexes: the way through</h2>
<p>An indexed column gives SQL a way to find matching rows <em>without</em> sweeping the table —
so a view whose <strong>first filter</strong> is on an indexed column, and narrows to fewer
than 5,000 matching rows, works no matter how large the whole list grows
(${ext(MS.largeLists, 'Manage large lists and libraries')}). The craft, in order:</p>
<ul>
  <li><strong>Index the columns your views filter on</strong> — and do it early; retrofitting
  indexes onto an already-huge list is much more painful than designing for them.</li>
  <li><strong>Make every view on a large list a filtered view</strong>, with the indexed filter
  doing the narrowing before anything else runs. "All items, sorted by Modified" is exactly the
  query the threshold exists to reject.</li>
  <li><strong>Mind the type rules</strong> — not every column type can be indexed. Multi-value
  columns can't, calculated columns can't; the full list is a column of the
  <a href="#" data-guide-page="single-vs-multi">capability matrix</a>.</li>
</ul>

<div class="wb-guide-note wb-guide-note-info"><strong>Formatting is threshold-free.</strong>
Formatting JSON runs in the browser against rows a view already fetched — it can't trip either
threshold, and it can't rescue a throttled view either. If a view won't load, the fix is up
here in the query layer, not in the <a href="#" data-guide-page="formatting">JSON layer</a>.</div>
`,
  },

  {
    id: 'column-types',
    chapter: 'The column system',
    title: 'Columns as a type system',
    body: `
<h1>Columns as a type system</h1>
<p class="wb-guide-lede">Treat SharePoint's column types as a real type system with three families.
Which family a column belongs to predicts almost everything it can and can't do. This page is the
chapter's on-ramp; the pages nested under it take each family into the engine, ending at the
full <a href="#" data-guide-page="single-vs-multi">capability matrix</a>.</p>

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
    parent: 'column-types',
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
3 metadata columns is over the line, even though it "only" has 13 columns. The engine story
behind the cap is in <a href="#" data-guide-page="limits">Limits &amp; thresholds</a>.</div>

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
from the schema XML. If you import a list into FormatFX and an imported column's formatting
references a field that isn't there (the linter flags the unknown field), this omission is the
usual reason.</div>
`,
  },

  {
    id: 'calculated',
    chapter: 'The column system',
    title: 'Calculated columns',
    parent: 'column-types',
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
concatenation</td><td>lowercase <code>=if(…)</code>; no logical NOT at all — neither
<code>not()</code> nor a standalone <code>!</code> (flip <code>==</code>/<code>!=</code> or swap
branches); <code>+</code> concatenation</td></tr>
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
    parent: 'column-types',
    body: `
<h1>Single vs multi: the capability matrix</h1>
<p class="wb-guide-lede">The deep end of the column system — the reference table. Rows are column types; columns are the engine
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
Column formatters style one column; view (row) formatters lay out the whole row; tile formatters
drive the gallery layout. One more key you'll meet in wild samples: a view formatter can embed a
column's live formatter by reference (<code>columnFormatterReference</code>). Recognize it when
reading other people's JSON — but it's platform plumbing, not how you author here: in this app
formatting is built as <strong>components</strong>, a column wears one as its look, and export
compiles a self-contained formatter for whichever target you deploy — never a reference.
References: ${ext(MS.columnFormatting, 'column formatting')} ·
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
<tr><td><code>justify-self</code>, <code>order</code>,
<code>align-content</code>, <code>justify-items</code></td><td>dropped</td>
<td>restructure: alignment lives on the parent (<code>align-items</code>/<code>justify-content</code>);
order lives in the children array</td></tr>
<tr><td><code>align-self</code>, <code>pointer-events</code></td><td>reported dropped —
unverified; re-test before relying on it either way</td><td>safe route: <code>align-items</code>
on the parent; overlay elements + <code>cursor</code> for click affordance</td></tr>
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
<p>Every color class the sandbox emulates — background, text and border for each
theme token, plus the semantic status fills. Click any swatch to copy its class name,
ready to paste into <code>attributes.class</code>:</p>
<div id="wb-guide-colorwall" class="wb-guide-colorwall"></div>
<p class="wb-guide-fineprint">Palette tokens (<code>theme*</code>, <code>neutral*</code>, the status
hues) re-tint in dark mode and follow a pasted tenant theme. The
<code>sp-field-severity--*</code> status fills carry meaning (good → blocked) and show fixed
light-mode colors in this preview — SharePoint themes them on the real page.</p>

<h2 id="fm-expressions">Two expression syntaxes</h2>
<p>Excel-style strings (<code>"=if([$Status] == 'Done', '#107c10', '#a80000')"</code>) and the
older object/AST form (<code>{"operator": "?", "operands": […]}</code>) are both legal and both
common in community samples. They're equivalent in power; the string form reads better. This
app's engine implements both, so pasted samples in either dialect render and lint.</p>
<p>For the dialect's sharp edges — whitespace, the missing logical NOT, nested <code>=</code>,
XML-escaped operators — go straight to <a href="#" data-guide-page="gotchas">the gotchas</a>.</p>
`,
  },

  {
    id: 'icons',
    chapter: 'The JSON layer',
    title: 'The icon gallery',
    parent: 'formatting',
    body: `
<h1>Icons: the <code>iconName</code> attribute</h1>
<p class="wb-guide-lede">SharePoint renders a Fluent UI (MDL2) icon wherever an element carries an
<code>iconName</code> attribute — <code>{ "elmType": "span", "attributes": { "iconName": "CheckMark" } }</code>.
No image, no URL, no upload: a single name pulls a crisp, theme-coloured glyph from the font the
list UI already ships.</p>

<h2 id="ic-use">How to use one</h2>
<p>Add an <strong>Icon</strong> from the palette (or set <code>iconName</code> on any element), then
select it and open the <strong>Icon</strong> slot in the fx bar — the chips show common icons with a
live preview, and <em>⊞ All icons…</em> opens the full searchable gallery below. Always pair an icon
with a <code>title</code> so it has an accessible tooltip.</p>
<div class="wb-guide-gotcha">${sev('info')}<h3>Every icon here is verified to render in SharePoint</h3>
<p>The gallery is the exact set whose names resolve on a real list — pick from it and the formatter
is guaranteed to show the glyph, not an empty box. Names are case-sensitive and map 1:1 to the
Fabric <code>ms-Icon--&lt;Name&gt;</code> class used for the previews.</p></div>

<h2 id="ic-gallery">Browse the full set</h2>
<p>Search by name (e.g. <em>check</em>, <em>arrow</em>, <em>person</em>) or scan by theme. Click any
icon to copy its name to the clipboard, ready to paste into <code>iconName</code>.</p>
<div id="wb-guide-iconwall" class="wb-guide-iconwall"></div>
<p class="wb-guide-foot-note">Reference: ${ext(MS.syntaxRef, 'formatting syntax reference')} ·
${ext('https://developer.microsoft.com/en-us/fluentui#/styles/web/icons', 'Fluent UI icon list')}.</p>
`,
  },

  {
    id: 'actions',
    chapter: 'The JSON layer',
    title: 'Commands & actions',
    parent: 'formatting',
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
<tr><td><code>copyLink</code> / <code>comment</code> /
<code>openApprovalDialog</code></td><td>the copy-link dialog, the comments pane, and the
approval dialog — runtime-accepted beyond the published schema (verified working in the
pnp/List-Formatting samples)</td></tr>
<tr><td><code>previewFileAction</code> / <code>copyFile</code> /
<code>moveFile</code></td><td>file preview / copy / move dialogs — <strong>document libraries
only</strong>; on a plain list the button renders but the click does nothing (the linter
reminds you)</td></tr>
<tr><td><code>executeQuickStep</code></td><td>fire an existing Quick Step —
<code>actionInput</code> carries its <code>ruleTemplateId</code>. <strong>Undocumented</strong>:
not in the published schema, and the id is unversioned and list-specific, so the linter always
warns. Prefer documented primitives where they can reproduce the action.</td></tr>
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
<p>Field notes for cards (details in <a href="#" data-guide-page="gotchas">gotchas</a>): give
the card a dedicated trigger — an absolutely-positioned overlay div, or a <code>button</code>
with direct <code>txtContent</code> — rather than hanging <code>customCardProps</code> on a div
full of children, whose clicks have been seen to get swallowed. And a note for pasted view JSON:
<code>columnFormatterReference</code> — the platform's embed-a-column-formatter key, which this
editor never emits — works inside card content, referenced formatters that open cards of their
own included (an old "renders blank" rule was retracted on production evidence).</p>

<h2 id="ac-foreach">forEach — the loop that pairs with all of this</h2>
<p><code>"forEach": "_item in [$MultiValueField]"</code> repeats an element per value — the
standard way to render multi-value joins as chips, facepiles, tag rows. Convention: prefix the
iterator with an underscore so it can't shadow a field reference. One hard scope rule:
<code>forEach</code> over a <code>split()</code> expression on the <strong>root element</strong>
kills the whole formatter — wrap it and loop on a child, where it works fine.</p>
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
with screenshot comparison (2026-06-11), and entries marked <em>unverified</em> are canon under
review — treat those as cautions, not laws. Two old rules were retracted outright on production
evidence (2026-06-13); they're kept below so they stay dead.</p>

<h2 id="go-expr">Expression language</h2>

<div class="wb-guide-gotcha">${sev('warning')}<h3>The Zero Whitespace Rule — verified scope: split()</h3>${lintRule('zero-whitespace')}
<p>The verified case: spaces outside quoted literals <em>inside a <code>split()</code>
expression</em> silently kill the formatter. The generalized folklore — "no spaces in any
expression, ever" — is long-standing canon but is <strong>not</strong> verified; plenty of
spaced expressions render fine. Shipping tight JSON costs nothing (this app's exports strip
unquoted whitespace anyway, and the linter notes non-split cases as info-level precaution),
so author readable and sanitize on export — just don't treat every space as a fire.</p></div>

<div class="wb-guide-gotcha">${sev('error')}<h3>There is no logical NOT</h3>${lintRule('no-not-function / no-bang-operator')}
<p>Neither <code>not()</code> (that's the calculated-column Excel dialect bleeding over) nor a
standalone <code>!</code> prefix exists in the formatting dialect — the only legal use of that
character is <code>!=</code> (not-equals). Negate <em>inside</em> the expression instead: turn
<code>==</code> into <code>!=</code>, <code>&lt;</code> into <code>&gt;=</code>, compare a
yes/no field with <code>== false</code>, or swap the <code>if()</code> branches.</p></div>

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

<div class="wb-guide-gotcha">${sev('info')}<h3>@currentField swaps inside a columnFormatterReference</h3>
<p>Platform trivia for reading JSON from the wild: a hand-written view formatter can embed a
column's live formatter with <code>columnFormatterReference</code>, and inside the referenced
formatter <code>@currentField</code> is the <em>referenced</em> column, not the host's. Correct
and convenient — until you forget while deciphering someone else's row formatter. In your own
work here the swap can't bite: this editor brings imported column formatters in as
component-shaped looks and never emits a reference.</p></div>

<div class="wb-guide-gotcha">${sev('info')}<h3>The calculated TODAY drift</h3>
<p>Calculated columns evaluate at save time only. A stored "days late" goes stale the moment
midnight passes. Time-relative logic belongs in formatting expressions with <code>@now</code>
(evaluated per render). See <a href="#" data-guide-page="calculated">Calculated columns</a>.</p></div>

<h2 id="go-structure">Structure, cards and loops</h2>

<div class="wb-guide-gotcha">${sev('info')}<h3>Card triggers: give the card a dedicated trigger</h3>${lintRule('card-trigger-button')}
<p><code>customCardProps</code> on a <code>div</code> full of children: the children have been
seen to swallow the click so the card never opens. Field observation, not gold-certified — but
the patterns that hold up are an <strong>absolutely-positioned overlay div</strong> as the
dedicated trigger (the preferred one), or a <code>button</code> with direct
<code>txtContent</code>.</p></div>

<div class="wb-guide-gotcha">${sev('info')}<h3>columnFormatterReference inside cards works (old canon said otherwise)</h3>
<p>Retraction, kept for anyone deciphering pasted view JSON: an earlier version of this guide —
and the imported team canon — claimed <code>columnFormatterReference</code> inside a
<code>customCardProps</code> formatter renders blank. <strong>It doesn't.</strong> References
inside card content run in production constantly, including referenced column formatters that
open cards of their own. The limits that <em>are</em> documented: a reference isn't resolved
multi-level, and references to multi-choice template formatters aren't supported
(${ext(MS.syntaxRef, 'syntax reference')}). Platform rules only — this editor never emits a
reference, so they constrain JSON you deploy by hand, not anything you build here.</p></div>

<div class="wb-guide-gotcha">${sev('error')}<h3>forEach + split() on the root element</h3>${lintRule('foreach-split-scope')}
<p>The verified failure: <code>forEach</code> over a <code>split()</code> expression on the
<strong>root div</strong> kills the whole formatter. On child elements it works — wrap the loop
in a parent div and put the <code>forEach</code> on a child. Convention: underscore-prefix
iterators (<code>_tag in [$Tags]</code>) so they can't shadow field refs
${lintRule('foreach-iterator-underscore')}.</p></div>

<div class="wb-guide-gotcha">${sev('info')}<h3>inlineEditField inside forEach works (old canon said otherwise)</h3>
<p>Retraction: the imported canon called <code>inlineEditField</code> inside a
<code>forEach</code> "unreliable". Production formatters render inline editors on looped
elements (text and similar columns) without trouble — the old lint rule is gone, and the
pattern isn't discouraged.</p></div>

<div class="wb-guide-gotcha">${sev('warning')}<h3>Non-schema keys: mostly ignored, once bitten</h3>${lintRule('comment-placement')}
<p>SharePoint ignores unknown keys as a rule — this app's <code>_elmName</code> labels ship in
exported JSON precisely because SP doesn't care. But there is a remembered (unverified, pending
re-test) incident of a <code>_comment</code> sibling of <code>elmType</code> breaking a
formatter. Until that's re-verified: keep annotations inside <code>style</code> objects, and be
deliberate about inventing keys anywhere else.</p></div>

<div class="wb-guide-gotcha">${sev('error')}<h3>class, not className</h3>${lintRule('class-not-classname')}
<p>The schema uses HTML attribute names: <code>attributes.class</code>. <code>className</code>
is a JSX habit the renderer ignores.</p></div>

<h2 id="go-css">CSS layer</h2>

<div class="wb-guide-gotcha">${sev('warning')}<h3>Off-list styles drop silently</h3>${lintRule('css-unknown / css-unsupported')}
<p>Anything not on the allow-list — <code>var()</code>, <code>calc()</code>, grid, transitions,
animations, filters, <code>order</code> — silently never paints. Two long-listed entries are
softer than canon claimed: <code>align-self</code> and <code>pointer-events</code> are
<em>reported</em> dropped but unverified — re-test before designing around either, in either
direction. The full table lives in <a href="#" data-guide-page="formatting">the JSON layer</a>.
Non-<code>translate</code> transforms: treat as suspect ${lintRule('css-transform')}.</p></div>

<div class="wb-guide-gotcha">${sev('info')}<h3>.sp-card-formatterRef outside card markup goes invisible</h3>
<p>Live-verified (2026-06-11): in LIST row context, an element carrying the
<code>.sp-card-formatterRef</code> class renders <code>visibility: hidden</code> — occupies
layout, never paints — and this app's preview reproduces that. Scope it correctly, though: the
class belongs to the <code>sp-card-*</code> gallery/card vocabulary, where hand-written card
JSON uses it as the standard wrapper around an embedded column formatter (typically a
<code>columnFormatterReference</code>). Pair it with card-classed containers
(<code>sp-card-container</code> and friends); anywhere else it just hides things. A pasted
sample that goes blank in a list view often has this class riding along — the verified
invisibility is "this class used outside card markup", not a defect of the content it wraps.</p></div>

<h2 id="go-platform">Platform &amp; tooling</h2>

<div class="wb-guide-gotcha">${sev('warning')}<h3>Schema export omits calculated and lookup columns</h3>
<p>SharePoint's <em>Export to CSV with schema</em> leaves calculated and lookup columns out of
the schema XML, and exports empty multi-lookups as the literal string <code>"[]"</code>
(verified 2026-06-11). An imported look whose expressions hit unknown-field lint flags usually
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
columns (types, choices, read-only flags), up to ten real rows, and each column's live formatter
as that column's <strong>look</strong> — component-shaped formatting already applied to the
column, worn in the grid the moment the import lands. Imported looks aren't silently editable
(they arrived without a component to edit); <em>Save as component…</em> in the column header
menu lifts one into a real, editable component — one gesture away. Remember the export blind
spot from the <a href="#" data-guide-page="gotchas">gotchas</a>: calculated and lookup columns
won't be in the schema XML; add them in the Data tab if your formatting references them.</p>

<h2 id="fx-components">Columns are data; components do the formatting</h2>
<p>There is no per-column formatter editor in this app, because a column doesn't own formatting —
it <em>wears</em> it. The unit you build is a <strong>component</strong> (⬡): packaged
formatting with typed slots for the columns it consumes. Apply one to a grid column and that
becomes the column's look; swap it for another, or pick <em>Remove the look</em> in the header
menu, and the column is plain data again — each a single undo step. Editing happens in the
component's workshop: change the component once, save, and every column and view wearing it
updates. At deploy time each look compiles into a self-contained SharePoint column formatter
(<code>@currentField</code> dialect) on demand, and views export as view formatters — nothing
you ship leans on <code>columnFormatterReference</code> or any other cross-formatter wiring.</p>

<h2 id="fx-linter">Let the linter teach</h2>
<p>The JSON tab's diagnostics are the <a href="#" data-guide-page="gotchas">gotchas page</a> in
executable form — Zero Whitespace, the missing logical NOT, nested <code>=</code>, XML entities,
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

/**
 * Nav-tree depth per page id, from the parent chain. 0 = a chapter's
 * plain-language on-ramp; each level down is more technical (the nav indents
 * accordingly). A typo'd parent or a parent cycle throws right here at module
 * init — fail fast beats a frozen UI (or a hung test import). The stricter
 * editorial invariants (parent precedes child, same chapter, depth ≤ 2) live
 * in guideContent.test.ts.
 */
export const GUIDE_DEPTH: ReadonlyMap<string, number> = (() => {
  const byId = new Map(GUIDE_PAGES.map((p) => [p.id, p]));
  const depth = new Map<string, number>();
  for (const page of GUIDE_PAGES) {
    let d = 0;
    let cur = page;
    while (cur.parent) {
      const parent = byId.get(cur.parent);
      if (!parent) throw new Error(`guide page "${cur.id}" names a missing parent "${cur.parent}"`);
      if (++d > GUIDE_PAGES.length) throw new Error(`guide page "${page.id}" sits on a parent cycle`);
      cur = parent;
    }
    depth.set(page.id, d);
  }
  return depth;
})();
