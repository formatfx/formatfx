# Connectivity — extraction, deployment, automation (design, 2026-06-12)

> Owner brief: pull a list's live formatting + configuration out; push it
> back with near-real-time, single-click-ish deploys; maybe grow into
> lists-as-code. HARD CONSTRAINT: **no app registrations, no tenant
> admin — site permissions only.** The npm name `formatfx` is staked with
> a real package (see §6).

## 1. The auth reality (dated; treat as closed, like HANDOFF §3)

- Azure ACS / SharePoint Add-in auth **stopped working 2026-04-02**.
- PnP.PowerShell has required **your own Entra app registration** for
  `-Interactive`/`-Credentials` since **2024-09-09**.
- ⇒ There is no app-registration-free path for Node CLIs or PowerShell.
  The ONLY zero-setup authentication left is **code running in the
  user's own authenticated browser session on the SharePoint page**:
  cookies the page already has, a form digest from
  `POST /_api/contextinfo`, and the user's own permissions. This is why
  sp-formatter is a browser extension. Every tier below follows from
  this fact — do not burn sessions re-deriving it.

## 2. The tiers

| Tier | Setup | Capability | Status |
|---|---|---|---|
| **0 — snippet bridge** | none | extract a list into FormatFX / deploy a formatter back, via pasted devtools snippets | **SHIPPED 2026-06-12** |
| **1 — companion extension** | one install | same, single-click, plus a live channel later | design (§4) — **next up** (reordered ahead of all remaining Sheet stages, 2026-06-15) |
| **2 — lists-as-code** | Entra app (org) | generated PnP.PowerShell + CI recipe for formatting AND structure | design (§5) |
| **npm `formatfx`** | — | core engine as a library + CLI linter | prep next (§6) |

## 3. Tier 0 — the paste-snippet bridge (shipped)

### 3.1 The FormatFX List Snapshot format (v1)

The fourth auto-detected import format (`core/schemaImport.ts`), and —
deliberately — the future extension wire protocol. Versioned from day one;
a `version` greater than the app understands gets a friendly refusal.

```jsonc
{
  "formatfx": "list-snapshot",      // discriminator
  "version": 1,
  "capturedAt": "2026-06-12T…Z",
  "siteUrl": "https://…/sites/team",
  "list": "Tasks", "listId": "guid",
  "fields": [{
    "internalName": "Status", "displayName": "Status", "type": "Choice",
    "choices": ["Not started", "Done"],          // when present
    "lookupList": "Projects", "lookupColumn": "Title", // lookups only
    "readOnly": false, "hidden": false,
    "customFormatter": "{…raw JSON string…}"     // when present
  }],
  "views": [{
    "title": "All Items", "id": "guid", "isDefault": true,
    "viewFields": ["LinkTitle", "Status"],
    "customFormatter": "{…raw JSON string…}"     // when present
  }],
  "rows": [ /* ≤10, plain OData nometadata shapes */ ]
}
```

`customFormatter` stays a **raw string** end to end: capture is faithful;
parse problems surface at import time as teaching toasts, never silently
at capture time.

### 3.2 Extraction snippet (`src/bridge/extractSnippet.ts`)

`buildExtractSnippet(opts?)` returns a **commented, unminified, GET-only**
async IIFE (~120 lines) the user pastes into devtools on their list page.
Auditability is a product feature: a maker (or their IT) can read every
line; there is no bundled library blob. Contract:

1. Target = the list you're on (`_spPageContextInfo.pageListId`), or a
   baked-in list title; neither → teaching error ("open your list page").
2. `GET …/fields?$filter=Hidden eq false&$select=…,CustomFormatter,…`,
   `GET …/views?$expand=ViewFields&$select=…,CustomFormatter,…`,
   `GET …/items?$top=10` with `$select`/`$expand` derived from the field
   list — **expands capped at 12** (SPO's lookup-join threshold; fields
   beyond the cap are gap-filled with sample values at import, the same
   path the CSV import uses). All requests
   `Accept: application/json;odata=nometadata`.
