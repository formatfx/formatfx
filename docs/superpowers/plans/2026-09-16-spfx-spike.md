# SPFx Format panel — spike plan (throwaway)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Answer the four questions in the spec's §9 with observed evidence, in about half a day, keeping no product code.

**Architecture:** A scaffolded SPFx 1.23 ListView Command Set (Heft toolchain) whose one command mounts a tiny vanilla-DOM panel in a shadow root on `document.body`. The panel is a prebuilt esbuild bundle (`spfx/panel/`) that imports the real `src/core` engine, one `src/editor` module, and `src/bridge/spClient` from the parent repo, consumed by the SPFx project as a local `file:` dependency (Q2 variant A). A mandatory second experiment imports the same source directly through SPFx's own build (Q2 variant B). Instrumentation logs answer Q1 (instance survival across view switch); key handling inside the shadow panel, checked after dispatch completes, answers Q3; response headers on a field and a view answer Q4 (ETags).

**Tech Stack:** SPFx 1.23.2 (`@microsoft/generator-sharepoint@latest`, Heft + webpack), Node 22.14.0 (installed; the 1.23 floor is `>=22.14.0 <23`), esbuild (as in `extension/build.mjs`), no React, no Fluent UI.

**Spec:** `docs/superpowers/specs/2026-09-16-spfx-format-panel-design.md` (§9 is the spike; §4 the build decision it tests).

## Global Constraints

- **Throwaway.** All code lives on branch `spike/spfx-command-set`, pushed but never merged. The only thing that reaches `main` is a docs-only PR that writes the answers into the spec (Task 6).
- **Read-only against the tenant.** The spike never writes `CustomFormatter` or anything else. GETs only, plus at most `POST /_api/contextinfo` (a read, CONNECTIVITY §8). No MERGE, no list creation.
- **No new runtime dependencies in the main app.** Everything new is under `spfx/` and has its own `package.json`, like `extension/`.
- **Corporate proxy:** `NODE_EXTRA_CA_CERTS` must already point at the corp CA bundle (memory `corp-tls-zscaler`). If any `npm install` fails with a certificate error, run the `fix-corp-tls-cert` skill and retry; do not disable TLS checks.
- **No unit tests for spike code.** The spike's output is a findings log, not software. Verification is "build passes" plus observed behaviour recorded in `spfx/FINDINGS.md`.
- **The owner drives the browser.** The MCP Chrome profile's M365 session is expired (memory `sp-live-probe-auth-expired`). Tasks 4 and 5 hand a URL to the owner and ask them to paste console output back. Do not try to automate the SharePoint page.
- Node commands that hang on prompts: `yo` is interactive by default. Use the non-interactive flags in Task 1; if it still prompts, ask the owner to run it with the `!` prefix.

---

## File structure

```
spfx/                                  # the SPFx project (scaffolded by yo, Task 1)
  package.json                         # + "formatfx-panel": "file:panel"   (Task 2)
  config/serve.json                    # pageUrl = the owner's test list      (Task 4)
  src/extensions/formatFx/
    FormatFxCommandSet.ts              # the one command + instrumentation   (Task 3)
    FormatFxCommandSet.manifest.json   # scaffolded; id used in the debug URL
  panel/                               # local package, prebuilt bundle      (Task 2)
    package.json                       # name formatfx-panel, main panel.js, type module
    build.mjs                          # esbuild: src/entry.ts → panel.js
    panel.d.ts                         # hand-written types for the bundle
    src/entry.ts                       # mountSpikePanel(): imports ../../../src/core/*
    panel.js                           # BUILD OUTPUT (gitignored)
  FINDINGS.md                          # the answers, appended per task       (Tasks 1–5)
```

`spfx/panel/src/entry.ts` is the only file that touches the parent repo's source (until Task 5's deliberate direct import). It imports:
- `../../../src/core/serializer` → `importJson`
- `../../../src/core/renderer` → `renderElement`
- `../../../src/core/theme` → `buildThemeCss`
- `../../../src/editor/dialect` → `excelToSp` (a representative editor module: the pure transpiler)
- `../../../src/bridge/spClient` → `readPageContext`

---

### Task 0: Preconditions (owner, 5 minutes)

**Files:** none.

