# SPFx Format panel — design (2026-09-16)

> Owner decisions from the 2026-09-16 brainstorm. Status: **approved design,
> not yet planned.** Next step is a half-day throwaway spike (§9), then an
> implementation plan.

## 1. What it is

A SharePoint Framework (SPFx) **ListView Command Set** that adds one **Format**
button to every list's command bar and opens a FormatFX panel for that list.
The panel edits **one formatter at a time** (a column or a view), writes it
through the user's own page session, and keeps drafts and history in a hidden
list on the site.

It replaces the Chrome extension and the paste snippets for anyone on a site
where the package is installed. CONNECTIVITY §1 (the browser session is the
only app-registration-free auth path) still holds; SPFx simply *is* code
running in that session, so the constraint stops shaping the product.

## 2. Decisions (locked)

1. **Entry:** a "Format" button in the list command bar. Nothing else is
   injected anywhere on the page.
2. **Container:** a right-side panel sized for the editor, with an
   expand-to-full-page toggle. Preview never shapes the layout (§5).
3. **Editing unit:** one column or one view at a time — exactly how
   SharePoint stores formatters. One document, one undo stack, one write,
   one history row.
4. **Navigation:** a tree in the panel whose root is the list, with branches
   for its views and its columns. Badge on anything already formatted, dot
   on anything with a draft. Picking a different view navigates the page to
   that view so the list on screen always matches the target.
5. **Editor:** three tabs over one document — **Rules, Formulas,
   Structure** — plus the validated-JSON pane as the escape hatch off
   Structure. The panel opens on the tab the person used last (per-browser
   convenience, not a setting).
6. **Drafts and history:** a hidden **FormatFX** list on the site (§6).
   Switching targets stashes the draft silently — no prompt. Rollback is one
   click.
7. **Apply:** one MERGE, preceded by a stale check (§7).
8. **Thrown away for this surface:** the mock grid, sample rows, import and
   export, the extension, the sandbox renderer.
9. **Not in v1:** recipes (type-aware starters — deferred, owner call), live-
   apply mode, the site-wide dashboard, multi-target push, Field/Form
   Customizers, sovereign clouds.
10. **Build:** a separate top-level `spfx/` package like `extension/`, exempt
    from the zero-runtime-dependency rule. No React, no Fluent UI. The panel
    is FormatFX's vanilla DOM mounted in a **shadow root** appended to the
    page body.

## 3. The tab ladder

Each tab edits a closed subset of the document, nested:
Rules ⊂ Formulas ⊂ Structure. Which tabs can *edit* a given document is a pure
function of the document (node-tested, no UI). When a document exceeds a tab,
that tab shows it read-only with one sentence naming what only the next tab
can express. **Lossless or refused, never lossy** — the same rule the dialect
transpiler already enforces one level down.

- **Rules** — the conditional-formatting manager: a base style plus an
  ordered stack of "when this, then that" rules built with the type-aware
  condition builder (`condRules.ts`).
- **Formulas** — the Sheet-mode fx bar: property slots, each accepting an
  expression (`fxSlots.ts`, `fxSuggest.ts`, `dialect.ts`).
- **Structure** — the element tree plus inspector, with the JSON pane off it.

## 4. Package and hosting

- `spfx/` at the repo root: its own `package.json`, the SPFx toolchain
  (heft/gulp, pinned Node), producing an `.sppkg`. Deployed to the **site
  collection app catalog**. No API permissions, no tenant admin.
- The host is thin: a Command Set that appends a shadow-root container to
  `document.body`, mounts the panel, and exposes page context (site URL,
  list id, current view id) to it.
- Engine and editor modules are consumed from the main repo's `src/` the way
  `extension/` already consumes `src/bridge/` — either as a prebuilt bundle
  handed to SPFx as a local package, or by direct import through SPFx's own
  build. Which one is a spike question (§9.2).
- Auth and REST: same-origin `fetch` with the page's cookies and a digest
  from `POST /_api/contextinfo`, i.e. the calls `src/bridge/spClient.ts`
  already makes. `SPHttpClient` is optional sugar, not a requirement.
- Permissions: anyone with Manage Lists on the list can format it — the same
  rule SharePoint itself applies.

## 5. Panel layout

- **Left:** the tree (§2.4).
- **Right:** the three tabs (§3) over the open document.
- **Bottom:** Apply, and a History drawer for the open target with one-click
  rollback.
- **Preview:** optional and small — at most a strip of real rows fetched via
  REST and rendered by FormatFX's renderer. It may be omitted entirely. It
  never dictates panel width or layout.
- Column formats are labelled as applying to *every view of this list*; view
  formats as applying to *this view only*. The tree says so in words.

