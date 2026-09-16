# SPFx spike findings (2026-09-16)

TEST_LIST_URL: https://mympc.sharepoint.com/sites/mplxcontrols/Lists/FormatFX%20Spike/AllItems.aspx (list id e481b50b-ebf9-4cbd-804f-a5276afb23ab; second view "Spike View 2"; provisioned 2026-09-16 via PnP.PowerShell 1.12 -UseWebLogin; throwaway, deleted at the end)
SPFx version: 1.23.2 (`@microsoft/sp-listview-extensibility` in `spfx/formatfx-spfx/package.json`)
Node: v22.14.0
EXTENSION_ID: 9bb46657-c68a-4e3b-895b-ed5a36ae6fcc (matches `id` in `FormatFxCommandSet.manifest.json`; same value already recorded below as "Manifest id (guid)")
Scaffold + first build: OK

## Deviation from the brief: nested project folder

The brief expected the scaffold to land directly in `spfx/` (e.g.
`spfx/src/extensions/formatFx/FormatFxCommandSet.ts`). Instead, running
`yo @microsoft/sharepoint` from inside `spfx/` (non-interactively, with
`--solution-name formatfx-spfx`) created an additional subfolder named
after the solution:

```
spfx/formatfx-spfx/          <- actual project root
spfx/formatfx-spfx/src/extensions/formatFx/FormatFxCommandSet.ts
spfx/formatfx-spfx/src/extensions/formatFx/FormatFxCommandSet.manifest.json
spfx/formatfx-spfx/package.json
```

Per the task's ambiguity resolution ("record the actual paths; do not
rename them"), the generated layout was left as-is rather than moved up
a level -- the generator's `.yo-rc.json`, `config/*.json`, and
`sharepoint/assets/*.xml` reference the solution name and relative paths
internally, so hand-moving files risked silently breaking the build.

**All subsequent spike work (Task 2+) should treat
`spfx/formatfx-spfx/` as the SPFx project root**, not `spfx/` directly.

## Command Set class and manifest (for Task 4's debug URL)

- Class: `FormatFxCommandSet` (`export default class FormatFxCommandSet
  extends BaseListViewCommandSet<IFormatFxCommandSetProperties>`)
- File: `spfx/formatfx-spfx/src/extensions/formatFx/FormatFxCommandSet.ts`
- Manifest: `spfx/formatfx-spfx/src/extensions/formatFx/FormatFxCommandSet.manifest.json`
- Manifest id (guid): `9bb46657-c68a-4e3b-895b-ed5a36ae6fcc`

## Generator / tooling versions

- `yo`: 7.0.1
- `@microsoft/generator-sharepoint`: 1.23.2 (installed as `@latest`)
- `@microsoft/sp-core-library`, `@microsoft/sp-listview-extensibility`,
  `@microsoft/decorators`, `@microsoft/sp-dialog`: all 1.23.2
- TypeScript: ~5.8.0 (build used 5.8.3)
- Heft: `@rushstack/heft` 1.2.17 (pinned via `overrides`)
- ESLint: 9.37.0
- Webpack: 5.105.4 (used by `heft build` internally)
- Node engines constraint in generated `package.json`: `>=22.14.0 <23.0.0`
  -- matches the machine's installed Node v22.14.0 exactly.

## npm scripts (`spfx/formatfx-spfx/package.json`)

```json
"scripts": {
  "build": "heft test --clean --production && heft package-solution --production",
  "clean": "heft clean",
  "eject-webpack": "heft eject-webpack",
  "start": "heft start --clean"
}
```

There is no separate `package-solution` script name -- `package-solution`
is chained inside `build` (which also runs `heft test`, i.e. Jest; there
are no test files yet so Jest reports "0 test suites" and exits 0).

## Build result

`npm install` (in `spfx/formatfx-spfx/`): 1320 packages added, exit code
0, no TLS errors (corporate proxy was not an issue this run). 8 moderate
`npm audit` advisories reported (not investigated -- throwaway spike,
transitive SPFx toolchain deps).

`npm run build`: exit code 0.
- `heft build`: succeeded in ~15.6s. Two non-fatal webpack warnings about
  relative icon paths (`icons/request.png`, `icons/cancel.png`) -- cosmetic,
  from the generator's own scaffolded command icons, not something this
  task touched.