- [ ] **Step 1: Owner supplies a test list URL** on the site with the app catalog, a list with at least one Choice column, that nobody else is working in. Record it as `TEST_LIST_URL` in `spfx/FINDINGS.md` once the folder exists (Task 1 creates it).

- [ ] **Step 2: Confirm Node**

Run: `node --version`
Expected: `v22.14.0` or any `v22.x` ≥ 22.14. Anything else: stop and tell the owner; SPFx 1.23 will refuse to build.

- [ ] **Step 3: Confirm the branch**

```bash
git checkout -b spike/spfx-command-set origin/main
git branch --show-current
```
Expected: `spike/spfx-command-set`.

---

### Task 1: Scaffold the SPFx project and prove it builds

**Files:**
- Create: `spfx/` (scaffolded)
- Create: `spfx/FINDINGS.md`
- Modify: `.gitignore` (root) — add `spfx/lib`, `spfx/dist`, `spfx/temp`, `spfx/release`, `spfx/panel/panel.js`

**Interfaces:**
- Produces: a buildable SPFx project whose command set class is `FormatFxCommandSet` in `spfx/src/extensions/formatFx/FormatFxCommandSet.ts`, and the manifest id in `spfx/src/extensions/formatFx/FormatFxCommandSet.manifest.json` (`"id": "<guid>"`) that Task 4's debug URL needs.

- [ ] **Step 1: Install the generator**

```bash
npm install -g yo @microsoft/generator-sharepoint@latest
yo --version
```
Expected: a version line. TLS error → `fix-corp-tls-cert`, retry.

- [ ] **Step 2: Scaffold non-interactively**

From the repo root:
```bash
mkdir spfx && cd spfx
yo @microsoft/sharepoint --solution-name formatfx-spfx --component-type extension --extension-type ListViewCommandSet --component-name FormatFx --component-description "FormatFX spike" --skip-install --skip-feature-deployment
```
Expected: files under `spfx/` including `src/extensions/formatFx/FormatFxCommandSet.ts`, `config/serve.json`, `package.json` with `heft` scripts. If `yo` stops on a prompt anyway, ask the owner to run the same command with the `!` prefix and answer: extension, ListViewCommandSet, name FormatFx.

- [ ] **Step 3: Install and build**

```bash
cd spfx
npm install
npm run build
```
Expected: `heft build` completes with no errors. Note the exact script names `package.json` uses (`build`, `start`, `package-solution` or similar) in FINDINGS.

- [ ] **Step 4: Create FINDINGS.md and gitignore the build output**

`spfx/FINDINGS.md`:
```markdown
# SPFx spike findings (2026-09-16)

TEST_LIST_URL: <owner fills in>
SPFx version: <from spfx/package.json "@microsoft/sp-listview-extensibility">
Node: <node --version>
Scaffold + first build: OK / FAIL (notes)

## Q1 — does a Command Set instance survive a client-side view switch?
(pending)

## Q2 — how does the SPFx build consume the parent repo's core + editor source: prebuilt bundle (A) or direct import (B)?
(pending — both variants run)

## Q3 — does a shadow-root panel render and take input without interference?
(pending)

## Q4 — do SP.Field / SP.View responses carry an ETag usable in IF-MATCH?
(pending)
```

Append to the root `.gitignore`:
```
# spfx spike (throwaway)
spfx/lib
spfx/dist
spfx/temp
spfx/release
spfx/panel/panel.js
```

- [ ] **Step 5: Commit**

```bash
git add spfx .gitignore
git -c core.hooksPath="C:/Users/FW97/.config/git/hooks" commit -m "spike: scaffold SPFx ListView Command Set"
```
(The `-c core.hooksPath` override avoids the commit-msg hook recursion described in memory `commit-msg-hook-loop`. Never `--no-verify`.)

---

### Task 2: The panel bundle — a local package built from the parent repo's source (answers Q2, variant A)

**Files:**
- Create: `spfx/panel/package.json`
- Create: `spfx/panel/build.mjs`
- Create: `spfx/panel/panel.d.ts`
- Create: `spfx/panel/src/entry.ts`
- Modify: `spfx/package.json` — add dependency `"formatfx-panel": "file:panel"`