3. Payload → `navigator.clipboard`, with a console fallback; a human
   summary logs what was captured and where to paste it.

Chrome note surfaced in the UI: devtools may demand typing
"allow pasting" first (the self-XSS guard) — that is Chrome being
careful, and exactly why the snippet is readable.

### 3.3 Deploy snippet (`src/bridge/deploySnippet.ts`)

`buildDeploySnippet({ target: 'field'|'view', name, formatterJson,
listTitle? })` — the formatter is baked in (double-encoded). Flow:

1. Resolve list (as above); `GET` the target's current `CustomFormatter`.
2. `confirm()` with a full echo — list, target, "currently has a
   formatter (N chars), it will be REPLACED" vs "currently none".
3. `POST /_api/contextinfo` → `FormDigestValue`.
4. MERGE: `POST fields/getByInternalNameOrTitle('…')` (or
   `views/getByTitle('…')`) with `X-RequestDigest`, `IF-MATCH: *`,
   `X-HTTP-Method: MERGE`, nometadata body `{"CustomFormatter":"…"}`.
   (nometadata deliberately avoids verbose-mode's per-type
   `__metadata.type` requirement.)
5. Re-GET and echo old→new; "refresh the list to see it." Errors teach:
   401/403 → you need Edit (Manage Lists) on this list; 404 → internal
   vs display name lesson; 412 → stale digest, rerun.

Generation is **lint-gated**: the Deploy panel refuses while the document
has lint errors — SP would accept the write and render blank. CSOM-safe
escaping is NOT applied (REST stores the raw string).

### 3.4 Permissions (the honest table)

| Action | Needs |
|---|---|
| extract (all GETs) | view permissions on the list |
| set field/view CustomFormatter | **ManageLists — included in the default Edit level**, so ordinary members usually can; the 403 copy explains when they can't |
| create lists/views/fields (Tier 2) | site owner |
| site columns / content types (Tier 2, optional) | site owner (site-collection scope for some) |

### 3.5 UX placement

- **Extract**: Data tab → Import schema → "⚡ Live from SharePoint (no
  install)" — copy snippet + 3 steps. Basic-visible (read-only, guarded).
- **Views**: a snapshot's default-view formatter auto-loads as the main
  document **only** under the untouched-pure-grid guard (same rule, same
  single undo step as the grid rebuild it replaces). Other captured views
  appear under "Views from your list" with Load-as-main (named-design soft
  confirm) and Copy. `state.importedViews` rides the existing project
  key — additive; old builds ignore it.
- **Deploy**: JSON tab → Deploy… (advanced-only for click-safety until
  the Sheet shell lands; revisit then).

### 3.6 Test boundary

- Unit (vitest): snapshot parsing; snippet string contracts (endpoints,
  extractor contains no write verbs); **executed-snippet round-trips** —
  the generated code is `eval`'d with stubbed `fetch`/`_spPageContextInfo`
  /`clipboard`/`confirm` against canned OData fixtures, and the captured
  payload is fed straight back through `importSchema()`. Deploy: digest-
  before-MERGE order, headers/body, confirm-false aborts, 403 teaching.
- e2e (Playwright): paste a synthetic snapshot; view auto-load vs the
  views section; Deploy panel render/lint-gate/copy.
- **One-time live checklist (owner's tenant; the only unverifiable part
  from CI):** ☐ extract snippet on a real list page (clipboard + summary)
  ☐ paste imports fields/formatters/views/rows ☐ deploy snippet on a test
  column: confirm echo, MERGE accepted, formatter live after refresh
  ☐ same for a view ☐ a >12-lookup list extracts without a 500.

## 4. Tier 1 — companion browser extension (design only)

