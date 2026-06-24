# Pre-built Row-View Templates — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Templates…" entry to the Row-View toolbar that opens a configuration modal (skeleton + stackable styles + kebab) with a live multi-row preview, and applies the result as one undoable mutation that drives the existing `makeRowView`/`areas`/CFR pipeline.

**Architecture:** A pure-brain module (`rowTemplates.ts`, no DOM/state imports — like `areas.ts`) turns a `RowTemplateConfig` into `{ root, additionalRowClass }` by **composing existing primitives** (`gridCellForField`, `setAreaWeight`, `setRowDensity`) plus three genuinely-new layers (skeletons, a conflict-resolving style compositor, a kebab builder). A thin `templateModal.ts` renders config + preview and calls one new state method, `applyRowTemplate`, modeled exactly on `makeRowView`.

**Tech Stack:** Vanilla TypeScript + Vite, zero runtime deps. Vitest (unit, jsdom), Playwright (e2e).

## Global Constraints

Copied verbatim from `CLAUDE.md` / `docs/HANDOFF.md` — every task implicitly includes these:

- Vanilla TypeScript + Vite, **zero runtime dependencies**.
- **One user gesture = one undoable document mutation.**
- Generators emit only **schema-valid, definitely-works-on-real-SP** output; **refuse and teach rather than guess**; never emit a standalone `!`.
- **Click-only safety:** a misclick must never be able to corrupt a formatter.
- localStorage keys and the `wb-` CSS prefix are **frozen** — no renames; no new top-level keys.
- Only CSS properties in `ALLOWED_STYLES` (`src/core/schema.ts:25`) may be emitted (SP silently drops the rest). Prefer `ms-*` / `sp-css-*` / `sp-card-*` classes over inline style where a shipped class exists.
- Pure-brain modules import **no DOM and no `state`** (node-testable, like `areas.ts`/`gridScaffold.ts`).
- **Test files are contracts:** change/extend the test first, then the code.
- **End of session:** `npm run build` + `npm test` (+ Playwright when a browser is available) green, then **open a PR to `main` automatically** (never merge, never push to `main`).

## Decisions locked this session (the verified design)

These were verified against the codebase and the authoritative SP docs (MCP `sharepoint-formatting`). Treat them as fixed:

1. **Reuse, don't reinvent.** `weight` is `areas.ts`'s `AreaWeight`; sizing/density come from `setAreaWeight`/`setRowDensity`; area content is a CFR cell from `gridCellForField(field, state.columnRefs)` — **drop the `columnRefs` param** the original plan threaded.
2. **Zebra** is emitted as `additionalRowClass` on the **view wrapper** (`doc.viewExtras.additionalRowClass`), value `=if(@rowIndex % 2 == 0,'ms-bgColor-themeLighter','')` — never as a style on the row element. (PnP `alternating-rows`: works regardless of sort/filter.)
3. **Hover highlight** is a shipped Fluent class `ms-bgColor-{token}--hover` (named theme token, default `themeLighter`) — never an arbitrary color and never a `:hover` style (SP drops it).
4. **Kebab trigger** is a `<button>` carrying the glyph as **direct `txtContent`** (no `children`) or an absolutely-positioned overlay div — never a content `<div>` with children (the `card-trigger-button` field gotcha, `linter.ts:341`; the live preview masks it via event bubbling so the linter is the real backstop).
5. **Blank action params are refused, not emitted.** `executeFlow` without a flow id, or `setValue` without field+value, produces **no** action (compiler-side), the modal teaches why, and `linter.ts` gains teaching rules (deploys are lint-gated).
6. **Apply** is `state.applyRowTemplate(...)` — one `snapshot()`, set `doc.root` + `doc.kind='row'` + `doc.viewExtras.additionalRowClass`, clear selection, `emit('kind')` — modeled on `makeRowView` (`state.ts:641`). One Ctrl+Z reverts everything; `viewExtras` (footerFormatter/commandBar/groupProps) is preserved.
7. **Conflict model** lives in one pure `composeRowStyle(config, palette)` that owns precedence, mutual-exclusion, and the `disabled` reason map that the modal greys controls from — so UI and compiler can't drift.
8. **Click-safety gate** uses the existing structural predicate `isPureGrid` (`gridScaffold.ts:170`), not an unprovable "unsaved changes" flag; the single-undo guarantee is the safety story.