**Interfaces:**
- Produces: `mountSpikePanel(host: ShadowRoot, ctx: SpikeContext): void` exported from the `formatfx-panel` package, where
  ```ts
  interface SpikeContext {
    webUrl: string;      // https://tenant.sharepoint.com/sites/x
    listId: string;      // GUID without braces
    viewId: string;      // GUID without braces
    instanceId: string;  // random per Command Set instance, for Q1
    log: (line: string) => void;  // writes to console AND the panel's log box
  }
  ```

- [ ] **Step 1: Package manifest**

`spfx/panel/package.json`:
```json
{
  "name": "formatfx-panel",
  "version": "0.0.0-spike",
  "private": true,
  "type": "module",
  "main": "panel.js",
  "types": "panel.d.ts",
  "scripts": { "build": "node build.mjs" },
  "devDependencies": { "esbuild": "^0.28.1", "typescript": "~6.0.2" }
}
```

- [ ] **Step 2: Build script** (mirrors `extension/build.mjs`)

`spfx/panel/build.mjs`:
```js
// Bundles the spike panel from the PARENT repo's src/ into one ESM file the
// SPFx webpack build can consume as a plain dependency. Throwaway.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/entry.ts'],
  outfile: 'panel.js',
  bundle: true,
  format: 'esm',
  target: 'es2022',
  legalComments: 'none',
});
console.log('formatfx-panel → panel.js');
```

- [ ] **Step 3: Types for the bundle**

`spfx/panel/panel.d.ts`:
```ts
export interface SpikeContext {
  webUrl: string;
  listId: string;
  viewId: string;
  instanceId: string;
  log: (line: string) => void;
}
export function mountSpikePanel(host: ShadowRoot, ctx: SpikeContext): void;
```

- [ ] **Step 4: The panel entry**

