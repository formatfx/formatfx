# Visual compare — sandbox vs real SharePoint

Ground-truth harness: render a formatter in the FormatFX sandbox, deploy the
same JSON to a **real SharePoint list**, and compare what the two surfaces
actually painted. The private predecessor repo had a tenant-coupled version
of this (HANDOFF "What was excluded at extraction"); this is the public,
tenant-agnostic rebuild. Nothing tenant-specific is checked in — your site
URL comes from the environment and your login lives in a git-ignored
storage-state file.

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
SP_SITE_URL=https://yourtenant.sharepoint.com/sites/yoursite npm run visual:compare
```

For every fixture in `fixtures/`:

1. **Sandbox side** — the local dev server renders the fixture as a column
   formatter over the mock rows; the harness screenshots the mock list and
   probes each rendered cell (text + computed background color).
2. **SharePoint side** — ensures the list named by `SP_LIST` (default
   `FormatFX Visual Compare`) exists with a `Status` choice column and the
   same three rows as the sandbox mock data, MERGEs the fixture into the
   column's `CustomFormatter` (same request shape as the deploy snippet),
   opens the list view, screenshots it and probes the same cells.
3. **Verdict** — `verdict.ts` decides pass/fail from the probes; both
   screenshots are attached to the report either way
   (`npx playwright show-report e2e/visual-compare/report` after a run).

Missing `SP_SITE_URL` or auth state? The SharePoint half skips with a
message and the sandbox half still runs — so the harness itself stays
testable anywhere.

## Ground rules

- Point `SP_LIST` at a **sacrificial list**. The harness creates/EDITS it
  without confirmation prompts — never aim it at a list anyone works in.
  (The in-product deploy snippet keeps its confirm-first behavior; that rule
  is for makers' real lists, this is a test rig.)
- Everything here is plain fetch against `/_api`, readable end to end, zero
  dependencies — same auditability bar as `src/bridge/`.
- First live run against a tenant may need selector/shape tweaks (modern
  list DOM shifts); `sp.ts` marks the two spots most likely to need them.
