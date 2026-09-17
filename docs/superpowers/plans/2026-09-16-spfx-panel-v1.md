# SPFx Format panel — v1 plan A: host, tree, journal and apply

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first working SPFx Format panel: a **Format** button on every generic list, a right-side shadow-root panel with the list/views/columns tree, the validated-JSON editor over one target at a time, drafts and append-only history in the hidden `FormatFX` list (with the per-tab fallback), and the journal-first Apply with one-click rollback.

**Architecture:** Two packages under `spfx/`, mirroring `extension/`. `spfx/panel/` is a dependency-free vanilla-DOM panel bundled by esbuild from the parent repo's `src/core`, `src/editor` and `src/bridge` (spike answer 2, variant A) and consumed by the SPFx project as a `file:` dependency. `spfx/formatfx-spfx/` is the thin SPFx 1.23 ListView Command Set (Heft) that mounts the panel as a singleton shadow root on `document.body`, re-keys the open view from the URL and stops key propagation at the shadow host (spike answers 1 and 3). All new logic is pure, injected-fetch modules node-tested from the root `vitest` run; the tenant is touched only by the owner's manual smoke.

**Tech Stack:** TypeScript ~6 + esbuild for the panel (as `extension/`), SPFx 1.23.2 / Heft / Node `>=22.14.0 <23` for the package, vitest + happy-dom for tests. No React, no Fluent UI, no new runtime dependency in the main app.

**Spec:** `docs/superpowers/specs/2026-09-16-spfx-format-panel-design.md` — this plan implements §1, §2 (except the tab ladder), §4, §5 (no preview strip), §6, §7, §8. **Plan B (next, separate):** §3 the tab ladder (Rules · Formulas · Structure over the shadow root, last-tab memory, the remaining `document`-global seams in the editor), the preview strip and dark mode.

## Global Constraints

- **Zero runtime dependencies in the main app** (CLAUDE.md house rule). `spfx/` is exempt like `extension/` — both its packages have their own `package.json`; nothing new lands in the root `dependencies`.
- **`spfx/` is a writer by design** (spec §7). The read-only rule stays on `src/bridge` extraction; the panel's write client lives under `spfx/panel/src/` and is never imported by `src/`.
- **No ETag anywhere** (spike answer 4): every write is `IF-MATCH: *`; §7 narrows the window with a re-read immediately before the MERGE. Never plan on a 412.
- **Journal before list** (spec §6): a `Pending` row carrying `Before` and `After` is written before the target MERGE, and flipped to `Applied` only after a verifying re-read. History is append-only; rollback is an apply of a previous row's `Before`.
- **Singleton panel keyed by element id `ffx-format-panel`** (spike answer 1: SharePoint instantiates the Command Set twice per page load).
- **Key guard**: the shadow host stops `keydown`/`keyup`/`keypress` propagation in the bubble phase, for all keys (spike answer 3).
- **The open target re-keys from the URL's `viewid`**, never from `listViewStateChangedEvent` or `context.listView.view` (spike answer 1).
- **Frozen keys**: nothing in this plan writes the frozen `localStorage` keys. The editor state's autosave is paused inside the panel (`state.pauseAutosave()`); the panel's own per-tab keys are `sessionStorage` and prefixed `ffx-`.
- **Generated formatters stay lint-gated**: Apply refuses with the existing teaching copy when `lintDocument` reports an error.
- **Tests are contracts**: change the test first, then the code. Every new pure module has a co-located `*.test.ts` under `spfx/panel/src/` run by the root `npm test`.
- **Corporate proxy**: `NODE_EXTRA_CA_CERTS` must already point at the corp CA bundle. A TLS error on `npm install` → run the `fix-corp-tls-cert` skill and retry; never disable TLS checks.
- **The owner drives the browser** (memory `sp-live-probe-auth-expired`): Task 14's tenant smoke is a checklist handed to the owner, not automated.
- **PowerShell has no bash heredoc**: multi-line commit messages go through `git commit -F <file>` (CLAUDE.md).

---

## Decisions this plan makes (owner may overrule at review)