`spfx/panel/src/entry.ts`:
```ts
// Spike panel: proves the real engine runs inside a shadow root on a
// SharePoint page. Read-only against the tenant. Throwaway.
import { importJson } from '../../../src/core/serializer';
import { renderElement } from '../../../src/core/renderer';
import { buildThemeCss } from '../../../src/core/theme';
import { excelToSp } from '../../../src/editor/dialect';
import { readPageContext } from '../../../src/bridge/spClient';
import type { EvalContext } from '../../../src/core/expressions';

export interface SpikeContext {
  webUrl: string;
  listId: string;
  viewId: string;
  instanceId: string;
  log: (line: string) => void;
}

const SAMPLE = JSON.stringify({
  elmType: 'div',
  style: { padding: '4px 8px', 'border-radius': '12px', 'background-color': '#e8f5e9' },
  txtContent: "='Status: ' + @currentField",
});

export function mountSpikePanel(host: ShadowRoot, ctx: SpikeContext): void {
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .wrap { position: fixed; top: 0; right: 0; width: 480px; height: 100vh;
            background: #fff; color: #222; border-left: 1px solid #ccc;
            font: 13px system-ui, sans-serif; padding: 12px; box-sizing: border-box;
            z-index: 1000000; display: flex; flex-direction: column; gap: 8px; }
    textarea { width: 100%; height: 120px; font: 12px monospace; }
    .log { flex: 1; overflow: auto; font: 11px monospace; white-space: pre-wrap;
           background: #f6f6f6; padding: 6px; }
    button { padding: 4px 10px; }
    ${buildThemeCss('light')}
  `;
  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  wrap.innerHTML = `
    <strong>FormatFX spike — instance ${ctx.instanceId}</strong>
    <div>list ${ctx.listId} · view ${ctx.viewId}</div>
    <textarea id="json"></textarea>
    <div>
      <button id="render">Render</button>
      <button id="fields">Fetch fields (GET)</button>
      <button id="close">Close</button>
    </div>
    <div id="preview"></div>
    <div class="log" id="log"></div>
  `;
  host.append(style, wrap);

  const $ = <T extends HTMLElement>(id: string) => wrap.querySelector<T>('#' + id)!;
  const logBox = $('log');
  const log = (line: string) => {
    ctx.log(line);
    logBox.textContent += line + '\n';
  };
  $<HTMLTextAreaElement>('json').value = SAMPLE;

  // Q3 instrumentation: does SharePoint swallow keys inside the shadow panel?
  // The flag is read in a macrotask AFTER dispatch completes, so a page-level
  // (document/window) handler that calls preventDefault() later in the bubble
  // is still observed. Reading it synchronously at the target would miss that.
  const ta = $<HTMLTextAreaElement>('json');
  for (const type of ['keydown', 'keyup', 'input', 'paste'] as const) {
    ta.addEventListener(type, (e) => {
      const k = (e as KeyboardEvent).key ?? '';
      setTimeout(() => log(`${type} ${k} defaultPrevented=${e.defaultPrevented}`), 0);
    });
  }

  $('render').addEventListener('click', () => {
    try {
      // Q2: prove an editor module is in the bundle and runs.
      const t = excelToSp('=1+1');
      log('excelToSp OK: ' + JSON.stringify(t).slice(0, 80));
      const doc = importJson(ta.value);
      const evalCtx: EvalContext = {
        row: { Status: 'Done', Title: 'Spike row' },
        rowIndex: 0,
        currentFieldName: 'Status',
        me: { title: 'Spike User', email: 'spike@example.com' } as EvalContext['me'],
        iterators: {}, iteratorIndex: {}, displayNames: {}, now: new Date(),
      };
      const out = renderElement(doc.root, evalCtx, {});
      $('preview').replaceChildren(out);
      log('render OK');
    } catch (err) {
      log('render FAILED: ' + (err as Error).message);
    }
  });

  $('fields').addEventListener('click', async () => {
    const pc = readPageContext();
    log('_spPageContextInfo present: ' + (pc !== null));
    const url = `${ctx.webUrl}/_api/web/lists(guid'${ctx.listId}')/fields?$select=InternalName,TypeAsString,CustomFormatter&$filter=Hidden eq false`;
    const res = await fetch(url, { headers: { Accept: 'application/json;odata=nometadata' } });
    log(`GET fields → ${res.status}`);
    if (res.ok) {
      const body = await res.json() as { value: { InternalName: string; TypeAsString: string; CustomFormatter?: string }[] };
      for (const f of body.value) log(`  ${f.InternalName} (${f.TypeAsString})${f.CustomFormatter ? ' [formatted]' : ''}`);
    }
    // Q4: does a single field / view entity carry an ETag? Both GETs, read-only.
    const single = [
      `${ctx.webUrl}/_api/web/lists(guid'${ctx.listId}')/fields/getbyinternalnameortitle('Title')`,
      `${ctx.webUrl}/_api/web/lists(guid'${ctx.listId}')/views?$top=1`,
    ];
    for (const u of single) {
      const r = await fetch(u, { headers: { Accept: 'application/json;odata=minimalmetadata' } });
      const hdr = r.headers.get('ETag');
      const j = r.ok ? await r.json() as Record<string, unknown> : {};
      const first = Array.isArray(j['value']) ? (j['value'] as Record<string, unknown>[])[0] ?? {} : j;
      log(`GET ${u.includes('/views') ? 'view' : 'field'} → ${r.status} ETag-header=${hdr ?? 'none'} odata.etag=${String(first['odata.etag'] ?? 'none')}`);
    }
  });

  $('close').addEventListener('click', () => host.host.remove());
}
```

If `PersonValue` needs more fields than `title`/`email`, the `as` cast keeps the compiler quiet; the spike does not evaluate `@me`.

- [ ] **Step 5: Build the bundle**

```bash
cd spfx/panel
npm install
npm run build
ls -la panel.js
```
Expected: `panel.js` exists (tens of KB). If esbuild errors on an import path, the parent repo's `src/` layout changed; fix the relative path, nothing else.

- [ ] **Step 6: Wire it as a local dependency and rebuild the SPFx project**

In `spfx/package.json`, under `"dependencies"`, add:
```json
"formatfx-panel": "file:panel"
```
Then:
```bash
cd spfx
npm install
ls -la node_modules/formatfx-panel
npm run build
```
Expected: `node_modules/formatfx-panel` is a symlink to `panel/`; `heft build` still passes (nothing imports it yet, this proves install only).

- [ ] **Step 7: Record and commit**

Append to `spfx/FINDINGS.md` under Q2:
```
Variant A (prebuilt esbuild bundle as a file: dependency): install OK / build OK — notes.
```
```bash
git add spfx
git -c core.hooksPath="C:/Users/FW97/.config/git/hooks" commit -m "spike: panel bundle from parent src as a local package"
```

---

### Task 3: The command set — one button, instrumentation, shadow-root mount

**Files:**
- Modify: `spfx/src/extensions/formatFx/FormatFxCommandSet.ts` (replace the scaffold body)
- Modify: `spfx/src/extensions/formatFx/FormatFxCommandSet.manifest.json` (one command only)

**Interfaces:**
- Consumes: `mountSpikePanel`, `SpikeContext` from `formatfx-panel` (Task 2).
- Produces: console lines prefixed `[ffx-spike]` that Task 4 reads.

- [ ] **Step 1: Manifest — one command**

In `FormatFxCommandSet.manifest.json`, replace the `items` object so it has exactly:
```json
"items": {
  "FORMAT": {
    "title": { "default": "Format (spike)" },
    "iconImageUrl": "",
    "type": "command"
  }
}
```
Leave `id`, `alias`, `componentType`, `extensionType`, `version`, `manifestVersion` as scaffolded. Copy the `id` value into `spfx/FINDINGS.md` as `EXTENSION_ID`.

- [ ] **Step 2: The command set**

Replace `FormatFxCommandSet.ts` with:
```ts
import { BaseListViewCommandSet, type IListViewCommandSetExecuteEventParameters } from '@microsoft/sp-listview-extensibility';
import { mountSpikePanel, type SpikeContext } from 'formatfx-panel';

