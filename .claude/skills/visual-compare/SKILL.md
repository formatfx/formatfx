---
name: visual-compare
description: Run the sandbox-vs-real-SharePoint visual comparison locally, visually review the triptych evidence, and diagnose any rendering divergence to a probable culprit in this repo. Use when the owner asks to visually compare a formatter against SharePoint, verify how a design really renders, run visual:compare, or investigate a sandbox/SharePoint rendering difference.
---

# Visual compare: run, look, diagnose

You are the reviewing agent for the ground-truth harness in
`e2e/visual-compare/` (its README is the operating manual). This runs in a
LOCAL terminal on purpose: the SharePoint auth is the owner's own browser
session, and you can Read the image evidence yourself. Your job is three
steps — run it, LOOK at it, and name the culprit.

## 1. Preflight and run

- Need `SP_SITE_URL` (the owner's SharePoint site). If it isn't in the
  environment, ask for it once.
- If `e2e/visual-compare/.auth/sp-state.json` is missing, run
  `SP_SITE_URL=… npm run visual:auth`, tell the owner a browser window is
  waiting for their sign-in, and wait for the command to exit. If the
  compare later fails on contextinfo/digest errors, the session expired —
  re-run auth the same way.
- Ask which workspace to test: a share link from the app's Share button
  (pass as `SP_SHARE_URL`) or the default workspace (leave unset).
- Run: `SP_SITE_URL=… SP_SHARE_URL=… npm run visual:compare`
  (locally the installed Edge is used; no `PW_EXECUTABLE` needed).
- Remember the SharePoint half DELETES AND RECREATES the `SP_LIST` list
  (default `FormatFX Visual Compare`). Confirm with the owner before the
  first run that this name is sacrificial on their site.

## 2. Review the evidence — with your eyes

Everything lands at stable paths under `e2e/visual-compare/artifacts/run/`:

- `verdict.json` — pass/fail, LABELED notes (see step 4), provisioning notes
- `<Field>-<row>.png` — triptychs: **sandbox | SharePoint | diff mask**
- `<Field>-hovercard.png` — hover-card triptychs (customCardProps, scored)
- `<Field>-<kind>-clicked-sp.png` — post-click state on SharePoint
  (customRowAction / inlineEditField — unscored, YOUR review is the check)
- `view-row-<n>.png` — the view formatter's real rows (unscored in v1)

Read `verdict.json` first, then **Read every image** — including on a PASS.
The thresholds are deliberately lenient (shade drift and ≤25% pixel
mismatch pass silently into notes); your eyes are the strict pass. For each
triptych ask: same text? same color family? same shape (radius, padding,
bar length)? anything missing entirely? For each clicked/hovered state:
did the effect happen at all, and does it do the same thing on both sides?
The interactive evidence and view-row shots have NO automated score —
visual review is their only check.

## 3. Diagnose to a culprit

Characterize each real difference, then localize it. The map:

| Symptom | Probable culprit | Where to look |
| --- | --- | --- |
| Different color family | Conditional expression took a different branch on SP, or an `sp-css-*` theme class resolves differently | The formatter's `background-color`/class expression; `src/core/theme.ts`; HANDOFF §3 |
| Text differs | Engine semantics divergence (check §3 FIRST — those behaviors are live-verified) or locale rendering (`toLocaleDateString`, number formatting) | `src/core/expressions.ts`; `src/core/core.test.ts` is the contract |
| Shape/padding/radius/size drift | Sandbox renderer fidelity gap — a style property SP applies that the mock renderer doesn't (or vice versa) | `src/core/renderer.ts` |
| SP cell empty or unformatted | SP rejected the formatter (schema-invalid) or the write silently targeted the wrong field | Lint the exported JSON (`node dist-lib/cli.js lint`); `workspace.ts` export; `verdict.json` provisioning notes |
| HTTP errors during provisioning | The numbered ⚠ watch spots (OData flavor, DOM selectors, multi-choice payloads) | `sp.ts`, `compare.vspec.ts`, `workspace.ts` — fix at the marked spot only |
| Wrapping/truncation only | SP's real column widths vs the sandbox's — expected surface difference | Note it; not a bug |
| Hover card on one side only | `openOnEvent` semantics, or the sandbox's flyout emulation diverging from SP's callout | `src/core/renderer.ts` (flyout emulation); watch spot #4 selector in `compare.vspec.ts` |
| Click did nothing | `customRowAction`/`inlineEditField` the sandbox stubs vs SP executes — or a genuinely dead button (bad `actionParams`) | `src/core/renderer.ts` (action stubs); the formatter's `customRowAction` block |

Ground rules while diagnosing:

- HANDOFF §3 topics are **closed** — the unit tests are the spec. If a §3
  behavior seems wrong, the harness or the formatter is wrong, not §3.
- If the ENGINE is the culprit, the fix is test-first: extend
  `core.test.ts`/`condRules.test.ts` with the SP-verified behavior, then
  change the code.
- If the VERDICT misjudged (failed something the owner would call fine, or
  passed something they'd call wrong), calibrate the two knobs at the top
  of `e2e/visual-compare/verdict.ts` and say what you changed and why.
- Never mark a watch spot "fixed" without a fresh green run against the
  tenant.

## 4. Label every finding and append it to the ledger

`e2e/visual-compare/labels.ts` is the controlled "what it looks like"
vocabulary. Every finding — the automated notes in `verdict.json` (already
labeled) AND anything your own eyes caught — gets one label plus a
plain-words `looksLike` line. Then append one JSON object per finding to
`e2e/visual-compare/findings.jsonl` (committed, append-only) and include
the file in your commit:

```json
{"ts":"2026-07-04","workspace":"sprint board","subject":"Status[1]","label":"shade-drift","looksLike":"pill is a touch darker on SP","culprit":"theme slot re-tint","culpritPath":"src/core/theme.ts","resolution":"tolerated","source":"agent"}
```

- `source`: `"verdict"` for automated notes, `"agent"` for your visual ones.
- `resolution`: `fixed` / `tolerated` / `calibrated` / `open`.
- NEVER put tenant URLs, list URLs, or anything identifying in an entry —
  the ledger is committed to a public repo. Workspace goes by nickname.
- Use an existing label whenever one fits; a new label is a PR-worthy event.

This ledger is the long game: over weeks and months of runs it becomes the
dataset for finding the common gotchas.

## 5. Periodic assessment (when the owner asks, or ~monthly)

Read all of `findings.jsonl`. Cluster by `label` + `culpritPath`. For the
recurring clusters, bake the lesson into a rule so the next run
troubleshoots itself faster — in priority order:

1. Extend the symptom→culprit map in THIS skill with the specific
   observed pattern (fastest payoff).
2. Calibrate `verdict.ts` knobs if a label keeps resolving as `tolerated`
   (the harness should stop flagging it) or keeps slipping through.
3. Propose a teaching lint rule (`src/core/linter.ts`) when the gotcha is
   something makers do in formatters — then the app prevents it upstream.

Present the clusters and the proposed rule changes to the owner before
changing verdict knobs or the linter; skill-map extensions you may just do.

## 6. Report

End with: the verdict; per-cell findings (label → nature of the difference
→ probable culprit → the evidence file that shows it); the ledger entries
you appended; and either the fix you made (with the usual verification) or
the smallest next step. If everything matched, say so plainly — and name
the images you checked so the owner knows the pass had eyes on it.
