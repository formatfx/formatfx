# FormatFX — SPFx Format panel

A SharePoint Framework ListView Command Set that adds **Format** to every
generic list's command bar and opens the FormatFX editor for that list —
one column or view formatter at a time, with drafts and history in a hidden
`FormatFX` list on the site. Design: `docs/superpowers/specs/2026-09-16-spfx-format-panel-design.md`.

Two packages, both exempt from the main app's zero-dependency rule:

| Folder | What | Build |
|---|---|---|
| `panel/` | the panel: FormatFX's own `src/core` + `src/editor` + `src/bridge` bundled by esbuild into `dist/panel.js`, plus the panel-only modules in `panel/src/` | `npm ci && npm run build` (CI does this) |
| `formatfx-spfx/` | the SPFx 1.23 project (Heft, Node `>=22.14.0 <23`) consuming `panel/` as `file:../panel` | `npm install && npm run build` → `sharepoint/solution/formatfx-format-panel.sppkg` |

The SPFx `build`/`start` scripts rebuild the panel first (`prebuild`/`prestart`), so the bundle can never ship stale.

## Tests

Every panel module is node-tested from the repo root: `npm test` runs all
`spfx/panel/src/*.test.ts` and `spfx/panel/tools/*.test.ts` files with the
rest of the suite — the root suite is now 1898 tests (was 1828 at branch
start). The root `pretest` script runs `spfx/panel/tools/genAppCss.mjs` first,
so `panel.ts`'s gitignored `src/appCss.gen.ts` exists on a clean checkout
without building the panel. The Command Set has no runner (the rig's Jest has
zero suites); the tenant smoke below covers it.

## Debug on a real list (owner-driven)

1. `cd spfx/formatfx-spfx`, set `config/serve.json` → `pageUrl` to your test list, once: `npx heft trust-dev-cert`.
2. `npm run start -- --nobrowser`
3. Open (replace the list URL; the id is the Command Set's manifest id):
   `<LIST_URL>?loadSPFX=true&debugManifestsFile=https://localhost:4321/temp/build/manifests.js&customActions={"9bb46657-c68a-4e3b-895b-ed5a36ae6fcc":{"location":"ClientSideExtension.ListViewCommandSet.CommandBar","properties":{}}}`
   Chromium 142+ asks to allow local-network access — allow it.
4. Done debugging? The debug-manifest setting sticks to the tab session: every page then errors with `Script error for "https://localhost:4321/temp/build/manifests.js"` once the dev server is gone. Open any site page with `?reset=true` (or a fresh tab) to clear it.

## Package and deploy (site collection app catalog, no tenant admin)

```powershell
cd spfx/formatfx-spfx; npm run build
Connect-PnPOnline -Url https://TENANT.sharepoint.com/sites/SITE -UseWebLogin
Add-PnPApp -Path .\sharepoint\solution\formatfx-format-panel.sppkg -Scope Site -Overwrite -Publish
Install-PnPApp -Identity formatfx-format-panel -Scope Site   # first install only
Update-PnPApp -Identity formatfx-format-panel -Scope Site    # every later deploy
```

Bump `solution.version` in `config/package-solution.json` before each deploy so the
site picks up the new bundle (first tenant deploy 2026-09-17: 1.0.0.0; the journal
`__metadata` fix is 1.0.1.0; entity decode + crumb reveal + hideSelection round-trip is 1.0.2.0).

`skipFeatureDeployment: true` means the Format button appears on every generic list of the site
once the app is installed; nothing is injected anywhere else.

## Smoke checklist (run by the owner after each deploy)

- [ ] First use on the site creates the hidden `FormatFX` list (Site contents → hidden lists) with 7 columns; a person without Manage Lists sees the per-tab notice instead. (Verified 2026-09-17: under `odata=nometadata` SharePoint 400s the `@odata.type` annotation, so `journalStore.ts`'s two creation POSTs send `odata=verbose` bodies with `__metadata: { type }` — every other call stays nometadata.)
- [ ] Format button on a list's command bar; panel opens once even though SharePoint mounts the extension twice (check `document.querySelectorAll('#ffx-format-panel').length === 1`).
- [ ] Tree: views then columns, badge on formatted ones, the on-screen view marked; opening the panel opens the current view.
- [ ] A formatter authored in SharePoint's own pane shows `>` / `"` in the editor, not `&gt;` / `&quot;` (REST returns the entities; the panel decodes on read, verified 2026-09-17). Applying it writes raw characters back and the list still renders.
- [ ] Type `g` and other letters in the JSON pane — nothing is swallowed; Ctrl+Z/Y undo/redo.
- [ ] Edit a column, pick another target → a dot appears; come back → the draft is restored.
- [ ] Pick another view → the page navigates and the panel reopens on that view.
- [ ] Apply → the list re-renders with the formatter; the journal has Pending→Applied with Before/After.
- [ ] Change the formatter in another tab, then Apply here → both versions shown; Overwrite and Reload both behave.
- [ ] History: roll back → previous formatter is live, a new Applied row exists.
- [ ] Close → no host element left, reopen works.