export interface IFormatFxCommandSetProperties {}

const TAG = '[ffx-spike]';

export default class FormatFxCommandSet extends BaseListViewCommandSet<IFormatFxCommandSetProperties> {
  private readonly instanceId = Math.random().toString(36).slice(2, 8);
  private panelHost: HTMLElement | undefined;

  public onInit(): Promise<void> {
    console.log(`${TAG} onInit instance=${this.instanceId} list=${this.listId()} view=${this.viewId()} url=${location.href}`);
    // Q1: fires on every ListView state change (selection, view switch, ...).
    this.context.listView.listViewStateChangedEvent.add(this, () => {
      console.log(`${TAG} listViewStateChanged instance=${this.instanceId} view=${this.viewId()} url=${location.href}`);
    });
    return Promise.resolve();
  }

  public onExecute(event: IListViewCommandSetExecuteEventParameters): void {
    if (event.itemId !== 'FORMAT') return;
    if (this.panelHost) { this.panelHost.remove(); }
    this.panelHost = document.createElement('div');
    this.panelHost.id = 'ffx-spike-host';
    const shadow = this.panelHost.attachShadow({ mode: 'open' });
    document.body.appendChild(this.panelHost);
    const ctx: SpikeContext = {
      webUrl: this.context.pageContext.web.absoluteUrl,
      listId: this.listId(),
      viewId: this.viewId(),
      instanceId: this.instanceId,
      log: (line) => console.log(`${TAG} ${line}`),
    };
    mountSpikePanel(shadow, ctx);
    console.log(`${TAG} panel mounted instance=${this.instanceId}`);
  }

  protected onDispose(): void {
    console.log(`${TAG} onDispose instance=${this.instanceId} panelStillInDom=${!!document.getElementById('ffx-spike-host')}`);
    super.onDispose();
  }

  private listId(): string {
    return this.context.pageContext.list?.id.toString() ?? '(none)';
  }
  private viewId(): string {
    return this.context.pageContext.listItem ? '(item)' : (this.context.listView.view?.id?.toString() ?? '(none)');
  }
}
```
If `this.context.listView.view` does not exist in this SPFx version's typings, read the view id from `new URL(location.href).searchParams.get('viewid')` instead and note that in FINDINGS. If `onDispose` is not `protected` in the base class typings, match whatever the scaffold used.

- [ ] **Step 3: Build**

```bash
cd spfx
npm run build
```
Expected: passes. Typical failures and the one-line fix for each:
- `Cannot find module 'formatfx-panel'` → `panel.d.ts` not picked up; add `"types": "panel.d.ts"` (already there) and check `node_modules/formatfx-panel` is the symlink.
- ESLint complaints from the scaffolded rig about `console` or `!` non-null → this is a spike; add `/* eslint-disable */` at the top of the file and move on.

- [ ] **Step 4: Commit**

```bash
git add spfx
git -c core.hooksPath="C:/Users/FW97/.config/git/hooks" commit -m "spike: Format command mounts the shadow-root panel with Q1/Q3 instrumentation"
```

---

### Task 4: Serve against the real list; answer Q1, Q3 and Q4 (owner in the loop)

**Files:**
- Modify: `spfx/config/serve.json`
- Modify: `spfx/FINDINGS.md`

- [ ] **Step 1: Point serve.json at the test list**

In `spfx/config/serve.json`, set every `pageUrl` to `TEST_LIST_URL`, and in `serveConfigurations.default.customActions` make sure the key is `EXTENSION_ID` with `"location": "ClientSideExtension.ListViewCommandSet.CommandBar"` and `"properties": {}`.

- [ ] **Step 2: Trust the dev certificate, start serving**

```bash
cd spfx
npx heft trust-dev-cert
```
(If that task is not found, run `npx heft --help` and use the certificate task it lists; record the real command in FINDINGS.) Then, in the background:
```bash
npm run start -- --nobrowser
```
Expected: the console prints the debug query string, containing `debugManifestsFile=https://localhost:4321/temp/build/manifests.js`.