## 6. The hidden list

Title `FormatFX`, hidden, created on first use if missing (needs Manage
Lists). If the person cannot create it, drafts fall back to **per-tab
browser storage** (`sessionStorage`, a per-viewer convenience) so a view
switch or reload never loses an unstashed edit, applied history is kept in
that tab only, and the panel says plainly that nothing is shared or durable.

One row per event:

| Column | Meaning |
|---|---|
| Kind | `Draft`, `Pending`, `Applied`, or `Failed` |
| ListId | target list GUID |
| TargetKind | `Field` or `View` |
| TargetId | field internal name or view GUID |
| Before | formatter JSON before the write (Pending/Applied/Failed) |
| After | formatter JSON written, or the draft document |
| BasedOn | hash of the formatter the draft/apply was based on |
| Author / Created | who, when (system columns) |

- **Drafts are per person** (one row per person + target); two owners never
  trample each other's unfinished work. Opening a target loads your draft if
  one exists.
- **The journal is written before the list is.** An apply first writes a
  `Pending` row carrying `Before` and `After`, then performs the MERGE, then
  flips the row to `Applied` after a verifying re-read. A `Pending` row that
  never flipped (the tab died, the flip failed) shows in the History drawer
  as *unconfirmed* with a "check" action: re-read the target; if it matches
  `After` the row becomes `Applied`, otherwise `Failed`. So a changed
  formatter can never exist without its `Before` on record.
- **Rollback** = an Apply whose payload is a previous Applied row's `Before`.
  It goes through the same Pending → Applied journal, so history is
  append-only.

## 7. Apply

1. Read the target's current `CustomFormatter` **and its ETag** (if the
   entity exposes one — spike question §9.4).
2. Compare to `BasedOn`. If different, warn: someone changed this since you
   started — show both, let the person choose overwrite or reload.
3. Write the `Pending` journal row (§6) with `Before` and `After`.
4. `POST /_api/contextinfo` → digest; one MERGE on the field or view
   (nometadata body `{"CustomFormatter": "…"}`) with `IF-MATCH: <etag>` from
   step 1, so a change that lands between the read and the write is refused
   rather than overwritten. `spClient.applyFormatters` sends `IF-MATCH: *`
   today; the panel's client must not. If §9.4 finds no usable ETag, the
   window is narrowed instead: re-read immediately before the MERGE and
   return to step 2 on any difference.
5. Re-read, verify it matches `After`, flip the journal row to `Applied`,
   echo.
6. Errors teach: 401/403 → you need Manage Lists on this list; 403 with
   "security validation" → digest expired, rerun; **412 → someone changed
   this since you started** (back to step 2, never "rerun"); 404 → internal
   vs display name.

## 8. Testing

- Every new pure module is node-tested from the root suite: the tab ladder,
  the log record shapes and hashing, the draft/rollback state machine, the
  apply client via the existing round-trip harness in `bridge.test.ts`.
- End-to-end: the Command Set cannot run in the local `.aspx` fixture server;
  it needs a real list with `?debugManifestsFile=`. Unit coverage carries the
  load; the tenant check is a manual smoke by the owner until the MCP browser
  has a live M365 session again.

## 9. The spike (first step, throwaway)

Half a day, answers only, no code kept:

1. Does a Command Set instance survive SharePoint's client-side view switch,
   or is it re-created? (Affects how the panel reopens after §2.4 navigation;
   server-side drafts make either answer workable.)
2. How does the SPFx build consume the parent repo's engine (`src/core`,
   `src/bridge`) **and editor** (`src/editor`) modules: (A) as a prebuilt
   esbuild bundle of that source handed to SPFx as a local package, or (B)
   by importing the source directly through SPFx's own webpack/TypeScript
   build? Both variants run; the answer names the one the product uses.
3. Confirm: a shadow-root panel appended to `document.body` renders and
   receives input without SharePoint's global styles or key handlers
   interfering — checked after event dispatch completes, so a page-level
   handler that cancels a key is caught.
4. Do `SP.Field` and `SP.View` entities return an ETag (response header or
   `odata.etag`) that a MERGE can send as `IF-MATCH`? Decides whether §7's
   write is atomic or only narrowed.

## 10. Later (explicitly out of scope now)

- **Recipes:** a pure, type-aware catalog of starters (Choice → status pill,
  Date → overdue warning, …) filled from the column's real values; would sit
  as a fourth tab left of Rules.
- **Live-apply mode:** a panel toggle where every gesture writes and reloads
  the view — the real list as the preview. For test lists nobody else is
  looking at. A convenience, not a capability.
- **Site-wide dashboard:** every list, every formatted target, the component
  library, the full history log, and push-one-style-to-many.