MV3, lives in **`extension/` in this repo** (owner decision): own
package.json, exempt from the app's zero-dep rule, CI in one place,
imports the Snapshot types directly. Content script on SP list pages ⇄
the formatfx.dev tab via extension messaging; the protocol is the List
Snapshot format plus an `apply` message (same payloads the snippets use —
Tier 0 is the dress rehearsal). `optional_host_permissions` so users
grant only their tenant. Later: a live-preview channel (sp-formatter's
proven pattern).

**Sequencing (reordered 2026-06-15, owner decision):** the extension is now
the immediate next work, **ahead of Sheet stages 2 and 3** — not gated
behind the Sheet shell. The original gate ("Apply from FormatFX" deserves
the Sheet surface) is consciously traded away: the Apply/Extract UI ships in
today's Basic/Advanced surface and migrates into the Sheet shell when stage
3 lands. This is clean because the extension reuses the shipped Tier-0
bridge contracts (`src/bridge/`) and needs neither the transpiler nor the
shell. The Sheet stages still run 1 → 2 → 3 in `docs/SHEET-MODE.md`; only
the extension's position relative to them changed.

## 5. Tier 2 — lists-as-code (design only)

Owner decision: **formatter-first**. The project file does NOT become the
source of truth for list structure; structure is a separate explicit
artifact — the List Snapshot plus a generated, idempotent PnP.PowerShell
script (`Set-PnPField`/`Set-PnPView` CustomFormatter; `Add-PnPField`/
`Add-PnPView` for missing pieces; optional site columns/content types),
plus a GitHub Actions recipe (cert auth). Stated up front, always: this
tier **requires a registered Entra app** — unattended auth cannot avoid
it post-ACS. Mechanical string generation once wanted; no urgency while
the Tier-0 deploy snippet covers "near-real-time with a little setup".

## 6. npm package `formatfx` (prep next, separate PR)

`src/core` (+ `src/bridge`) published as a library with a tiny CLI:
`npx formatfx lint formatter.json` / `validate` — the teaching linter,
headless, zero dependencies. tsc-only build to `dist-lib/` (hermetic from
the app/single-file builds) + a dependency-free ESM-extension fixer;
curated surface in `src/lib.ts` (renderer excluded from the docs — it
needs a DOM; the sandbox IS the renderer); release workflow publishes on
a `v*` tag with the owner's `NPM_TOKEN`. 0.x until the surface survives
pnp/List-Formatting outreach.

## 7. Verdicts

- **PnPjs**: not used. Tier 0/1 speak raw REST over ~6 endpoints; a
  pasted snippet must be auditable, and PnPjs would be the project's
  first runtime dependency for no capability we lack. The extension may
  revisit (its own package).
- **sp-formatter**: complementary, not a PR target — it enhances the
  native pane's *code* editor; FormatFX is the *visual* editor/sandbox.
  We adopt its architecture lesson (page-context extension; local
  session for live sync) and stay interop-friendly via the Snapshot
  format. Credit it in any announce.

## 8. Decision log

- Snapshot payload doubles as the extension protocol — versioned v1.
- `RenderListDataAsStream` rejected for row capture (under-documented,
  shifting shapes); plain OData GETs with derived expands instead.
- View auto-load only under the existing untouched-pure-grid guard.
- Deploy gated to Advanced until the Sheet shell; lint-gated always.
- `tools/Export-ListSchema.ps1` demoted to the "I already use PnP" path,
  its auth guidance modernized (own ClientId), not deleted.
- Snippets stay self-contained, commented, auditable; `src/bridge` stays
  dependency-free and node-tested (house rule, also in CLAUDE.md).
- **2026-06-15:** Tier 1 (companion extension) reordered **ahead of Sheet
  stages 2 and 3** — it is now the immediate next work, no longer gated
  behind the Sheet shell (§4). Accepted consequence: the Apply/Extract UI
  ships in today's surface and migrates into the Sheet shell later.