- [ ] **Step 3: Hand the owner the URL and the script**

Give the owner one line to open (single line, no whitespace):
```
<TEST_LIST_URL>?loadSPFX=true&debugManifestsFile=https://localhost:4321/temp/build/manifests.js&customActions={"<EXTENSION_ID>":{"location":"ClientSideExtension.ListViewCommandSet.CommandBar","properties":{}}}
```
And these instructions, verbatim:
1. Accept **Load debug scripts**. If Edge/Chrome asks to allow access to devices on your local network, click **Allow** (Chromium 142+ Local Network Access).
2. Open devtools → Console, filter on `ffx-spike`.
3. Click **Format (spike)** in the command bar. The panel appears on the right.
4. In the panel textarea: type a few characters, press **Ctrl+Z**, **Escape**, **Arrow keys**, **Enter**, then paste something. Click **Render**, then **Fetch fields (GET)**.
5. Switch to a different view using the list's own view dropdown (top right). Wait for it to load.
6. Switch back.
7. Copy everything in the console that contains `ffx-spike` and paste it back to me. Also say whether the panel was still on screen after step 5.

- [ ] **Step 4: Read the answers off the console log**

Q1 — instance survival. Look at the `onInit` and `listViewStateChanged` lines around the view switch:
- Only `listViewStateChanged` lines, same `instance=` value, new `view=` → **survives**; the panel stays in the DOM; the product can re-key the open target from the event.
- A new `onInit` with a different `instance=` (with or without an `onDispose` first) → **re-created**; the panel must reopen itself from the stashed draft (spec §2.4 already assumes this is fine).
- A full page load (the console clears) → **hard navigation**; same handling as re-created.

Q3 — shadow panel. From the `keydown … defaultPrevented=` lines (logged after dispatch completed, so they include any page-level cancel): every key the owner pressed should show `defaultPrevented=false`, the textarea should contain what they typed, `excelToSp OK` and `render OK` should appear and the preview pill should be visible, `GET fields → 200` should list the columns. Any key that never logged, or logged `defaultPrevented=true`, is SharePoint's global handler stealing it; note which.

Q4 — ETags. From the two `GET field → … / GET view → …` lines: record the `ETag-header=` and `odata.etag=` values. Either one being a non-`none` value means §7's MERGE can send `IF-MATCH: <etag>`; both `none` means the write can only be narrowed (re-read immediately before the MERGE).

- [ ] **Step 5: Record**

Fill in Q1, Q3 and Q4 in `spfx/FINDINGS.md` with the pasted console excerpt and one-line verdicts. Commit:
```bash
git add spfx/config/serve.json spfx/FINDINGS.md
git -c core.hooksPath="C:/Users/FW97/.config/git/hooks" commit -m "spike: Q1/Q3/Q4 findings from the live list"
```
Stop the serve process.

---

### Task 5: Q2 variant B — direct source import through SPFx's own build (mandatory)

**Files:**
- Modify: `spfx/src/extensions/formatFx/FormatFxCommandSet.ts` (temporary imports)
- Modify: `spfx/FINDINGS.md`

Variant A (Task 2) only proves that esbuild can bundle the parent's source and that SPFx can consume the result. This task is the other half of §9.2: can SPFx's webpack + TypeScript consume that source *directly*? It runs regardless of Task 2's outcome.

- [ ] **Step 1: Import the parent's core and editor source directly**

