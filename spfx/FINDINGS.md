# SPFx spike findings (2026-09-16)

TEST_LIST_URL: <owner fills in>
SPFx version: 1.23.2 (`@microsoft/sp-listview-extensibility` in `spfx/formatfx-spfx/package.json`)
Node: v22.14.0
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

## Q3 -- does a shadow-root panel render and take input without interference?
(pending)

## Q4 — do SP.Field / SP.View responses carry an ETag usable in IF-MATCH?
(pending)
