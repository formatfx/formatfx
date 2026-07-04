# Visual compare — sandbox vs real SharePoint

Ground-truth harness: take a FormatFX workspace, render it in the sandbox,
**provision a real SharePoint list from it** — columns, data rows, column
formatters, view formatter — and compare what the two surfaces actually
painted, pixel crops included. The private predecessor repo had a
tenant-coupled version of this; this is the public, tenant-agnostic rebuild.
Nothing tenant-specific is checked in — your site URL comes from the
environment and your login lives in a git-ignored storage-state file.

**This never runs in CI.** The auth model is your own browser session
(cookies + form digest — the only app-registration-free path, see
docs/CONNECTIVITY.md §1), and that can't and shouldn't exist on a runner.
The specs use a `.vspec.ts` suffix so `npm run test:ui` / the CI `e2e` job
never even discover them; they only run through the `visual:*` scripts below.

## One-time setup

```sh
SP_SITE_URL=https://yourtenant.sharepoint.com/sites/yoursite npm run visual:auth
```

A headed browser opens on your site. Sign in (MFA and all); the harness
notices when `/_api/web/title` starts answering and saves your session to
`e2e/visual-compare/.auth/sp-state.json` (git-ignored). Re-run whenever the
session expires.

## Each run

```sh
SP_SITE_URL=https://…/sites/yoursite \
SP_SHARE_URL='https://…/#w1…your share link…' \
npm run visual:compare
```

**The workspace IS the fixture.** Hit Share in the app (include data), paste
the link as `SP_SHARE_URL` — that's "test MY design". Leave it unset and the
harness mints a link from the app's default workspace, so even the smoke run
exercises the share codec.

1. **Sandbox side** — renders the workspace from its share fragment on the
   local dev server and captures every formatted, placed grid column: DOM
   probes (visible text + painted background of the formatter's own output)
   plus pixel crops of the painted element.
2. **SharePoint side** — decodes the same link in Node with the app's own
   codec (`core/share.ts`), then provisions the list named by `SP_LIST`
   (default `FormatFX Visual Compare`): deletes any previous run's list,
   recreates it, creates every creatable column (person/lookup columns are
   skipped with a note — they need principals a test rig can't fabricate),
   adds the rows, MERGEs each column formatter, and puts the view formatter
   on a second view (`FormatFX View Compare`) so the default view keeps
   SharePoint's native cell DOM for symmetric crops.
3. **Verdict** (`verdict.ts`) — scored on the default view's formatted
   cells: text must match exactly; colors are lenient (only a different
   color *family* fails — `COLOR_DELTA_LIMIT`); pixel crops are diffed with
   `pixelmatch` and fail past `PIXEL_MISMATCH_LIMIT`. Every cell pair gets a
   sandbox|SharePoint|diff triptych attached; the view-formatter view is
   captured as whole-row shots for human review (unscored in v1).
   Report: `npx playwright show-report e2e/visual-compare/report`.

Missing `SP_SITE_URL` or auth state? The SharePoint half skips and the
sandbox half still runs — so the harness itself stays testable anywhere.

## Ground rules

- Point `SP_LIST` at a **sacrificial list name**: the harness DELETES and
  recreates that list every run, without confirmation. Never aim it at a
  list anyone works in. (The in-product deploy snippet keeps its
  confirm-first behavior; that rule is for makers' real lists, this is a
  test rig.)
- Dependencies: `pixelmatch` + `pngjs`, dev-only, for the pixel comparison
  (owner-approved 2026-07-04). The runtime app stays at zero dependencies,
  and everything here is plain commented `fetch` against `/_api` — same
  auditability bar as `src/bridge/`.
- First live run against a tenant may need small tweaks; the numbered
  ⚠ watch spots in `sp.ts`, `compare.vspec.ts` and `workspace.ts` mark the
  likely places (OData flavor on field creation, modern-list DOM selectors,
  multi-choice item payloads).