**Deferred to v2 (out of scope, noted so it isn't silently dropped):** `leftStripe: 'status'` (needs a per-row status-field expression binding). v1 ships `leftStripe: 'none' | 'neutral'`. The `'native'` kebab (`openContextMenu`) is buildable and schema-valid but the canvas only stubs it as a toast — the preview must label it honestly (Task 6).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/editor/rowTemplates.ts` *(new)* | Pure brain: config types, `defaultConfigFor`, `composeRowStyle`, `buildKebab`, `buildTemplateView`. No DOM/state. |
| `src/editor/rowTemplates.test.ts` *(new)* | Contract for the brain: skeletons, conflict matrix, zebra-on-wrapper, kebab trigger shape + blank-param refusal, allow-list. |
| `src/editor/state.ts` *(modify)* | Add `applyRowTemplate(root, additionalRowClass?)` next to `makeRowView` (~`state.ts:652`). |
| `src/editor/state.test.ts` *(modify)* | Contract: one undo step; reverts root+kind; preserves other `viewExtras`. |
| `src/core/linter.ts` *(modify)* | Teaching rules `flow-missing-id`, `setvalue-missing-target` (~`linter.ts:339`). |
| `src/core/linter.test.ts` *(modify)* | Contract for the two new rules. |
| `src/editor/templateModal.ts` *(new)* | Modal: config pane, multi-row live preview, disabled-from-compose, drag-drop, Apply. |
| `src/editor/canvas.ts` *(modify)* | "Templates…" button in `rowViewToolbar` (~`canvas.ts:43`). |
| `src/style.css` *(modify)* | `.wb-template-modal*` styles. |
| `e2e/templates.spec.ts` *(new)* | Apply + single-undo, disabled-control felt, field drag-drop. |

---

## Task 1: `rowTemplates.ts` — config types + `composeRowStyle`

**Files:**
- Create: `src/editor/rowTemplates.ts`
- Test: `src/editor/rowTemplates.test.ts`

**Interfaces:**
- Consumes: `AreaWeight`, `RowDensity` from `./areas`; `SPElement`, `MockField`, `CustomRowAction` from `../core/types`; `ThemeMode`/`themePalette` from `../core/theme`.
- Produces: all config types below; `composeRowStyle(config: RowTemplateConfig, palette: Record<string,string>): ComposedRowStyle`.

- [ ] **Step 1: Write the failing tests** (`src/editor/rowTemplates.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { composeRowStyle, type RowTemplateConfig } from './rowTemplates';
import { themePalette } from '../core/theme';

const PAL = themePalette('light');
const base = (over: Partial<RowTemplateConfig> = {}): RowTemplateConfig => ({
  templateId: 'equal', rowStyle: 'flat', density: 'roomy',
  zebraStriping: false, hoverHighlight: false, hoverToken: 'themeLighter',
  borderStyle: 'none', borderColor: 'neutralQuaternaryAlt', leftStripe: 'none',
  areas: [], kebab: { enabled: false, behavior: 'custom', position: 'right',
    actions: { defaultClick: false, editProps: false, share: false, delete: false, executeFlow: false, setValue: false } },
  ...over,
});

describe('composeRowStyle — conflict precedence + exclusion', () => {
  it('card disables generic border and zebra, with reasons', () => {
    const c = composeRowStyle(base({ rowStyle: 'card', borderStyle: 'solid', zebraStriping: true }), PAL);
    expect(c.disabled.border).toBe('Card style manages its own border');
    expect(c.disabled.zebra).toBe('Card fill covers row striping');
    // excluded toggles do not leak into output
    expect(c.rootStyle['border-style']).toBeUndefined();
    expect(c.wrapperAdditionalRowClass).toBeUndefined();
    // card paints its own surface via shipped classes + allow-listed inline
    expect(c.rootClass).toContain('ms-bgColor-white');
    expect(c.rootStyle['border-radius']).toBe('4px');
  });

  it('zebra emits a wrapper additionalRowClass, never a root background', () => {
    const c = composeRowStyle(base({ zebraStriping: true }), PAL);
    expect(c.wrapperAdditionalRowClass).toBe("=if(@rowIndex % 2 == 0,'ms-bgColor-themeLighter','')");
    expect(c.rootStyle['background-color']).toBeUndefined();
  });

  it('hover highlight is a named --hover class, never a :hover style', () => {
    const c = composeRowStyle(base({ hoverHighlight: true, hoverToken: 'themeLighter' }), PAL);
    expect(c.rootClass).toContain('ms-bgColor-themeLighter--hover');
    expect(JSON.stringify(c.rootStyle)).not.toMatch(/:hover/);
  });

  it('leftStripe wins border-left over a flat generic border', () => {
    const c = composeRowStyle(base({ borderStyle: 'solid', leftStripe: 'neutral' }), PAL);
    expect(c.rootStyle['border-left']).toBe(`3px solid ${PAL.themePrimary}`);
  });

  it('minimalist disables generic border but allows leftStripe', () => {
    const c = composeRowStyle(base({ rowStyle: 'minimalist', borderStyle: 'solid', leftStripe: 'neutral' }), PAL);
    expect(c.disabled.border).toBe('Minimalist uses only a bottom separator');
    expect(c.rootStyle['border-bottom-style']).toBe('solid');
    expect(c.rootStyle['border-left']).toBe(`3px solid ${PAL.themePrimary}`);
  });

  it('every emitted style key is on the SP allow-list', async () => {
    const { ALLOWED_STYLES } = await import('../core/schema');
    const c = composeRowStyle(base({ rowStyle: 'card', leftStripe: 'neutral', hoverHighlight: true }), PAL);
    for (const k of Object.keys(c.rootStyle)) expect(ALLOWED_STYLES.has(k)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/editor/rowTemplates.test.ts`
Expected: FAIL — `composeRowStyle` not exported.

- [ ] **Step 3: Write the types + `composeRowStyle`** (`src/editor/rowTemplates.ts`)

```ts
/**
 * editor/rowTemplates.ts — Pure brain for "pre-built row-view templates".
 * No DOM, no state imports — node-testable, like areas.ts / gridScaffold.ts.
 * COMPOSES the shipped row-view engine (areas.ts, gridScaffold.ts) and adds
 * only the new layers: skeletons, a conflict-resolving style compositor, and
 * a kebab builder. The verified SP semantics it must honor are in
 * docs/superpowers/plans/2026-06-24-rowview-templates.md "Decisions locked".
 */
import type { MockField, SPElement, CustomRowAction } from '../core/types';
import type { AreaWeight, RowDensity } from './areas';
import { setAreaWeight, setRowDensity } from './areas';
import { gridCellForField } from './gridScaffold';

export type RowTemplateId = 'split' | 'avatar' | 'equal' | 'header-detail';
export type RowStyle = 'flat' | 'card' | 'minimalist';
export type LeftStripe = 'none' | 'neutral'; // 'status' deferred to v2
export type BorderStyle = 'none' | 'solid' | 'dashed';
export type KebabPosition = 'right' | 'left' | 'title' | 'hover';
export type KebabBehavior = 'native' | 'custom';
/** Toggles composeRowStyle may grey out; the value is the reason shown in the UI. */
export type StyleToggle = 'border' | 'zebra' | 'hoverHighlight' | 'leftStripe';

export interface RowAreaConfig {
  fieldName: string;            // '' = empty drop slot
  weight: AreaWeight;
  wrapping: 'wrap' | 'truncate';
  align: 'left' | 'center' | 'right';
}
export interface KebabActionFlags {
  defaultClick: boolean; editProps: boolean; share: boolean;
  delete: boolean; executeFlow: boolean; setValue: boolean;
}
export interface KebabConfig {
  enabled: boolean;
  behavior: KebabBehavior;
  position: KebabPosition;
  actions: KebabActionFlags;
  flowId?: string;
  setValueField?: string;
  setValueVal?: string;
}
export interface RowTemplateConfig {
  templateId: RowTemplateId;
  rowStyle: RowStyle;
  density: RowDensity;
  zebraStriping: boolean;
  hoverHighlight: boolean;
  hoverToken: string;          // a theme token name; default 'themeLighter'
  borderStyle: BorderStyle;
  borderColor: string;         // a theme token name for sp-css-borderColor-*
  leftStripe: LeftStripe;
  areas: RowAreaConfig[];
  kebab: KebabConfig;
}

export interface ComposedRowStyle {
  rootStyle: Record<string, string>;
  rootClass: string[];
  wrapperAdditionalRowClass?: string;
  disabled: Partial<Record<StyleToggle, string>>;
}

/** Single source of truth for style precedence, exclusion, and the UI grey-out map.
 *  `palette` is themePalette(mode) — only leftStripe bakes a concrete color (no
 *  shipped per-side border-color class exists); everything else stays class-based
 *  and theme-safe. */
export function composeRowStyle(config: RowTemplateConfig, palette: Record<string, string>): ComposedRowStyle {
  const rootStyle: Record<string, string> = {};
  const rootClass: string[] = [];
  const disabled: Partial<Record<StyleToggle, string>> = {};

  // --- exclusions first: base styles that OWN or NULLIFY a toggle's property ---
  if (config.rowStyle === 'card') {
    disabled.border = 'Card style manages its own border';
    disabled.zebra = 'Card fill covers row striping';
  } else if (config.rowStyle === 'minimalist') {
    disabled.border = 'Minimalist uses only a bottom separator';
  }
  const borderLive = !disabled.border;
  const zebraLive = !disabled.zebra;

  // --- layer 1: base rowStyle ---
  if (config.rowStyle === 'card') {
    rootClass.push('ms-bgColor-white', 'sp-css-borderColor-neutralQuaternaryAlt');
    rootStyle['border-width'] = '1px';
    rootStyle['border-style'] = 'solid';
    rootStyle['border-radius'] = '4px';
    rootStyle['box-shadow'] = '0 1.6px 3.6px 0 rgba(0,0,0,.13)';
  } else if (config.rowStyle === 'minimalist') {
    rootClass.push('sp-css-borderColor-neutralQuaternaryAlt');
    rootStyle['border-bottom-width'] = '1px';
    rootStyle['border-bottom-style'] = 'solid';
  }

  // --- layer 2: generic border (flat only) ---
  if (borderLive && config.borderStyle !== 'none') {
    rootClass.push(`sp-css-borderColor-${config.borderColor}`);
    rootStyle['border-width'] = '1px';
    rootStyle['border-style'] = config.borderStyle;
  }

  // --- layer 3: leftStripe wins border-left (inline beats the border-color class) ---
  if (config.leftStripe === 'neutral') {
    rootStyle['border-left'] = `3px solid ${palette.themePrimary}`;
  }

  // --- layer 4: background/state ---
  if (zebraLive && config.zebraStriping) {
    // ROOT carries nothing; the stripe lives on the view wrapper (see buildTemplateView).
    return finalize(rootStyle, rootClass, disabled,
      "=if(@rowIndex % 2 == 0,'ms-bgColor-themeLighter','')", config);
  }
  return finalize(rootStyle, rootClass, disabled, undefined, config);
}

function finalize(
  rootStyle: Record<string, string>, rootClass: string[],
  disabled: Partial<Record<StyleToggle, string>>,
  wrapperAdditionalRowClass: string | undefined, config: RowTemplateConfig,
): ComposedRowStyle {
  if (config.hoverHighlight) rootClass.push(`ms-bgColor-${config.hoverToken}--hover`);
  return { rootStyle, rootClass, wrapperAdditionalRowClass, disabled };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/editor/rowTemplates.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/editor/rowTemplates.ts src/editor/rowTemplates.test.ts
git commit -m "feat(rowTemplates): composeRowStyle — conflict precedence, exclusion, allow-listed output"
```

---

## Task 2: `rowTemplates.ts` — `buildKebab` (safe trigger + refuse blank params)

**Files:**
- Modify: `src/editor/rowTemplates.ts`
- Test: `src/editor/rowTemplates.test.ts`

**Interfaces:**
- Consumes: `KebabConfig`, `CustomRowAction`.
- Produces: `buildKebab(kebab: KebabConfig): SPElement | null`.

- [ ] **Step 1: Write the failing tests** (append to `rowTemplates.test.ts`)

```ts
import { buildKebab } from './rowTemplates';

const kebab = (over: Partial<import('./rowTemplates').KebabConfig> = {}) => ({
  enabled: true, behavior: 'custom' as const, position: 'right' as const,
  actions: { defaultClick: false, editProps: false, share: false, delete: false, executeFlow: false, setValue: false },
  ...over,
});

describe('buildKebab — trigger shape + refuse-and-teach', () => {
  it('custom trigger is a button with DIRECT txtContent and NO children (no card-trigger gotcha)', () => {
    const el = buildKebab(kebab({ actions: { ...kebab().actions, editProps: true } }))!;
    expect(el.elmType).toBe('button');
    expect(el.txtContent).toBe('⋯');
    expect(el.children).toBeUndefined();         // trigger has no children
    expect(el.customCardProps!.formatter.children!.length).toBe(1); // flyout has the action
  });

  it('refuses executeFlow with a blank flow id (no dead action emitted)', () => {
    const el = buildKebab(kebab({ actions: { ...kebab().actions, executeFlow: true }, flowId: '   ' }));
    expect(el).toBeNull();                         // nothing else enabled → whole kebab refused
  });

  it('emits executeFlow only when a flow id is present, as a JSON-string actionParams', () => {
    const el = buildKebab(kebab({ actions: { ...kebab().actions, executeFlow: true }, flowId: 'abc-123' }))!;
    const action = el.customCardProps!.formatter.children![0].customRowAction!;
    expect(action.action).toBe('executeFlow');
    expect(action.actionParams).toBe('{"id":"abc-123"}');
  });

  it('emits setValue only with field+value, keyed by the internal name', () => {
    const el = buildKebab(kebab({ actions: { ...kebab().actions, setValue: true }, setValueField: 'Status', setValueVal: 'Done' }))!;
    const action = el.customCardProps!.formatter.children![0].customRowAction!;
    expect(action.action).toBe('setValue');
    expect(action.actionInput).toEqual({ Status: 'Done' });
  });

  it('native behavior is a button carrying openContextMenu (direct glyph, no children)', () => {
    const el = buildKebab(kebab({ behavior: 'native' }))!;
    expect(el.elmType).toBe('button');
    expect(el.children).toBeUndefined();
    expect(el.customRowAction!.action).toBe('openContextMenu');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/editor/rowTemplates.test.ts -t buildKebab`
Expected: FAIL — `buildKebab` not exported.

- [ ] **Step 3: Implement** (append to `rowTemplates.ts`)

```ts
function actionRow(label: string, action: CustomRowAction): SPElement {
  return {
    elmType: 'button',
    txtContent: label,
    customRowAction: action,
    style: { 'display': 'block', 'width': '100%', 'text-align': 'left',
      'border': 'none', 'background-color': 'transparent', 'padding': '6px 8px', 'cursor': 'pointer' },
  };
}

/** Action buttons, REFUSING any whose required param is blank (refuse-and-teach). */
function buildActionButtons(kebab: KebabConfig): SPElement[] {
  const out: SPElement[] = [];
  if (kebab.actions.defaultClick) out.push(actionRow('Open', { action: 'defaultClick' }));
  if (kebab.actions.editProps) out.push(actionRow('Edit', { action: 'editProps' }));
  if (kebab.actions.share) out.push(actionRow('Share', { action: 'share' }));
  if (kebab.actions.delete) out.push(actionRow('Delete', { action: 'delete' }));
  if (kebab.actions.executeFlow && kebab.flowId?.trim()) {
    out.push(actionRow('Run flow', { action: 'executeFlow', actionParams: JSON.stringify({ id: kebab.flowId.trim() }) }));
  }
  if (kebab.actions.setValue && kebab.setValueField?.trim() && kebab.setValueVal?.trim()) {
    out.push(actionRow('Set value', { action: 'setValue', actionInput: { [kebab.setValueField.trim()]: kebab.setValueVal.trim() } }));
  }
  return out;
}

/** The kebab trigger. ALWAYS a <button> with the glyph as direct txtContent and
 *  NO children array — the field-proven safe trigger (linter `card-trigger-button`). */
export function buildKebab(kebab: KebabConfig): SPElement | null {
  if (!kebab.enabled) return null;
  const triggerStyle = { 'cursor': 'pointer', 'border': 'none', 'background-color': 'transparent', 'font-size': '18px', 'line-height': '1' };
  if (kebab.behavior === 'native') {
    return { elmType: 'button', txtContent: '⋯', attributes: { title: 'Item actions' },
      style: triggerStyle, customRowAction: { action: 'openContextMenu' } };
  }
  const actions = buildActionButtons(kebab);
  if (!actions.length) return null; // refuse an empty/all-blank custom kebab
  return {
    elmType: 'button', txtContent: '⋯', attributes: { title: 'Actions' }, style: triggerStyle,
    customCardProps: {
      openOnEvent: 'click', directionalHint: 'bottomRightEdge', isBeakVisible: true,
      formatter: { elmType: 'div',
        style: { 'display': 'flex', 'flex-direction': 'column', 'padding': '4px', 'min-width': '160px' },
        children: actions },
    },
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/editor/rowTemplates.test.ts -t buildKebab`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/editor/rowTemplates.ts src/editor/rowTemplates.test.ts
git commit -m "feat(rowTemplates): buildKebab — safe button trigger, refuse blank action params"
```

---

## Task 3: `rowTemplates.ts` — `defaultConfigFor` + `buildTemplateView`

**Files:**
- Modify: `src/editor/rowTemplates.ts`
- Test: `src/editor/rowTemplates.test.ts`

**Interfaces:**
- Consumes: Task 1 (`composeRowStyle`, config types), Task 2 (`buildKebab`); `gridCellForField`, `setAreaWeight`, `setRowDensity`.
- Produces:
  - `defaultConfigFor(templateId: RowTemplateId, fields: MockField[]): RowTemplateConfig`
  - `buildTemplateView(config: RowTemplateConfig, fields: MockField[], columnRefs: Record<string,SPElement>, palette: Record<string,string>): { root: SPElement; additionalRowClass?: string }`

- [ ] **Step 1: Write the failing tests** (append)

```ts
import { defaultConfigFor, buildTemplateView } from './rowTemplates';
import type { MockField } from '../core/types';
const FIELDS: MockField[] = [
  { name: 'Title', type: 'text' }, { name: 'Status', type: 'choice' }, { name: 'Due', type: 'date' },
];

describe('defaultConfigFor + buildTemplateView', () => {
  it('split skeleton seeds a Title area + 2 content areas', () => {
    const c = defaultConfigFor('split', FIELDS);
    expect(c.areas.length).toBe(3);
    expect(c.areas[0].fieldName).toBe('Title');
    expect(c.areas[0].weight).toBe('wide'); // Title gets the heavier area
  });

  it('areas become CFR/value cells with conflict-free weights (areas.ts reuse)', () => {
    const c = defaultConfigFor('equal', FIELDS);
    const { root } = buildTemplateView(c, FIELDS, {}, themePalette('light'));
    expect(root.children!.length).toBe(c.areas.length);
    for (const area of root.children!) expect(area.style!['min-width']).toBe('0'); // setAreaWeight invariant
  });

  it('zebra lands on the returned additionalRowClass, never on root style', () => {
    const c = defaultConfigFor('equal', FIELDS);
    c.zebraStriping = true;
    const { root, additionalRowClass } = buildTemplateView(c, FIELDS, {}, themePalette('light'));
    expect(additionalRowClass).toBe("=if(@rowIndex % 2 == 0,'ms-bgColor-themeLighter','')");
    expect(root.style!['background-color']).toBeUndefined();
  });

  it('hover-positioned kebab puts showOnHoverParent on the row and showOnHoverChild on the kebab', () => {
    const c = defaultConfigFor('equal', FIELDS);
    c.kebab = { enabled: true, behavior: 'custom', position: 'hover',
      actions: { defaultClick: true, editProps: false, share: false, delete: false, executeFlow: false, setValue: false } };
    const { root } = buildTemplateView(c, FIELDS, {}, themePalette('light'));
    expect((root.attributes!.class as string)).toContain('sp-card-showOnHoverParent');
    const kebab = root.children![root.children!.length - 1];
    expect((kebab.attributes!.class as string)).toContain('sp-card-showOnHoverChild');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/editor/rowTemplates.test.ts -t defaultConfigFor`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement** (append to `rowTemplates.ts`)

```ts
const EMPTY_ACTIONS: KebabActionFlags = { defaultClick: false, editProps: false, share: false, delete: false, executeFlow: false, setValue: false };

/** Skeleton → ordered area field names + the heavier "title" index (-1 = none). */
const SKELETONS: Record<RowTemplateId, { slots: number; titleIdx: number }> = {
  split: { slots: 3, titleIdx: 0 },          // Title (wide) + 2 content
  avatar: { slots: 3, titleIdx: 1 },         // icon/avatar + Title + details
  equal: { slots: 3, titleIdx: -1 },         // equal columns
  'header-detail': { slots: 2, titleIdx: 0 },// header + detail
};

export function defaultConfigFor(templateId: RowTemplateId, fields: MockField[]): RowTemplateConfig {
  const skel = SKELETONS[templateId];
  const usable = fields.filter((f) => !f.protected);
  const areas: RowAreaConfig[] = Array.from({ length: skel.slots }, (_, i) => ({
    fieldName: usable[i]?.name ?? '',
    weight: i === skel.titleIdx ? 'wide' : 'normal',
    wrapping: 'truncate',
    align: 'left',
  }));
  return {
    templateId, rowStyle: 'flat', density: 'roomy',
    zebraStriping: false, hoverHighlight: false, hoverToken: 'themeLighter',
    borderStyle: 'none', borderColor: 'neutralQuaternaryAlt', leftStripe: 'none',
    areas, kebab: { enabled: false, behavior: 'custom', position: 'right', actions: { ...EMPTY_ACTIONS } },
  };
}

function applyWrapAlign(cell: SPElement, wrapping: 'wrap' | 'truncate', align: 'left' | 'center' | 'right'): void {
  cell.style = cell.style ?? {};
  if (wrapping === 'truncate') {
    cell.style['overflow'] = 'hidden';
    cell.style['text-overflow'] = 'ellipsis';
    cell.style['white-space'] = 'nowrap';
  } else {
    cell.style['white-space'] = 'normal';
  }
  cell.style['text-align'] = align;
}

function placeKebab(areas: SPElement[], kebab: SPElement | null, position: KebabPosition): SPElement[] {
  if (!kebab) return areas;
  switch (position) {
    case 'left': return [kebab, ...areas];
    case 'title': return areas.length ? [areas[0], kebab, ...areas.slice(1)] : [kebab];
    default: return [...areas, kebab]; // right + hover
  }
}

export function buildTemplateView(
  config: RowTemplateConfig, fields: MockField[],
  columnRefs: Record<string, SPElement>, palette: Record<string, string>,
): { root: SPElement; additionalRowClass?: string } {
  const composed = composeRowStyle(config, palette);
  const areaEls = config.areas.map((a) => {
    const field = fields.find((f) => f.name === a.fieldName);
    const cell: SPElement = field
      ? gridCellForField(field, columnRefs)
      : { elmType: 'div', _elmName: 'Empty area', style: { 'flex': '1', 'min-width': '0' } };
    setAreaWeight(cell, a.weight);            // areas.ts: flex + load-bearing min-width:0
    applyWrapAlign(cell, a.wrapping, a.align);
    return cell;
  });

  let kebab = config.kebab.enabled ? buildKebab(config.kebab) : null;
  if (kebab && config.kebab.position === 'hover') {
    kebab.attributes = { ...kebab.attributes, class: joinClass(kebab.attributes?.class, 'sp-card-showOnHoverChild') };
  }
  const children = placeKebab(areaEls, kebab, config.kebab.position);

  const root: SPElement = {
    elmType: 'div', _elmName: 'Row layout',
    style: { 'display': 'flex', 'align-items': 'center', 'width': '100%', ...composed.rootStyle },
    children,
  };
  let cls = composed.rootClass.slice();
  if (kebab && config.kebab.position === 'hover') cls.push('sp-card-showOnHoverParent');
  if (cls.length) root.attributes = { class: cls.join(' ') };
  setRowDensity(root, config.density);        // areas.ts: gap + padding only (owns padding over card)
  return { root, additionalRowClass: composed.wrapperAdditionalRowClass };
}

function joinClass(existing: unknown, add: string): string {
  return `${typeof existing === 'string' ? existing + ' ' : ''}${add}`.trim();
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/editor/rowTemplates.test.ts`
Expected: PASS (all rowTemplates tests).

- [ ] **Step 5: Commit**

```bash
git add src/editor/rowTemplates.ts src/editor/rowTemplates.test.ts
git commit -m "feat(rowTemplates): defaultConfigFor + buildTemplateView composing areas/CFR, zebra on wrapper"
```

---

## Task 4: `state.applyRowTemplate` — one undoable mutation

**Files:**
- Modify: `src/editor/state.ts` (add method after `makeRowView`, ~line 652)
- Test: `src/editor/state.test.ts`

**Interfaces:**
- Consumes: Task 3 output shape `{ root, additionalRowClass? }`.
- Produces: `applyRowTemplate(root: SPElement, additionalRowClass?: string): void`.

- [ ] **Step 1: Write the failing tests** (append to `state.test.ts`)

```ts
it('applyRowTemplate is one undo step that reverts root + kind together', () => {
  const s = makeState();                         // existing helper in state.test.ts
  s.loadDocument({ kind: 'grid', root: { elmType: 'div', _elmName: 'grid', children: [] } });
  const newRoot = { elmType: 'div', _elmName: 'Row layout', children: [] };
  s.applyRowTemplate(newRoot, "=if(@rowIndex % 2 == 0,'ms-bgColor-themeLighter','')");
  expect(s.doc.kind).toBe('row');
  expect(s.doc.viewExtras!.additionalRowClass).toContain('@rowIndex');
  s.undo();
  expect(s.doc.kind).toBe('grid');               // single undo reverts BOTH
  expect(s.doc.root._elmName).toBe('grid');
});

it('applyRowTemplate preserves unrelated viewExtras (footerFormatter etc.)', () => {
  const s = makeState();
  s.loadDocument({ kind: 'row', root: { elmType: 'div' }, viewExtras: { footerFormatter: { elmType: 'div' } } });
  s.applyRowTemplate({ elmType: 'div', _elmName: 'Row layout' });
  expect(s.doc.viewExtras!.footerFormatter).toBeDefined();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/editor/state.test.ts -t applyRowTemplate`
Expected: FAIL — `applyRowTemplate` is not a function.

- [ ] **Step 3: Implement** (in `state.ts`, immediately after `makeRowView`)

```ts
  /** Apply a pre-built row template: replace the row formatter body, switch to
   *  'row', and set/clear the zebra wrapper class — as ONE undoable mutation
   *  (snapState captures the whole doc), mirroring makeRowView. Other viewExtras
   *  (footerFormatter, commandBarProps, groupProps, …) are preserved. */
  applyRowTemplate(root: SPElement, additionalRowClass?: string): void {
    this.snapshot();
    this.doc.root = root;
    this.doc.kind = 'row';
    this.doc.viewExtras = { ...this.doc.viewExtras };
    if (additionalRowClass) this.doc.viewExtras.additionalRowClass = additionalRowClass;
    else delete this.doc.viewExtras.additionalRowClass;
    this.selection = [];
    this.emit('kind');
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/editor/state.test.ts -t applyRowTemplate`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/editor/state.ts src/editor/state.test.ts
git commit -m "feat(state): applyRowTemplate — one undoable root+kind+zebra mutation, preserves viewExtras"
```

---

## Task 5: Linter teaching rules for blank action params

**Files:**
- Modify: `src/core/linter.ts` (inside the per-element walk, near the `customCardProps` block ~line 339)
- Test: `src/core/linter.test.ts`

**Interfaces:**
- Consumes: existing `push(level, id, message)` helper inside `walk`.
- Produces: two new rule ids — `flow-missing-id`, `setvalue-missing-target` — surfaced on any element whose `customRowAction` is incomplete.

- [ ] **Step 1: Write the failing tests** (append to `linter.test.ts`)

```ts
it('flags executeFlow with no flow id (flow-missing-id)', () => {
  const issues = lint({ elmType: 'button', customRowAction: { action: 'executeFlow' } });
  expect(issues.some((i) => i.id === 'flow-missing-id')).toBe(true);
});
it('flags setValue with no actionInput (setvalue-missing-target)', () => {
  const issues = lint({ elmType: 'button', customRowAction: { action: 'setValue' } });
  expect(issues.some((i) => i.id === 'setvalue-missing-target')).toBe(true);
});
it('does NOT flag a complete executeFlow', () => {
  const issues = lint({ elmType: 'button', customRowAction: { action: 'executeFlow', actionParams: '{"id":"x"}' } });
  expect(issues.some((i) => i.id === 'flow-missing-id')).toBe(false);
});
```
*(Use the file's existing `lint(...)` test helper; match its current import/shape.)*

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/core/linter.test.ts -t missing`
Expected: FAIL — rules not present.

- [ ] **Step 3: Implement** (in `linter.ts` `walk`, after the `customCardProps` block)

```ts
  // customRowAction completeness — a blank-param action is schema-shaped but
  // does nothing on real SP. Refuse-and-teach (deploys are lint-gated).
  if (el.customRowAction) {
    const a = el.customRowAction;
    if (a.action === 'executeFlow') {
      const id = typeof a.actionParams === 'string' && /"id"\s*:\s*"[^"]+"/.test(a.actionParams);
      if (!id) push('error', 'flow-missing-id', 'executeFlow needs actionParams \'{"id":"<FLOWID>"}\' — pick a flow, or the action does nothing on the list.');
    }
    if (a.action === 'setValue') {
      const ok = a.actionInput && typeof a.actionInput === 'object' && Object.keys(a.actionInput).length > 0;
      if (!ok) push('error', 'setvalue-missing-target', 'setValue needs actionInput keyed by the column internal name (e.g. {"Status":"Done"}) — set a field and value.');
    }
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/core/linter.test.ts`
Expected: PASS (incl. 3 new).

- [ ] **Step 5: Commit**

```bash
git add src/core/linter.ts src/core/linter.test.ts
git commit -m "feat(linter): teaching rules for blank executeFlow/setValue params"
```

---

## Task 6: `templateModal.ts` — config pane, multi-row preview, Apply

**Files:**
- Create: `src/editor/templateModal.ts`
- (Preview reuse) Read: `src/editor/canvas.ts:81-95` (`resolveColumnRef` + `ctxForRow`), `src/editor/playground.ts:201-219` (live-stage pattern).

**Interfaces:**
- Consumes: `state`, `renderElement` (`../core/renderer`), `themePalette` (`../core/theme`), `isPureGrid` (`./gridScaffold`), Task 1-3 (`defaultConfigFor`, `buildTemplateView`, `composeRowStyle`, config types), Task 4 (`state.applyRowTemplate`).
- Produces: `openTemplateModal(onToast: (m: string) => void): void`.

- [ ] **Step 1: Write the failing test** (`src/editor/templateModal.test.ts`, jsdom)

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { state } from './state';
import { openTemplateModal } from './templateModal';

beforeEach(() => { document.body.innerHTML = ''; state.loadDocument({ kind: 'grid', root: { elmType: 'div', children: [] } }); });

describe('template modal', () => {
  it('opens with a config pane and a preview pane', () => {
    openTemplateModal(() => {});
    expect(document.querySelector('.wb-template-modal')).toBeTruthy();
    expect(document.querySelector('.wb-template-preview')).toBeTruthy();
  });

  it('greys a control when composeRowStyle disables it, showing the reason', () => {
    openTemplateModal(() => {});
    (document.querySelector('[data-field="rowStyle"]') as HTMLSelectElement).value = 'card';
    document.querySelector('[data-field="rowStyle"]')!.dispatchEvent(new Event('change'));
    const borderCtl = document.querySelector('[data-toggle="border"]') as HTMLElement;
    expect(borderCtl.hasAttribute('disabled') || borderCtl.classList.contains('wb-disabled')).toBe(true);
    expect(borderCtl.title).toContain('Card style manages its own border');
  });

  it('Apply calls state.applyRowTemplate and switches to row', () => {
    const spy = vi.spyOn(state, 'applyRowTemplate');
    openTemplateModal(() => {});
    (document.querySelector('.wb-template-apply') as HTMLButtonElement).click();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(state.doc.kind).toBe('row');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/editor/templateModal.test.ts`
Expected: FAIL — `openTemplateModal` not exported.

- [ ] **Step 3: Implement** (`src/editor/templateModal.ts`)

Build with `document.createElement` (no innerHTML for dynamic parts), following the overlay pattern in `playground.ts`. Structure:

```ts
import { state } from './state';
import { renderElement } from '../core/renderer';
import { themePalette } from '../core/theme';
import { isPureGrid } from './gridScaffold';
import {
  defaultConfigFor, buildTemplateView, composeRowStyle,
  type RowTemplateConfig, type RowTemplateId, type StyleToggle,
} from './rowTemplates';
import { ctxForRow, resolveColumnRef } from './canvas'; // export these two if not already (see note)

export function openTemplateModal(onToast: (m: string) => void): void {
  let config: RowTemplateConfig = defaultConfigFor('split', state.fields);

  const overlay = el('div', 'wb-template-modal-overlay');
  const modal = el('div', 'wb-template-modal');
  const pane = el('div', 'wb-template-config');
  const preview = el('div', 'wb-template-preview');
  modal.append(pane, preview); overlay.append(modal); document.body.appendChild(overlay);

  const rerender = () => {
    const composed = composeRowStyle(config, themePalette(state.themeMode));
    renderConfigPane(pane, config, composed.disabled, (next) => { config = next; rerender(); });
    renderPreview(preview, config);
  };
  rerender();

  // Apply: structural click-safety gate (isPureGrid) + one undoable mutation.
  const apply = el('button', 'wb-template-apply'); apply.textContent = 'Apply';
  apply.addEventListener('click', () => {
    const dirty = !isPureGrid(state.doc.root) && state.doc.kind !== 'grid';
    if (dirty && !confirm('Replace the current row layout with this template? Ctrl+Z reverts it in one step.')) return;
    const { root, additionalRowClass } = buildTemplateView(config, state.fields, state.columnRefs, themePalette(state.themeMode));
    state.applyRowTemplate(root, additionalRowClass);
    onToast('Template applied'); overlay.remove();
  });
  const cancel = el('button', 'wb-template-cancel'); cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => overlay.remove());
  pane.append(cancel, apply);
}

function el(tag: string, cls: string): HTMLElement { const n = document.createElement(tag); n.className = cls; return n; }
```

`renderConfigPane(pane, config, disabled, onChange)` builds, with `data-field` / `data-toggle` attributes (the test keys):
- Template selector (`data-field="templateId"`) → on change, `onChange(defaultConfigFor(value, state.fields))`.
- Per-area rows: a **field `<select>`** (the dropdown half) listing `state.fields`, plus weight/wrapping/align selects.
- Style controls: `rowStyle` (`data-field="rowStyle"`), and for each `StyleToggle` a control with `data-toggle="<name>"`. **Disabled wiring:** if `disabled[toggle]` is set, add `wb-disabled` class + `disabled` attribute + `el.title = disabled[toggle]` (this is what makes the exclusion *felt* — visible grey + reason tooltip).
- Kebab controls: enable, behavior, position, action checkboxes, and flow-id / set-value inputs that show an inline "pick a flow" / "set a field & value" hint when their action is checked but blank.

`renderPreview(preview, config)` renders **3 mock rows** so zebra alternation is visible:

```ts
function renderPreview(host: HTMLElement, config: RowTemplateConfig): void {
  host.innerHTML = '';
  const { root, additionalRowClass } = buildTemplateView(config, state.fields, state.columnRefs, themePalette(state.themeMode));
  const rows = state.rows.slice(0, 3);
  rows.forEach((row, i) => {
    const ctx = ctxForRow(row, i);                 // i drives @rowIndex so zebra alternates
    const wrap = document.createElement('div');
    if (additionalRowClass) applyAdditionalRowClass(wrap, additionalRowClass, ctx); // emulate the wrapper stripe
    wrap.appendChild(renderElement(root, ctx, { tagPaths: false }, []));
    host.appendChild(wrap);
  });
  // Honesty labels for what a static preview cannot fully show:
  if (config.kebab.enabled && config.kebab.behavior === 'native')
    host.appendChild(note('The native kebab opens the SharePoint item menu on a real list — not emulated here.'));
  if (config.hoverHighlight) host.appendChild(note('Hover highlight shows on pointer-over in the real list.'));
}
```

> **Note for the implementer:** `ctxForRow` and `resolveColumnRef` currently live un-exported in `canvas.ts:81-95`. Export them (or lift the pair into a tiny shared `previewCtx.ts` and have canvas/playground/modal all import it) so the modal's preview uses the identical resolution/eval path — do not re-implement ctx assembly. `applyAdditionalRowClass` evaluates the `=if(@rowIndex…)` expression with `evaluate` (`../core/expressions`) and `classList.add`s the result, matching how SP applies the wrapper class.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/editor/templateModal.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/editor/templateModal.ts src/editor/templateModal.test.ts src/editor/canvas.ts
git commit -m "feat(templateModal): config pane + 3-row live preview + isPureGrid-gated Apply"
```

---

## Task 7: Field drag-drop into preview areas (the "both 1 and 3" deliverable)

> **Owner decision point:** this delivers the drag-drop half of your explicit "why not both 1 and 3?" answer. It is isolated so it can be deferred without blocking Tasks 1-6. If deferred, say so explicitly — do not let the dropdown-only modal ship as if it were the whole answer.

**Files:**
- Modify: `src/editor/templateModal.ts`

**Interfaces:**
- New drag MIME `application/x-wb-field`, mirroring `application/x-wb-palette` (`palette.ts:37`), `application/x-wb-node` (`treeView.ts:251`), `application/x-wb-grid-col` (`gridView.ts:804`).

- [ ] **Step 1: Write the failing test** (append to `templateModal.test.ts`)

```ts
it('dropping a field chip on an area sets that area fieldName', () => {
  state.loadDocument({ kind: 'grid', root: { elmType: 'div', children: [] } });
  openTemplateModal(() => {});
  const area = document.querySelector('[data-area="0"]') as HTMLElement;
  const dt = new DataTransfer(); dt.setData('application/x-wb-field', 'Status');
  area.dispatchEvent(Object.assign(new Event('drop', { bubbles: true }), { dataTransfer: dt }));
  const select = area.querySelector('[data-field="areaField"]') as HTMLSelectElement;
  expect(select.value).toBe('Status');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/editor/templateModal.test.ts -t dropping`
Expected: FAIL — areas are not drop targets yet.

- [ ] **Step 3: Implement**

- Render a draggable field-chip list (the source) in the config pane: each chip
  `chip.draggable = true; chip.addEventListener('dragstart', e => e.dataTransfer!.setData('application/x-wb-field', field.name));`
- Make each area (`data-area="<i>"`) a drop target:
  `area.addEventListener('dragover', e => { if (e.dataTransfer!.types.includes('application/x-wb-field')) e.preventDefault(); });`
  `area.addEventListener('drop', e => { const name = e.dataTransfer!.getData('application/x-wb-field'); if (!name) return; e.preventDefault(); const next = structuredClone(config); next.areas[i].fieldName = name; onChange(next); });`
- Keep the area's field `<select>` in sync (both channels write the same `areas[i].fieldName`).

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/editor/templateModal.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/editor/templateModal.ts
git commit -m "feat(templateModal): drag fields into areas (application/x-wb-field) — dropdown + drag, both"
```

---

## Task 8: "Templates…" button in the Row-View toolbar

**Files:**
- Modify: `src/editor/canvas.ts` (`rowViewToolbar`, after the density `group` append at ~line 43)

- [ ] **Step 1: Write the failing test** (append to `canvas.test.ts`)

```ts
it('row-view toolbar has a Templates button that opens the modal', () => {
  state.loadDocument({ kind: 'row', root: { elmType: 'div', children: [] } });
  renderCanvas(host, () => {});                    // existing harness in canvas.test.ts
  const btn = [...host.querySelectorAll('button')].find((b) => /Templates/.test(b.textContent ?? ''));
  expect(btn).toBeTruthy();
  btn!.click();
  expect(document.querySelector('.wb-template-modal')).toBeTruthy();
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/editor/canvas.test.ts -t Templates` → FAIL.

- [ ] **Step 3: Implement** — add import `import { openTemplateModal } from './templateModal';` and, after `bar.appendChild(group);`:

```ts
  const templates = document.createElement('button');
  templates.className = 'wb-rowview-bar-btn wb-rowview-templates';
  templates.textContent = '▤ Templates…';
  templates.title = 'Start from a pre-built row layout (skeleton, styles, kebab)';
  templates.addEventListener('click', () => openTemplateModal(onToast));
  bar.appendChild(templates);
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/editor/canvas.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/editor/canvas.ts src/editor/canvas.test.ts
git commit -m "feat(canvas): Templates button in the row-view toolbar"
```

---

## Task 9: Modal styles

**Files:**
- Modify: `src/style.css`

- [ ] **Step 1: Add styles** (use the frozen `wb-` prefix; match existing overlay vars like `--wb-text-2`)

```css
/* ── row-view templates modal ─────────────────────────────────────── */
.wb-template-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4);
  display: flex; align-items: center; justify-content: center; z-index: 50; }
.wb-template-modal { display: flex; gap: 0; width: min(960px, 92vw); height: min(620px, 88vh);
  background: var(--wb-surface); border-radius: 8px; overflow: hidden; box-shadow: 0 8px 32px rgba(0,0,0,.3); }
.wb-template-config { width: 360px; padding: 16px; overflow-y: auto; border-right: 1px solid var(--wb-border); }
.wb-template-preview { flex: 1; padding: 16px; overflow-y: auto; background: var(--wb-bg-2); display: flex; flex-direction: column; gap: 6px; }
.wb-template-config .wb-disabled { opacity: .45; pointer-events: none; }
.wb-template-config label { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; font-size: 12px; color: var(--wb-text-2); }
.wb-template-field-chip { display: inline-block; padding: 3px 8px; margin: 2px; border: 1px solid var(--wb-border);
  border-radius: 12px; font-size: 12px; cursor: grab; background: var(--wb-surface); }
.wb-template-area { border: 1px dashed var(--wb-border); border-radius: 6px; padding: 8px; margin-bottom: 8px; }
.wb-template-area.wb-drop-hover { border-color: var(--wb-accent); background: var(--wb-bg-2); }
.wb-template-apply { background: var(--wb-accent); color: #fff; border: none; border-radius: 4px; padding: 8px 16px; cursor: pointer; }
.wb-template-cancel { background: transparent; border: 1px solid var(--wb-border); border-radius: 4px; padding: 8px 16px; cursor: pointer; margin-right: 8px; }
.wb-template-note { font-size: 11px; color: var(--wb-text-2); font-style: italic; }
```

- [ ] **Step 2: Verify build** — `npm run build` → PASS.

- [ ] **Step 3: Commit**

```bash
git add src/style.css
git commit -m "style(templateModal): wb-template-modal styles"
```

---

## Task 10: End-to-end coverage

**Files:**
- Create: `e2e/templates.spec.ts`

- [ ] **Step 1: Write the spec** (model on `e2e/areas.spec.ts`)

```ts
import { test, expect } from '@playwright/test';

test('apply a template, see the preview, and Ctrl+Z reverts in one step', async ({ page }) => {
  await page.goto('/');
  // enter row view, open Templates
  await page.getByRole('button', { name: /Make a row view|Row view/ }).first().click();
  await page.getByRole('button', { name: /Templates/ }).click();
  await expect(page.locator('.wb-template-preview .sp-card-container, .wb-template-preview > div')).toBeVisible();
  // pick card → border control greys with a reason (exclusion is felt)
  await page.locator('[data-field="rowStyle"]').selectOption('card');
  await expect(page.locator('[data-toggle="border"]')).toHaveClass(/wb-disabled/);
  await page.getByRole('button', { name: 'Apply' }).click();
  // one Ctrl+Z reverts the whole replacement
  const before = await page.locator('.wb-canvas').innerHTML();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.wb-canvas')).not.toHaveText(''); // back to grid in one step
});

test('a field can be dragged into an area', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Make a row view|Row view/ }).first().click();
  await page.getByRole('button', { name: /Templates/ }).click();
  await page.locator('.wb-template-field-chip', { hasText: 'Status' })
    .dragTo(page.locator('[data-area="0"]'));
  await expect(page.locator('[data-area="0"] [data-field="areaField"]')).toHaveValue('Status');
});
```

- [ ] **Step 2: Run** (when a browser is available; HANDOFF §7 no-CDN recipe)

Run: `npx playwright test e2e/templates.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 3: Full suite + commit**

```bash
npm run build && npm test
git add e2e/templates.spec.ts
git commit -m "test(e2e): row-view templates apply + single-undo + field drag"
```

---

## Final: verify + PR (CLAUDE.md end-of-session contract)

- [ ] `npm run build` green.
- [ ] `npm test` green (report unit + e2e counts).
- [ ] Playwright suite green when a browser is available.
- [ ] Open a PR to `main` automatically (never merge, never push to `main`). Body: what changed + why, in plain language, plus test counts.

---

## Self-Review

**Spec coverage:** Templates button (T8) · 4 skeletons (T3 `defaultConfigFor`) · config modal + live preview (T6) · stackable styles with conflict model (T1 `composeRowStyle`) · kebab native+custom with positions incl. hover (T2/T3) · refuse blank params (T2 + T5 linter) · field mapping dropdown **and** drag (T6 + T7) · zebra on wrapper (T1/T3) · hover as `--hover` class (T1) · one-undo Apply + viewExtras preserved (T4) · click-safety via `isPureGrid` (T6) · allow-listed styles (T1 test) · areas.ts reuse (T3). Deferred & flagged: `leftStripe:'status'`, faithful 'native' kebab behavior in preview (labeled, not emulated).

**Placeholder scan:** every code step carries real, compilable code against verified signatures (`makeRowView`, `gridCellForField`, `setAreaWeight`/`setRowDensity`, `isPureGrid`, `viewExtras.additionalRowClass`, `CustomRowAction`, `themePalette`/`state.themeMode`, `ALLOWED_STYLES`). The one explicit follow-up — exporting `ctxForRow`/`resolveColumnRef` from `canvas.ts` — is called out in T6 with its location, not left implicit.

**Type consistency:** `RowTemplateConfig`/`KebabConfig`/`ComposedRowStyle` are defined in T1-2 and consumed unchanged in T3/T6/T7; `buildTemplateView` returns `{ root, additionalRowClass? }`, exactly what `applyRowTemplate(root, additionalRowClass?)` (T4) consumes; `AreaWeight`/`RowDensity` are imported from `areas.ts`, never re-declared.