Add at the top of `FormatFxCommandSet.ts`:
```ts
import { importJson } from '../../../../src/core/serializer';
import { excelToSp } from '../../../../src/editor/dialect';
console.log('[ffx-spike] direct import OK', typeof importJson, typeof excelToSp);
```

- [ ] **Step 2: Build and record the outcome**

```bash
cd spfx && npm run build
```
Expected, most likely: a TypeScript `rootDir` error or the Heft rig refusing files outside `spfx/src`. Whatever it says, paste the first error into FINDINGS under Q2 as "Variant B (direct import): …". If it *passes*, also record whether the parent's `tsconfig.json` options (`verbatimModuleSyntax`, `erasableSyntaxOnly`, `moduleResolution: bundler`) caused any diagnostics.

- [ ] **Step 3: Revert the import, commit findings**

Remove the three lines added in Step 1. Then:
```bash
git add spfx
git -c core.hooksPath="C:/Users/FW97/.config/git/hooks" commit -m "spike: Q2 variant B outcome"
```

---

### Task 6: Write the answers into the spec and open the docs PR

**Files:**
- Modify: `docs/superpowers/specs/2026-09-16-spfx-format-panel-design.md` — §9 gains an "Answers" subsection; §4 bullet 3 gets its verdict.

- [ ] **Step 1: Push the spike branch (kept, never merged)**

```bash
git push -u origin spike/spfx-command-set
```

- [ ] **Step 2: Docs branch off main**

```bash
git checkout -b claude/spfx-spike-findings origin/main
```

- [ ] **Step 3: Write the answers**

In the spec, after §9's numbered list, add:
```markdown
### Answers (spike run 2026-09-xx, branch `spike/spfx-command-set`)

1. **View switch:** <survives / re-created / hard navigation> — evidence: <one console line>.
   Consequence for the panel: <re-key from listViewStateChangedEvent | reopen from the stashed draft>.
2. **Build:** Variant A (prebuilt esbuild bundle as a `file:` dependency): <works | fails: …>. Variant B (direct import through SPFx's build): <works | fails: first error>.
   Decision: the product package uses <A|B>. <one line of caveats>
3. **Shadow panel:** <renders and takes input cleanly | SharePoint steals: <keys>>.
   Consequence: <none | the panel stops propagation on <keys>>.
4. **ETags:** field <header/odata.etag value | none>, view <…>.
   Consequence: §7 step 4 <sends IF-MATCH: <etag> | narrows the window with a re-read before the MERGE>.
```
And in §4, replace the bullet "Engine and editor modules are consumed … is a spike question (§9.2)" with the decided sentence. In §7 step 4, delete whichever branch Q4 ruled out.

- [ ] **Step 4: Commit, push, PR**

```bash
git add docs/superpowers/specs/2026-09-16-spfx-format-panel-design.md
git -c core.hooksPath="C:/Users/FW97/.config/git/hooks" commit -m "docs: SPFx spike answers folded into the design spec"
git push -u origin claude/spfx-spike-findings
gh pr create --base main --head claude/spfx-spike-findings --title "docs: SPFx spike findings" --body-file <scratchpad>/pr-body.md
```
PR body: the four answers, one line each, and a link to the spike branch. Docs only; CI short-circuits. Then `git checkout main && git pull origin main` per CLAUDE.md.

---

## Self-review

- **Spec coverage:** §9.1 → Task 4 Q1; §9.2 → Task 2 (variant A, core + editor + bridge imports) and Task 5 (variant B, mandatory); §9.3 → Task 4 Q3 (flag read after dispatch); §9.4 → Task 2 Step 4's two single-entity GETs + Task 4 Q4; "no code kept" → Global Constraints + Task 6 branch handling; "read-only" → Global Constraints, and the only tenant calls are GETs in Task 2 Step 4.
- **Placeholders:** the `<…>` markers in Task 4 Step 3 and Task 6 Step 3 are owner-supplied values or observed results by design, not plan gaps.
- **Type consistency:** `SpikeContext` fields (`webUrl`, `listId`, `viewId`, `instanceId`, `log`) match between `panel.d.ts`, `entry.ts`, and the command set. `mountSpikePanel(host: ShadowRoot, ctx)` is the same signature in all three places. `EXTENSION_ID` and `TEST_LIST_URL` are defined in Task 1 Step 4 and Task 0 Step 1 before use.