1. **The v1 editor is the existing JSON IDE pane (`src/editor/jsonPanel.ts`), mounted inside the shadow root**, not a new mini editor. It needs one seam in `EditorState` — a *single-target mode* where the open target is the only sheet, including a `column`-kind sheet (today `createView` refuses `column` and `loadDocument` routes a column payload into the floor's column "look") — plus one seam in `acMenu.ts` so completion popups render inside the shadow root. Both seams are inert for the web app and node-tested.
2. **CI builds and typechecks `spfx/panel` on every run** (like `extension/`); the SPFx `.sppkg` build stays a local step documented in `spfx/README.md`, because its `npm ci` is ~1,300 packages. Revisit when the package is released.
3. **View switch = full navigation** (`location.assign(view.url)`), with the open target remembered in `sessionStorage` so the panel reopens on the new view. Client-side navigation cannot be triggered from outside SharePoint's router.
4. **Document libraries are out of v1** (the Command Set registers for `ListTemplateId` 100 only, as the generator scaffolds it).
5. **The syntax-color mapper and dark mode are off in the panel** (they key off `document.body`, which is SharePoint's). Plan B.

---

## File structure

```
.gitignore                                   # + spfx build outputs (Task 1)
vite.config.ts                               # + test.exclude for the SPFx project (Task 1)
.github/workflows/ci.yml                     # + spfx/panel ci/typecheck/build steps (Task 14)
src/editor/state.ts                          # + singleTargetKind, openTargetDocument(), loadDocument coercion (Task 9)
src/editor/state.singleTarget.test.ts        # the seam's contract (Task 9)
src/editor/acMenu.ts                         # popup mounts into the editor's root node (Task 9)
src/editor/acMenu.shadow.test.ts             # (Task 9)
spfx/
  README.md                                  # build · debug · package · deploy (Task 14)
  panel/                                     # the bundle package (Task 1)
    package.json                             # name formatfx-panel, main dist/panel.js, types panel.d.ts
    package-lock.json
    tsconfig.json                            # mirror of extension/tsconfig.json
    build.mjs                                # esbuild src/panel.ts → dist/panel.js (+ generates src/appCss.gen.ts)
    panel.d.ts                               # hand-written public surface (kept in sync by Task 13)
    tools/shadowCss.mjs                      # cssForShadow(): :root→:host, body→.ffx-app …
    tools/shadowCss.test.ts
    src/
      hash.ts · hash.test.ts                 # contentHash / formatterHash (Task 2)
      journal.ts · journal.test.ts           # row types, item mapping, pending verdict (Task 2)
      rest.ts · rest.test.ts                 # injected-fetch SpRest: getJson/postJson/merge/del + digest (Task 3)
      journalStore.ts · journalStore.test.ts # hidden-list backend + sessionStorage fallback (Task 4)
      targetIo.ts · targetIo.test.ts         # list shape, read/write CustomFormatter (Task 5)
      applyFlow.ts · applyFlow.test.ts       # spec §7 state machine (Task 6)
      tree.ts · tree.test.ts                 # tree model with badges/dots (Task 7)
      urlState.ts · urlState.test.ts         # viewid parsing, URL watcher (Task 8)
      panelShell.ts · panelShell.test.ts     # shadow chrome, key guard, layout (Task 10)
      panel.ts · panel.test.ts               # controller: mountFormatPanel (Tasks 11–12)
      appCss.gen.ts                          # BUILD OUTPUT (gitignored): export const APP_CSS
    dist/panel.js                            # BUILD OUTPUT (gitignored)
  formatfx-spfx/                             # the SPFx project, cleaned up from the spike (Task 13)
    package.json                             # + prebuild/prestart → panel build; "formatfx-panel": "file:../panel"
    config/serve.json                        # pageUrl placeholder, ONE serve configuration
    config/package-solution.json             # real name/description, fresh GUIDs
    sharepoint/assets/elements.xml           # CustomAction without sample properties
    sharepoint/assets/ClientSideInstance.xml
    src/extensions/formatFx/FormatFxCommandSet.ts            # singleton mount + URL watcher + reopen
    src/extensions/formatFx/FormatFxCommandSet.manifest.json # one item: FORMAT "Format"
    src/extensions/formatFx/loc/{en-us.js,myStrings.d.ts}
```

**Shared vocabulary (used verbatim by every task):**

```ts
// spfx/panel/src/journal.ts
export type JournalKind = 'Draft' | 'Pending' | 'Applied' | 'Failed';
export type TargetKind = 'Field' | 'View';
export interface TargetRef { kind: TargetKind; id: string }   // Field → internal name; View → guid, lowercase, no braces
export interface JournalRow {
  id?: number; kind: JournalKind; listId: string; target: TargetRef;
  before: string | null; after: string | null; basedOn: string;
  author?: string; created?: string;
}
```

---
### Task 1: The `spfx/panel` package skeleton and the shadow-CSS rewrite

**Files:**
- Create: `spfx/panel/package.json`, `spfx/panel/tsconfig.json`, `spfx/panel/build.mjs`, `spfx/panel/tools/shadowCss.mjs`, `spfx/panel/tools/shadowCss.test.ts`, `spfx/panel/src/panel.ts` (placeholder export, replaced in Task 11), `spfx/panel/panel.d.ts`
- Modify: `.gitignore` (append), `vite.config.ts:48-52` (test.exclude)

**Interfaces:**
- Produces: `cssForShadow(css: string): string` (tools/shadowCss.mjs); `npm run build` in `spfx/panel` → `dist/panel.js` + `src/appCss.gen.ts` exporting `APP_CSS: string`; `npm run typecheck`.

- [ ] **Step 1: Root wiring**

Append to `.gitignore`:

```
# spfx (panel bundle + SPFx project build outputs)
spfx/panel/dist
spfx/panel/src/appCss.gen.ts
spfx/formatfx-spfx/lib
spfx/formatfx-spfx/dist
spfx/formatfx-spfx/temp
spfx/formatfx-spfx/release
spfx/formatfx-spfx/sharepoint/solution
```

In `vite.config.ts` extend the exclude list (the SPFx project carries Jest suites in its `node_modules`, and `node_modules/**` only matches the root):

```ts
    exclude: ['e2e/**', 'node_modules/**', 'dist/**', 'dist-single/**', 'tools/**',
      'extension/node_modules/**', 'extension/dist/**',
      'spfx/formatfx-spfx/**', 'spfx/panel/node_modules/**', 'spfx/panel/dist/**'],
```

- [ ] **Step 2: Package files**

`spfx/panel/package.json`:

```json
{
  "name": "formatfx-panel",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/panel.js",
  "types": "panel.d.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "build": "node build.mjs"
  },
  "devDependencies": { "esbuild": "^0.28.1", "typescript": "~6.0.2" }
}
```

`spfx/panel/tsconfig.json` — copy `extension/tsconfig.json` verbatim and change only the comment: `"Mirrors the repo root tsconfig so the parent src/ modules the panel bundles typecheck identically (DOM, no vite/client)."` Keep `"include": ["src"]`.

`spfx/panel/tools/shadowCss.mjs`:

```js
/**
 * cssForShadow — rewrite the app stylesheet for a shadow root. Inside a
 * shadow tree `:root` and `body` never match: the panel's host element plays
 * :root (custom properties are declared on it) and `.ffx-app` plays body.
 * `#app` is the web shell's flex column and is dropped. Every other rule
 * (`.wb-*`, `#wb-*`) is left alone — ids are scoped to the shadow tree.
 */
export function cssForShadow(css) {
  return css
    .replace(/^:root\s*\{/gm, ':host {')
    .replace(/^body\.wb-dark\b/gm, ':host(.wb-dark)')
    .replace(/^body\s*\{/gm, '.ffx-app {')
    .replace(/^#app\s*\{[^}]*\}[ \t]*$/gm, '');
}
```

`spfx/panel/build.mjs`:

```js
// Bundles the Format panel from the PARENT repo's src/ into one ESM file the
// SPFx webpack build consumes as a plain dependency (spike answer 2, variant
// A). Step 1 bakes the app stylesheet in as a string so the panel can inject
// it into its shadow root. Rebuilt by the SPFx project's prebuild/prestart.
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { cssForShadow } from './tools/shadowCss.mjs';

const css = cssForShadow(
  (await readFile('../../src/style.css', 'utf8')) + '\n' + (await readFile('../../src/chromeIcons.css', 'utf8')),
);
await writeFile('src/appCss.gen.ts',
  '// GENERATED by build.mjs — do not edit, do not commit.\nexport const APP_CSS = ' + JSON.stringify(css) + ';\n');

await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['src/panel.ts'],
  outfile: 'dist/panel.js',
  bundle: true,
  format: 'esm',
  target: 'es2022',
  sourcemap: true,
  legalComments: 'none',
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
    __BUILD_REV__: '"spfx"', __BUILD_DATE__: '""', __REPO_URL__: '""', __LAST_PR__: '""',
  },
});
console.log('formatfx-panel → dist/panel.js');
```

`spfx/panel/src/panel.ts` (placeholder; Task 11 replaces it):

```ts
export const PANEL_HOST_ID = 'ffx-format-panel';
```

`spfx/panel/panel.d.ts` (placeholder; Task 13 writes the full surface):

```ts
export declare const PANEL_HOST_ID: string;
```

- [ ] **Step 3: Write the failing test**

`spfx/panel/tools/shadowCss.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { cssForShadow } from './shadowCss.mjs';

describe('cssForShadow', () => {
  it('re-homes :root and body onto the shadow host and the app root', () => {
    const out = cssForShadow(':root {\n  --wb-bg: #fff;\n}\nbody {\n  margin: 0;\n}\nbody.wb-dark .x { color: red; }\n#app { display: flex; height: 100vh; }\n.wb-json { color: var(--wb-bg); }\n');
    expect(out).toContain(':host {\n  --wb-bg: #fff;');
    expect(out).toContain('.ffx-app {\n  margin: 0;');
    expect(out).toContain(':host(.wb-dark) .x { color: red; }');
    expect(out).not.toContain('#app');
    expect(out).toContain('.wb-json { color: var(--wb-bg); }');
  });

  it('leaves no document-level selector in the real stylesheet', () => {
    const out = cssForShadow(readFileSync(new URL('../../../src/style.css', import.meta.url), 'utf8'));
    expect(out).not.toMatch(/^:root\b/m);
    expect(out).not.toMatch(/^body\b/m);
    expect(out).not.toMatch(/^#app\b/m);
    expect(out).toMatch(/^:host \{/m);
  });
});
```

- [ ] **Step 4: Run the test, install, build**

Run: `npx vitest run spfx/panel/tools/shadowCss.test.ts`
Expected: PASS (2 tests). (Fix the regexes if the real stylesheet trips the second test — the intent is "no line starts with `:root`, `body` or `#app`".)

Run: `cd spfx/panel && npm install && npm run build && npm run typecheck`
Expected: `formatfx-panel → dist/panel.js`, `dist/panel.js` exists, `src/appCss.gen.ts` exists and is ignored (`git status --short spfx` shows no `appCss.gen.ts`, no `dist/`).

Run: `npm test` (root)
Expected: the full suite passes and includes the 2 new tests.

- [ ] **Step 5: Commit**

```bash
git add .gitignore vite.config.ts spfx/panel
git commit -m "spfx: panel bundle package skeleton + shadow-root CSS rewrite"
```

---

### Task 2: Content hash and the journal row model (pure)

**Files:**
- Create: `spfx/panel/src/hash.ts`, `spfx/panel/src/hash.test.ts`, `spfx/panel/src/journal.ts`, `spfx/panel/src/journal.test.ts`

**Interfaces:**
- Produces:
  - `contentHash(text: string): string` — FNV-1a 32-bit hex + `-` + length in base36; `formatterHash(f: string | null): string` — `contentHash(f ?? '')`.
  - `JournalKind`, `TargetKind`, `TargetRef`, `JournalRow` (shared vocabulary above); `JOURNAL_LIST_TITLE = 'FormatFX'`; `JOURNAL_FIELDS: { name: string; kind: 2 | 3 }[]`; `targetKey(t: TargetRef): string`; `rowTitle(row: JournalRow): string`; `toItemBody(row: JournalRow): Record<string, unknown>`; `fromItem(item: Record<string, unknown>): JournalRow | null`; `verdictForPending(row: JournalRow, live: string | null): 'Applied' | 'Failed'`.

- [ ] **Step 1: Write the failing tests**

`spfx/panel/src/hash.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { contentHash, formatterHash } from './hash';

describe('contentHash', () => {
  it('is deterministic and length-tagged', () => {
    expect(contentHash('abc')).toBe(contentHash('abc'));
    expect(contentHash('abc')).toMatch(/^[0-9a-f]{8}-3$/);
  });
  it('differs on a one-character change', () => {
    expect(contentHash('{"elmType":"div"}')).not.toBe(contentHash('{"elmType":"span"}'));
  });
  it('treats a missing formatter as the empty string', () => {
    expect(formatterHash(null)).toBe(contentHash(''));
  });
});
```

`spfx/panel/src/journal.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  targetKey, rowTitle, toItemBody, fromItem, verdictForPending,
  JOURNAL_FIELDS, JOURNAL_LIST_TITLE, type JournalRow,
} from './journal';
import { formatterHash } from './hash';

const row: JournalRow = {
  kind: 'Pending', listId: 'e481b50b-ebf9-4cbd-804f-a5276afb23ab',
  target: { kind: 'Field', id: 'Status' },
  before: '{"elmType":"div"}', after: '{"elmType":"span"}', basedOn: formatterHash('{"elmType":"div"}'),
};

describe('journal rows', () => {
  it('keys a target as Kind:id', () => {
    expect(targetKey({ kind: 'View', id: 'f24ba2a8-0000-0000-0000-000000000000' })).toBe('View:f24ba2a8-0000-0000-0000-000000000000');
  });
  it('titles a row for the list view', () => {
    expect(rowTitle(row)).toBe('Pending Field:Status');
  });
  it('maps to and from a SharePoint item, Title included (required column)', () => {
    const body = toItemBody(row);
    expect(body).toEqual({
      Title: 'Pending Field:Status', Kind: 'Pending', ListId: row.listId, TargetKind: 'Field', TargetId: 'Status',
      Before: row.before, After: row.after, BasedOn: row.basedOn,
    });
    const back = fromItem({ Id: 7, ...body, Created: '2026-09-16T00:00:00Z', Author: { Title: 'Sam' } });
    expect(back).toEqual({ ...row, id: 7, created: '2026-09-16T00:00:00Z', author: 'Sam' });
  });
  it('maps a cleared formatter as null both ways', () => {
    const cleared = { ...row, before: null };
    expect(toItemBody(cleared).Before).toBe('');
    expect(fromItem({ Id: 1, ...toItemBody(cleared) })?.before).toBeNull();
  });
  it('rejects an item with an unknown Kind', () => {
    expect(fromItem({ Id: 1, Kind: 'Bogus', ListId: 'x', TargetKind: 'Field', TargetId: 'y' })).toBeNull();
  });
  it('confirms a Pending row when the live formatter equals After, else fails it', () => {
    expect(verdictForPending(row, '{"elmType":"span"}')).toBe('Applied');
    expect(verdictForPending(row, '{"elmType":"div"}')).toBe('Failed');
    expect(verdictForPending({ ...row, after: null }, null)).toBe('Applied');
  });
  it('declares the hidden list shape', () => {
    expect(JOURNAL_LIST_TITLE).toBe('FormatFX');
    expect(JOURNAL_FIELDS.map((f) => f.name)).toEqual(['Kind', 'ListId', 'TargetKind', 'TargetId', 'Before', 'After', 'BasedOn']);
    expect(JOURNAL_FIELDS.find((f) => f.name === 'Before')?.kind).toBe(3);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run spfx/panel/src/hash.test.ts spfx/panel/src/journal.test.ts`
Expected: FAIL — cannot resolve `./hash` / `./journal`.

- [ ] **Step 3: Implement**

`spfx/panel/src/hash.ts`:

```ts
/**
 * hash.ts — content identity for journal rows (spec §6 `BasedOn`). Not a
 * security hash: FNV-1a 32-bit plus the length, enough to tell "the
 * formatter you started from" apart from "what the list holds now". The apply
 * flow compares full strings wherever it has them; the hash is what a draft
 * row can carry.
 */
export function contentHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0') + '-' + text.length.toString(36);
}

/** SharePoint stores a cleared formatter as ''/null — hash both the same. */
export function formatterHash(formatter: string | null): string {
  return contentHash(formatter ?? '');
}
```

`spfx/panel/src/journal.ts`:

```ts
/**
 * journal.ts — the hidden FormatFX list's row model (spec §6), pure.
 * One row per event; drafts are per person + target; Pending → Applied /
 * Failed is the only transition, history is append-only.
 */
export type JournalKind = 'Draft' | 'Pending' | 'Applied' | 'Failed';
export type TargetKind = 'Field' | 'View';
export interface TargetRef { kind: TargetKind; id: string }
export interface JournalRow {
  id?: number;
  kind: JournalKind;
  listId: string;
  target: TargetRef;
  before: string | null;
  after: string | null;
  basedOn: string;
  author?: string;
  created?: string;
}

export const JOURNAL_LIST_TITLE = 'FormatFX';
/** FieldTypeKind 2 = single line of text, 3 = multiple lines (the JSON). */
export const JOURNAL_FIELDS: { name: string; kind: 2 | 3 }[] = [
  { name: 'Kind', kind: 2 }, { name: 'ListId', kind: 2 }, { name: 'TargetKind', kind: 2 },
  { name: 'TargetId', kind: 2 }, { name: 'Before', kind: 3 }, { name: 'After', kind: 3 }, { name: 'BasedOn', kind: 2 },
];
const KINDS: readonly string[] = ['Draft', 'Pending', 'Applied', 'Failed'];

export function targetKey(t: TargetRef): string { return `${t.kind}:${t.id}`; }
export function rowTitle(row: JournalRow): string { return `${row.kind} ${targetKey(row.target)}`; }

export function toItemBody(row: JournalRow): Record<string, unknown> {
  return {
    Title: rowTitle(row), Kind: row.kind, ListId: row.listId,
    TargetKind: row.target.kind, TargetId: row.target.id,
    Before: row.before ?? '', After: row.after ?? '', BasedOn: row.basedOn,
  };
}

export function fromItem(item: Record<string, unknown>): JournalRow | null {
  const kind = item.Kind;
  if (typeof kind !== 'string' || !KINDS.includes(kind)) return null;
  if (item.TargetKind !== 'Field' && item.TargetKind !== 'View') return null;
  const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
  const row: JournalRow = {
    kind: kind as JournalKind, listId: String(item.ListId ?? ''),
    target: { kind: item.TargetKind, id: String(item.TargetId ?? '') },
    before: str(item.Before), after: str(item.After), basedOn: String(item.BasedOn ?? ''),
  };
  if (typeof item.Id === 'number') row.id = item.Id;
  if (typeof item.Created === 'string') row.created = item.Created;
  const author = (item.Author as { Title?: unknown } | undefined)?.Title;
  if (typeof author === 'string') row.author = author;
  return row;
}

/** The "check" action on an unconfirmed row: does the list hold After now? */
export function verdictForPending(row: JournalRow, live: string | null): 'Applied' | 'Failed' {
  return (live ?? '') === (row.after ?? '') ? 'Applied' : 'Failed';
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run spfx/panel/src/hash.test.ts spfx/panel/src/journal.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add spfx/panel/src/hash.ts spfx/panel/src/hash.test.ts spfx/panel/src/journal.ts spfx/panel/src/journal.test.ts
git commit -m "spfx: content hash + journal row model (pure)"
```

---
### Task 3: The injected-fetch REST client with digest handling

**Files:**
- Create: `spfx/panel/src/rest.ts`, `spfx/panel/src/rest.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export class SpRestError extends Error { readonly status: number; readonly body: string }
  export interface SpRest {
    readonly webUrl: string;                       // no trailing slash
    getJson(path: string): Promise<Record<string, unknown>>;                   // path starts with '/_api/…'
    postJson(path: string, body: unknown, headers?: Record<string, string>): Promise<Record<string, unknown> | null>;
    merge(path: string, body: unknown): Promise<void>;                          // X-HTTP-Method MERGE, IF-MATCH *
    del(path: string): Promise<void>;                                           // X-HTTP-Method DELETE, IF-MATCH *
  }
  export function explainHttp(status: number, body?: string): string;
  export function createSpRest(webUrl: string, fetchImpl?: typeof fetch): SpRest;
  ```
- Consumes: nothing from earlier tasks.

- [ ] **Step 1: Write the failing test**

`spfx/panel/src/rest.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createSpRest, explainHttp, SpRestError } from './rest';

interface Call { url: string; init?: RequestInit }

/** A fake fetch: `routes` maps (url, init) → status number | JSON body | { __status, body }. */
function fakeFetch(routes: (url: string, init?: RequestInit) => unknown): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = routes(url, init);
    if (typeof r === 'number') return new Response('', { status: r });
    if (r && typeof r === 'object' && '__status' in (r as Record<string, unknown>)) {
      const b = r as { __status: number; body?: string };
      return new Response(b.body ?? '', { status: b.__status });
    }
    return new Response(JSON.stringify(r), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}
const hdr = (c: Call, name: string): string | undefined => (c.init?.headers as Record<string, string> | undefined)?.[name];

describe('createSpRest', () => {
  it('GETs with the nometadata Accept header and same-origin cookies', async () => {
    const { fetch, calls } = fakeFetch(() => ({ value: [1] }));
    const rest = createSpRest('https://t.sharepoint.com/sites/x/', fetch);
    expect(await rest.getJson('/_api/web/lists')).toEqual({ value: [1] });
    expect(calls[0].url).toBe('https://t.sharepoint.com/sites/x/_api/web/lists');
    expect(hdr(calls[0], 'Accept')).toBe('application/json;odata=nometadata');
    expect(calls[0].init?.credentials).toBe('same-origin');
    expect(calls[0].init?.method).toBeUndefined();
  });

  it('fetches ONE digest lazily before the first write and reuses it', async () => {
    const { fetch, calls } = fakeFetch((url) => (url.endsWith('/_api/contextinfo') ? { FormDigestValue: 'D1' } : { Id: 5 }));
    const rest = createSpRest('https://t.sharepoint.com/sites/x', fetch);
    expect(await rest.postJson('/_api/web/lists/getbytitle(\'FormatFX\')/items', { Title: 'a' })).toEqual({ Id: 5 });
    await rest.merge('/_api/web/lists/getbytitle(\'FormatFX\')/items(5)', { Kind: 'Applied' });
    const digests = calls.filter((c) => c.url.endsWith('/_api/contextinfo'));
    expect(digests).toHaveLength(1);
    expect(digests[0].init?.method).toBe('POST');
    const post = calls[1];
    expect(hdr(post, 'X-RequestDigest')).toBe('D1');
    expect(hdr(post, 'Content-Type')).toBe('application/json;odata=nometadata');
    expect(post.init?.body).toBe('{"Title":"a"}');
    const merge = calls[2];
    expect(hdr(merge, 'X-HTTP-Method')).toBe('MERGE');
    expect(hdr(merge, 'IF-MATCH')).toBe('*');
  });

  it('refreshes the digest once on a 403 "security validation" and retries that write', async () => {
    let n = 0;
    const { fetch, calls } = fakeFetch((url, init) => {
      if (url.endsWith('/_api/contextinfo')) return { FormDigestValue: 'D' + (++n) };
      if (init?.method === 'POST' && (init.headers as Record<string, string>)['X-RequestDigest'] === 'D1') {
        return { __status: 403, body: '{"odata.error":{"message":{"value":"The security validation for this page is invalid and might be corrupted."}}}' };
      }
      return 204;
    });
    const rest = createSpRest('https://t.sharepoint.com/sites/x', fetch);
    await rest.merge('/_api/web/lists(guid\'a\')/fields/getbyinternalnameortitle(\'Status\')', { CustomFormatter: '{}' });
    const writes = calls.filter((c) => c.init?.method === 'POST' && !c.url.endsWith('/_api/contextinfo'));
    expect(writes.map((c) => hdr(c, 'X-RequestDigest'))).toEqual(['D1', 'D2']);
  });

  it('DELETEs through X-HTTP-Method with no body', async () => {
    const { fetch, calls } = fakeFetch((url) => (url.endsWith('/_api/contextinfo') ? { FormDigestValue: 'D' } : 204));
    const rest = createSpRest('https://t.sharepoint.com/sites/x', fetch);
    await rest.del('/_api/web/lists/getbytitle(\'FormatFX\')/items(3)');
    const d = calls[1];
    expect(hdr(d, 'X-HTTP-Method')).toBe('DELETE');
    expect(d.init?.body).toBeUndefined();
  });

  it('throws a teaching SpRestError on failure', async () => {
    const { fetch } = fakeFetch(() => 403);
    const rest = createSpRest('https://t.sharepoint.com/sites/x', fetch);
    const err = await rest.getJson('/_api/web/lists').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SpRestError);
    expect((err as SpRestError).status).toBe(403);
    expect((err as SpRestError).message).toContain('Manage Lists');
  });
});

describe('explainHttp', () => {
  it('teaches per status (spec §7.7)', () => {
    expect(explainHttp(401)).toContain('Manage Lists');
    expect(explainHttp(403, 'security validation')).toContain('digest');
    expect(explainHttp(404)).toContain('internal name');
    expect(explainHttp(500)).toContain('HTTP 500');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run spfx/panel/src/rest.test.ts`
Expected: FAIL — cannot resolve `./rest`.

- [ ] **Step 3: Implement**

`spfx/panel/src/rest.ts`:

```ts
/**
 * rest.ts — the panel's SharePoint REST client. Same-origin fetch with the
 * page's cookies plus a request digest from POST /_api/contextinfo (spec §4,
 * §7.3): the digest is fetched lazily before the first write, reused, and
 * refreshed ONCE when a write comes back 403 "security validation".
 *
 * The fetch is injected so every caller is node-testable with a fake; the
 * default is the page's own fetch. This is the WRITE path of the product
 * (spec §7) — it lives here, never in src/bridge, whose extraction stays
 * read-only.
 */
const ACCEPT = 'application/json;odata=nometadata';
const SECURITY_VALIDATION = /security validation/i;

export class SpRestError extends Error {
  constructor(readonly status: number, readonly body: string, message: string) {
    super(message);
    this.name = 'SpRestError';
  }
}

export interface SpRest {
  readonly webUrl: string;
  getJson(path: string): Promise<Record<string, unknown>>;
  postJson(path: string, body: unknown, headers?: Record<string, string>): Promise<Record<string, unknown> | null>;
  merge(path: string, body: unknown): Promise<void>;
  del(path: string): Promise<void>;
}

/** Spec §7.7 — errors teach. */
export function explainHttp(status: number, body = ''): string {
  if (status === 403 && SECURITY_VALIDATION.test(body)) {
    return 'the request digest expired — it is refreshed automatically once; try the action again if this persists.';
  }
  if (status === 401 || status === 403) {
    return 'you need Manage Lists on this list (part of the default Edit level). Ask the site owner.';
  }
  if (status === 404) {
    return 'target not found — columns go by INTERNAL name, views by their id; the list may also have been deleted.';
  }
  return 'unexpected HTTP ' + status + ' — check the Network tab for the response body.';
}

export function createSpRest(webUrl: string, fetchImpl: typeof fetch = (...a) => globalThis.fetch(...a)): SpRest {
  const base = webUrl.replace(/\/+$/, '');
  let digest: string | null = null;

  const fail = async (res: Response): Promise<never> => {
    const body = await res.text().catch(() => '');
    throw new SpRestError(res.status, body, 'FormatFX: ' + explainHttp(res.status, body));
  };

  const fetchDigest = async (): Promise<string> => {
    const res = await fetchImpl(base + '/_api/contextinfo', {
      method: 'POST', headers: { Accept: ACCEPT }, credentials: 'same-origin',
    });
    if (!res.ok) return fail(res);
    digest = ((await res.json()) as { FormDigestValue: string }).FormDigestValue;
    return digest;
  };

  const write = async (path: string, body: unknown, headers: Record<string, string>): Promise<Response> => {
    const send = async (): Promise<Response> => fetchImpl(base + path, {
      method: 'POST',
      headers: {
        Accept: ACCEPT, 'Content-Type': ACCEPT,
        'X-RequestDigest': digest ?? (await fetchDigest()),
        ...headers,
      },
      credentials: 'same-origin',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let res = await send();
    if (res.status === 403 && SECURITY_VALIDATION.test(await res.clone().text().catch(() => ''))) {
      await fetchDigest();
      res = await send();
    }
    if (!res.ok) return fail(res);
    return res;
  };

  return {
    webUrl: base,
    async getJson(path) {
      const res = await fetchImpl(base + path, { headers: { Accept: ACCEPT }, credentials: 'same-origin' });
      if (!res.ok) return fail(res);
      return (await res.json()) as Record<string, unknown>;
    },
    async postJson(path, body, headers = {}) {
      const res = await write(path, body, headers);
      const text = await res.text();
      return text ? (JSON.parse(text) as Record<string, unknown>) : null;
    },
    async merge(path, body) {
      await write(path, body, { 'X-HTTP-Method': 'MERGE', 'IF-MATCH': '*' });
    },
    async del(path) {
      await write(path, undefined, { 'X-HTTP-Method': 'DELETE', 'IF-MATCH': '*' });
    },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run spfx/panel/src/rest.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add spfx/panel/src/rest.ts spfx/panel/src/rest.test.ts
git commit -m "spfx: injected-fetch REST client with lazy digest + one refresh"
```

---

### Task 4: The journal store — hidden list backend and the per-tab fallback

**Files:**
- Create: `spfx/panel/src/journalStore.ts`, `spfx/panel/src/journalStore.test.ts`

**Interfaces:**
- Consumes: `SpRest`, `SpRestError` (Task 3); `JournalRow`, `TargetRef`, `JournalKind`, `targetKey`, `toItemBody`, `fromItem`, `JOURNAL_LIST_TITLE`, `JOURNAL_FIELDS` (Task 2).
- Produces:
  ```ts
  export interface JournalBackend {
    readonly durable: boolean;          // false → per-tab sessionStorage fallback (spec §6)
    readonly reason?: string;           // why the fallback is in use
    loadDraft(t: TargetRef): Promise<JournalRow | null>;
    saveDraft(t: TargetRef, after: string, basedOn: string): Promise<void>;
    deleteDraft(t: TargetRef): Promise<void>;
    listDraftKeys(): Promise<Set<string>>;
    append(row: JournalRow): Promise<number>;            // new row id
    setKind(id: number, kind: JournalKind): Promise<void>;
    history(t: TargetRef): Promise<JournalRow[]>;         // Pending/Applied/Failed, newest first
  }
  export const JOURNAL_PATH: string;    // "/_api/web/lists/getbytitle('FormatFX')"
  export function createListJournal(rest: SpRest, listId: string, userId: number): JournalBackend;
  export function createSessionJournal(listId: string, storage: Storage, reason: string): JournalBackend;
  export async function openJournal(rest: SpRest, listId: string, storage: Storage): Promise<JournalBackend>;
  ```

- [ ] **Step 1: Write the failing test**

`spfx/panel/src/journalStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createSpRest } from './rest';
import { openJournal, createSessionJournal, JOURNAL_PATH, type JournalBackend } from './journalStore';
import { formatterHash } from './hash';
import type { JournalRow } from './journal';

interface Call { url: string; init?: RequestInit }
const LIST = 'e481b50b-ebf9-4cbd-804f-a5276afb23ab';
const T = { kind: 'Field' as const, id: 'Status' };

/** An in-memory FormatFX list behind a fake fetch. `state.exists=false` 404s the list. */
function fakeTenant(state: { exists: boolean; canWrite: boolean; items: Record<string, unknown>[] }) {
  const calls: Call[] = [];
  let nextId = 1;
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const h = (init?.headers ?? {}) as Record<string, string>;
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    if (url.endsWith('/_api/contextinfo')) return json({ FormDigestValue: 'D' });
    if (url.endsWith('/_api/web/currentuser?$select=Id')) return json({ Id: 12 });
    if (url.endsWith('/_api/web/lists') && init?.method === 'POST') {
      if (!state.canWrite) return new Response('', { status: 403 });
      state.exists = true; return json({ Id: 'new' }, 201);
    }
    if (!url.includes(JOURNAL_PATH)) return new Response('', { status: 404 });
    if (!state.exists) return new Response('', { status: 404 });
    if (url.endsWith('/fields') && init?.method === 'POST') return json({}, 201);
    if (url.includes('/items(') && h['X-HTTP-Method'] === 'MERGE') {
      const id = Number(/items\((\d+)\)/.exec(url)![1]);
      Object.assign(state.items.find((i) => i.Id === id)!, JSON.parse(init!.body as string));
      return new Response('', { status: 204 });
    }
    if (url.includes('/items(') && h['X-HTTP-Method'] === 'DELETE') {
      const id = Number(/items\((\d+)\)/.exec(url)![1]);
      state.items = state.items.filter((i) => i.Id !== id);
      return new Response('', { status: 204 });
    }
    if (url.includes('/items') && init?.method === 'POST') {
      const item = { Id: nextId++, Created: new Date(nextId * 1000).toISOString(), AuthorId: 12, Author: { Title: 'Me' }, ...JSON.parse(init!.body as string) };
      state.items.push(item);
      return json(item, 201);
    }
    if (url.includes('/items')) {
      const filter = decodeURIComponent(new URL(url).searchParams.get('$filter') ?? '');
      const rows = state.items.filter((i) => {
        const eq = (col: string) => { const m = new RegExp(col + " eq '([^']*)'").exec(filter); return !m || i[col] === m[1]; };
        const ne = (col: string) => { const m = new RegExp(col + " ne '([^']*)'").exec(filter); return !m || i[col] !== m[1]; };
        const author = /AuthorId eq (\d+)/.exec(filter); return eq('Kind') && ne('Kind') && eq('ListId') && eq('TargetKind') && eq('TargetId') && (!author || i.AuthorId === Number(author[1]));
      });
      const desc = (new URL(url).searchParams.get('$orderby') ?? '').includes('desc');
      return json({ value: desc ? [...rows].reverse() : rows });
    }
    return json({ Id: 'list' });
  }) as unknown as typeof fetch;
  return { fetch: f, calls, state };
}

describe('openJournal', () => {
  it('creates the hidden list with its columns when missing, then is durable', async () => {
    const t = fakeTenant({ exists: false, canWrite: true, items: [] });
    const j = await openJournal(createSpRest('https://t/sites/x', t.fetch), LIST, sessionStorage);
    expect(j.durable).toBe(true);
    const create = t.calls.find((c) => c.url.endsWith('/_api/web/lists') && c.init?.method === 'POST')!;
    expect(JSON.parse(create.init!.body as string)).toEqual({ '@odata.type': '#SP.List', BaseTemplate: 100, Title: 'FormatFX', Hidden: true, Description: 'FormatFX drafts and formatter history. Do not edit by hand.' });
    const fields = t.calls.filter((c) => c.url.endsWith('/fields') && c.init?.method === 'POST').map((c) => JSON.parse(c.init!.body as string));
    expect(fields).toHaveLength(7);
    expect(fields[4]).toEqual({ '@odata.type': '#SP.FieldMultiLineText', FieldTypeKind: 3, Title: 'Before' });
    expect(fields[0]).toEqual({ '@odata.type': '#SP.FieldText', FieldTypeKind: 2, Title: 'Kind' });
  });

  it('falls back to the per-tab journal when the list cannot be created', async () => {
    const t = fakeTenant({ exists: false, canWrite: false, items: [] });
    const j = await openJournal(createSpRest('https://t/sites/x', t.fetch), LIST, sessionStorage);
    expect(j.durable).toBe(false);
    expect(j.reason).toContain('Manage Lists');
  });
});

function contract(name: string, make: () => Promise<JournalBackend>): void {
  describe(`${name} backend`, () => {
    let j: JournalBackend;
    beforeEach(async () => { sessionStorage.clear(); j = await make(); });

    it('has no draft to begin with', async () => {
      expect(await j.loadDraft(T)).toBeNull();
      expect(await j.listDraftKeys()).toEqual(new Set());
    });
    it('saves ONE draft per target and person, updating in place', async () => {
      await j.saveDraft(T, '{"a":1}', formatterHash(null));
      await j.saveDraft(T, '{"a":2}', formatterHash(null));
      const d = await j.loadDraft(T);
      expect(d?.kind).toBe('Draft');
      expect(d?.after).toBe('{"a":2}');
      expect(await j.listDraftKeys()).toEqual(new Set(['Field:Status']));
      await j.deleteDraft(T);
      expect(await j.loadDraft(T)).toBeNull();
    });
    it('appends Pending rows, flips them, and lists history newest first without drafts', async () => {
      await j.saveDraft(T, '{"draft":1}', formatterHash(null));
      const row: JournalRow = { kind: 'Pending', listId: LIST, target: T, before: null, after: '{"v":1}', basedOn: formatterHash(null) };
      const id1 = await j.append(row);
      await j.setKind(id1, 'Applied');
      const id2 = await j.append({ ...row, before: '{"v":1}', after: '{"v":2}', basedOn: formatterHash('{"v":1}') });
      const h = await j.history(T);
      expect(h.map((r) => [r.id, r.kind])).toEqual([[id2, 'Pending'], [id1, 'Applied']]);
      expect(h.every((r) => r.kind !== 'Draft')).toBe(true);
      expect(h[1].after).toBe('{"v":1}');
    });
  });
}

contract('list', async () => {
  const t = fakeTenant({ exists: true, canWrite: true, items: [] });
  return openJournal(createSpRest('https://t/sites/x', t.fetch), LIST, sessionStorage);
});
contract('session', async () => createSessionJournal(LIST, sessionStorage, 'test'));
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run spfx/panel/src/journalStore.test.ts`
Expected: FAIL — cannot resolve `./journalStore`.

- [ ] **Step 3: Implement**

`spfx/panel/src/journalStore.ts`:

```ts
/**
 * journalStore.ts — where drafts and history live (spec §6).
 *
 * Durable backend: the hidden `FormatFX` list on the site, created on first
 * use (needs Manage Lists). Drafts are per person + target (filtered by
 * AuthorId); Pending/Applied/Failed rows are the append-only history.
 *
 * Fallback backend: per-tab sessionStorage, used whenever the list is
 * unavailable to this person — cannot be created, or exists but cannot be
 * read/written. Nothing there is shared or durable; the panel says so.
 */
import { type SpRest, SpRestError } from './rest';
import {
  JOURNAL_FIELDS, JOURNAL_LIST_TITLE, fromItem, toItemBody, targetKey,
  type JournalKind, type JournalRow, type TargetRef,
} from './journal';

export interface JournalBackend {
  readonly durable: boolean;
  readonly reason?: string;
  loadDraft(t: TargetRef): Promise<JournalRow | null>;
  saveDraft(t: TargetRef, after: string, basedOn: string): Promise<void>;
  deleteDraft(t: TargetRef): Promise<void>;
  listDraftKeys(): Promise<Set<string>>;
  append(row: JournalRow): Promise<number>;
  setKind(id: number, kind: JournalKind): Promise<void>;
  history(t: TargetRef): Promise<JournalRow[]>;
}

export const JOURNAL_PATH = `/_api/web/lists/getbytitle('${JOURNAL_LIST_TITLE}')`;
const SELECT = '$select=Id,Kind,ListId,TargetKind,TargetId,Before,After,BasedOn,Created,AuthorId,Author/Title&$expand=Author';
const q = (s: string): string => s.replace(/'/g, "''");

// ── the hidden list ────────────────────────────────────────────────────────

export function createListJournal(rest: SpRest, listId: string, userId: number): JournalBackend {
  const items = async (filter: string, extra = ''): Promise<JournalRow[]> => {
    const res = await rest.getJson(`${JOURNAL_PATH}/items?$filter=${encodeURIComponent(filter)}&${SELECT}${extra}`);
    return ((res.value as Record<string, unknown>[]) ?? []).map(fromItem).filter((r): r is JournalRow => r !== null);
  };
  const target = (t: TargetRef): string => `ListId eq '${q(listId)}' and TargetKind eq '${t.kind}' and TargetId eq '${q(t.id)}'`;
  const draftOf = async (t: TargetRef): Promise<JournalRow | null> =>
    (await items(`Kind eq 'Draft' and ${target(t)} and AuthorId eq ${userId}`, '&$top=1'))[0] ?? null;

  return {
    durable: true,
    loadDraft: draftOf,
    async saveDraft(t, after, basedOn) {
      const existing = await draftOf(t);
      if (existing?.id !== undefined) {
        await rest.merge(`${JOURNAL_PATH}/items(${existing.id})`, { After: after, BasedOn: basedOn });
        return;
      }
      await rest.postJson(`${JOURNAL_PATH}/items`, toItemBody({ kind: 'Draft', listId, target: t, before: null, after, basedOn }));
    },
    async deleteDraft(t) {
      const existing = await draftOf(t);
      if (existing?.id !== undefined) await rest.del(`${JOURNAL_PATH}/items(${existing.id})`);
    },
    async listDraftKeys() {
      const rows = await items(`Kind eq 'Draft' and ListId eq '${q(listId)}' and AuthorId eq ${userId}`, '&$top=500');
      return new Set(rows.map((r) => targetKey(r.target)));
    },
    async append(row) {
      const created = await rest.postJson(`${JOURNAL_PATH}/items`, toItemBody(row));
      const id = created?.Id;
      if (typeof id !== 'number') throw new Error('FormatFX: the journal row was written but SharePoint returned no item id.');
      return id;
    },
    async setKind(id, kind) {
      await rest.merge(`${JOURNAL_PATH}/items(${id})`, { Kind: kind, Title: `${kind} (row ${id})` });
    },
    async history(t) {
      return items(`Kind ne 'Draft' and ${target(t)}`, '&$orderby=Created desc&$top=50');
    },
  };
}

/** Ensure the list exists with its columns. Throws SpRestError when it cannot. */
async function ensureJournalList(rest: SpRest): Promise<void> {
  try {
    await rest.getJson(`${JOURNAL_PATH}?$select=Id`);
    return;
  } catch (e) {
    if (!(e instanceof SpRestError) || e.status !== 404) throw e;
  }
  await rest.postJson('/_api/web/lists', {
    '@odata.type': '#SP.List', BaseTemplate: 100, Title: JOURNAL_LIST_TITLE, Hidden: true,
    Description: 'FormatFX drafts and formatter history. Do not edit by hand.',
  });
  for (const f of JOURNAL_FIELDS) {
    await rest.postJson(`${JOURNAL_PATH}/fields`, {
      '@odata.type': f.kind === 3 ? '#SP.FieldMultiLineText' : '#SP.FieldText', FieldTypeKind: f.kind, Title: f.name,
    });
  }
}

// ── the per-tab fallback ───────────────────────────────────────────────────

interface SessionBag { nextId: number; rows: JournalRow[] }

export function createSessionJournal(listId: string, storage: Storage, reason: string): JournalBackend {
  const key = `ffx-journal.${listId}`;
  const load = (): SessionBag => {
    try { const raw = storage.getItem(key); if (raw) return JSON.parse(raw) as SessionBag; } catch { /* private mode */ }
    return { nextId: 1, rows: [] };
  };
  const save = (bag: SessionBag): void => { try { storage.setItem(key, JSON.stringify(bag)); } catch { /* quota */ } };
  const same = (a: TargetRef, b: TargetRef): boolean => a.kind === b.kind && a.id === b.id;
  return {
    durable: false,
    reason,
    async loadDraft(t) { return load().rows.find((r) => r.kind === 'Draft' && same(r.target, t)) ?? null; },
    async saveDraft(t, after, basedOn) {
      const bag = load();
      const d = bag.rows.find((r) => r.kind === 'Draft' && same(r.target, t));
      if (d) { d.after = after; d.basedOn = basedOn; }
      else bag.rows.push({ id: bag.nextId++, kind: 'Draft', listId, target: t, before: null, after, basedOn, created: new Date().toISOString() });
      save(bag);
    },
    async deleteDraft(t) {
      const bag = load();
      bag.rows = bag.rows.filter((r) => !(r.kind === 'Draft' && same(r.target, t)));
      save(bag);
    },
    async listDraftKeys() { return new Set(load().rows.filter((r) => r.kind === 'Draft').map((r) => targetKey(r.target))); },
    async append(row) {
      const bag = load();
      const id = bag.nextId++;
      bag.rows.push({ ...row, id, created: new Date().toISOString() });
      save(bag);
      return id;
    },
    async setKind(id, kind) {
      const bag = load();
      const r = bag.rows.find((x) => x.id === id);
      if (r) { r.kind = kind; save(bag); }
    },
    async history(t) {
      return load().rows.filter((r) => r.kind !== 'Draft' && same(r.target, t)).sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
    },
  };
}

// ── choosing ───────────────────────────────────────────────────────────────

export async function openJournal(rest: SpRest, listId: string, storage: Storage): Promise<JournalBackend> {
  try {
    await ensureJournalList(rest);
    const me = await rest.getJson('/_api/web/currentuser?$select=Id');
    await rest.getJson(`${JOURNAL_PATH}/items?$top=1&$select=Id`); // proves this person can read it
    return createListJournal(rest, listId, me.Id as number);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    return createSessionJournal(listId, storage, `The FormatFX journal list is not available to you (${why}). Drafts and history live in this browser tab only.`);
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run spfx/panel/src/journalStore.test.ts`
Expected: PASS (8 tests: 2 openJournal + 3 × 2 contract).

- [ ] **Step 5: Commit**

```bash
git add spfx/panel/src/journalStore.ts spfx/panel/src/journalStore.test.ts
git commit -m "spfx: journal store — hidden FormatFX list backend + per-tab fallback"
```

---
### Task 5: Target I/O — list shape, read and write of `CustomFormatter`

**Files:**
- Create: `spfx/panel/src/targetIo.ts`, `spfx/panel/src/targetIo.test.ts`

**Interfaces:**
- Consumes: `SpRest` (Task 3); `TargetRef` (Task 2); `SnapshotField`, `SnapshotView` from `../../../src/bridge/spClient` (types only).
- Produces:
  ```ts
  export interface ShapeView extends SnapshotView { id: string; url: string }   // url = ServerRelativeUrl of the view page
  export interface ListShape { fields: SnapshotField[]; views: ShapeView[] }
  export function normalizeGuid(g: string): string;                            // strip {} and lowercase
  export function listPath(listId: string): string;                            // "/_api/web/lists(guid'…')"
  export function targetPath(listId: string, t: TargetRef): string;
  export function loadListShape(rest: SpRest, listId: string): Promise<ListShape>;
  export function readFormatter(rest: SpRest, listId: string, t: TargetRef): Promise<string | null>;
  export function writeFormatter(rest: SpRest, listId: string, t: TargetRef, formatter: string | null): Promise<void>;
  ```

- [ ] **Step 1: Write the failing test**

`spfx/panel/src/targetIo.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createSpRest } from './rest';
import { listPath, targetPath, normalizeGuid, loadListShape, readFormatter, writeFormatter } from './targetIo';

const LIST = '{E481B50B-EBF9-4CBD-804F-A5276AFB23AB}';
const VIEW = 'f24ba2a8-1111-2222-3333-444444444444';
interface Call { url: string; init?: RequestInit }
function fake(routes: (url: string, init?: RequestInit) => unknown): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = routes(url, init);
    return typeof r === 'number' ? new Response('', { status: r }) : new Response(JSON.stringify(r), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}

describe('paths', () => {
  it('normalizes guids and builds list/target paths', () => {
    expect(normalizeGuid(LIST)).toBe('e481b50b-ebf9-4cbd-804f-a5276afb23ab');
    expect(listPath(LIST)).toBe("/_api/web/lists(guid'e481b50b-ebf9-4cbd-804f-a5276afb23ab')");
    expect(targetPath(LIST, { kind: 'Field', id: "O'Brien" })).toBe(listPath(LIST) + "/fields/getbyinternalnameortitle('O''Brien')");
    expect(targetPath(LIST, { kind: 'View', id: VIEW })).toBe(listPath(LIST) + `/views(guid'${VIEW}')`);
  });
});

describe('loadListShape', () => {
  it('maps fields and views the way captureSnapshot does, plus the view url', async () => {
    const { fetch, calls } = fake((url) => {
      if (url.includes('/fields?')) return { value: [{ InternalName: 'Status', Title: 'Status', TypeAsString: 'Choice', Choices: ['A', 'B'], CustomFormatter: '{"elmType":"div"}', ReadOnlyField: false, Hidden: false }] };
      if (url.includes('/views?')) return { value: [{ Title: 'All Items', Id: VIEW, DefaultView: true, CustomFormatter: '', ServerRelativeUrl: '/sites/x/Lists/L/AllItems.aspx', ViewFields: { Items: ['Title', 'Status'] } }] };
      throw new Error('unexpected ' + url);
    });
    const shape = await loadListShape(createSpRest('https://t/sites/x', fetch), LIST);
    expect(shape.fields[0]).toEqual({ internalName: 'Status', displayName: 'Status', type: 'Choice', choices: ['A', 'B'], lookupList: undefined, lookupColumn: undefined, readOnly: false, hidden: false, customFormatter: '{"elmType":"div"}' });
    expect(shape.views[0]).toEqual({ title: 'All Items', id: VIEW, isDefault: true, viewFields: ['Title', 'Status'], customFormatter: undefined, url: '/sites/x/Lists/L/AllItems.aspx' });
    expect(calls[0].url).toContain('$filter=Hidden eq false');
    expect(calls[1].url).toContain('ServerRelativeUrl');
  });
});

describe('read/write', () => {
  it('reads null for an empty formatter and writes "" to clear', async () => {
    const { fetch, calls } = fake((url) => (url.endsWith('/_api/contextinfo') ? { FormDigestValue: 'D' } : url.includes('?$select=CustomFormatter') ? { CustomFormatter: '' } : 204));
    const rest = createSpRest('https://t/sites/x', fetch);
    expect(await readFormatter(rest, LIST, { kind: 'Field', id: 'Status' })).toBeNull();
    await writeFormatter(rest, LIST, { kind: 'View', id: VIEW }, null);
    const w = calls[calls.length - 1];
    expect(w.url).toBe(`https://t/sites/x${listPath(LIST)}/views(guid'${VIEW}')`);
    expect((w.init?.headers as Record<string, string>)['X-HTTP-Method']).toBe('MERGE');
    expect(w.init?.body).toBe('{"CustomFormatter":""}');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run spfx/panel/src/targetIo.test.ts`
Expected: FAIL — cannot resolve `./targetIo`.

- [ ] **Step 3: Implement**

`spfx/panel/src/targetIo.ts`:

```ts
/**
 * targetIo.ts — the list as the panel sees it (fields + views with their
 * formatters, spec §2.4) and the two target operations the apply flow needs
 * (§7.1 read, §7.5 write). Field/view mapping mirrors src/bridge/spClient's
 * captureSnapshot so the tree and the editor's lint see the same shape the
 * extension captures. Views additionally carry their page url (§2.4: picking
 * a view navigates the page).
 */
import type { SpRest } from './rest';
import type { TargetRef } from './journal';
import type { SnapshotField, SnapshotView } from '../../../src/bridge/spClient';

export interface ShapeView extends SnapshotView { id: string; url: string }
export interface ListShape { fields: SnapshotField[]; views: ShapeView[] }

export function normalizeGuid(g: string): string { return g.replace(/[{}]/g, '').toLowerCase(); }
const q = (s: string): string => s.replace(/'/g, "''");

export function listPath(listId: string): string { return `/_api/web/lists(guid'${normalizeGuid(listId)}')`; }

export function targetPath(listId: string, t: TargetRef): string {
  return listPath(listId) + (t.kind === 'Field'
    ? `/fields/getbyinternalnameortitle('${q(t.id)}')`
    : `/views(guid'${normalizeGuid(t.id)}')`);
}

const FIELDS_Q = '/fields?$filter=Hidden eq false&$select=InternalName,Title,TypeAsString,Choices,CustomFormatter,LookupList,LookupField,ReadOnlyField,Hidden';
const VIEWS_Q = '/views?$expand=ViewFields&$select=Title,Id,DefaultView,CustomFormatter,ServerRelativeUrl,ViewFields/Items';

export async function loadListShape(rest: SpRest, listId: string): Promise<ListShape> {
  const base = listPath(listId);
  const fieldsRes = await rest.getJson(base + FIELDS_Q);
  const fields: SnapshotField[] = ((fieldsRes.value as Record<string, unknown>[]) || []).map((f) => ({
    internalName: f.InternalName as string,
    displayName: f.Title as string,
    type: f.TypeAsString as string,
    choices: Array.isArray(f.Choices) && f.Choices.length ? (f.Choices as string[]) : undefined,
    lookupList: f.LookupList ? String(f.LookupList).replace(/[{}]/g, '') : undefined,
    lookupColumn: (f.LookupField as string) || undefined,
    readOnly: !!f.ReadOnlyField,
    hidden: !!f.Hidden,
    customFormatter: (f.CustomFormatter as string) || undefined,
  }));
  const viewsRes = await rest.getJson(base + VIEWS_Q);
  const views: ShapeView[] = ((viewsRes.value as Record<string, unknown>[]) || []).map((v) => ({
    title: v.Title as string,
    id: normalizeGuid(String(v.Id)),
    isDefault: !!v.DefaultView,
    viewFields: ((v.ViewFields as Record<string, unknown>)?.Items as string[]) || [],
    customFormatter: (v.CustomFormatter as string) || undefined,
    url: String(v.ServerRelativeUrl ?? ''),
  }));
  return { fields, views };
}

export async function readFormatter(rest: SpRest, listId: string, t: TargetRef): Promise<string | null> {
  const res = await rest.getJson(targetPath(listId, t) + '?$select=CustomFormatter');
  const f = res.CustomFormatter;
  return typeof f === 'string' && f !== '' ? f : null;
}

export async function writeFormatter(rest: SpRest, listId: string, t: TargetRef, formatter: string | null): Promise<void> {
  await rest.merge(targetPath(listId, t), { CustomFormatter: formatter ?? '' });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run spfx/panel/src/targetIo.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add spfx/panel/src/targetIo.ts spfx/panel/src/targetIo.test.ts
git commit -m "spfx: target I/O — list shape, read/write CustomFormatter"
```

---

### Task 6: The apply flow (spec §7) as a pure state machine

**Files:**
- Create: `spfx/panel/src/applyFlow.ts`, `spfx/panel/src/applyFlow.test.ts`

**Interfaces:**
- Consumes: `JournalBackend` (Task 4); `JournalRow`, `TargetRef`, `verdictForPending` (Task 2); `formatterHash` (Task 2).
- Produces:
  ```ts
  export interface ApplyDeps {
    read(): Promise<string | null>;                 // the target's live CustomFormatter
    write(formatter: string | null): Promise<void>;
    journal: JournalBackend;
  }
  export interface ApplyRequest { listId: string; target: TargetRef; after: string | null; basedOn: string; force?: boolean }
  export type ApplyResult =
    | { status: 'applied'; rowId: number }
    | { status: 'stale'; live: string | null; yours: string | null }
    | { status: 'failed'; rowId?: number; message: string };
  export function applyTarget(deps: ApplyDeps, req: ApplyRequest): Promise<ApplyResult>;
  export function checkPending(deps: ApplyDeps, row: JournalRow): Promise<'Applied' | 'Failed'>;
  ```

- [ ] **Step 1: Write the failing test**

`spfx/panel/src/applyFlow.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { applyTarget, checkPending, type ApplyDeps } from './applyFlow';
import { createSessionJournal } from './journalStore';
import { formatterHash } from './hash';

const LIST = 'e481b50b-ebf9-4cbd-804f-a5276afb23ab';
const T = { kind: 'Field' as const, id: 'Status' };
const V1 = '{"elmType":"div"}';
const V2 = '{"elmType":"span"}';

/** A fake target whose live value can be changed mid-flight: `reads` is a queue of values the read() returns in order (last repeats). */
function target(reads: (string | null)[], opts: { writeFails?: string } = {}) {
  const log: string[] = [];
  let live: string | null = reads[0];
  let i = 0;
  const deps: ApplyDeps = {
    async read() { live = reads[Math.min(i++, reads.length - 1)]; log.push('read'); return live; },
    async write(f) { log.push('write'); if (opts.writeFails) throw new Error(opts.writeFails); reads.push(f); },
    journal: createSessionJournal(LIST, sessionStorage, 'test'),
  };
  return { deps, log };
}

describe('applyTarget', () => {
  it('happy path: read → Pending row → re-read → write → verify → Applied', async () => {
    sessionStorage.clear();
    const { deps, log } = target([V1]);
    const r = await applyTarget(deps, { listId: LIST, target: T, after: V2, basedOn: formatterHash(V1) });
    expect(r.status).toBe('applied');
    expect(log).toEqual(['read', 'read', 'write', 'read']);
    const [row] = await deps.journal.history(T);
    expect(row.kind).toBe('Applied');
    expect(row.before).toBe(V1);
    expect(row.after).toBe(V2);
  });

  it('stops at step 2 when the live formatter no longer matches BasedOn (no row, no write)', async () => {
    sessionStorage.clear();
    const { deps, log } = target([V2]);
    const r = await applyTarget(deps, { listId: LIST, target: T, after: '{"x":1}', basedOn: formatterHash(V1) });
    expect(r).toEqual({ status: 'stale', live: V2, yours: '{"x":1}' });
    expect(log).toEqual(['read']);
    expect(await deps.journal.history(T)).toEqual([]);
  });

  it('force skips the BasedOn check but still records the real Before', async () => {
    sessionStorage.clear();
    const { deps } = target([V2]);
    const r = await applyTarget(deps, { listId: LIST, target: T, after: '{"x":1}', basedOn: formatterHash(V1), force: true });
    expect(r.status).toBe('applied');
    expect((await deps.journal.history(T))[0].before).toBe(V2);
  });

  it('narrows the window: a change between step 1 and the pre-MERGE re-read fails the Pending row and reports stale', async () => {
    sessionStorage.clear();
    const { deps, log } = target([V1, V2]);
    const r = await applyTarget(deps, { listId: LIST, target: T, after: '{"x":1}', basedOn: formatterHash(V1) });
    expect(r).toEqual({ status: 'stale', live: V2, yours: '{"x":1}' });
    expect(log).toEqual(['read', 'read']);
    expect((await deps.journal.history(T))[0].kind).toBe('Failed');
  });

  it('a failed write flips the row to Failed and returns the teaching message', async () => {
    sessionStorage.clear();
    const { deps } = target([V1], { writeFails: 'FormatFX: you need Manage Lists on this list' });
    const r = await applyTarget(deps, { listId: LIST, target: T, after: V2, basedOn: formatterHash(V1) });
    expect(r.status).toBe('failed');
    expect((r as { message: string }).message).toContain('Manage Lists');
    expect((await deps.journal.history(T))[0].kind).toBe('Failed');
  });

  it('a verify mismatch is a failure, never Applied', async () => {
    sessionStorage.clear();
    const { deps } = target([V1, V1, '{"other":true}']);
    const r = await applyTarget(deps, { listId: LIST, target: T, after: V2, basedOn: formatterHash(V1) });
    expect(r.status).toBe('failed');
    expect((await deps.journal.history(T))[0].kind).toBe('Failed');
  });

  it('clears a formatter with after = null (rollback to "no formatter")', async () => {
    sessionStorage.clear();
    const { deps } = target([V1]);
    const r = await applyTarget(deps, { listId: LIST, target: T, after: null, basedOn: formatterHash(V1) });
    expect(r.status).toBe('applied');
  });
});

describe('checkPending', () => {
  it('re-reads and flips an unconfirmed row', async () => {
    sessionStorage.clear();
    const { deps } = target([V2]);
    const id = await deps.journal.append({ kind: 'Pending', listId: LIST, target: T, before: V1, after: V2, basedOn: formatterHash(V1) });
    const [row] = await deps.journal.history(T);
    expect(await checkPending(deps, row)).toBe('Applied');
    expect((await deps.journal.history(T))[0]).toMatchObject({ id, kind: 'Applied' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run spfx/panel/src/applyFlow.test.ts`
Expected: FAIL — cannot resolve `./applyFlow`.

- [ ] **Step 3: Implement**

`spfx/panel/src/applyFlow.ts`:

```ts
/**
 * applyFlow.ts — spec §7, as a pure orchestration over injected deps.
 *
 *   1. read the live formatter
 *   2. compare to BasedOn → 'stale' (the caller shows both, offers overwrite = force)
 *   3. (the digest is the REST client's business)
 *   4. write the Pending journal row with Before + After — BEFORE the list
 *   5. re-read immediately before the MERGE (no ETag: the window is narrowed,
 *      not closed); any difference → row Failed, 'stale'
 *   6. MERGE, re-read, verify, flip the row to Applied
 *   7. every failure flips the row to Failed and returns a teaching message;
 *      a row that could not be flipped stays Pending = "unconfirmed" in the
 *      History drawer, where checkPending() resolves it.
 *
 * Rollback is applyTarget() with `after` = an earlier row's Before.
 */
import type { JournalBackend } from './journalStore';
import { verdictForPending, type JournalRow, type TargetRef } from './journal';
import { formatterHash } from './hash';

export interface ApplyDeps {
  read(): Promise<string | null>;
  write(formatter: string | null): Promise<void>;
  journal: JournalBackend;
}
export interface ApplyRequest { listId: string; target: TargetRef; after: string | null; basedOn: string; force?: boolean }
export type ApplyResult =
  | { status: 'applied'; rowId: number }
  | { status: 'stale'; live: string | null; yours: string | null }
  | { status: 'failed'; rowId?: number; message: string };

const same = (a: string | null, b: string | null): boolean => (a ?? '') === (b ?? '');

export async function applyTarget(deps: ApplyDeps, req: ApplyRequest): Promise<ApplyResult> {
  const live1 = await deps.read();
  if (!req.force && formatterHash(live1) !== req.basedOn) {
    return { status: 'stale', live: live1, yours: req.after };
  }
  const row: JournalRow = { kind: 'Pending', listId: req.listId, target: req.target, before: live1, after: req.after, basedOn: req.basedOn };
  const rowId = await deps.journal.append(row);
  const fail = async (message: string): Promise<ApplyResult> => {
    try { await deps.journal.setKind(rowId, 'Failed'); } catch { /* stays Pending → unconfirmed */ }
    return { status: 'failed', rowId, message };
  };
  try {
    const live2 = await deps.read();
    if (!same(live2, live1)) {
      await fail('someone changed this since you started');
      return { status: 'stale', live: live2, yours: req.after };
    }
    await deps.write(req.after);
    const verify = await deps.read();
    if (!same(verify, req.after)) {
      return fail('The write returned OK but the list does not hold what was sent. Reload and check the target before trying again.');
    }
    await deps.journal.setKind(rowId, 'Applied');
    return { status: 'applied', rowId };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

/** The History drawer's "check" action for an unconfirmed (Pending) row. */
export async function checkPending(deps: ApplyDeps, row: JournalRow): Promise<'Applied' | 'Failed'> {
  const verdict = verdictForPending(row, await deps.read());
  if (row.id !== undefined) await deps.journal.setKind(row.id, verdict);
  return verdict;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run spfx/panel/src/applyFlow.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add spfx/panel/src/applyFlow.ts spfx/panel/src/applyFlow.test.ts
git commit -m "spfx: apply flow — journal-first, re-read-narrowed MERGE (spec §7)"
```

---

### Task 7: The tree model (pure)

**Files:**
- Create: `spfx/panel/src/tree.ts`, `spfx/panel/src/tree.test.ts`

**Interfaces:**
- Consumes: `ListShape` (Task 5); `TargetRef`, `targetKey` (Task 2).
- Produces:
  ```ts
  export interface TreeNode {
    key: string;              // targetKey(target)
    target: TargetRef;
    label: string;            // display name (columns) or title (views)
    scope: string;            // spec §5: 'applies to every view of this list' | 'applies to this view only'
    formatted: boolean;       // badge
    draft: boolean;           // dot
    current: boolean;         // the view the page shows (views only)
    url?: string;             // views only — navigate here
  }
  export interface TreeModel { views: TreeNode[]; columns: TreeNode[] }
  export const COLUMN_SCOPE = 'applies to every view of this list';
  export const VIEW_SCOPE = 'applies to this view only';
  export function buildTree(shape: ListShape, draftKeys: Set<string>, currentViewId: string | null): TreeModel;
  export function currentViewOf(shape: ListShape, viewId: string | null): ShapeView | undefined;   // by id, else the default view
  ```

- [ ] **Step 1: Write the failing test**

`spfx/panel/src/tree.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildTree, currentViewOf, COLUMN_SCOPE, VIEW_SCOPE } from './tree';
import type { ListShape } from './targetIo';

const V1 = 'f24ba2a8-0000-0000-0000-000000000001';
const V2 = 'f24ba2a8-0000-0000-0000-000000000002';
const shape: ListShape = {
  fields: [
    { internalName: 'Title', displayName: 'Title', type: 'Text', readOnly: false, hidden: false },
    { internalName: 'Status', displayName: 'Status', type: 'Choice', readOnly: false, hidden: false, customFormatter: '{"elmType":"div"}' },
    { internalName: 'ID', displayName: 'ID', type: 'Counter', readOnly: true, hidden: false },
  ],
  views: [
    { title: 'All Items', id: V1, isDefault: true, viewFields: [], url: '/sites/x/Lists/L/AllItems.aspx' },
    { title: 'Mine', id: V2, isDefault: false, viewFields: [], customFormatter: '{}', url: '/sites/x/Lists/L/Mine.aspx' },
  ],
};

describe('buildTree', () => {
  it('lists views then columns with badges, dots, scope copy and the current view', () => {
    const t = buildTree(shape, new Set(['Field:Title', `View:${V2}`]), V2);
    expect(t.views.map((n) => [n.label, n.formatted, n.draft, n.current])).toEqual([
      ['All Items', false, false, false], ['Mine', true, true, true],
    ]);
    expect(t.views[1]).toMatchObject({ key: `View:${V2}`, target: { kind: 'View', id: V2 }, scope: VIEW_SCOPE, url: '/sites/x/Lists/L/Mine.aspx' });
    expect(t.columns.map((n) => [n.label, n.formatted, n.draft])).toEqual([
      ['Title', false, true], ['Status', true, false], ['ID', false, false],
    ]);
    expect(t.columns[0]).toMatchObject({ key: 'Field:Title', target: { kind: 'Field', id: 'Title' }, scope: COLUMN_SCOPE, current: false });
  });
  it('marks the default view current when the URL carries no viewid', () => {
    expect(buildTree(shape, new Set(), null).views.map((n) => n.current)).toEqual([true, false]);
    expect(currentViewOf(shape, null)?.id).toBe(V1);
    expect(currentViewOf(shape, V2)?.id).toBe(V2);
    expect(currentViewOf(shape, 'nope')?.id).toBe(V1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run spfx/panel/src/tree.test.ts`
Expected: FAIL — cannot resolve `./tree`.

- [ ] **Step 3: Implement**

`spfx/panel/src/tree.ts`:

```ts
/**
 * tree.ts — the panel's navigation tree (spec §2.4, §5), pure. Root = the
 * list; branches = its views and its columns. Badge on anything formatted,
 * dot on anything with a draft, and the scope stated in words: column
 * formats apply to every view, view formats to this view only.
 */
import type { ListShape, ShapeView } from './targetIo';
import { targetKey, type TargetRef } from './journal';

export interface TreeNode {
  key: string; target: TargetRef; label: string; scope: string;
  formatted: boolean; draft: boolean; current: boolean; url?: string;
}
export interface TreeModel { views: TreeNode[]; columns: TreeNode[] }

export const COLUMN_SCOPE = 'applies to every view of this list';
export const VIEW_SCOPE = 'applies to this view only';

export function currentViewOf(shape: ListShape, viewId: string | null): ShapeView | undefined {
  return (viewId ? shape.views.find((v) => v.id === viewId) : undefined)
    ?? shape.views.find((v) => v.isDefault) ?? shape.views[0];
}

export function buildTree(shape: ListShape, draftKeys: Set<string>, currentViewId: string | null): TreeModel {
  const current = currentViewOf(shape, currentViewId);
  const views = shape.views.map((v): TreeNode => {
    const target: TargetRef = { kind: 'View', id: v.id };
    const key = targetKey(target);
    return { key, target, label: v.title, scope: VIEW_SCOPE, formatted: !!v.customFormatter, draft: draftKeys.has(key), current: v.id === current?.id, url: v.url };
  });
  const columns = shape.fields.map((f): TreeNode => {
    const target: TargetRef = { kind: 'Field', id: f.internalName };
    const key = targetKey(target);
    return { key, target, label: f.displayName || f.internalName, scope: COLUMN_SCOPE, formatted: !!f.customFormatter, draft: draftKeys.has(key), current: false };
  });
  return { views, columns };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run spfx/panel/src/tree.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add spfx/panel/src/tree.ts spfx/panel/src/tree.test.ts
git commit -m "spfx: tree model — views + columns with badges, dots, scope copy"
```

---

### Task 8: URL state — `viewid` parsing and the URL watcher

**Files:**
- Create: `spfx/panel/src/urlState.ts`, `spfx/panel/src/urlState.test.ts`

**Interfaces:**
- Consumes: `normalizeGuid` (Task 5).
- Produces:
  ```ts
  export function viewIdFromUrl(href: string): string | null;                  // normalized guid or null
  export function watchUrl(onChange: (href: string) => void, intervalMs?: number): () => void;  // poll + popstate; returns stop()
  export const REOPEN_KEY = 'ffx-panel.reopen';                                // sessionStorage: JSON { listId, targetKey }
  export interface ReopenState { listId: string; targetKey: string | null }
  export function readReopen(storage: Storage, listId: string): ReopenState | null;
  export function writeReopen(storage: Storage, s: ReopenState | null): void;
  ```

- [ ] **Step 1: Write the failing test**

`spfx/panel/src/urlState.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { viewIdFromUrl, watchUrl, readReopen, writeReopen, REOPEN_KEY } from './urlState';

describe('viewIdFromUrl', () => {
  it('reads viewid in any casing/encoding and normalizes the guid', () => {
    expect(viewIdFromUrl('https://t/sites/x/Lists/L/AllItems.aspx?viewid=%7BF24BA2A8-0000-0000-0000-000000000001%7D')).toBe('f24ba2a8-0000-0000-0000-000000000001');
    expect(viewIdFromUrl('https://t/sites/x/Lists/L/AllItems.aspx?env=WebView&viewid=f24ba2a8-0000-0000-0000-000000000001')).toBe('f24ba2a8-0000-0000-0000-000000000001');
    expect(viewIdFromUrl('https://t/sites/x/Lists/L/AllItems.aspx')).toBeNull();
    expect(viewIdFromUrl('not a url')).toBeNull();
  });
});

describe('watchUrl', () => {
  it('reports href changes on poll and popstate, and stops', () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const stop = watchUrl((h) => seen.push(h), 100);
    history.pushState({}, '', '/a?viewid=1');
    vi.advanceTimersByTime(100);
    history.replaceState({}, '', '/a?viewid=2');
    window.dispatchEvent(new PopStateEvent('popstate'));
    stop();
    history.replaceState({}, '', '/a?viewid=3');
    vi.advanceTimersByTime(300);
    expect(seen.map((h) => new URL(h).search)).toEqual(['?viewid=1', '?viewid=2']);
    vi.useRealTimers();
  });
});

describe('reopen state', () => {
  it('round-trips per tab and ignores another list', () => {
    sessionStorage.clear();
    writeReopen(sessionStorage, { listId: 'L1', targetKey: 'Field:Status' });
    expect(JSON.parse(sessionStorage.getItem(REOPEN_KEY)!)).toEqual({ listId: 'L1', targetKey: 'Field:Status' });
    expect(readReopen(sessionStorage, 'L1')).toEqual({ listId: 'L1', targetKey: 'Field:Status' });
    expect(readReopen(sessionStorage, 'L2')).toBeNull();
    writeReopen(sessionStorage, null);
    expect(readReopen(sessionStorage, 'L1')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run spfx/panel/src/urlState.test.ts`
Expected: FAIL — cannot resolve `./urlState`.

- [ ] **Step 3: Implement**

`spfx/panel/src/urlState.ts`:

```ts
/**
 * urlState.ts — spike answer 1 made concrete: a modern view switch is
 * client-side navigation that fires no SPFx event and leaves
 * context.listView.view one switch behind, so the panel keys its open view
 * off the URL's `viewid`. The watcher is a 500 ms poll plus popstate; a
 * reopen record in sessionStorage survives the full navigation the panel
 * itself triggers when the person picks another view (§2.4).
 */
import { normalizeGuid } from './targetIo';

export function viewIdFromUrl(href: string): string | null {
  try {
    const v = new URL(href, 'https://placeholder.invalid').searchParams.get('viewid');
    return v ? normalizeGuid(v) : null;
  } catch {
    return null;
  }
}

export function watchUrl(onChange: (href: string) => void, intervalMs = 500): () => void {
  let last = location.href;
  const check = (): void => {
    if (location.href !== last) { last = location.href; onChange(last); }
  };
  const timer = setInterval(check, intervalMs);
  window.addEventListener('popstate', check);
  return () => { clearInterval(timer); window.removeEventListener('popstate', check); };
}

export const REOPEN_KEY = 'ffx-panel.reopen';
export interface ReopenState { listId: string; targetKey: string | null }

export function readReopen(storage: Storage, listId: string): ReopenState | null {
  try {
    const raw = storage.getItem(REOPEN_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as ReopenState;
    return s.listId === listId ? s : null;
  } catch {
    return null;
  }
}

export function writeReopen(storage: Storage, s: ReopenState | null): void {
  try {
    if (s) storage.setItem(REOPEN_KEY, JSON.stringify(s));
    else storage.removeItem(REOPEN_KEY);
  } catch { /* private mode */ }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run spfx/panel/src/urlState.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add spfx/panel/src/urlState.ts spfx/panel/src/urlState.test.ts
git commit -m "spfx: url state — viewid parsing, URL watcher, per-tab reopen record"
```

---
### Task 9: Editor seams — single-target mode in `EditorState`, shadow-aware `acMenu`

Two small, inert-for-the-web-app changes in `src/editor` so the JSON IDE pane can be the panel's editor over one document of any kind, including `column` (spec §2.3, decision 1). This is the only task that touches `src/`.

**Files:**
- Modify: `src/editor/state.ts` (add a field + a method; extend `loadDocument`), `src/editor/acMenu.ts:68`
- Create: `src/editor/state.singleTarget.test.ts`, `src/editor/acMenu.shadow.test.ts`

**Interfaces:**
- Produces (on `EditorState`):
  ```ts
  /** Non-null while the workspace is ONE target document (the SPFx panel). */
  singleTargetKind: DocumentKind | null;
  /** Replace the workspace with `doc` as the only sheet; clears undo/redo; savepoint = now. */
  openTargetDocument(doc: FormatterDocument, name: string): void;
  ```
  and `loadDocument(doc)` in single-target mode replaces the open sheet's document in place, coercing the kind to the target's (`column` stays `column`; a view target takes `tile` or `row`), as ONE undo step.

- [ ] **Step 1: Write the failing tests**

`src/editor/state.singleTarget.test.ts`:

```ts
/**
 * Single-target mode — the SPFx panel edits ONE target document (spec
 * 2026-09-16 §2.3). The web app never enters this mode; these are its
 * contract: any kind (column included) is the lone sheet, "Apply to canvas"
 * replaces it in place and never routes into looks or new sheets.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { state } from './state';
import type { FormatterDocument } from '../core/types';

const column: FormatterDocument = { kind: 'column', root: { elmType: 'div', txtContent: '@currentField' } };
const row: FormatterDocument = { kind: 'row', root: { elmType: 'div', children: [{ elmType: 'span' }] }, hideSelection: true };

beforeEach(() => { state.resetAll(); state.singleTargetKind = null; });

describe('openTargetDocument', () => {
  it('makes a column document the only sheet and the live doc', () => {
    state.openTargetDocument(column, 'Status (column)');
    expect(state.singleTargetKind).toBe('column');
    expect(state.views).toHaveLength(1);
    expect(state.views[0].name).toBe('Status (column)');
    expect(state.doc.kind).toBe('column');
    expect(state.doc.root.txtContent).toBe('@currentField');
    expect(state.canUndo).toBe(false);
    expect(state.isDirtySinceSave).toBe(false);
  });
  it('replaces a previous target entirely (no undo across targets)', () => {
    state.openTargetDocument(column, 'A');
    state.mutateDocument(() => { state.doc.root.txtContent = 'x'; });
    state.openTargetDocument(row, 'B');
    expect(state.views).toHaveLength(1);
    expect(state.doc.kind).toBe('row');
    expect(state.canUndo).toBe(false);
  });
});

describe('loadDocument in single-target mode', () => {
  it('replaces the column sheet in place as one undo step (never a look)', () => {
    state.openTargetDocument(column, 'A');
    state.loadDocument({ kind: 'column', root: { elmType: 'span' } });
    expect(state.views).toHaveLength(1);
    expect(state.doc.kind).toBe('column');
    expect(state.doc.root.elmType).toBe('span');
    expect(state.columnLooks.Status).toBeUndefined();
    expect(state.canUndo).toBe(true);
    state.undo();
    expect(state.doc.root.elmType).toBe('div');
  });
  it('coerces a pasted row payload to the column target kind', () => {
    state.openTargetDocument(column, 'A');
    state.loadDocument(row);
    expect(state.doc.kind).toBe('column');
    expect(state.doc.hideSelection).toBeUndefined();
  });
  it('keeps a view target a view: row ↔ tile follow the payload, column payloads become row', () => {
    state.openTargetDocument(row, 'V');
    state.loadDocument({ kind: 'tile', root: { elmType: 'div' }, tileWidth: 300 });
    expect(state.doc.kind).toBe('tile');
    expect(state.doc.tileWidth).toBe(300);
    expect(state.doc.tileHeight).toBe(220);
    state.loadDocument(column);
    expect(state.doc.kind).toBe('row');
    expect(state.views).toHaveLength(1);
  });
  it('is inert for the web app: without the mode, a column payload still becomes a look', () => {
    state.loadDocument(column);
    expect(state.columnLooks[state.currentFieldName]).toBeDefined();
  });
});
```

`src/editor/acMenu.shadow.test.ts`:

```ts
/** The completion popup must live in the SAME root as its editor: inside a
 *  shadow root (the SPFx panel) a body-mounted popup would be unstyled and
 *  outside the key guard. In the document it stays on body as before. */
import { describe, it, expect, afterEach } from 'vitest';
import { openAcMenu } from './acMenu';

afterEach(() => { document.body.innerHTML = ''; });

describe('openAcMenu root', () => {
  it('mounts on document.body for a light-DOM editor', () => {
    const editor = document.createElement('div');
    document.body.appendChild(editor);
    const menu = openAcMenu(editor, [{ insert: 'a' }], () => {});
    expect(menu.el.parentNode).toBe(document.body);
    menu.close();
  });
  it('mounts inside the shadow root for a shadow-DOM editor', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const editor = document.createElement('div');
    shadow.appendChild(editor);
    const menu = openAcMenu(editor, [{ insert: 'a' }], () => {});
    expect(menu.el.parentNode).toBe(shadow);
    menu.close();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/editor/state.singleTarget.test.ts src/editor/acMenu.shadow.test.ts`
Expected: FAIL — `openTargetDocument is not a function`; the shadow test's `parentNode` is `document.body`.

- [ ] **Step 3: Implement the state seam**

In `src/editor/state.ts`, next to `activeDocKey = 'main';` (line ~276) add:

```ts
  /** SINGLE-TARGET MODE (the SPFx Format panel, spec 2026-09-16 §2.3): the
   *  workspace is exactly one target document — a column's or a view's
   *  formatter — held as the only sheet, whatever its kind. Null in the web
   *  app, where a column is never a surface (it is a look on the floor). */
  singleTargetKind: DocumentKind | null = null;
```

After `loadViewDocument(...)` (line ~1672) add:

```ts
  /** Enter single-target mode with `doc` as the only sheet. A target switch is
   *  navigation, not an edit: undo/redo are cleared and the savepoint is now,
   *  so isDirtySinceSave answers "has this target been edited". Fields/rows
   *  are left alone (the panel sets them from the list). */
  openTargetDocument(doc: FormatterDocument, name: string): void {
    if (doc.kind === 'tile') {
      doc.tileWidth = doc.tileWidth ?? 254;
      doc.tileHeight = doc.tileHeight ?? 220;
    }
    this.singleTargetKind = doc.kind;
    this.floorDoc = defaultFloor();
    const sheet: SheetDoc = { id: this.nextViewId(), name: name.trim() || 'Target', doc };
    this.views = [sheet];
    this.openTabs = [{ kind: 'grid' }, { kind: 'view', id: sheet.id }];
    this.activeViewId = sheet.id;
    this.lastOpenViewId = sheet.id;
    this.activeComponentTab = null;
    this.activeDocKey = 'main';
    this.doc = sheet.doc;
    this.selection = [];
    this.surfaceSelections = {};
    this.surfaceFolds = {};
    this.navStack = [];
    this.undoStack = [];
    this.redoStack = [];
    foldState.clear();
    this.markSavepoint();
    this.emit('load');
    this.emit('kind');
    this.emit('data');
  }
```

At the top of `loadDocument(doc)` (line ~1690), before the `if (doc.kind === 'column')` branch, add:

```ts
    if (this.singleTargetKind !== null && this.activeView) {
      // single-target mode: the payload REPLACES the open target in place,
      // coerced to the target's kind — a column target stays a column, a view
      // target takes tile or row. Never a look, never a new sheet.
      this.snapshot();
      const kind: DocumentKind = this.singleTargetKind === 'column'
        ? 'column'
        : (doc.kind === 'tile' ? 'tile' : 'row');
      const next: FormatterDocument = { kind, root: doc.root };
      if (kind !== 'column') {
        if (doc.hideSelection) next.hideSelection = true;
        if (doc.hideColumnHeader) next.hideColumnHeader = true;
        if (doc.viewExtras) next.viewExtras = doc.viewExtras;
      }
      if (kind === 'tile') {
        next.tileWidth = doc.tileWidth ?? 254;
        next.tileHeight = doc.tileHeight ?? 220;
        if (doc.fillHorizontally !== undefined) next.fillHorizontally = doc.fillHorizontally;
      }
      this.activeView.doc = next;
      this.doc = next;
      this.selection = [];
      this.emit('load');
      return;
    }
```

Check the names used exist in the class before wiring (`defaultFloor`, `nextViewId`, `foldState`, `surfaceSelections`, `surfaceFolds`, `navStack`, `lastOpenViewId`, `SheetDoc` — all present per `resetAll()` at `state.ts:1015-1048` and `createView()` at `:662-689`). `resetAll()` must also clear the mode: add `this.singleTargetKind = null;` inside it.

- [ ] **Step 4: Implement the acMenu seam**

In `src/editor/acMenu.ts` replace line 68 `document.body.appendChild(el);` with:

```ts
  // mount in the editor's own root: a shadow root (the SPFx panel) keeps the
  // popup styled and inside the key guard; the document keeps body as before
  const root = editor.getRootNode();
  (root instanceof ShadowRoot ? root : document.body).appendChild(el);
```

- [ ] **Step 5: Run to verify they pass — and that nothing else moved**

Run: `npx vitest run src/editor/state.singleTarget.test.ts src/editor/acMenu.shadow.test.ts`
Expected: PASS (8 tests).

Run: `npm test && npm run build`
Expected: the whole suite green (the pre-existing count plus 8), `tsc` clean.

- [ ] **Step 6: Commit**

```bash
git add src/editor/state.ts src/editor/state.singleTarget.test.ts src/editor/acMenu.ts src/editor/acMenu.shadow.test.ts
git commit -m "editor: single-target mode seam + shadow-aware completion popup (for the SPFx panel)"
```

---

### Task 10: The panel shell — shadow chrome, layout, key guard

**Files:**
- Create: `spfx/panel/src/panelShell.ts`, `spfx/panel/src/panelShell.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ShellHandlers { onClose(): void; onUndo(): void; onRedo(): void }
  export interface Shell {
    app: HTMLElement;        // .ffx-app — the panel root inside the shadow
    title: HTMLElement;      // .ffx-title text
    tree: HTMLElement;       // left column host
    editor: HTMLElement;     // right column host (the JSON pane mounts here)
    banner: HTMLElement;     // one-line notices above the editor (hidden when empty)
    footer: HTMLElement;     // Apply / History live here (Task 12 fills it)
    drawer: HTMLElement;     // the History drawer (hidden by default)
    status: HTMLElement;     // bottom-left status text
    undoBtn: HTMLButtonElement; redoBtn: HTMLButtonElement;
    setExpanded(on: boolean): void;
    notice(text: string | null): void;   // sets/clears banner
    destroy(): void;                     // removes listeners + the host element
  }
  export function mountShell(shadow: ShadowRoot, css: string, h: ShellHandlers): Shell;
  ```

- [ ] **Step 1: Write the failing test**

`spfx/panel/src/panelShell.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mountShell, type Shell } from './panelShell';

function mount(): { shell: Shell; host: HTMLElement; h: { onClose: ReturnType<typeof vi.fn>; onUndo: ReturnType<typeof vi.fn>; onRedo: ReturnType<typeof vi.fn> } } {
  const host = document.createElement('div');
  host.id = 'ffx-format-panel';
  document.body.appendChild(host);
  const h = { onClose: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn() };
  const shell = mountShell(host.attachShadow({ mode: 'open' }), ':host { --wb-bg: #fff; }', h);
  return { shell, host, h };
}
afterEach(() => { document.body.innerHTML = ''; });

describe('mountShell', () => {
  it('renders the chrome inside the shadow with the app css first', () => {
    const { shell, host } = mount();
    const styles = host.shadowRoot!.querySelectorAll('style');
    expect(styles[0].textContent).toContain(':host { all: initial; }');
    expect(styles[0].textContent).toContain('--wb-bg: #fff');
    expect(shell.app.classList.contains('ffx-app')).toBe(true);
    expect(shell.tree.isConnected && shell.editor.isConnected && shell.footer.isConnected).toBe(true);
    expect(shell.drawer.hidden).toBe(true);
    expect(shell.banner.hidden).toBe(true);
  });

  it('stops key events at the shadow host so SharePoint never sees them', () => {
    const { shell } = mount();
    const seen: string[] = [];
    const spy = (e: Event) => seen.push(e.type);
    document.addEventListener('keydown', spy);
    document.addEventListener('keyup', spy);
    document.addEventListener('keypress', spy);
    const ta = document.createElement('textarea');
    shell.editor.appendChild(ta);
    for (const type of ['keydown', 'keyup', 'keypress']) ta.dispatchEvent(new KeyboardEvent(type, { key: 'g', bubbles: true, composed: true }));
    document.removeEventListener('keydown', spy);
    document.removeEventListener('keyup', spy);
    document.removeEventListener('keypress', spy);
    expect(seen).toEqual([]);
  });

  it('routes Ctrl+Z / Ctrl+Y outside text fields to undo/redo', () => {
    const { shell, h } = mount();
    shell.tree.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, composed: true }));
    shell.tree.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true, composed: true }));
    const ta = document.createElement('textarea');
    shell.editor.appendChild(ta);
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, composed: true }));
    expect(h.onUndo).toHaveBeenCalledTimes(1);
    expect(h.onRedo).toHaveBeenCalledTimes(1);
  });

  it('expands, notices, closes and destroys', () => {
    const { shell, host, h } = mount();
    shell.setExpanded(true);
    expect(shell.app.classList.contains('ffx-full')).toBe(true);
    shell.notice('Drafts live in this tab only');
    expect(shell.banner.hidden).toBe(false);
    expect(shell.banner.textContent).toContain('this tab only');
    shell.notice(null);
    expect(shell.banner.hidden).toBe(true);
    (host.shadowRoot!.querySelector('.ffx-close') as HTMLButtonElement).click();
    expect(h.onClose).toHaveBeenCalledTimes(1);
    shell.destroy();
    expect(document.getElementById('ffx-format-panel')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run spfx/panel/src/panelShell.test.ts`
Expected: FAIL — cannot resolve `./panelShell`.

- [ ] **Step 3: Implement**

`spfx/panel/src/panelShell.ts`:

```ts
/**
 * panelShell.ts — the panel's chrome inside its shadow root (spec §2.2, §5):
 * a right-side rail sized for the editor with an expand-to-full-page toggle;
 * left the tree, right the editor, bottom Apply + History. No preview shapes
 * the layout.
 *
 * The shadow host stops keydown/keyup/keypress in the BUBBLE phase for every
 * key: SharePoint's document-level handler cancels plain `g` (a page
 * shortcut) and the shadow root retargets events so it cannot tell a
 * textarea is focused (spike answer 3). Undo/redo shortcuts are re-bound
 * here because main.ts's document listener never sees them now.
 */
export interface ShellHandlers { onClose(): void; onUndo(): void; onRedo(): void }
export interface Shell {
  app: HTMLElement; title: HTMLElement; tree: HTMLElement; editor: HTMLElement; banner: HTMLElement;
  footer: HTMLElement; drawer: HTMLElement; status: HTMLElement;
  undoBtn: HTMLButtonElement; redoBtn: HTMLButtonElement;
  setExpanded(on: boolean): void;
  notice(text: string | null): void;
  destroy(): void;
}

const SHELL_CSS = `
:host { all: initial; }
.ffx-app { position: fixed; top: 0; right: 0; height: 100vh; width: min(760px, 100vw); z-index: 1000000;
  display: flex; flex-direction: column; background: var(--wb-bg); color: var(--wb-text);
  border-left: 1px solid var(--wb-border); box-shadow: -8px 0 24px rgba(0,0,0,.18); font-size: 13px; }
.ffx-app.ffx-full { width: 100vw; border-left: 0; }
.ffx-head { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--wb-border); background: var(--wb-surface); }
.ffx-title { flex: 1; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ffx-head button, .ffx-foot button { font: inherit; padding: 4px 10px; border: 1px solid var(--wb-border); border-radius: 4px; background: var(--wb-surface); color: inherit; cursor: pointer; }
.ffx-head button:disabled, .ffx-foot button:disabled { opacity: .5; cursor: default; }
.ffx-body { flex: 1; display: flex; min-height: 0; }
.ffx-tree { width: 220px; overflow: auto; border-right: 1px solid var(--wb-border); padding: 6px 0; }
.ffx-main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.ffx-banner { padding: 6px 12px; background: var(--wb-surface); border-bottom: 1px solid var(--wb-border); }
.ffx-editor { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.ffx-editor > * { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.ffx-foot { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-top: 1px solid var(--wb-border); background: var(--wb-surface); }
.ffx-status { flex: 1; color: var(--wb-text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ffx-drawer { max-height: 40vh; overflow: auto; border-top: 1px solid var(--wb-border); padding: 8px 12px; }
.ffx-apply { font-weight: 600; }
`;

export function mountShell(shadow: ShadowRoot, css: string, h: ShellHandlers): Shell {
  const style = document.createElement('style');
  style.textContent = ':host { all: initial; }\n' + css + '\n' + SHELL_CSS;
  const app = document.createElement('div');
  app.className = 'ffx-app';
  app.innerHTML = `
    <div class="ffx-head">
      <span class="ffx-title">FormatFX</span>
      <button class="ffx-undo" title="Undo (Ctrl+Z)" disabled>↶</button>
      <button class="ffx-redo" title="Redo (Ctrl+Y)" disabled>↷</button>
      <button class="ffx-expand" title="Expand to the full page">⤢</button>
      <button class="ffx-close" title="Close the panel">✕</button>
    </div>
    <div class="ffx-body">
      <div class="ffx-tree" role="tree"></div>
      <div class="ffx-main">
        <div class="ffx-banner" role="status" hidden></div>
        <div class="ffx-editor"></div>
      </div>
    </div>
    <div class="ffx-drawer" hidden></div>
    <div class="ffx-foot"><span class="ffx-status"></span></div>`;
  shadow.append(style, app);

  const $ = <T extends HTMLElement>(sel: string): T => app.querySelector<T>(sel)!;
  const host = shadow.host as HTMLElement;

  // spike answer 3: bubble-phase stop at the host, every key type
  const stop = (e: Event): void => e.stopPropagation();
  for (const type of ['keydown', 'keyup', 'keypress']) host.addEventListener(type, stop);

  const onKey = (e: KeyboardEvent): void => {
    if ((e.target as HTMLElement).matches('input, textarea, select')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === 'z') { e.preventDefault(); h.onUndo(); }
    else if (mod && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) { e.preventDefault(); h.onRedo(); }
  };
  app.addEventListener('keydown', onKey);

  let expanded = false;
  const setExpanded = (on: boolean): void => { expanded = on; app.classList.toggle('ffx-full', on); };
  $('.ffx-expand').addEventListener('click', () => setExpanded(!expanded));
  $('.ffx-close').addEventListener('click', () => h.onClose());
  const undoBtn = $<HTMLButtonElement>('.ffx-undo');
  const redoBtn = $<HTMLButtonElement>('.ffx-redo');
  undoBtn.addEventListener('click', () => h.onUndo());
  redoBtn.addEventListener('click', () => h.onRedo());
  const banner = $('.ffx-banner');

  return {
    app, title: $('.ffx-title'), tree: $('.ffx-tree'), editor: $('.ffx-editor'), banner,
    footer: $('.ffx-foot'), drawer: $('.ffx-drawer'), status: $('.ffx-status'), undoBtn, redoBtn,
    setExpanded,
    notice(text) { banner.textContent = text ?? ''; banner.hidden = !text; },
    destroy() {
      for (const type of ['keydown', 'keyup', 'keypress']) host.removeEventListener(type, stop);
      app.removeEventListener('keydown', onKey);
      host.remove();
    },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run spfx/panel/src/panelShell.test.ts`
Expected: PASS (4 tests). If happy-dom does not retarget composed events through the shadow boundary the way browsers do, the key-guard test still holds: the listener on the host sees the event before `document` either way.

- [ ] **Step 5: Commit**

```bash
git add spfx/panel/src/panelShell.ts spfx/panel/src/panelShell.test.ts
git commit -m "spfx: panel shell — shadow chrome, layout, key guard, undo/redo keys"
```

---
### Task 11: The panel controller — boot, tree, open target, drafts, view switch

**Files:**
- Create: `spfx/panel/src/panel.ts` (replaces the Task 1 placeholder), `spfx/panel/src/panel.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–10; from the parent repo `state` + `mountJsonPanel` (`src/editor`), `importJson`/`exportJson` (`src/core/serializer`), `importSchema`/`LIST_SNAPSHOT_VERSION`/`buildSampleRows` (`src/core/schemaImport`), `lintDocument` (`src/core/linter`).
- Produces:
  ```ts
  export const PANEL_HOST_ID = 'ffx-format-panel';
  export interface PanelContext {
    webUrl: string; listId: string; listTitle?: string; viewId: string | null;
    fetchImpl?: typeof fetch;            // default: the page's fetch
    storage?: Storage;                   // default: sessionStorage
    navigate?: (url: string) => void;    // default: location.assign
    onClose?: () => void;                // the host stops its URL watcher here
  }
  export interface PanelApi {
    ready: Promise<void>;                // boot finished (shape + journal loaded, first target open)
    setViewId(id: string | null): void;  // the host feeds URL changes here
    openTarget(t: TargetRef): Promise<void>;
    close(): Promise<void>;
  }
  export function mountFormatPanel(shadow: ShadowRoot, ctx: PanelContext): PanelApi;
  ```
  Task 12 adds Apply/History to the same file. `panel.ts` is the bundle entry: it re-exports `viewIdFromUrl`, `watchUrl`, `readReopen`, `REOPEN_KEY` for the host.

- [ ] **Step 1: Write the failing test**

`spfx/panel/src/panel.test.ts` (Task 12 appends to this file):

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountFormatPanel, PANEL_HOST_ID, type PanelApi } from './panel';
import { JOURNAL_PATH } from './journalStore';
import { REOPEN_KEY } from './urlState';
import { state } from '../../../src/editor/state';

const WEB = 'https://t.sharepoint.com/sites/x';
const LIST = 'e481b50b-ebf9-4cbd-804f-a5276afb23ab';
const V1 = 'f24ba2a8-0000-0000-0000-000000000001';
const V2 = 'f24ba2a8-0000-0000-0000-000000000002';
const COL_JSON = '{"elmType":"div","txtContent":"@currentField"}';
const VIEW_JSON = '{"$schema":"https://developer.microsoft.com/json-schemas/sp/v2/row-formatting.schema.json","hideSelection":true,"additionalRowClass":"x"}';

interface Call { url: string; init?: RequestInit }
/** A fake tenant: one list with two views and two columns, a FormatFX journal list, and mutable formatters. */
function tenant() {
  const formatters: Record<string, string> = { 'Field:Status': COL_JSON, [`View:${V1}`]: VIEW_JSON, 'Field:Title': '', [`View:${V2}`]: '' };
  const items: Record<string, unknown>[] = [];
  const calls: Call[] = [];
  let nextId = 1;
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const h = (init?.headers ?? {}) as Record<string, string>;
    if (url.endsWith('/_api/contextinfo')) return json({ FormDigestValue: 'D' });
    if (url.endsWith('/_api/web/currentuser?$select=Id')) return json({ Id: 12 });
    if (url.includes(JOURNAL_PATH)) {
      if (url.includes('/items(') && h['X-HTTP-Method'] === 'MERGE') { const id = Number(/items\((\d+)\)/.exec(url)![1]); Object.assign(items.find((i) => i.Id === id)!, JSON.parse(init!.body as string)); return new Response('', { status: 204 }); }
      if (url.includes('/items(') && h['X-HTTP-Method'] === 'DELETE') { const id = Number(/items\((\d+)\)/.exec(url)![1]); items.splice(items.findIndex((i) => i.Id === id), 1); return new Response('', { status: 204 }); }
      if (url.includes('/items') && init?.method === 'POST') { const it = { Id: nextId++, Created: new Date(nextId * 1000).toISOString(), AuthorId: 12, Author: { Title: 'Me' }, ...JSON.parse(init!.body as string) }; items.push(it); return json(it, 201); }
      if (url.includes('/items')) {
        const filter = decodeURIComponent(new URL(url).searchParams.get('$filter') ?? '');
        const rows = items.filter((i) => ['Kind', 'ListId', 'TargetKind', 'TargetId'].every((c) => { const m = new RegExp(c + " eq '([^']*)'").exec(filter); return !m || i[c] === m[1]; }) && !(/Kind ne 'Draft'/.test(filter) && i.Kind === 'Draft'));
        return json({ value: (new URL(url).searchParams.get('$orderby') ?? '').includes('desc') ? [...rows].reverse() : rows });
      }
      return json({ Id: 'journal' });
    }
    if (url.includes('/fields?')) return json({ value: [
      { InternalName: 'Title', Title: 'Title', TypeAsString: 'Text', CustomFormatter: formatters['Field:Title'] },
      { InternalName: 'Status', Title: 'Status', TypeAsString: 'Choice', Choices: ['A', 'B'], CustomFormatter: formatters['Field:Status'] },
    ] });
    if (url.includes('/views?')) return json({ value: [
      { Title: 'All Items', Id: V1, DefaultView: true, CustomFormatter: formatters[`View:${V1}`], ServerRelativeUrl: '/sites/x/Lists/L/AllItems.aspx', ViewFields: { Items: ['Title', 'Status'] } },
      { Title: 'Mine', Id: V2, DefaultView: false, CustomFormatter: formatters[`View:${V2}`], ServerRelativeUrl: '/sites/x/Lists/L/Mine.aspx', ViewFields: { Items: ['Title'] } },
    ] });
    const key = /fields\/getbyinternalnameortitle\('([^']+)'\)/.exec(url)?.[1] ? 'Field:' + /fields\/getbyinternalnameortitle\('([^']+)'\)/.exec(url)![1] : /views\(guid'([^']+)'\)/.exec(url)?.[1] ? 'View:' + /views\(guid'([^']+)'\)/.exec(url)![1] : null;
    if (key && h['X-HTTP-Method'] === 'MERGE') { formatters[key] = (JSON.parse(init!.body as string) as { CustomFormatter: string }).CustomFormatter; return new Response('', { status: 204 }); }
    if (key) return json({ CustomFormatter: formatters[key] });
    return new Response('', { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls, items, formatters };
}

function mount(t: ReturnType<typeof tenant>, viewId: string | null = null, extra: Partial<Parameters<typeof mountFormatPanel>[1]> = {}) {
  const host = document.createElement('div');
  host.id = PANEL_HOST_ID;
  document.body.appendChild(host);
  const navigate = vi.fn();
  const api = mountFormatPanel(host.attachShadow({ mode: 'open' }), { webUrl: WEB, listId: LIST, listTitle: 'L', viewId, fetchImpl: t.fetchImpl, storage: sessionStorage, navigate, ...extra });
  const $ = <T extends HTMLElement>(sel: string): T => host.shadowRoot!.querySelector<T>(sel)!;
  const $$ = (sel: string): HTMLElement[] => Array.from(host.shadowRoot!.querySelectorAll<HTMLElement>(sel));
  const textarea = (): HTMLTextAreaElement => $('#wb-json-text');
  const typeAndApply = (text: string): void => {
    const ta = textarea();
    ta.value = text;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    $('#wb-json-apply').click();
  };
  return { api, host, $, $$, textarea, typeAndApply, navigate };
}

beforeEach(() => { sessionStorage.clear(); state.resetAll(); });
afterEach(() => { document.body.innerHTML = ''; });

describe('mountFormatPanel — boot and tree', () => {
  it('loads the list shape, renders views then columns, opens the current view', async () => {
    const m = mount(tenant());
    await m.api.ready;
    expect(m.$$('.ffx-node').map((n) => n.dataset.key)).toEqual([`View:${V1}`, `View:${V2}`, 'Field:Title', 'Field:Status']);
    expect(m.$(`.ffx-node[data-key="View:${V1}"]`).classList.contains('ffx-current')).toBe(true);
    expect(m.$('.ffx-node[data-key="Field:Status"]').classList.contains('ffx-formatted')).toBe(true);
    expect(m.$('.ffx-node[data-key="Field:Status"]').title).toContain('every view of this list');
    expect(m.$('.ffx-title').textContent).toContain('All Items');
    expect(m.$('.ffx-title').textContent).toContain('this view only');
    expect(m.textarea().value).toContain('"additionalRowClass": "x"');
    expect(state.singleTargetKind).toBe('row');
    expect(state.isAutosavePaused).toBe(true);
    expect(state.fields.map((f) => f.name)).toEqual(['Title', 'Status']);
  });

  it('marks the URL view current and opens it', async () => {
    const m = mount(tenant(), V2);
    await m.api.ready;
    expect(m.$(`.ffx-node[data-key="View:${V2}"]`).classList.contains('ffx-current')).toBe(true);
    expect(m.$('.ffx-title').textContent).toContain('Mine');
  });

  it('hides the web app deploy chrome inside the pane', async () => {
    const m = mount(tenant());
    await m.api.ready;
    expect(getComputedStyle(m.$('#wb-deploy-panel')).display).toBe('none');
  });
});

describe('mountFormatPanel — targets and drafts', () => {
  it('opens a column as a column document and remembers it for reopen', async () => {
    const m = mount(tenant());
    await m.api.ready;
    m.$('.ffx-node[data-key="Field:Status"]').click();
    await m.api.ready; // openTarget is awaited inside; flush
    await vi.waitFor(() => expect(m.$('.ffx-title').textContent).toContain('Status'));
    expect(state.singleTargetKind).toBe('column');
    expect(m.textarea().value).toContain('column-formatting.schema.json');
    expect(JSON.parse(sessionStorage.getItem(REOPEN_KEY)!)).toEqual({ listId: LIST, targetKey: 'Field:Status' });
  });

  it('opens an unformatted target with an empty document of the right kind', async () => {
    const m = mount(tenant());
    await m.api.ready;
    await m.api.openTarget({ kind: 'Field', id: 'Title' });
    expect(state.doc.kind).toBe('column');
    expect(m.textarea().value).toContain('"@currentField"');
  });

  it('stashes an edited target as a draft on switch, dots the tree, and restores it on return', async () => {
    const t = tenant();
    const m = mount(t);
    await m.api.ready;
    m.typeAndApply('{"elmType":"div","txtContent":"edited"}');
    expect(state.isDirtySinceSave).toBe(true);
    await m.api.openTarget({ kind: 'Field', id: 'Status' });
    const draft = t.items.find((i) => i.Kind === 'Draft')!;
    expect(draft).toMatchObject({ TargetKind: 'View', TargetId: V1 });
    expect(String(draft.After)).toContain('"edited"');
    expect(m.$(`.ffx-node[data-key="View:${V1}"]`).classList.contains('ffx-draft')).toBe(true);
    await m.api.openTarget({ kind: 'View', id: V1 });
    expect(m.textarea().value).toContain('"edited"');
    expect(m.$('.ffx-banner').hidden).toBe(true);
  });

  it('warns when a restored draft was based on an older formatter', async () => {
    const t = tenant();
    const m = mount(t);
    await m.api.ready;
    m.typeAndApply('{"elmType":"div","txtContent":"edited"}');
    await m.api.openTarget({ kind: 'Field', id: 'Status' });
    t.formatters[`View:${V1}`] = '{"elmType":"div","txtContent":"someone else"}';
    await m.api.openTarget({ kind: 'View', id: V1 });
    expect(m.$('.ffx-banner').hidden).toBe(false);
    expect(m.$('.ffx-banner').textContent).toContain('changed since');
  });

  it('picking another view stashes, records the reopen target and navigates', async () => {
    const t = tenant();
    const m = mount(t);
    await m.api.ready;
    m.typeAndApply('{"elmType":"div","txtContent":"edited"}');
    m.$(`.ffx-node[data-key="View:${V2}"]`).click();
    await vi.waitFor(() => expect(m.navigate).toHaveBeenCalledWith('/sites/x/Lists/L/Mine.aspx'));
    expect(t.items.some((i) => i.Kind === 'Draft')).toBe(true);
    expect(JSON.parse(sessionStorage.getItem(REOPEN_KEY)!)).toEqual({ listId: LIST, targetKey: `View:${V2}` });
  });

  it('reopens the remembered target after a navigation', async () => {
    sessionStorage.setItem(REOPEN_KEY, JSON.stringify({ listId: LIST, targetKey: 'Field:Status' }));
    const m = mount(tenant(), V2);
    await m.api.ready;
    expect(m.$('.ffx-title').textContent).toContain('Status');
  });

  it('follows a URL view change when a view target is open', async () => {
    const m = mount(tenant());
    await m.api.ready;
    m.api.setViewId(V2);
    await vi.waitFor(() => expect(m.$('.ffx-title').textContent).toContain('Mine'));
    expect(m.$(`.ffx-node[data-key="View:${V2}"]`).classList.contains('ffx-current')).toBe(true);
  });

  it('says so when the journal is per-tab only', async () => {
    const t = tenant();
    const failing = (async (url: string, init?: RequestInit) => (url.includes(JOURNAL_PATH) ? new Response('', { status: 403 }) : t.fetchImpl(url, init))) as unknown as typeof fetch;
    const m = mount(t, null, { fetchImpl: failing });
    await m.api.ready;
    expect(m.$('.ffx-banner').textContent).toContain('this browser tab only');
  });

  it('close stashes the draft, clears the reopen record and removes the host', async () => {
    const t = tenant();
    const onClose = vi.fn();
    const m = mount(t, null, { onClose });
    await m.api.ready;
    m.typeAndApply('{"elmType":"div","txtContent":"edited"}');
    await m.api.close();
    expect(t.items.some((i) => i.Kind === 'Draft')).toBe(true);
    expect(sessionStorage.getItem(REOPEN_KEY)).toBeNull();
    expect(document.getElementById(PANEL_HOST_ID)).toBeNull();
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run spfx/panel/src/panel.test.ts`
Expected: FAIL — `mountFormatPanel` is not exported.

- [ ] **Step 3: Implement**

`spfx/panel/src/panel.ts` (whole file; Task 12 extends it where marked):

```ts
/**
 * panel.ts — the Format panel's controller and the bundle's entry point.
 *
 * One target at a time (spec §2.3): the open column or view is the editor
 * state's only document (single-target mode, Task 9), edited through the
 * JSON IDE pane mounted in the shadow root. Switching targets stashes the
 * draft silently in the journal (§2.6); picking another view navigates the
 * page and the panel reopens on it from a per-tab record (§2.4). The host
 * feeds URL `viewid` changes in through setViewId (spike answer 1).
 */
import { APP_CSS } from './appCss.gen';
import { state } from '../../../src/editor/state';
import { mountJsonPanel } from '../../../src/editor/jsonPanel';
import { importJson, exportJson } from '../../../src/core/serializer';
import { importSchema, buildSampleRows, LIST_SNAPSHOT_VERSION } from '../../../src/core/schemaImport';
import type { FormatterDocument } from '../../../src/core/types';
import { createSpRest, type SpRest } from './rest';
import { openJournal, type JournalBackend } from './journalStore';
import { loadListShape, readFormatter, writeFormatter, type ListShape } from './targetIo';
import { buildTree, currentViewOf, type TreeNode } from './tree';
import { targetKey, type TargetRef } from './journal';
import { formatterHash } from './hash';
import { mountShell, type Shell } from './panelShell';
import { readReopen, writeReopen, viewIdFromUrl, watchUrl, REOPEN_KEY } from './urlState';
import { mountApply } from './panelApply'; // Task 12 — create as a stub exporting `mountApply = () => ({ refresh() {} })` until then

export { viewIdFromUrl, watchUrl, readReopen, REOPEN_KEY };
export type { TargetRef };

export const PANEL_HOST_ID = 'ffx-format-panel';

export interface PanelContext {
  webUrl: string; listId: string; listTitle?: string; viewId: string | null;
  fetchImpl?: typeof fetch; storage?: Storage; navigate?: (url: string) => void; onClose?: () => void;
}
export interface PanelApi {
  ready: Promise<void>;
  setViewId(id: string | null): void;
  openTarget(t: TargetRef): Promise<void>;
  close(): Promise<void>;
}

/** What the controller shares with the Apply/History module (Task 12). */
export interface PanelCore {
  rest: SpRest; listId: string; shell: Shell; journal: () => JournalBackend;
  current: () => TargetRef | null; basedOn: () => string; setBasedOn: (h: string) => void;
  setLiveFormatter: (t: TargetRef, f: string | null) => void; loadLive: (f: string | null) => void;
  toast: (m: string) => void; renderTree: () => Promise<void>;
}

const PANEL_EXTRA_CSS = `
#wb-deploy-panel, #wb-json-deploy, #wb-json-compbar { display: none !important; }
.ffx-node { display: flex; align-items: center; gap: 6px; width: 100%; text-align: left; padding: 4px 10px; border: 0; background: none; color: inherit; font: inherit; cursor: pointer; }
.ffx-node:hover, .ffx-node.ffx-open { background: var(--wb-surface); }
.ffx-node.ffx-open { font-weight: 600; }
.ffx-group { padding: 8px 10px 2px; color: var(--wb-text-2); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
.ffx-badge { margin-left: auto; font-size: 10px; padding: 0 5px; border-radius: 8px; background: var(--wb-accent); color: var(--wb-accent-text); }
.ffx-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--wb-accent); flex: none; }
.ffx-current .ffx-label::after { content: ' · on screen'; color: var(--wb-text-2); font-weight: 400; }
`;

const emptyDoc = (kind: 'column' | 'row'): FormatterDocument => (kind === 'column'
  ? { kind: 'column', root: { elmType: 'div', txtContent: '@currentField' } }
  : { kind: 'row', root: { elmType: 'div' } });

/** Parse a stored formatter into a document of the target's kind. */
function docFor(t: TargetRef, text: string | null): { doc: FormatterDocument; error?: string } {
  const want = t.kind === 'Field' ? 'column' : 'row';
  if (!text) return { doc: emptyDoc(want) };
  try {
    const doc = importJson(text);
    if (t.kind === 'Field') return { doc: { kind: 'column', root: doc.root } };
    return { doc: doc.kind === 'tile' ? doc : { ...doc, kind: 'row' } };
  } catch (e) {
    return { doc: emptyDoc(want), error: `This formatter could not be parsed (${(e as Error).message}) — showing an empty ${want} document. Paste the JSON to fix it, or roll back from History.` };
  }
}

export function mountFormatPanel(shadow: ShadowRoot, ctx: PanelContext): PanelApi {
  const storage = ctx.storage ?? sessionStorage;
  const navigate = ctx.navigate ?? ((url: string) => location.assign(url));
  const rest = createSpRest(ctx.webUrl, ctx.fetchImpl);
  const listId = ctx.listId;
  let shape: ListShape = { fields: [], views: [] };
  let journal: JournalBackend | null = null;
  let viewId = ctx.viewId;
  let current: TargetRef | null = null;
  let basedOn = formatterHash(null);
  let openedFromDraft = false;
  let draftKeys = new Set<string>();

  state.pauseAutosave(); // never touch the frozen key on the tenant origin
  const shell = mountShell(shadow, APP_CSS + PANEL_EXTRA_CSS, {
    onClose: () => { void close(); },
    onUndo: () => state.undo(),
    onRedo: () => state.redo(),
  });
  let toastTimer = 0;
  const toast = (m: string): void => {
    shell.status.textContent = m;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { if (shell.status.textContent === m) shell.status.textContent = ''; }, 6000);
  };
  const jsonApi = mountJsonPanel(shell.editor, toast);
  const refreshChrome = (): void => {
    shell.undoBtn.disabled = !state.canUndo;
    shell.redoBtn.disabled = !state.canRedo;
    jsonApi.refreshLint([]);
  };
  const unsub = state.subscribe((reason) => { if (reason === 'document' || reason === 'load' || reason === 'kind') refreshChrome(); });

  const labelOf = (t: TargetRef): string => {
    if (t.kind === 'Field') {
      const f = shape.fields.find((x) => x.internalName === t.id);
      return `${f?.displayName ?? t.id} — column · applies to every view of this list`;
    }
    const v = shape.views.find((x) => x.id === t.id);
    return `${v?.title ?? t.id} — view · applies to this view only`;
  };
  const liveOf = (t: TargetRef): string | null => (t.kind === 'Field'
    ? shape.fields.find((x) => x.internalName === t.id)?.customFormatter
    : shape.views.find((x) => x.id === t.id)?.customFormatter) ?? null;
  const setLiveFormatter = (t: TargetRef, f: string | null): void => {
    if (t.kind === 'Field') { const x = shape.fields.find((y) => y.internalName === t.id); if (x) x.customFormatter = f ?? undefined; }
    else { const x = shape.views.find((y) => y.id === t.id); if (x) x.customFormatter = f ?? undefined; }
  };

  // ── tree ─────────────────────────────────────────────────────────────────
  const renderTree = async (): Promise<void> => {
    draftKeys = journal ? await journal.listDraftKeys() : new Set();
    const model = buildTree(shape, draftKeys, viewId);
    shell.tree.replaceChildren();
    const group = (title: string, nodes: TreeNode[]): void => {
      const g = document.createElement('div');
      g.className = 'ffx-group';
      g.textContent = title;
      shell.tree.appendChild(g);
      for (const n of nodes) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ffx-node' + (n.formatted ? ' ffx-formatted' : '') + (n.draft ? ' ffx-draft' : '') + (n.current ? ' ffx-current' : '') + (current && targetKey(current) === n.key ? ' ffx-open' : '');
        b.dataset.key = n.key;
        b.title = `${n.label} — ${n.scope}`;
        b.innerHTML = `<span class="ffx-label"></span>${n.draft ? '<span class="ffx-dot" title="you have a draft"></span>' : ''}${n.formatted ? '<span class="ffx-badge">formatted</span>' : ''}`;
        b.querySelector('.ffx-label')!.textContent = n.label;
        b.addEventListener('click', () => { void pick(n); });
        shell.tree.appendChild(b);
      }
    };
    group('Views', model.views);
    group('Columns', model.columns);
  };

  const pick = async (n: TreeNode): Promise<void> => {
    if (n.target.kind === 'View' && !n.current && n.url) {
      // §2.4: the list on screen must match the target — navigate, reopen there
      await stashDraft();
      writeReopen(storage, { listId, targetKey: n.key });
      navigate(n.url);
      return;
    }
    await openTarget(n.target);
  };

  // ── targets and drafts ───────────────────────────────────────────────────
  const stashDraft = async (): Promise<void> => {
    if (!current || !journal) return;
    if (!state.isDirtySinceSave && !openedFromDraft) return;
    const after = exportJson(state.doc, { sanitizeWhitespace: true, keepMeta: true });
    await journal.saveDraft(current, after, basedOn);
  };

  const openTarget = async (t: TargetRef): Promise<void> => {
    await stashDraft();
    current = t;
    writeReopen(storage, { listId, targetKey: targetKey(t) });
    const live = await readFormatter(rest, listId, t);
    setLiveFormatter(t, live);
    const draft = journal ? await journal.loadDraft(t) : null;
    const text = draft ? draft.after : live;
    basedOn = draft ? draft.basedOn : formatterHash(live);
    openedFromDraft = !!draft;
    const { doc, error } = docFor(t, text);
    state.openTargetDocument(doc, labelOf(t));
    shell.title.textContent = labelOf(t);
    shell.notice(error
      ?? (draft && draft.basedOn !== formatterHash(live)
        ? 'Your draft was restored, but this formatter has changed since you started it — Apply will show both versions.'
        : (journal && !journal.durable ? journal.reason ?? null : null)));
    refreshChrome();
    apply.refresh();
    await renderTree();
  };

  const loadLive = (f: string | null): void => {
    if (!current) return;
    const { doc } = docFor(current, f);
    state.loadDocument(doc);
    state.markSavepoint();
    basedOn = formatterHash(f);
    openedFromDraft = false;
    shell.notice(null);
  };

  const core: PanelCore = {
    rest, listId, shell, journal: () => journal!, current: () => current, basedOn: () => basedOn,
    setBasedOn: (h) => { basedOn = h; openedFromDraft = false; }, setLiveFormatter, loadLive, toast, renderTree,
  };
  const apply = mountApply(core, { read: (t) => readFormatter(rest, listId, t), write: (t, f) => writeFormatter(rest, listId, t, f) });

  // ── boot ─────────────────────────────────────────────────────────────────
  const boot = async (): Promise<void> => {
    shell.title.textContent = ctx.listTitle ? `FormatFX — ${ctx.listTitle}` : 'FormatFX';
    shape = await loadListShape(rest, listId);
    const schema = importSchema(JSON.stringify({
      formatfx: 'list-snapshot', version: LIST_SNAPSHOT_VERSION, capturedAt: new Date().toISOString(),
      siteUrl: ctx.webUrl, listId, fields: shape.fields, views: [], rows: [],
    }));
    state.fields = schema.fields;
    state.rows = buildSampleRows(schema.fields, 3);
    journal = await openJournal(rest, listId, storage);
    if (!journal.durable) shell.notice(journal.reason ?? null);
    const remembered = readReopen(storage, listId)?.targetKey;
    const rememberedNode = remembered ? [...buildTree(shape, new Set(), viewId).views, ...buildTree(shape, new Set(), viewId).columns].find((n) => n.key === remembered) : undefined;
    const first: TargetRef = rememberedNode?.target ?? { kind: 'View', id: currentViewOf(shape, viewId)?.id ?? '' };
    if (first.id) await openTarget(first);
    else await renderTree();
  };
  const ready = boot().catch((e: unknown) => { shell.notice(`FormatFX could not load this list: ${e instanceof Error ? e.message : String(e)}`); });

  const close = async (): Promise<void> => {
    await stashDraft();
    writeReopen(storage, null);
    unsub();
    shell.destroy();
    state.resumeAutosave();
    ctx.onClose?.();
  };

  return {
    ready,
    setViewId(id) {
      viewId = id;
      const now = currentViewOf(shape, id)?.id ?? null;
      if (current?.kind === 'View' && now && current.id !== now) void openTarget({ kind: 'View', id: now });
      else void renderTree();
    },
    openTarget,
    close,
  };
}
```

Create the Task 12 stub so this compiles now — `spfx/panel/src/panelApply.ts`:

```ts
import type { PanelCore } from './panel';
import type { TargetRef } from './journal';
export interface ApplyIo { read(t: TargetRef): Promise<string | null>; write(t: TargetRef, f: string | null): Promise<void> }
export interface ApplyUi { refresh(): void }
export function mountApply(_core: PanelCore, _io: ApplyIo): ApplyUi { return { refresh() {} }; }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd spfx/panel && npm run build && cd ../.. && npx vitest run spfx/panel/src/panel.test.ts`
(The build regenerates `appCss.gen.ts`, which the test imports transitively.)
Expected: PASS (12 tests). Likely first-run snags, in order of probability: (a) happy-dom `getComputedStyle` inside a shadow root — if `display` comes back `''`, assert instead that the injected `<style>` text contains `#wb-deploy-panel, #wb-json-deploy, #wb-json-compbar { display: none !important; }`; (b) `jsonPanel` reading `state.doc` before `openTargetDocument` — the pane regenerates on `'load'`, which `openTargetDocument` emits; (c) the pane's confirm() on a diverged buffer — the tests apply into a clean buffer, so no confirm fires.

Run: `cd spfx/panel && npm run typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add spfx/panel/src/panel.ts spfx/panel/src/panel.test.ts spfx/panel/src/panelApply.ts
git commit -m "spfx: panel controller — boot, tree, open target, drafts, view switch"
```

---

### Task 12: Apply, the stale choice, History drawer and rollback

**Files:**
- Modify: `spfx/panel/src/panelApply.ts` (replace the stub), `spfx/panel/src/panel.test.ts` (append)

**Interfaces:**
- Consumes: `PanelCore` (Task 11), `applyTarget`/`checkPending` (Task 6), `lintDocument` (`src/core/linter`), `exportJson`, `state`.
- Produces: `mountApply(core: PanelCore, io: ApplyIo): ApplyUi` with `refresh()` (re-reads history when the drawer is open, resets the stale choice).

- [ ] **Step 1: Append the failing tests**

Append to `spfx/panel/src/panel.test.ts`:

```ts
describe('mountFormatPanel — apply, stale, history, rollback', () => {
  it('applies through the journal: Pending → MERGE → verify → Applied, then refreshes badges', async () => {
    const t = tenant();
    const m = mount(t);
    await m.api.ready;
    await m.api.openTarget({ kind: 'Field', id: 'Title' });
    m.typeAndApply('{"elmType":"div","txtContent":"new"}');
    m.$('.ffx-apply').click();
    await vi.waitFor(() => expect(m.$('.ffx-status').textContent).toContain('Applied'));
    expect(t.formatters['Field:Title']).toContain('"txtContent": "new"');
    const merge = t.calls.find((c) => c.url.includes("getbyinternalnameortitle('Title')") && (c.init?.headers as Record<string, string>)['X-HTTP-Method'] === 'MERGE')!;
    const pending = t.calls.findIndex((c) => c.url.endsWith(`${JOURNAL_PATH}/items`) && c.init?.method === 'POST');
    expect(pending).toBeLessThan(t.calls.indexOf(merge)); // journal before list
    expect(t.items.filter((i) => i.TargetId === 'Title').map((i) => i.Kind)).toEqual(['Applied']);
    expect(t.items.some((i) => i.Kind === 'Draft')).toBe(false);
    expect(m.$('.ffx-node[data-key="Field:Title"]').classList.contains('ffx-formatted')).toBe(true);
    expect(state.isDirtySinceSave).toBe(false);
  });

  it('refuses to apply a document with lint errors', async () => {
    const t = tenant();
    const m = mount(t);
    await m.api.ready;
    await m.api.openTarget({ kind: 'Field', id: 'Title' });
    m.typeAndApply('{"elmType":"div","txtContent":"=if([$Nope] == 1, 1, 2)"}');
    m.$('.ffx-apply').click();
    await vi.waitFor(() => expect(m.$('.ffx-status').textContent).toContain('lint error'));
    expect(t.items).toHaveLength(0);
  });

  it('shows both versions when the target changed since you started, and overwrites on request', async () => {
    const t = tenant();
    const m = mount(t);
    await m.api.ready;
    m.typeAndApply('{"elmType":"div","txtContent":"mine"}');
    t.formatters[`View:${V1}`] = '{"elmType":"div","txtContent":"theirs"}';
    m.$('.ffx-apply').click();
    await vi.waitFor(() => expect(m.$('.ffx-drawer').hidden).toBe(false));
    expect(m.$('.ffx-drawer').textContent).toContain('changed this since you started');
    expect(m.$('.ffx-stale-theirs').textContent).toContain('theirs');
    expect(m.$('.ffx-stale-yours').textContent).toContain('mine');
    m.$('.ffx-overwrite').click();
    await vi.waitFor(() => expect(t.formatters[`View:${V1}`]).toContain('mine'));
    expect(t.items.find((i) => i.Kind === 'Applied')?.Before).toContain('theirs');
  });

  it('"reload theirs" loads the live version and keeps yours one undo away', async () => {
    const t = tenant();
    const m = mount(t);
    await m.api.ready;
    m.typeAndApply('{"elmType":"div","txtContent":"mine"}');
    t.formatters[`View:${V1}`] = '{"elmType":"div","txtContent":"theirs"}';
    m.$('.ffx-apply').click();
    await vi.waitFor(() => expect(m.$('.ffx-drawer').hidden).toBe(false));
    m.$('.ffx-reload').click();
    await vi.waitFor(() => expect(m.textarea().value).toContain('theirs'));
    state.undo();
    expect(state.doc.root.txtContent).toBe('mine');
  });

  it('lists history newest first and rolls back through the same journal', async () => {
    const t = tenant();
    const m = mount(t);
    await m.api.ready;
    await m.api.openTarget({ kind: 'Field', id: 'Title' });
    m.typeAndApply('{"elmType":"div","txtContent":"v1"}');
    m.$('.ffx-apply').click();
    await vi.waitFor(() => expect(t.formatters['Field:Title']).toContain('v1'));
    m.typeAndApply('{"elmType":"div","txtContent":"v2"}');
    m.$('.ffx-apply').click();
    await vi.waitFor(() => expect(t.formatters['Field:Title']).toContain('v2'));
    m.$('.ffx-history').click();
    await vi.waitFor(() => expect(m.$$('.ffx-hist-row')).toHaveLength(2));
    expect(m.$$('.ffx-hist-row').map((r) => r.dataset.kind)).toEqual(['Applied', 'Applied']);
    m.$$('.ffx-rollback')[1].click(); // the first apply's Before = no formatter
    await vi.waitFor(() => expect(t.formatters['Field:Title']).toBe(''));
    expect(t.items.map((i) => i.Kind)).toEqual(['Applied', 'Applied', 'Applied']);
    expect(m.textarea().value).toContain('"@currentField"');
    expect(m.$('.ffx-node[data-key="Field:Title"]').classList.contains('ffx-formatted')).toBe(false);
  });

  it('offers "check" on an unconfirmed Pending row and resolves it', async () => {
    const t = tenant();
    t.items.push({ Id: 99, Kind: 'Pending', ListId: LIST, TargetKind: 'Field', TargetId: 'Status', Before: '', After: COL_JSON, BasedOn: 'x', Created: '2026-09-16T00:00:00Z', AuthorId: 12, Author: { Title: 'Me' } });
    const m = mount(t);
    await m.api.ready;
    await m.api.openTarget({ kind: 'Field', id: 'Status' });
    m.$('.ffx-history').click();
    await vi.waitFor(() => expect(m.$('.ffx-hist-row[data-kind="Pending"]')).toBeTruthy());
    expect(m.$('.ffx-hist-row[data-kind="Pending"]').textContent).toContain('unconfirmed');
    m.$('.ffx-check').click();
    await vi.waitFor(() => expect(t.items.find((i) => i.Id === 99)?.Kind).toBe('Applied'));
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run spfx/panel/src/panel.test.ts`
Expected: the 6 new tests FAIL (no `.ffx-apply` button).

- [ ] **Step 3: Implement**

`spfx/panel/src/panelApply.ts` (replace the stub):

```ts
/**
 * panelApply.ts — the footer's Apply + History (spec §5, §6, §7).
 * Apply is lint-gated and runs applyFlow over the open target; a stale
 * result shows both versions in the drawer with Overwrite / Reload theirs.
 * The History drawer lists the target's journal rows newest first: Applied
 * rows roll back (an apply of their Before), Pending rows are "unconfirmed"
 * with a Check action, Failed rows are informational.
 */
import type { PanelCore } from './panel';
import type { TargetRef, JournalRow } from './journal';
import { applyTarget, checkPending, type ApplyDeps } from './applyFlow';
import { formatterHash } from './hash';
import { state } from '../../../src/editor/state';
import { exportJson } from '../../../src/core/serializer';
import { lintDocument } from '../../../src/core/linter';

export interface ApplyIo { read(t: TargetRef): Promise<string | null>; write(t: TargetRef, f: string | null): Promise<void> }
export interface ApplyUi { refresh(): void }

const APPLY_CSS = `
.ffx-stale pre, .ffx-hist pre { max-height: 120px; overflow: auto; background: var(--wb-surface); padding: 6px; margin: 4px 0; font-size: 11px; }
.ffx-stale-cols { display: flex; gap: 12px; } .ffx-stale-cols > div { flex: 1; min-width: 0; }
.ffx-hist-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; border-bottom: 1px solid var(--wb-border); }
.ffx-hist-row .ffx-when { color: var(--wb-text-2); }
.ffx-hist-row button { font: inherit; padding: 2px 8px; }
`;

export function mountApply(core: PanelCore, io: ApplyIo): ApplyUi {
  const { shell } = core;
  const style = document.createElement('style');
  style.textContent = APPLY_CSS;
  shell.app.prepend(style);
  shell.footer.insertAdjacentHTML('beforeend',
    '<button class="ffx-history" title="Drafts and every apply for this target, with one-click rollback">History</button>'
    + '<button class="ffx-apply" title="Write this formatter to the list — one MERGE, journaled first">Apply</button>');
  const applyBtn = shell.footer.querySelector<HTMLButtonElement>('.ffx-apply')!;
  const histBtn = shell.footer.querySelector<HTMLButtonElement>('.ffx-history')!;
  let drawerMode: 'closed' | 'history' | 'stale' = 'closed';

  const depsFor = (t: TargetRef): ApplyDeps => ({
    read: () => io.read(t), write: (f) => io.write(t, f), journal: core.journal(),
  });

  const lintErrors = (): number => lintDocument(
    state.doc, state.fields.map((f) => f.name), Object.fromEntries(state.fields.map((f) => [f.name, f.type])),
  ).filter((i) => i.severity === 'error').length;

  const finish = async (t: TargetRef, after: string | null, result: Awaited<ReturnType<typeof applyTarget>>, yoursText: string | null): Promise<void> => {
    if (result.status === 'applied') {
      core.setBasedOn(formatterHash(after));
      core.setLiveFormatter(t, after);
      state.markSavepoint();
      await core.journal().deleteDraft(t);
      core.toast(after === null ? 'Applied — formatter cleared' : 'Applied');
      await core.renderTree();
      if (drawerMode === 'history') await showHistory();
      else closeDrawer();
      return;
    }
    if (result.status === 'stale') { showStale(t, result.live, yoursText); return; }
    core.toast(`Not applied — ${result.message}`);
  };

  const run = async (after: string | null, force = false): Promise<void> => {
    const t = core.current();
    if (!t) return;
    applyBtn.disabled = true;
    try {
      const result = await applyTarget(depsFor(t), { listId: core.listId, target: t, after, basedOn: core.basedOn(), force });
      await finish(t, after, result, after);
    } finally {
      applyBtn.disabled = false;
    }
  };

  applyBtn.addEventListener('click', () => {
    const n = lintErrors();
    if (n) { core.toast(`Not applying with ${n} lint error${n === 1 ? '' : 's'} — SharePoint would accept the write and render blank. Fix the red items first.`); return; }
    void run(exportJson(state.doc, { sanitizeWhitespace: true, keepMeta: true }));
  });

  // ── drawer ───────────────────────────────────────────────────────────────
  const closeDrawer = (): void => { drawerMode = 'closed'; shell.drawer.hidden = true; shell.drawer.replaceChildren(); };

  const showStale = (t: TargetRef, live: string | null, yours: string | null): void => {
    drawerMode = 'stale';
    shell.drawer.hidden = false;
    shell.drawer.innerHTML = `<div class="ffx-stale">
      <p><strong>Someone changed this since you started.</strong> Choose: overwrite with yours, or reload theirs (yours stays one undo away).</p>
      <div class="ffx-stale-cols">
        <div><div>Theirs (on the list now)</div><pre class="ffx-stale-theirs"></pre></div>
        <div><div>Yours</div><pre class="ffx-stale-yours"></pre></div>
      </div>
      <button class="ffx-overwrite">Overwrite with mine</button>
      <button class="ffx-reload">Reload theirs</button>
      <button class="ffx-cancel">Cancel</button>
    </div>`;
    shell.drawer.querySelector('.ffx-stale-theirs')!.textContent = live ?? '(no formatter)';
    shell.drawer.querySelector('.ffx-stale-yours')!.textContent = yours ?? '(no formatter)';
    shell.drawer.querySelector('.ffx-overwrite')!.addEventListener('click', () => { void run(yours, true); });
    shell.drawer.querySelector('.ffx-reload')!.addEventListener('click', () => { core.setLiveFormatter(t, live); core.loadLive(live); closeDrawer(); });
    shell.drawer.querySelector('.ffx-cancel')!.addEventListener('click', closeDrawer);
  };

  const showHistory = async (): Promise<void> => {
    const t = core.current();
    if (!t) return;
    drawerMode = 'history';
    shell.drawer.hidden = false;
    const rows = await core.journal().history(t);
    shell.drawer.replaceChildren();
    const head = document.createElement('div');
    head.className = 'ffx-hist';
    head.textContent = rows.length ? (core.journal().durable ? 'History for this target (shared, on the site)' : 'History for this target (this browser tab only)') : 'No applies recorded for this target yet.';
    shell.drawer.appendChild(head);
    for (const r of rows) shell.drawer.appendChild(historyRow(t, r));
  };

  const historyRow = (t: TargetRef, r: JournalRow): HTMLElement => {
    const el = document.createElement('div');
    el.className = 'ffx-hist-row';
    el.dataset.kind = r.kind;
    const when = r.created ? new Date(r.created).toLocaleString() : '';
    const size = (s: string | null): string => (s === null ? 'no formatter' : `${s.length} chars`);
    el.innerHTML = `<span class="ffx-when"></span><span class="ffx-kind"></span><span class="ffx-who"></span><span class="ffx-size"></span>`;
    el.querySelector('.ffx-when')!.textContent = when;
    el.querySelector('.ffx-kind')!.textContent = r.kind === 'Pending' ? 'unconfirmed' : r.kind;
    el.querySelector('.ffx-who')!.textContent = r.author ?? '';
    el.querySelector('.ffx-size')!.textContent = `${size(r.before)} → ${size(r.after)}`;
    if (r.kind === 'Applied') {
      const b = document.createElement('button');
      b.className = 'ffx-rollback';
      b.textContent = 'Roll back to before this';
      b.title = 'Apply this row\'s Before — journaled like any other apply';
      b.addEventListener('click', () => { void run(r.before); });
      el.appendChild(b);
    } else if (r.kind === 'Pending') {
      const b = document.createElement('button');
      b.className = 'ffx-check';
      b.textContent = 'Check';
      b.title = 'Re-read the target: Applied if it holds this row\'s After, otherwise Failed';
      b.addEventListener('click', () => { void checkPending(depsFor(t), r).then(showHistory); });
      el.appendChild(b);
    }
    return el;
  };

  histBtn.addEventListener('click', () => { if (drawerMode === 'history') closeDrawer(); else void showHistory(); });

  return {
    refresh() { if (drawerMode === 'history') void showHistory(); else closeDrawer(); },
  };
}
```

Rollback lands the rolled-back document in the editor: in `finish()`'s applied branch, after `state.markSavepoint()`, add `if (after !== exportJson(state.doc, { sanitizeWhitespace: true, keepMeta: true })) core.loadLive(after);` — a rollback's `after` is a previous Before, not the buffer, so the editor must follow it (the last test checks the empty column document shows). Then `state.markSavepoint()` again.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run spfx/panel/src/panel.test.ts && cd spfx/panel && npm run typecheck && npm run build`
Expected: PASS (18 tests), typecheck clean, bundle built.

Run: `npm test` (root)
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add spfx/panel/src/panelApply.ts spfx/panel/src/panel.test.ts
git commit -m "spfx: apply + stale choice + history drawer with rollback and check"
```

---
### Task 13: The SPFx Command Set host — cleaned up from the spike

No unit runner exists in the SPFx rig (`heft test` runs Jest with zero suites); this task's test cycle is the build plus the panel's `panel.d.ts` surface staying honest. The tenant check is Task 14's smoke.

**Files:**
- Create (restored from the spike branch, then scrubbed): `spfx/formatfx-spfx/**` — via `git checkout origin/spike/spfx-command-set -- spfx/formatfx-spfx` from the worktree root (this only stages files; it does not switch branches)
- Modify after restore: `spfx/formatfx-spfx/package.json`, `config/serve.json`, `config/package-solution.json`, `sharepoint/assets/elements.xml`, `sharepoint/assets/ClientSideInstance.xml`, `src/extensions/formatFx/FormatFxCommandSet.ts`, `src/extensions/formatFx/FormatFxCommandSet.manifest.json`, `src/extensions/formatFx/loc/en-us.js`, `src/extensions/formatFx/loc/myStrings.d.ts`, `README.md` (replace generator boilerplate with a pointer to `spfx/README.md`)
- Modify: `spfx/panel/panel.d.ts` (the real surface)

**Interfaces:**
- Consumes from `formatfx-panel`: `mountFormatPanel`, `PANEL_HOST_ID`, `viewIdFromUrl`, `watchUrl`, `readReopen`, `PanelApi`, `PanelContext`.

- [ ] **Step 1: Restore the spike project and drop the probe code**

```bash
git checkout origin/spike/spfx-command-set -- spfx/formatfx-spfx
git rm --cached -r spfx/formatfx-spfx/.vscode   # editor config is not ours to ship
rm -rf spfx/formatfx-spfx/.vscode
```

`spfx/formatfx-spfx/package.json` — change these fields only (versions stay exactly as the spike pinned them, `@rushstack/heft` `overrides` included):

```json
  "version": "0.1.0",
  "scripts": {
    "prebuild": "npm --prefix ../panel run build",
    "prestart": "npm --prefix ../panel run build",
    "build": "heft test --clean --production && heft package-solution --production",
    "clean": "heft clean",
    "eject-webpack": "heft eject-webpack",
    "start": "heft start --clean"
  },
```

(`"formatfx-panel": "file:../panel"` stays in `dependencies`. The pre-steps make a stale panel bundle impossible — spike answer 2's caveat.)

`config/serve.json` — ONE configuration, no tenant URL committed:

```json
{
  "$schema": "https://developer.microsoft.com/json-schemas/spfx-build/spfx-serve.schema.json",
  "port": 4321,
  "https": true,
  "serveConfigurations": {
    "default": {
      "pageUrl": "https://YOUR-TENANT.sharepoint.com/sites/YOUR-SITE/Lists/YOUR-LIST/AllItems.aspx",
      "customActions": {
        "9bb46657-c68a-4e3b-895b-ed5a36ae6fcc": {
          "location": "ClientSideExtension.ListViewCommandSet.CommandBar",
          "properties": {}
        }
      }
    }
  }
}
```

`config/package-solution.json` — set `solution.name` to `formatfx-format-panel`, `solution.title` to `FormatFX Format panel`, `metadata.shortDescription.default` and `longDescription.default` to `Adds a Format button to every list's command bar that opens the FormatFX editor for that list's column and view formatters.`, `metadata.categories` to `["Productivity"]`, keep `skipFeatureDeployment: true`, `includeClientSideAssets: true`, `isDomainIsolated: false`, keep the solution and feature GUIDs (they were never published), `paths.zippedPackage` to `solution/formatfx-format-panel.sppkg`.

`sharepoint/assets/elements.xml` and `ClientSideInstance.xml` — drop the sample properties and retitle:

```xml
<?xml version="1.0" encoding="utf-8"?>
<Elements xmlns="http://schemas.microsoft.com/sharepoint/">
    <CustomAction
        Title="FormatFX Format panel"
        RegistrationId="100"
        RegistrationType="List"
        Location="ClientSideExtension.ListViewCommandSet.CommandBar"
        ClientSideComponentId="9bb46657-c68a-4e3b-895b-ed5a36ae6fcc"
        ClientSideComponentProperties="{}">
    </CustomAction>
</Elements>
```

```xml
<?xml version="1.0" encoding="utf-8"?>
<Elements xmlns="http://schemas.microsoft.com/sharepoint/">
    <ClientSideComponentInstance
        Title="FormatFX Format panel"
        Location="ClientSideExtension.ListViewCommandSet.CommandBar"
        ListTemplateId="100"
        Properties="{}"
        ComponentId="9bb46657-c68a-4e3b-895b-ed5a36ae6fcc" />
</Elements>
```

`src/extensions/formatFx/FormatFxCommandSet.manifest.json` — the `items` block becomes:

```json
  "items": {
    "FORMAT": {
      "title": { "default": "Format" },
      "iconImageUrl": "",
      "type": "command"
    }
  }
```

`loc/en-us.js` → `return { "Format": "Format" }`; `loc/myStrings.d.ts` → `interface IFormatFxCommandSetStrings { Format: string; }` (keep the `declare module` block).

- [ ] **Step 2: The Command Set**

`spfx/formatfx-spfx/src/extensions/formatFx/FormatFxCommandSet.ts` (whole file):

```ts
/**
 * FormatFxCommandSet — the thin SPFx host for the FormatFX Format panel
 * (spec docs/superpowers/specs/2026-09-16-spfx-format-panel-design.md §4).
 * One command, "Format", mounts the panel as a shadow root on document.body.
 *
 * Spike facts this code answers to (spec §9):
 *  1. SharePoint creates TWO Command Set instances per page load and a modern
 *     view switch is client-side navigation with no SPFx event → the panel
 *     host is a singleton by element id, and the open view is re-keyed from
 *     the URL's `viewid` by a watcher, not from context.listView.
 *  3. The panel itself stops key propagation at its shadow host.
 * The panel's own view picks are full navigations; a per-tab record makes it
 * reopen on the new view (onInit).
 */
import { BaseListViewCommandSet, type IListViewCommandSetExecuteEventParameters } from '@microsoft/sp-listview-extensibility';
import {
  mountFormatPanel, PANEL_HOST_ID, viewIdFromUrl, watchUrl, readReopen, type PanelApi,
} from 'formatfx-panel';

export interface IFormatFxCommandSetProperties {}

export default class FormatFxCommandSet extends BaseListViewCommandSet<IFormatFxCommandSetProperties> {
  private panel: PanelApi | null = null;
  private stopWatch: (() => void) | null = null;

  public onInit(): Promise<void> {
    // reopen after the full navigation a view pick triggers (panel decision 3)
    const listId = this.listId();
    if (listId && readReopen(sessionStorage, listId)) this.open();
    return Promise.resolve();
  }

  public onExecute(event: IListViewCommandSetExecuteEventParameters): void {
    if (event.itemId === 'FORMAT') this.open();
  }

  protected onDispose(): void {
    this.stopWatch?.();
    this.stopWatch = null;
    // the panel outlives this instance only if the other instance owns it;
    // ours closes with us
    if (this.panel) { void this.panel.close(); this.panel = null; }
    super.onDispose();
  }

  private open(): void {
    const listId = this.listId();
    if (!listId) return; // not a list page (e.g. an item form)
    if (document.getElementById(PANEL_HOST_ID)) return; // singleton — the other instance owns it
    const host = document.createElement('div');
    host.id = PANEL_HOST_ID;
    const shadow = host.attachShadow({ mode: 'open' });
    document.body.appendChild(host);
    this.panel = mountFormatPanel(shadow, {
      webUrl: this.context.pageContext.web.absoluteUrl,
      listId,
      listTitle: this.context.pageContext.list?.title,
      viewId: viewIdFromUrl(location.href),
      onClose: () => { this.stopWatch?.(); this.stopWatch = null; this.panel = null; },
    });
    this.stopWatch = watchUrl((href) => this.panel?.setViewId(viewIdFromUrl(href)));
  }

  private listId(): string | undefined {
    return this.context.pageContext.list?.id.toString();
  }
}
```

- [ ] **Step 3: The panel's declared surface**

`spfx/panel/panel.d.ts` (replace the placeholder — this is what the SPFx TypeScript build sees; keep it in step with `src/panel.ts` exports):

```ts
export declare const PANEL_HOST_ID: string;
export declare const REOPEN_KEY: string;
export type TargetKind = 'Field' | 'View';
export interface TargetRef { kind: TargetKind; id: string }
export interface PanelContext {
  webUrl: string; listId: string; listTitle?: string; viewId: string | null;
  fetchImpl?: typeof fetch; storage?: Storage; navigate?: (url: string) => void; onClose?: () => void;
}
export interface PanelApi {
  ready: Promise<void>;
  setViewId(id: string | null): void;
  openTarget(t: TargetRef): Promise<void>;
  close(): Promise<void>;
}
export declare function mountFormatPanel(shadow: ShadowRoot, ctx: PanelContext): PanelApi;
export declare function viewIdFromUrl(href: string): string | null;
export declare function watchUrl(onChange: (href: string) => void, intervalMs?: number): () => void;
export interface ReopenState { listId: string; targetKey: string | null }
export declare function readReopen(storage: Storage, listId: string): ReopenState | null;
```

- [ ] **Step 4: Build**

Run (from `spfx/formatfx-spfx`, Node 22.14.x): `npm install && npm run build`
Expected: the `prebuild` prints `formatfx-panel → dist/panel.js`, then `heft test --clean --production` and `heft package-solution --production` exit 0, producing `sharepoint/solution/formatfx-format-panel.sppkg`. Two cosmetic webpack warnings about generator icon paths are known and fine. `git status --short spfx` shows no build output.

Run (root): `npm test`
Expected: green — the vitest exclude from Task 1 keeps the SPFx project's Jest fixtures out.

- [ ] **Step 5: Commit**

```bash
git add spfx/formatfx-spfx spfx/panel/panel.d.ts
git commit -m "spfx: Command Set host — singleton shadow panel, URL re-key, reopen after view pick"
```

---

### Task 14: Docs, CI, the owner's smoke checklist, and the PR

**Files:**
- Create: `spfx/README.md`
- Modify: `.github/workflows/ci.yml:36-67`, `docs/HANDOFF.md` (§2 architecture map: one paragraph + the §7 test inventory line), `docs/CONNECTIVITY.md` (§2 tiers: add the SPFx tier as shipped-v1), `CLAUDE.md` (house rules: `spfx/` joins `extension/` in the zero-dependency exemption; the read-only rule names `src/bridge` extraction explicitly), `README.md:29` (one sentence on the SPFx panel), `docs/superpowers/specs/2026-09-16-spfx-format-panel-design.md` (status line → "v1 plan A executing / landed: `docs/superpowers/plans/2026-09-16-spfx-panel-v1.md`")

- [ ] **Step 1: `spfx/README.md`**

```markdown
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

Every panel module is node-tested from the repo root: `npm test` runs `spfx/panel/src/*.test.ts`
and `spfx/panel/tools/*.test.ts` with the rest of the suite. The Command Set has no runner
(the rig's Jest has zero suites); the tenant smoke below covers it.

## Debug on a real list (owner-driven)

1. `cd spfx/formatfx-spfx`, set `config/serve.json` → `pageUrl` to your test list, once: `npx heft trust-dev-cert`.
2. `npm run start -- --nobrowser`
3. Open (replace the list URL; the id is the Command Set's manifest id):
   `<LIST_URL>?loadSPFX=true&debugManifestsFile=https://localhost:4321/temp/build/manifests.js&customActions={"9bb46657-c68a-4e3b-895b-ed5a36ae6fcc":{"location":"ClientSideExtension.ListViewCommandSet.CommandBar","properties":{}}}`
   Chromium 142+ asks to allow local-network access — allow it.

## Package and deploy (site collection app catalog, no tenant admin)

```powershell
cd spfx/formatfx-spfx; npm run build
Connect-PnPOnline -Url https://TENANT.sharepoint.com/sites/SITE -UseWebLogin
Add-PnPApp -Path .\sharepoint\solution\formatfx-format-panel.sppkg -Scope Site -Overwrite -Publish
Install-PnPApp -Identity formatfx-format-panel -Scope Site   # first install only
```

`skipFeatureDeployment: true` means the Format button appears on every generic list of the site
once the app is installed; nothing is injected anywhere else.

## Smoke checklist (run by the owner after each deploy)

- [ ] Format button on a list's command bar; panel opens once even though SharePoint mounts the extension twice (check `document.querySelectorAll('#ffx-format-panel').length === 1`).
- [ ] Tree: views then columns, badge on formatted ones, the on-screen view marked; opening the panel opens the current view.
- [ ] Type `g` and other letters in the JSON pane — nothing is swallowed; Ctrl+Z/Y undo/redo.
- [ ] First use on the site creates the hidden `FormatFX` list (Site contents → hidden lists) with 7 columns; a person without Manage Lists sees the per-tab notice instead.
- [ ] Edit a column, pick another target → a dot appears; come back → the draft is restored.
- [ ] Pick another view → the page navigates and the panel reopens on that view.
- [ ] Apply → the list re-renders with the formatter; the journal has Pending→Applied with Before/After.
- [ ] Change the formatter in another tab, then Apply here → both versions shown; Overwrite and Reload both behave.
- [ ] History: roll back → previous formatter is live, a new Applied row exists.
- [ ] Close → no host element left, reopen works.
```

- [ ] **Step 2: CI**

In `.github/workflows/ci.yml` extend the cache key list and add the panel steps right after the extension's:

```yaml
          cache-dependency-path: |
            package-lock.json
            extension/package-lock.json
            spfx/panel/package-lock.json
```

```yaml
      # the SPFx panel bundle: own package like the extension (the .sppkg
      # build itself stays local — ~1,300 packages; see spfx/README.md)
      - run: npm ci
        if: steps.docsonly.outputs.skip != 'true'
        working-directory: spfx/panel
      - run: npm run build
        if: steps.docsonly.outputs.skip != 'true'
        working-directory: spfx/panel
      - run: npm run typecheck
        if: steps.docsonly.outputs.skip != 'true'
        working-directory: spfx/panel
```

(`build` before `typecheck`: typecheck needs the generated `appCss.gen.ts`.)

- [ ] **Step 3: Doc touches**

- `docs/HANDOFF.md` §2: add a paragraph "SPFx Format panel (`spfx/`)" naming the two packages, the single-target seam in `EditorState`, the journal list, and pointing at the spec and this plan. §7: add the `spfx/panel` test files to the inventory.
- `docs/CONNECTIVITY.md` §2: add "Tier 1b — SPFx Format panel (v1 shipped: JSON editor, drafts, history; tab ladder next)". §8 decision log: one dated line.
- `CLAUDE.md` house rules: `Vanilla TypeScript + Vite, zero runtime dependencies — keep it that way (extension/ and spfx/ are separate packages and exempt).` and in the connectivity bullet: `extraction (src/bridge) stays read-only; the SPFx panel writes, by design, through its own client under spfx/panel/src`.
- `README.md` line 29: append `A SharePoint Framework package (spfx/) puts the editor straight into the list's command bar — see spfx/README.md.`
- Spec status line (line 3-5): `Status: approved design; spike done (§9 Answers); v1 plan A: docs/superpowers/plans/2026-09-16-spfx-panel-v1.md.`

- [ ] **Step 4: Verify, commit, PR**

Run: `npm test && npm run build` (root), `cd spfx/panel && npm run build && npm run typecheck`
Expected: all green.

```bash
git add spfx/README.md .github/workflows/ci.yml docs/HANDOFF.md docs/CONNECTIVITY.md CLAUDE.md README.md docs/superpowers/specs/2026-09-16-spfx-format-panel-design.md
git commit -m "spfx: README (build/debug/deploy/smoke), CI for the panel bundle, doc pointers"
git push -u origin <session-branch>
```

Open the PR to `main` per CLAUDE.md (title `SPFx Format panel v1 — host, tree, journal, apply`; body: what changed and why in plain language, test counts before/after, the decisions list from this plan's header, the smoke checklist as the owner's to-do), then watch CI (memory `pr-watch-fallback`: a Monitor polling `gh`), fix under the usual rules, never merge.

---

## Self-review (done while writing; kept for the executor)

- **Spec coverage.** §2.1 entry → Task 13. §2.2 container + expand → Task 10. §2.3 one target → Tasks 9, 11. §2.4 tree, badges, dots, navigate-on-view-pick, URL re-key, singleton → Tasks 7, 8, 11, 13. §2.5 tabs → **Plan B** (the JSON pane is the escape hatch, present). §2.6 drafts, silent stash, one-click rollback → Tasks 4, 11, 12. §2.7 apply → Tasks 6, 12. §2.10 shadow root + key guard → Task 10. §4 package/bundle/`file:` dep/prebuild → Tasks 1, 13. §5 layout, scope copy, no preview → Tasks 7, 10, 11. §6 hidden list shape, per-person drafts, journal-before-list, unconfirmed + check, rollback via journal, fallback → Tasks 2, 4, 6, 12. §7 steps 1–7 → Tasks 3, 5, 6, 12. §8 node tests + manual smoke → every task + Task 14.
- **Deliberately deferred** (named in the header): tab ladder, last-tab memory, preview strip, dark mode/syntax colors, document libraries, CI build of the `.sppkg`.
- **Type consistency checked:** `TargetRef {kind: 'Field'|'View'; id}` everywhere; `JournalBackend` method names identical in Tasks 4, 6, 11, 12; `PanelCore` fields used by Task 12 (`rest, listId, shell, journal(), current(), basedOn(), setBasedOn, setLiveFormatter, loadLive, toast, renderTree`) all defined in Task 11; `mountApply(core, io)` returns `{ refresh }` in both the stub and the real module; `Shell` members used by Task 12 (`app, footer, drawer, status`) exist in Task 10; `ShapeView.url` produced in Task 5 and consumed in Tasks 7, 11; `viewIdFromUrl`/`watchUrl`/`readReopen`/`REOPEN_KEY` re-exported by `panel.ts` and declared in `panel.d.ts`.
- **Known soft spots for the executor:** happy-dom's `getComputedStyle` in shadow roots (Task 11 step 4 names the fallback assertion); the nometadata `@odata.type` bodies for list/field creation are the documented shape but only the tenant smoke proves them — if the smoke fails there, switch those two POSTs to `Accept/Content-Type: application/json;odata=verbose` with `__metadata: { type }` and keep the test expectations in step with the change.