- `heft test` (Jest): 0 test suites, 0 failures (no spec files exist yet;
  per the global constraint, no unit tests were added for spike code).
- `heft package-solution --production`: succeeded, produced
  `spfx/formatfx-spfx/sharepoint/solution/formatfx-spfx.sppkg` and the
  debug solution XML under `spfx/formatfx-spfx/sharepoint/solution/debug/`.

## Gitignore

- Root `.gitignore` got the literal block from the brief appended
  (`spfx/lib`, `spfx/dist`, `spfx/temp`, `spfx/release`,
  `spfx/panel/panel.js`). Because the actual project root is one level
  deeper (`spfx/formatfx-spfx/...`), these specific root-relative
  patterns don't currently match anything on disk -- they're inert but
  harmless, kept for parity with the brief. The generator's own
  `spfx/formatfx-spfx/.gitignore` (committed, generated, left as-is per
  the task's resolution) already covers `dist`, `lib`, `lib-commonjs`,
  `release`, `temp`, `jest-output`, `node_modules`, `*.sppkg`, and
  `.heft` as basename-matched patterns, so build output is not staged
  regardless of the root file's paths. The root `.gitignore` also already
  had bare `node_modules` and `dist` patterns (no leading slash), which
  match at any depth and additionally cover the nested folder.
- Verified with `git add -n spfx` (dry run): only 24 source/config files
  under `spfx/formatfx-spfx/` would be staged -- no `node_modules`, no
  `lib`/`dist`/`temp`/`release`, no `.sppkg`, no `sharepoint/solution/`
  build artifacts.

## Live rounds — how Q1/Q3/Q4 were answered

Q1, Q3 and Q4 were answered by **two live rounds against the real list**
(`TEST_LIST_URL` above), served from `npm run start -- --nobrowser` in
`spfx/formatfx-spfx` with `config/serve.json` pointed at that list.
**The owner drove the browser in both rounds** (the tenant is reachable
only from their signed-in session — docs/CONNECTIVITY.md §1); this
session read the answers off the `ffx-spike` console lines they pasted
back. Full pasted log:
`.superpowers/sdd/2026-09-16-spfx-spike/round-logs.md`.

- **Round 1 — build `269f8c3`** ("Format command mounts the shadow-root
  panel with Q1/Q3 instrumentation"). Answered Q4 outright and Q3 except
  for one stolen key; left Q1 ambiguous, because the view switch produced
  *no* SPFx lifecycle lines at all.
- **Round 2 — build `ce1f0d4`** ("guard probe in bubble phase" on top of
  `419a005`, which added the key guard, the sample-reset button and the
  `popstate`/`urlchange` probes). Confirmed the Q3 fix and turned Q1 from
  "nothing happened" into a positive observation via the URL poll.

## Q1 -- does a Command Set instance survive a client-side view switch?

**Verdict: the instance SURVIVES.** A modern list view switch is
client-side navigation — the URL is rewritten with a `viewid=` query
param, the `loadSPFX`/`debugManifestsFile`/`customActions` debug params
are preserved, the console is never cleared, and no page load occurs.
The same `instance=` ids keep logging across the switch, no `onDispose`
or second `onInit` fires, and **"Format (spike)" is present and working
on the other view — clicking it mounts the panel from the same
instance**.

Two facts the product has to plan for, both of which only showed up
because round 2 polled the URL:

1. **`listViewStateChangedEvent` never fired for a view switch**, and
   `context.listView.view.id` **lags one switch behind the URL** (at the
   moment of the change the context still reports the *previous* view).
   So the panel cannot re-key its open target from the SPFx event or
   from `context` — it must read the `viewid` out of `location.href`
   (a poll, or a wrapped `history.pushState`/`replaceState`).
2. **SharePoint creates TWO Command Set instances on page load.** Both
   run `onInit`, both see the URL change. The panel host must therefore
   be a singleton keyed by element id — the spike's
   `#ffx-spike-host` remove-then-append does exactly this, which is why
   only one panel ever appears.

Evidence (round 2 unless noted):
```
onInit instance=13ab7316-…  view=96da35f1-…   ← TWO instances are created on page load
onInit instance=1e1fdb96-…  view=96da35f1-…
urlchange instance=1e1fdb96-… view=96da35f1-… url=…?viewid=f24ba2a8-…   ← switch to Spike View 2: URL changed, context.listView.view still OLD
panel mounted instance=1e1fdb96-…                ← "Format (spike)" present and working on Spike View 2, SAME instance
urlchange instance=1e1fdb96-… view=f24ba2a8-… url=…?viewid=96da35f1-…   ← switch back: view id now reflects the PREVIOUS switch (lags one step)
```
Round 1, same switch, address bar afterwards (debug params preserved,
`viewid=` added, console not cleared):
```
…/AllItems.aspx?viewid=96da35f1-…&loadSPFX=true&debugManifestsFile=…&customActions=…
```
Never observed in either round: `onDispose`, `listViewStateChanged`,
`popstate`.

## Q2 — how does the SPFx build consume the parent repo's core + editor source: prebuilt bundle (A) or direct import (B)?

**Verdict: variant A works, variant B fails — the product package uses
A.** Caveat: the panel bundle must be rebuilt *before* the SPFx build, so
it has to be wired in as a pre-step. Both variants were run; details
below.

Variant A (prebuilt esbuild bundle as a file: dependency): install OK / build OK.
`spfx/panel`: `npm install` added 3 packages (esbuild, typescript, and one
transitive), no TLS errors. `npm run build` (`node build.mjs`, esbuild
0.28.x) bundled `spfx/panel/src/entry.ts` — which imports
`src/core/serializer`, `src/core/renderer`, `src/core/theme`,
`src/editor/dialect`, and `src/bridge/spClient` from the PARENT repo via
`../../../src/...` relative paths — straight through on the first attempt,
no import-path fixes needed; the paths in the brief matched the current
`src/` layout exactly. Output: `spfx/panel/panel.js`, 78,692 bytes (~77KB),
ESM, target es2022. No parent `tsconfig.json` was needed or added — esbuild
strips types without reading `moduleResolution`/`verbatimModuleSyntax`/
`erasableSyntaxOnly` from the parent config.

Wiring: added `"formatfx-panel": "file:../panel"` to
`spfx/formatfx-spfx/package.json` `dependencies`. `npm install` in
`spfx/formatfx-spfx` reported "added 1 package" and created
`node_modules/formatfx-panel` as a real symlink (`lrwxrwxrwx ... ->
/c/dev/formatfx/.claude/worktrees/partitioned-squishing-reddy/spfx/panel`),
confirming npm's `file:` handling symlinks rather than copies on this
platform/npm version. `npm run build` in `spfx/formatfx-spfx` (heft test +
heft package-solution --production) still passed cleanly — expected, since
nothing imports `formatfx-panel` yet (Task 3's job); this run only proves
the install/symlink and that adding the dependency doesn't break the
existing build.

Variant B (direct import): **build failed**, first error is a TypeScript
`rootDir` error, not a Heft-rig file-refusal or ESLint/webpack failure.
Added the brief's three imports (`../../../../../src/core/serializer`,
`../../../../../src/editor/dialect`, `../../../../../src/bridge/spClient`)
plus the `console.log('[ffx-spike] direct import OK', ...)` line to the top
of `FormatFxCommandSet.ts`, then ran `npm run build`
(`heft test --clean --production`). The `build:typescript` sub-task
(tsc 5.8.3, invoked by the Heft rig) failed first with:

```
[build:typescript] Error: src/extensions/formatFx/FormatFxCommandSet.ts:3:28 - (TS6059) File 'C:/dev/formatfx/.claude/worktrees/partitioned-squishing-reddy/src/core/serializer.ts' is not under 'rootDir' 'C:/dev/formatfx/.claude/worktrees/partitioned-squishing-reddy/spfx/formatfx-spfx/src'. 'rootDir' is expected to contain all source files.
```

(and the same TS6059 for `../editor/dialect` and `../bridge/spClient`,
then cascading TS6059s for every parent-repo module transitively imported
by those three — `core/types`, `core/linter`, `core/schema`,
`core/expressions`, `core/contrast`, `core/refs`, `bridge/applyPayload`,
`core/schemaImport`). Total: 46 TypeScript errors, build exit non-zero
("Failed (5.645s)"). `eslint`/`webpack` never ran — `heft test` fails at
the `build:typescript` step before lint or webpack in the pipeline.

Cheap-fix attempt (tsconfig one-liner, per the task's ambiguity
resolution): added `"compilerOptions": { "rootDir": "../.." }` to
`spfx/formatfx-spfx/tsconfig.json` (repo root is two levels above that
file) and rebuilt. Result: the rootDir class of errors disappeared (down
from 46 to 35), confirming the diagnosis, but the build **still failed**
— the remaining 35 errors are unrelated to rootDir: `TS2354` ("This syntax
requires an imported helper but module 'tslib' cannot be found") wherever
the parent source needs a TS downlevel-emit helper, plus `TS2550`/`TS2802`
wherever the parent source uses ES2016+ library members
(`Array.prototype.includes`, `String.prototype.padStart/padEnd/
matchAll/trimStart`, `Object.entries`, for-of over a `Set`) that aren't in
the `lib`/`target` the SPFx rig's `tsconfig-base.json` compiles against.
Per the task's stop condition (one cheap fix, record and stop — the
answer is the finding, not a working build), no further changes were
attempted; reaching a real pass would need the rig's `lib`/`target`
raised and `tslib` wired in as an actual dependency, which is not a
one-liner. The `rootDir` override and the four import/log lines were then
reverted; `git diff spfx/formatfx-spfx/tsconfig.json` is empty and
`FormatFxCommandSet.ts`'s only remaining diff is the round-2 URL-watch
probe (below) — confirmed with `git diff --stat`.

**Conclusion for §9.2**: variant A (prebuilt esbuild bundle, Task 2) is
the only one of the two that gets the parent source running inside the
SPFx solution without inheriting the parent's newer TS/lib surface;
variant B (direct import through SPFx's own tsc) fails on both the
physical `rootDir` sandboxing the Heft rig imposes and, once that's
worked around, a real lib/target mismatch between the parent repo's
TypeScript config and the SPFx rig's.

## Q3 -- does a shadow-root panel render and take input without interference?

**Verdict: it renders and takes input — with exactly one exception,
which has a one-line fix.** Inside the shadow root the textarea accepted
typing, paste, Ctrl+Z, arrow keys, Enter and Escape with
`defaultPrevented=false` and a matching `input` event; `excelToSp` and
the renderer both ran (`render OK` in round 2) and the field GET came
back 200 with the list's columns. The exception: **SharePoint's
document-level, bubble-phase key handler cancels the plain `g` key** (a
page shortcut). The shadow root retargets the event, so SharePoint's
handler never sees that the target is a textarea and treats `g` as a
global shortcut.

**Fix, verified live in round 2:** a **bubble-phase `stopPropagation()`
on keydown at the shadow host** — with the guard on, `g` logs
`defaultPrevented=false` and fires `input`. (Round 2's first build put
the listener in the capture phase, which was too early to matter;
`ce1f0d4` moved it to the bubble phase, which is what the `guard=true`
lines below come from.)

**Consequence for the product:** the panel stops `keydown`/`keyup`/
`keypress` propagation at its shadow host, for **all** keys — cheaper and
more predictable than an allow-list, and it keeps SharePoint's page-level
shortcuts from ever reaching a focused editor. **No iframe is needed.**

Evidence:
```
render OK                                        ← renderer works inside the shadow root
keydown g defaultPrevented=true  guard=false     (×2, no input)   ← stolen without the guard
guard=true
keydown g defaultPrevented=false guard=true + input   (×2)        ← passes with bubble-phase stopPropagation at the host
```
Round 1 (guard did not exist yet) — everything else was already clean:
```
keydown j defaultPrevented=false / input / keyup j        (plain letters pass)
keydown g defaultPrevented=true  (×3, never followed by an input event → SharePoint cancelled it)
keydown Escape defaultPrevented=false; ArrowUp/ArrowLeft false; Enter false + input; paste false + input
excelToSp OK: {"ok":true,"value":"=1 + 1"}
```
Round 1's `render FAILED: Invalid JSON: Bad control character …` was
operator error (typing had put a newline inside the sample JSON), not a
bug — round 2 added the "Reset sample" button and logged `render OK`.

## Q4 — do SP.Field / SP.View responses carry an ETag usable in IF-MATCH?

**Verdict: no ETag — neither a response header nor an `odata.etag` in the
body, for either entity type.** Both single-entity GETs (one `SP.Field`,
one `SP.View`, issued from the panel against the live list in round 1)
returned 200 with `ETag-header=none body-etag=none`.

**Consequence for the product:** spec §7's write step **cannot** send
`IF-MATCH: <etag>`. The optimistic-concurrency branch is deleted; the
only available protection is to **narrow the window** — re-read the
entity immediately before the MERGE, compare it to the copy read in
step 1, and bounce back to step 2 (re-present / re-merge) on any
difference. §7 step 1's "and its ETag …" phrasing goes away with it.

Evidence (round 1):
```
GET fields → 200   (Title, Status (Choice), … 26 non-hidden fields listed)
GET field → 200 ETag-header=none body-etag=none
GET view  → 200 ETag-header=none body-etag=none
```

## Task 3 notes — command set implementation

All base-class typings the brief hedged against (`onDispose` visibility,
`pageContext.list`/`listItem`, `context.listView.view`) matched the
brief's code exactly in this SPFx version (1.23.2) — no hedge paths were
needed for those.

One typing conflict the brief didn't anticipate: `BaseComponent` (an
ancestor of `BaseListViewCommandSet` via `BaseExtension`) already declares
a public `get instanceId(): string` getter, unique per component
instance. The brief's `private readonly instanceId = Math.random()...`
field shadows that inherited public member with a private one, which
TypeScript rejects as TS2415 ("Class 'FormatFxCommandSet' incorrectly
extends base class ... Property 'instanceId' is private in type
'FormatFxCommandSet' but not in type 'BaseListViewCommandSet<...>'"), and
a second, consequent TS2345 on the `.add(this, ...)` event-subscribe call.

Fix: dropped the private `instanceId` field entirely and used the
inherited `this.instanceId` (SPFx-assigned, unique per instance, set once
at construction — same identity semantics the brief's own random field
was going for) everywhere the brief's code referenced `this.instanceId`.
No other line changed. Rebuilt clean: `npm run build` in
`spfx/formatfx-spfx` exits 0, zero TypeScript errors, zero ESLint
warnings (no `/* eslint-disable */` needed — tried it first per the
brief's guidance, but ESLint flagged it as an *unused* eslint-disable
directive since the file had no actual lint violations, so it was
removed).

## Round 2 instrumentation

Added ahead of the second live round, to chase two round-1 open
questions (SharePoint's page-level key handler cancelling plain `g` in
the shadow textarea, and the silent client-side view switch) without
needing a reload to recover a corrupted textarea:

- `guard=` (`spfx/panel/src/entry.ts`) — a checkbox ("stop keydown
  propagation at host (round-2 probe)") wired to a capture-phase keydown
  listener on the shadow host element (`host.host`) that calls
  `stopPropagation()` while checked. The existing keydown/keyup/input/
  paste log line now always reports the guard's current state
  (`... defaultPrevented=... guard=true|false`), so a single session can
  compare "SharePoint sees the key" vs. "SharePoint doesn't" back to
  back without touching code.
- `sample reset` (`spfx/panel/src/entry.ts`) — a "Reset sample" button
  next to Render that overwrites the textarea with the original `SAMPLE`
  JSON and logs `sample reset`, so a textarea left in a bad state (e.g.
  from a swallowed/partial key sequence) can be recovered without
  reloading the page and losing the Command Set instance under test.
- `popstate` / `urlchange` (`spfx/formatfx-spfx/.../FormatFxCommandSet.ts`,
  `onInit`) — round 1 found a client-side view switch changes the URL
  (`viewid=` query param) but never fires `listViewStateChangedEvent`.
  Round 2 adds a `popstate` listener (logs
  `popstate instance=... url=...`) and a 500ms `setInterval` poll that
  diffs `location.href` against its last-seen value and logs
  `urlchange instance=... view=... url=...` on any change not caught by
  `popstate` (covers `history.pushState`/`replaceState`, which don't fire
  `popstate`). The existing `listViewStateChangedEvent` subscription is
  unchanged.
