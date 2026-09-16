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

## Q1 -- does a Command Set instance survive a client-side view switch?
(pending)

## Q2 — how does the SPFx build consume the parent repo's core + editor source: prebuilt bundle (A) or direct import (B)?
(pending — both variants run)

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
(pending)

## Q4 — do SP.Field / SP.View responses carry an ETag usable in IF-MATCH?
(pending)

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
