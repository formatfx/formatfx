// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * editor/componentLibrary.ts — the COMPONENTS section of the Left Edit Pane
 * (the teal channel: formatting without a column to call home). Mounted
 * ALWAYS below the columns shelf since the Phase-C left-pane rebuild
 * (COLUMNS-COMPONENTS-VIEWS §3.5 — the old COMPONENTS-tab swap mode died
 * with the formatter tablist). First an INVENTORY of the current project,
 * then the add-a-component browser, plus the dialogs around them:
 *
 *   The pane speaks the same INVENTORY language as the Columns and Views
 *   surfaces (owner redesign, 2026-07-05 — "why do we have such a different
 *   looking card list"): compact ⬡ rows in the tree idiom (wb-tree-row), one
 *   per component, with hover actions and a click-to-expand details drawer
 *   (description, slot chips, live preview, usage jump rows, Add). No cards.
 *
 *   · "In this project" — one row per component in use (built-in or custom):
 *     usage-count chip; the drawer lists one jump row per place — a view
 *     instance selects it on the canvas, a column usage jumps to that
 *     column's cell on the grid. Usage data comes from the pure
 *     componentUsage.ts scan over the instance stamps (view docs + looks).
 *   · "Add components" — Built-in / From the palette / Yours / Whole rows /
 *     Bring your own, same rows; previews render in the drawer with a
 *     best-guess binding against the CURRENT schema
 *   · the typed mapping dialog — one type-filtered column picker per slot,
 *     prefilled with the best guess, PLUS the trigger picker ("Where should
 *     this appear?" — issue #204, docs/specs/TRIGGER-MODEL.md §3): inline in
 *     the layout (default), or as a hover/click card opening from a candidate
 *     division (triggerBind.ts generates the robust pattern). Insert binds +
 *     STAMPS the instance (bindComponentInstance) and lands it in the active
 *     view as ONE undoable step (a new root column on the grid). Aimed at a
 *     grid column instead (openComponentMapper's applyToColumn mode) it
 *     APPLIES the component as that column's look —
 *     state.applyComponentToColumn, the one way a column gets formatting.
 *   · "Save as component…" (reached from the element context menu) — derives
 *     typed slots from the fields a subtree references; refuses trees
 *     carrying a columnFormatterReference (components are self-contained —
 *     § left the model, nothing resolves references anymore)
 *
 * Persistence: localStorage under COMPONENTS_KEY via the pure components.ts
 * store helpers. Built-ins never persist.
 */

import { state } from './state';
import { renderElement } from '../core/renderer';
import { importJson } from '../core/serializer';
import type { EvalContext } from '../core/expressions';
import type { SPElement, NodePath, MockField, FieldType } from '../core/types';
import { createOverlay } from './overlay';
import { inlineColumnFormatter } from './lookDialect';
import { gridColumnField, gridCellForField } from './gridScaffold';
import { openTemplateModal } from './templateModal';
import {
  COMPONENTS_KEY, BUILTIN_COMPONENTS,
  loadComponents, serializeComponents, addComponent, removeComponent,
  bestGuessMapping, mappingComplete, bindComponent, bindComponentInstance,
  deriveSlots, containsCfr, componentId, widenType, componentKind,
  componentFromFormatterDoc, componentInsertTarget, uniqueName,
  flattenComponent, componentsEmbedding,
  type ComponentDef,
} from './components';
import { scanComponentUsages, mainUsageLabel, type ComponentUsage } from './componentUsage';
import { paletteComponents } from './paletteComponents';
import { openComponentEditor } from './componentEditor';
import { candidateHostPaths, hostLabel, applyTriggerAt } from './triggerBind';
import { isSectionCollapsed, setSectionCollapsed } from './paneSections';
import { DIRECTIONAL_HINTS } from '../core/schema';

function readCustom(): ComponentDef[] {
  try {
    return loadComponents(localStorage.getItem(COMPONENTS_KEY));
  } catch {
    return [];
  }
}

/**
 * One-time swallow of the retired custom-subtype store: anything a maker
 * saved as a "reusable subtype" (wb-subtypes) becomes a single-slot component
 * — the ONE "yours" concept. The old key is left untouched (it's the maker's
 * data and the rollback path); a flag key stops the migration re-running.
 * The store is read RAW here (the subtype engine is deleted): the same
 * version-1 envelope + per-record shape its loader accepted, nothing more.
 */
const SUBTYPES_MIGRATED_FLAG = 'wb-components.subtypes-migrated.v1';

/** What the migration needs of a stored subtype record. */
interface RetiredSubtype { id: string; name: string; baseTypes: FieldType[]; formatter: SPElement }

function readRetiredSubtypes(): RetiredSubtype[] {
  try {
    const raw = localStorage.getItem('wb-subtypes');
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { version?: unknown; subtypes?: unknown } | null;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.subtypes)) return [];
    // the shape guard subtypes.ts enforced, verbatim — a corrupt record can't
    // poison the migration, and only maker-authored ('custom') records exist
    const isRecord = (s: unknown): s is RetiredSubtype => {
      if (!s || typeof s !== 'object') return false;
      const o = s as Record<string, unknown>;
      const vocab = o.vocab as { refs?: unknown; values?: unknown } | undefined;
      return typeof o.id === 'string'
        && typeof o.name === 'string'
        && o.origin === 'custom'
        && Array.isArray(o.baseTypes) && o.baseTypes.every((t) => typeof t === 'string')
        && !!o.formatter && typeof o.formatter === 'object'
        && Array.isArray(o.knobs) && o.knobs.every((k) => !!k && typeof k === 'object')
        && !!vocab && typeof vocab === 'object'
        && Array.isArray(vocab.refs) && Array.isArray(vocab.values);
    };
    return (parsed.subtypes as unknown[]).filter(isRecord);
  } catch {
    return [];
  }
}

function migrateCustomSubtypes(): void {
  try {
    if (localStorage.getItem(SUBTYPES_MIGRATED_FLAG)) return;
    const customs = readRetiredSubtypes();
    if (customs.length) {
      let list = readCustom();
      for (const st of customs) {
        const id = `c-sub-${st.id}`;
        if (list.some((c) => c.id === id)) continue;
        list = addComponent(list, {
          id,
          name: st.name,
          description: `Migrated from your “${st.name}” subtype.`,
          slots: [{
            key: 'Column',
            label: 'The column to format',
            types: [...new Set(st.baseTypes.flatMap(widenType))],
          }],
          // subtype recipes are written in @currentField terms; a component's
          // tree is written against its slot key
          root: inlineColumnFormatter(st.formatter, 'Column'),
        });
      }
      writeCustom(list);
    }
    localStorage.setItem(SUBTYPES_MIGRATED_FLAG, '1');
  } catch { /* private mode — retry next load */ }
}

/** The maker's saved components (migrating any old custom subtypes first). */
export function customComponents(): ComponentDef[] {
  migrateCustomSubtypes();
  return readCustom();
}

/** Create a new blank component, write it to custom components, open its workshop tab and toast. */
export function createNewComponent(onToast: (m: string) => void): void {
  const taken = [...BUILTIN_COMPONENTS, ...paletteComponents(), ...readCustom()].map((c) => c.name);
  const def: ComponentDef = {
    id: componentId(new Date()),
    // deduped: "Save as component" replaces by NAME, so two blanks must
    // never collide ("New component 2", …)
    name: uniqueName('New component', taken),
    description: 'A blank component — build it in the workshop.',
    slots: [],
    root: { elmType: 'div', _elmName: 'New component', txtContent: 'New component' },
  };
  if (!writeCustom(addComponent(readCustom(), def))) {
    onToast('Could not create the component — browser storage is full or blocked.');
    return;
  }
  state.openComponentTab(def.id); // emits 'data' → the library re-renders
  onToast(`Started “${def.name}” — build it in the workshop and Save when it's ready`);
}

/** Drag payload for component cards → the canvas (carries the def id). */
export const COMPONENT_MIME = 'application/x-wb-component';

/** Every offering: built-ins, the palette derivations, the maker's customs. */
function allOfferings(): ComponentDef[] {
  return [...BUILTIN_COMPONENTS, ...paletteComponents(), ...customComponents()];
}

/** Look a component up across every offering, RESOLVED for use: a def that
 *  embeds other components (#225) arrives inline-flattened — the plain shape
 *  every consumer (mapper, inspector re-binds, drops) already speaks. Plain
 *  defs pass through untouched. The workshop edits the STORED shape instead —
 *  that's rawComponentById. */
export function componentById(id: string): ComponentDef | undefined {
  const all = allOfferings();
  const def = all.find((d) => d.id === id);
  return def && flattenComponent(def, all);
}

/** The stored def as-is, embeds unresolved — what the workshop stages so a
 *  save never bakes the nesting away. Everyone else wants componentById. */
export function rawComponentById(id: string): ComponentDef | undefined {
  return allOfferings().find((d) => d.id === id);
}

/** The typed mapping dialog, openable from outside the library — the canvas
 *  drop path uses it when the best guess can't complete a mapping, and the
 *  grid's column gestures aim it at a column: with `applyToColumn`, the first
 *  slot fitting that column's type is FORCED to it and the insert becomes
 *  state.applyComponentToColumn (the column's look, one undoable step). */
export function openComponentMapper(
  def: ComponentDef,
  onToast: (m: string) => void,
  opts: { applyToColumn?: string } = {},
): void {
  openMappingDialog(def, onToast, undefined, opts);
}

function writeCustom(components: ComponentDef[]): boolean {
  try {
    localStorage.setItem(COMPONENTS_KEY, serializeComponents(components));
    return true;
  } catch {
    return false; // quota/private mode — callers toast
  }
}

function previewCtx(rowIndex: number): EvalContext {
  return {
    row: state.rows[rowIndex] ?? {},
    rowIndex,
    currentFieldName: state.currentFieldName,
    me: state.me,
    iterators: {},
    iteratorIndex: {},
    displayNames: Object.fromEntries(state.fields.map((f) => [f.name, f.displayName ?? f.name])),
    now: new Date(),
  };
}

/** Render `tree` against the first mock row into a preview box ('—' on error). */
function previewBox(tree: SPElement, className: string): HTMLElement {
  const box = document.createElement('div');
  box.className = className;
  try {
    box.appendChild(renderElement(tree, previewCtx(0)));
  } catch {
    box.textContent = '—';
  }
  return box;
}

/** A field's display name for copy ("Apply to the Due date column"). */
function fieldLabel(name: string): string {
  return state.fields.find((f) => f.name === name)?.displayName ?? name;
}

/**
 * The usage JUMP ROWS for a def, shared by the inventory drawer, the def
 * card's count pop-out and the component kebab: a view instance selects it
 * on the canvas, a column usage jumps to that column's cell on the grid.
 * Navigation first uncovers the canvas (a workshop tab may be over it —
 * the tab and its staged edits stay put), then selects. `onNavigate` lets
 * a pop-out host close itself after the jump.
 */
export function usageJumpList(inUse: ComponentUsage[], onNavigate?: () => void): HTMLElement {
  const list = document.createElement('div');
  list.className = 'wb-comp-usages';
  for (const u of inUse) {
    const jump = document.createElement('button');
    jump.type = 'button';
    jump.className = 'wb-comp-usage';
    if (u.kind === 'view') {
      jump.textContent = mainUsageLabel(u);
      jump.title = 'Jump to this instance in the view formatter';
      jump.addEventListener('click', () => {
        state.deactivateComponentTab();
        state.select(u.path);
        onNavigate?.();
      });
    } else {
      jump.textContent = `${fieldLabel(u.field)} — column look`;
      jump.title = `Jump to the ${fieldLabel(u.field)} column on the grid`;
      jump.addEventListener('click', () => {
        // the look renders embedded in the floor's grid cell — select it
        state.deactivateComponentTab();
        if (!state.onFloor) state.minimizeView();
        const i = (state.floorDoc.root.children ?? []).findIndex((c) => gridColumnField(c) === u.field);
        if (i >= 0) state.select([i]);
        onNavigate?.();
      });
    }
    list.appendChild(jump);
  }
  return list;
}

let usagePop: { panel: HTMLElement; cleanup: () => void } | null = null;

export function closeUsagePopout(): void {
  if (!usagePop) return;
  usagePop.cleanup();
  usagePop.panel.remove();
  usagePop = null;
}

/**
 * The where-it's-used POP-OUT, opened by clicking a usage count (the def
 * card's, or an inventory row's chip). Body-owned and position:fixed — the
 * counts live in chrome that re-renders wholesale, so an inline panel would
 * be destroyed by its own navigation. Escape/outside close; a jump closes.
 */
export function openUsagePopout(anchor: HTMLElement, defId: string): void {
  closeUsagePopout();
  const def = componentById(defId);
  if (!def) return;
  const inUse = scanComponentUsages([def], state.doc.root, state.columnLooks).get(def.id) ?? [];

  const panel = document.createElement('div');
  panel.className = 'wb-usage-pop wb-esc-owner';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', `Where ${def.name} is used`);
  const head = document.createElement('div');
  head.className = 'wb-usage-pop-head';
  head.textContent = 'Where it’s used';
  panel.appendChild(head);
  let done = false;
  const close = (): void => { if (!done) { done = true; closeUsagePopout(); } };
  if (inUse.length) {
    panel.appendChild(usageJumpList(inUse, close));
  } else {
    const none = document.createElement('div');
    none.className = 'wb-complib-empty';
    none.textContent = 'Not used anywhere yet.';
    panel.appendChild(none);
  }
  document.body.appendChild(panel);

  const r = anchor.getBoundingClientRect();
  const w = panel.offsetWidth || 240;
  const h = panel.offsetHeight || 120;
  panel.style.top = `${Math.max(8, Math.min(r.bottom + 4, window.innerHeight - h - 8))}px`;
  panel.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;

  const onOutside = (e: PointerEvent): void => {
    if (!panel.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); };
  const armTimer = window.setTimeout(() => document.addEventListener('pointerdown', onOutside), 0);
  document.addEventListener('keydown', onKey);
  const cleanup = (): void => {
    window.clearTimeout(armTimer);
    document.removeEventListener('pointerdown', onOutside);
    document.removeEventListener('keydown', onKey);
  };
  usagePop = { panel, cleanup };
}

/** Human tag for a slot's acceptable types, e.g. "person / multi-person". */
function slotTypesLabel(types: string[]): string {
  const NAMES: Record<string, string> = {
    text: 'text', note: 'multiline', number: 'number', currency: 'currency',
    choice: 'choice', choiceMulti: 'multi-choice', date: 'date',
    person: 'person', personMulti: 'multi-person', boolean: 'yes/no',
    hyperlink: 'hyperlink', lookup: 'lookup', lookupMulti: 'multi-lookup',
  };
  return types.map((t) => NAMES[t] ?? t).join(' / ');
}

// ─── the library list (mounted into the Left Edit Pane's tree region) ────────

/** (Re)render the component library into `host`: the project inventory first
 *  ("In this project"), then the add-a-component browser. */
export function renderComponentLibrary(host: HTMLElement, onToast: (m: string) => void): void {
  host.replaceChildren();
  const rerender = (): void => renderComponentLibrary(host, onToast);

  const customs = customComponents();
  // palette-derived offerings sit beside the built-ins ("the components we
  // offer are built out from the palette" — owner, 2026-07-05); they join
  // allDefs so the usage scan and lineage resolution can see their instances
  const fromPalette = paletteComponents();
  const allDefs = [...BUILTIN_COMPONENTS, ...fromPalette, ...customs];
  const usages = scanComponentUsages(allDefs, state.doc.root, state.columnLooks);

  const heading = (title: string, cls: string, parent: HTMLElement = host): void => {
    const head = document.createElement('div');
    head.className = cls;
    head.textContent = title;
    parent.appendChild(head);
  };
  const emptyNote = (text: string, parent: HTMLElement = host): void => {
    const none = document.createElement('div');
    none.className = 'wb-complib-empty';
    none.textContent = text;
    parent.appendChild(none);
  };
  const section = (title: string, defs: ComponentDef[], empty?: string, parent: HTMLElement = host): void => {
    heading(title, 'wb-complib-group', parent);
    if (!defs.length) {
      if (empty) emptyNote(empty, parent);
      return;
    }
    for (const def of defs) parent.appendChild(componentRow(def));
  };

  // A foldable top-level group ("In this project" / "Add components"): the header
  // is a real <button> that folds its body away — same caret/aria idiom as the
  // pane's outer sections. State persists (paneSections, its own key) and is read
  // fresh each render, so it survives the library's full re-renders. Returns the
  // body element to append the group's content into.
  const foldGroup = (title: string, key: string): HTMLElement => {
    const collapsed = isSectionCollapsed(key);
    const bodyId = `wb-lp-fold-${key.replace(/[^a-z0-9]+/gi, '-')}`;
    const group = document.createElement('div');
    group.className = 'wb-complib-fold';
    group.classList.toggle('wb-collapsed', collapsed);
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'wb-lp-sec-head wb-complib-foldhead';
    head.setAttribute('aria-expanded', String(!collapsed));
    head.setAttribute('aria-controls', bodyId);
    head.title = collapsed ? `Show ${title}` : `Hide ${title}`;
    const caret = document.createElement('span');
    caret.className = 'wb-lp-sec-caret';
    caret.setAttribute('aria-hidden', 'true');
    const titleEl = document.createElement('span');
    titleEl.className = 'wb-lp-sec-title';
    titleEl.textContent = title;
    head.append(caret, titleEl);
    const body = document.createElement('div');
    body.id = bodyId;
    body.className = 'wb-lp-sec-body wb-complib-foldbody';
    head.addEventListener('click', () => {
      const next = !group.classList.contains('wb-collapsed');
      group.classList.toggle('wb-collapsed', next);
      head.setAttribute('aria-expanded', String(!next));
      head.title = next ? `Show ${title}` : `Hide ${title}`;
      setSectionCollapsed(key, next);
    });
    group.append(head, body);
    host.appendChild(group);
    return body;
  };

  const addLabel = (def: ComponentDef): string =>
    componentKind(def) === 'row' ? 'Use as the row layout…' : 'Add to view…';
  const addTitle = (def: ComponentDef): string =>
    componentKind(def) === 'row'
      ? 'Map your columns into this layout and make it THE row layout for this view (one undoable step)'
      : 'Map your columns into this component and add it to the canvas';

  /** Dim hint after the name, tree-style: what the component asks a schema
   *  for ("date · person"), or its scope for row kinds. */
  const rowHint = (def: ComponentDef): string => {
    if (componentKind(def) === 'row') return 'row layout';
    if (!def.slots.length) return '';
    return def.slots.map((s) => slotTypesLabel([s.types[0] ?? 'text'])).join(' · ');
  };

  /**
   * ONE component = ONE row, in the structure tree's language (wb-tree-row:
   * same hover, same reveal-on-hover actions), plus a click-to-expand details
   * drawer (description, slot chips, live preview, usage jump rows, Add).
   * Replaces both old card shapes — cards were the one surface speaking a
   * different visual language than the Columns/Views inventories.
   */
  const componentRow = (def: ComponentDef, inUse?: ComponentUsage[]): HTMLElement => {
    // what the row/drawer DISPLAYS and binds is the resolved (inline-
    // flattened) shape — embedded components' surfaced slots included; the
    // edit/delete actions keep the stored def so nesting survives a save
    const shown = flattenComponent(def, allDefs);
    const node = document.createElement('div');
    node.className = 'wb-comp-node';

    const row = document.createElement('div');
    row.className = 'wb-tree-row wb-comp-row';
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.setAttribute('aria-expanded', 'false');
    row.title = `${def.description} — click for details`;

    const label = document.createElement('span');
    label.className = 'wb-tree-label';
    const mark = document.createElement('span');
    mark.className = 'wb-comp-mark';
    mark.textContent = '⬡';
    mark.setAttribute('aria-hidden', 'true');
    const nm = document.createElement('span');
    nm.className = 'wb-tree-name wb-comp-rowname';
    nm.textContent = def.name;
    label.append(mark, nm);
    if (def.variantOf) {
      const vt = document.createElement('span');
      vt.className = 'wb-comp-vtag';
      vt.textContent = 'as-found';
      vt.title = 'A one-off frozen from an older recipe when its usages were pinned "keep as-found"';
      label.appendChild(vt);
    }
    const hint = rowHint(shown);
    if (hint) {
      const h = document.createElement('span');
      h.className = 'wb-tree-elmtype-dim';
      h.textContent = hint;
      label.appendChild(h);
    }
    row.appendChild(label);

    if (inUse !== undefined) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'wb-comp-count';
      chip.textContent = String(inUse.length);
      chip.title = `Used in ${inUse.length} place${inUse.length === 1 ? '' : 's'} — click to jump to each`;
      chip.setAttribute('aria-label', chip.title);
      chip.setAttribute('aria-haspopup', 'dialog');
      chip.addEventListener('click', (e) => {
        e.stopPropagation(); // never toggle the drawer
        openUsagePopout(chip, def.id);
      });
      row.appendChild(chip);
    }

    // hover actions, exactly the tree's idiom: quick-add, edit, delete
    const actions = document.createElement('span');
    actions.className = 'wb-tree-actions';
    const act = (cls: string, text: string, title: string, fn: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      b.textContent = text;
      b.title = title;
      b.setAttribute('aria-label', title);
      b.addEventListener('click', (e) => {
        e.stopPropagation(); // never toggle the drawer
        fn();
      });
      actions.appendChild(b);
      return b;
    };
    act('wb-comp-rowedit', '✎', def.builtin
      ? `Open ${def.name} in the component editor — built-ins can't be overwritten, saving creates your own copy`
      : `Edit ${def.name} — name, slot labels and elements; nothing changes until you save`,
    () => openComponentEditor(def, onToast, rerender));
    act('wb-comp-rowadd', '＋', addTitle(def), () => openMappingDialog(def, onToast, rerender));
    if (!def.builtin) {
      act('wb-comp-rowdel', '✕', `Delete the ${def.name} component`, () => {
        // blast-radius guard (#225): a def other components EMBED can't be
        // deleted out from under them — refuse and point at the parents
        const embedders = componentsEmbedding(def.id, allDefs);
        if (embedders.length) {
          onToast(`“${def.name}” is embedded inside ${embedders.map((d) => `“${d.name}”`).join(', ')} — remove it there first, then delete it here.`);
          return;
        }
        if (!writeCustom(removeComponent(readCustom(), def.id))) {
          onToast('Could not delete the component — browser storage is blocked, so it would just come back');
          return; // don't rerender a deletion that didn't persist
        }
        rerender();
      });
    }
    row.appendChild(actions);

    // element components are DRAG SOURCES onto the canvas — the palette's
    // signature gesture, generalized to every component (owner, 2026-07-05).
    // Row components stay click-only: replacing the whole view is never a
    // gesture a stray drop should perform.
    if (componentKind(def) === 'element') {
      row.draggable = true;
      row.addEventListener('dragstart', (e) => {
        if (!e.dataTransfer) return;
        e.dataTransfer.setData(COMPONENT_MIME, def.id);
        e.dataTransfer.effectAllowed = 'copy';
      });
    }

    const drawer = detailsDrawer(def, inUse);
    drawer.hidden = true;
    // the same def renders in the inventory AND the browser — suffix keeps
    // the aria-controls target ids unique across the two sections
    drawer.id = `wb-comp-drawer-${def.id}${inUse !== undefined ? '-used' : ''}`;
    row.setAttribute('aria-controls', drawer.id);
    const toggle = (): void => {
      drawer.hidden = !drawer.hidden;
      row.setAttribute('aria-expanded', String(!drawer.hidden));
      row.classList.toggle('wb-comp-row-open', !drawer.hidden);
    };
    row.addEventListener('click', toggle);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    });

    node.append(row, drawer);
    return node;
  };

  /** The expanded row: everything the old card showed, on demand. `def` is
   *  the STORED shape (lineage, edit); slots + preview speak the RESOLVED
   *  one, so an embed-carrying def shows what it really asks for and bakes. */
  const detailsDrawer = (def: ComponentDef, inUse?: ComponentUsage[]): HTMLElement => {
    const shown = flattenComponent(def, allDefs);
    const box = document.createElement('div');
    box.className = 'wb-comp-details';

    if (def.variantOf) {
      const parent = allDefs.find((d) => d.id === def.variantOf);
      const line = document.createElement('div');
      line.className = 'wb-comp-lineage';
      line.textContent = parent
        ? `Kept as-found from “${parent.name}”`
        : 'Kept as-found from a component since deleted';
      box.appendChild(line);
    }

    // nesting lineage (#225), both directions: what this def embeds, and the
    // blast radius — which components embed IT (edits reach their next bakes)
    if (def.embeds?.length) {
      const line = document.createElement('div');
      line.className = 'wb-comp-lineage';
      line.textContent = `Embeds ${def.embeds.map((e) => `“${e.name}”`).join(', ')} — bakes as one flattened formatter`;
      box.appendChild(line);
    }
    const embedders = componentsEmbedding(def.id, allDefs);
    if (embedders.length) {
      const line = document.createElement('div');
      line.className = 'wb-comp-lineage';
      line.textContent = `Used by ${embedders.length} component${embedders.length === 1 ? '' : 's'}: ${embedders.map((d) => `“${d.name}”`).join(', ')}`;
      line.title = 'Editing this component re-bakes them wherever they are used on the canvas, live';
      box.appendChild(line);
    }

    const desc = document.createElement('div');
    desc.className = 'wb-comp-desc';
    desc.textContent = def.description;
    box.appendChild(desc);

    if (shown.slots.length) {
      const slots = document.createElement('div');
      slots.className = 'wb-comp-slots';
      for (const slot of shown.slots) {
        const chip = document.createElement('span');
        chip.className = 'wb-comp-slot';
        chip.textContent = `${slot.label} · ${slotTypesLabel(slot.types)}`;
        chip.title = slot.description ?? `Needs a ${slotTypesLabel(slot.types)} column`;
        slots.appendChild(chip);
      }
      box.appendChild(slots);
    }

    // live preview with the best-guess binding against the current schema
    const guess = bestGuessMapping(shown, state.fields);
    if (mappingComplete(shown, guess)) {
      box.appendChild(previewBox(bindComponent(shown, guess), 'wb-comp-preview'));
    } else {
      const miss = document.createElement('div');
      miss.className = 'wb-complib-empty';
      miss.textContent = 'No preview — your schema has no column of the needed type yet.';
      box.appendChild(miss);
    }

    // usage jump rows (inventory rows only) — the drawer IS the toggle now
    if (inUse?.length) {
      const usesHead = document.createElement('div');
      usesHead.className = 'wb-complib-group';
      usesHead.textContent = 'Where it\'s used';
      box.appendChild(usesHead);
      box.appendChild(usageJumpList(inUse));
    }

    const actions = document.createElement('div');
    actions.className = 'wb-comp-actions';
    const add = document.createElement('button');
    add.type = 'button';
    add.className = inUse !== undefined ? 'wb-comp-addmore' : 'wb-comp-add';
    add.textContent = inUse !== undefined ? 'Add another…' : addLabel(def);
    add.title = addTitle(def);
    add.addEventListener('click', () => openMappingDialog(def, onToast, rerender));
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'wb-comp-edit';
    edit.textContent = 'Edit…';
    edit.title = def.builtin
      ? `Open ${def.name} in the component editor — built-ins can't be overwritten, saving creates your own copy`
      : `Edit ${def.name} — name, slot labels and elements; nothing changes until you save`;
    edit.addEventListener('click', () => openComponentEditor(def, onToast, rerender));
    actions.append(add, edit);
    box.appendChild(actions);
    return box;
  };

  // ── the inventory: what this project already uses ─────────────────────────
  // As-found variants nest (indented) under their parent's card when it's
  // shown; a variant whose parent is unused/deleted renders top-level.
  const projectBody = foldGroup('In this project', 'lib:in-project');
  const used = allDefs.filter((d) => (usages.get(d.id)?.length ?? 0) > 0);
  if (!used.length) {
    emptyNote('Nothing in use yet — add a component from the sections below and it shows up here.', projectBody);
  } else {
    // the display parent is the ROOT (non-variant) ancestor: editing an
    // as-found one-off and pinning again yields a variant-of-a-variant, which
    // still belongs under the original card. The chain is walked through ALL
    // defs (an intermediate needn't be in use), cycle-guarded because lineage
    // comes from localStorage; a broken/dangling chain renders top-level.
    const rootAncestor = (d: ComponentDef): ComponentDef | undefined => {
      let cur: ComponentDef | undefined = d;
      const seen = new Set<string>([d.id]);
      while (cur?.variantOf) {
        cur = allDefs.find((x) => x.id === cur!.variantOf);
        if (!cur || seen.has(cur.id)) return undefined;
        seen.add(cur.id);
      }
      return cur === d ? undefined : cur;
    };
    const parentOf = (d: ComponentDef): ComponentDef | undefined => {
      const root = rootAncestor(d);
      return root && used.some((x) => x.id === root.id) ? root : undefined;
    };
    for (const def of used) {
      if (parentOf(def)) continue; // rendered nested under its parent below
      projectBody.appendChild(componentRow(def, usages.get(def.id)!));
      for (const v of used.filter((x) => parentOf(x)?.id === def.id)) {
        const nested = componentRow(v, usages.get(v.id)!);
        nested.classList.add('wb-comp-variantnode');
        projectBody.appendChild(nested);
      }
    }
  }

  // ── the browser: everything addable (used ones simply also appear above) ──
  const addBody = foldGroup('Add components', 'lib:add');
  section('Built-in', BUILTIN_COMPONENTS.filter((c) => componentKind(c) === 'element'), undefined, addBody);
  section('From the palette', fromPalette.filter((c) => componentKind(c) === 'element'), undefined, addBody);
  section('Yours', customs.filter((c) => componentKind(c) === 'element'),
    'Nothing saved yet — right-click an element and “Save as component…” to package it.', addBody);

  // "＋ New component…" — start from a BLANK def and build it in the workshop
  // (§3.5). The def persists immediately (a workshop tab needs a stored def
  // to stage against); Save in the workshop is where the recipe evolves.
  const newComp = document.createElement('button');
  newComp.type = 'button';
  newComp.className = 'wb-comp-rowlink wb-comp-newdef';
  newComp.innerHTML = '<span class="wb-comp-rowlink-name">＋ New component…</span>';
  newComp.title = 'Start a blank component and open its workshop tab — build its elements there, then Save.';
  newComp.addEventListener('click', () => createNewComponent(onToast));
  addBody.appendChild(newComp);

  // ── the row-scoped siblings: whole-row components + New rowview ───────────
  section('Whole rows', customs.filter((c) => componentKind(c) === 'row'), undefined, addBody);
  const rowCard = document.createElement('button');
  rowCard.type = 'button';
  rowCard.className = 'wb-comp-rowlink';
  rowCard.innerHTML = '<span class="wb-comp-rowlink-name">▤ New rowview…</span>';
  rowCard.title = 'Start the whole row from a pre-built layout (the same templates as the View dropdown); save a row you like as a component (right-click its root) to see it here.';
  rowCard.addEventListener('click', () => openTemplateModal(onToast));
  addBody.appendChild(rowCard);

  // ── the pnp/List-Formatting bridge: paste any formatter JSON ──────────────
  const importHead = document.createElement('div');
  importHead.className = 'wb-complib-group';
  importHead.textContent = 'Bring your own';
  addBody.appendChild(importHead);
  const importCard = document.createElement('button');
  importCard.type = 'button';
  importCard.className = 'wb-comp-rowlink';
  importCard.innerHTML = '<span class="wb-comp-rowlink-name">⤓ Import from formatter JSON…</span>';
  importCard.title = 'Paste any column or view formatter — a pnp/List-Formatting sample, a teammate’s copy — and it becomes a mappable component with typed slots.';
  importCard.addEventListener('click', () => openImportComponentDialog(() => renderComponentLibrary(host, onToast), onToast));
  addBody.appendChild(importCard);
}

/**
 * The ALWAYS-ON mount (§3.5): renderComponentLibrary plus a state
 * subscription, so the inventory counts, look usages and def lists stay live
 * as the project changes. Re-renders keep the maker's place — rows whose
 * drawer was expanded re-expand (matched by the drawer's stable id).
 */
export function mountComponentLibrary(host: HTMLElement, onToast: (m: string) => void): void {
  const render = (): void => {
    const open = new Set(
      [...host.querySelectorAll<HTMLElement>('.wb-comp-row[aria-expanded="true"]')]
        .map((r) => r.getAttribute('aria-controls') ?? ''),
    );
    renderComponentLibrary(host, onToast);
    if (!open.size) return;
    for (const row of host.querySelectorAll<HTMLElement>('.wb-comp-row')) {
      if (open.has(row.getAttribute('aria-controls') ?? '')) row.click(); // re-expand
    }
  };
  const hostAny = host as unknown as { _unsub?: () => void };
  hostAny._unsub?.();
  hostAny._unsub = state.subscribe((reason) => {
    // 'data' = defs/looks/tabs/schema, 'document' = instance edits (usage
    // counts), 'load'/'kind' = another surface's inventory
    if (reason === 'data' || reason === 'document' || reason === 'load' || reason === 'kind') render();
  });
  render();
}

/**
 * The drop-target gesture of TRIGGER-MODEL §3, in its click-safe form: hide
 * the dialog, highlight every candidate division ON THE CANVAS (each rendered
 * copy — one per mock row), and let the maker point at the one the card
 * should open from. Esc returns unchanged; clicks anywhere else do nothing
 * (misclick-resistant per house rules). Capture-phase listeners so Select
 * mode's click-to-select and the overlay's own Esc handling never fire
 * underneath the pick.
 */
function beginHostPick(hostPaths: NodePath[], done: (idx: number | null) => void): void {
  const canvas = document.getElementById('wb-canvas');
  const wanted = new Map(hostPaths.map((p, i) => [p.join('.'), i]));
  const marked: HTMLElement[] = [];
  canvas?.querySelectorAll<HTMLElement>('[data-sp-path]').forEach((el) => {
    // the selector guarantees the attribute exists ('' is the ROOT — a real key)
    const key = el.dataset.spPath;
    if (key !== undefined && wanted.has(key)) {
      el.classList.add('wb-trigger-candidate');
      marked.push(el);
    }
  });
  const cleanup = (): void => {
    marked.forEach((el) => el.classList.remove('wb-trigger-candidate'));
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
  };
  const finish = (idx: number | null): void => {
    cleanup();
    done(idx);
  };
  const onClick = (e: MouseEvent): void => {
    // picking is modal: EVERY click is swallowed so a stray one can't fall
    // through to click-to-select (or any other handler) underneath — only a
    // candidate ends the pick, only Esc cancels it
    e.preventDefault();
    e.stopPropagation();
    const t = (e.target as HTMLElement).closest?.('.wb-trigger-candidate') as HTMLElement | null;
    if (!t) return;
    const key = t.dataset.spPath;
    finish(key !== undefined ? wanted.get(key) ?? null : null);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    finish(null);
  };
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
}

// ─── the typed mapping dialog (add to the view, or apply to a column) ────────

function openMappingDialog(
  def: ComponentDef,
  onToast: (m: string) => void,
  onInserted?: () => void,
  opts: { applyToColumn?: string } = {},
): void {
  // resolve nesting FIRST (#225): everything below — slots, previews, the
  // insert — speaks the inline-flattened shape, so what the maker maps is
  // exactly what bakes. Plain defs pass through untouched (identity), and
  // flatten is idempotent, so an already-resolved def is safe to re-enter.
  def = flattenComponent(def, allOfferings());
  // where the insert lands is decided by what's OPEN on the canvas — pinned
  // here so the button copy and the insert can never disagree
  const target = componentInsertTarget(state.doc.kind);
  // apply-to-column mode (grid header menu / column drop): the insert doesn't
  // land in the view — the bound instance becomes the column's LOOK
  const applyField: MockField | null = opts.applyToColumn
    ? state.fields.find((f) => f.name === opts.applyToColumn) ?? null
    : null;
  if (opts.applyToColumn && !applyField) return; // schema changed underneath — nothing to aim at
  const applyLabel = applyField ? fieldLabel(applyField.name) : '';
  // a look must render the column it's applied to: the FIRST slot whose types
  // fit the column is forced to it (rows can't be looks — they're a layout)
  const forcedSlot = applyField && componentKind(def) === 'element'
    ? def.slots.find((s) => s.types.includes(applyField.type)) ?? null
    : null;
  const { overlay, close } = createOverlay('wb-compmap-overlay', () => close());

  const panel = document.createElement('div');
  panel.className = 'wb-compmap';
  overlay.appendChild(panel);

  const head = document.createElement('div');
  head.className = 'wb-compmap-head';
  const title = document.createElement('span');
  title.className = 'wb-compmap-title';
  title.textContent = applyField ? `Apply ${def.name} to ${applyLabel}` : `Add ${def.name}`;
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'wb-compmap-close';
  closeBtn.textContent = '✕';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.addEventListener('click', () => close());
  head.append(title, closeBtn);
  panel.appendChild(head);

  const note = document.createElement('div');
  note.className = 'wb-compmap-note';
  note.textContent = 'Map your columns into the component — each picker lists only the columns whose type fits.';
  panel.appendChild(note);

  const mapping = bestGuessMapping(def, state.fields);
  if (forcedSlot && applyField) mapping[forcedSlot.key] = applyField.name;
  const preview = document.createElement('div');
  // slots with NO acceptable column at all — "pick one" would be impossible
  // (the forced slot is filled by the column itself, so it never counts)
  const unfillable = def.slots.filter(
    (slot) => slot !== forcedSlot
      && !state.fields.some((f) => !f.protected && slot.types.includes(f.type)),
  );

  const refreshPreview = (): void => {
    preview.replaceChildren();
    if (mappingComplete(def, mapping)) {
      preview.appendChild(previewBox(bindComponent(def, mapping), 'wb-comp-preview'));
    } else {
      const miss = document.createElement('div');
      miss.className = 'wb-complib-empty';
      miss.textContent = unfillable.length
        ? `Your schema has no ${unfillable.map((s) => slotTypesLabel(s.types)).join(' or ')} column yet — add one in the Data tab to use this component.`
        : 'Pick a column for every slot to preview.';
      preview.appendChild(miss);
    }
  };

  for (const slot of def.slots) {
    const row = document.createElement('label');
    row.className = 'wb-compmap-row';
    const lab = document.createElement('span');
    lab.className = 'wb-compmap-label';
    lab.textContent = slot.label;
    lab.title = slot.description ?? '';
    const sel = document.createElement('select');
    sel.className = 'wb-compmap-select';
    sel.dataset.slot = slot.key;
    if (slot === forcedSlot && applyField) {
      // the slot the component is being applied THROUGH — pinned to the
      // column, not a choice (the other slots stay free)
      const opt = document.createElement('option');
      opt.value = applyField.name;
      opt.textContent = `${applyLabel} — ${slotTypesLabel([applyField.type])}`;
      sel.appendChild(opt);
      sel.value = applyField.name;
      sel.disabled = true;
      sel.title = `This slot is the ${applyLabel} column — the component is being applied to it`;
      row.append(lab, sel);
      panel.appendChild(row);
      continue;
    }
    const candidates = state.fields.filter((f) => !f.protected && slot.types.includes(f.type));
    if (!candidates.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = `— no ${slotTypesLabel(slot.types)} column in your schema —`;
      sel.appendChild(opt);
      sel.disabled = true;
    }
    for (const f of candidates) {
      const opt = document.createElement('option');
      opt.value = f.name;
      opt.textContent = `${f.displayName ?? f.name} — ${slotTypesLabel([f.type])}`;
      sel.appendChild(opt);
    }
    sel.value = mapping[slot.key] ?? '';
    sel.addEventListener('change', () => {
      mapping[slot.key] = sel.value;
      refreshPreview();
      insert.disabled = !mappingComplete(def, mapping);
    });
    row.append(lab, sel);
    panel.appendChild(row);
  }

  // ── "Where should this appear?" — the trigger picker (issue #204) ─────────
  // A component stays trigger-agnostic content; applying binds it to a host
  // division + event (TRIGGER-MODEL §2-3). Default = the plain inline insert,
  // so a no-trigger apply stays exactly one click. Element inserts only: a row
  // component IS the row layout, and a column APPLY is always inline — the
  // look lives in the cell, there is nothing to trigger.
  const isRow = componentKind(def) === 'row';
  // candidates come from whatever is on the canvas — the same doc the inline
  // branches write to, so the two paths can never disagree about the target
  const hosts = isRow || applyField ? [] : candidateHostPaths(state.doc.root);
  type AppearMode = 'inline' | 'hover-card' | 'click-card';
  let appear: AppearMode = 'inline';
  let hostIdx = 0;
  let cardHint = 'bottomCenter';

  const inlineLabel = 'In the layout — add to the view';

  const whereRow = document.createElement('label');
  whereRow.className = 'wb-compmap-row';
  const whereLab = document.createElement('span');
  whereLab.className = 'wb-compmap-label';
  whereLab.textContent = 'Where should this appear?';
  const whereSel = document.createElement('select');
  whereSel.className = 'wb-compmap-select';
  whereSel.dataset.role = 'appear';
  const whereOpt = (value: AppearMode, text: string, disabled = false): void => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = text;
    o.disabled = disabled;
    whereSel.appendChild(o);
  };
  whereOpt('inline', inlineLabel);
  whereOpt('hover-card', 'As a hover card — opens from an element you pick', !hosts.length);
  whereOpt('click-card', 'As a click card — opens from an element you pick', !hosts.length);
  whereRow.append(whereLab, whereSel);

  // host + placement rows, shown only in card modes
  const hostRow = document.createElement('label');
  hostRow.className = 'wb-compmap-row';
  hostRow.hidden = true;
  const hostLab = document.createElement('span');
  hostLab.className = 'wb-compmap-label';
  hostLab.textContent = 'Opens from';
  const hostSel = document.createElement('select');
  hostSel.className = 'wb-compmap-select';
  hostSel.dataset.role = 'host';
  hosts.forEach((p, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = hostLabel(state.doc.root, p);
    hostSel.appendChild(o);
  });
  hostSel.addEventListener('change', () => { hostIdx = Number(hostSel.value) || 0; });
  // the drop-target gesture (TRIGGER-MODEL §3): point at the host on the
  // canvas itself — candidates highlight, a click picks, Esc comes back
  const pickBtn = document.createElement('button');
  pickBtn.type = 'button';
  pickBtn.className = 'wb-compmap-pick';
  pickBtn.textContent = '🎯 Point at it…';
  pickBtn.title = 'Hide this dialog and highlight every element that can host the card on the canvas — click one to choose it, Esc to come back unchanged';
  pickBtn.addEventListener('click', (e) => {
    e.preventDefault(); // lives inside a <label> — don't poke the select
    overlay.style.display = 'none';
    beginHostPick(hosts, (idx) => {
      overlay.style.display = '';
      if (idx !== null) {
        hostIdx = idx;
        hostSel.value = String(idx);
      }
    });
  });
  hostRow.append(hostLab, hostSel, pickBtn);

  const hintRow = document.createElement('label');
  hintRow.className = 'wb-compmap-row';
  hintRow.hidden = true;
  const hintLab = document.createElement('span');
  hintLab.className = 'wb-compmap-label';
  hintLab.textContent = 'Card position';
  const hintSel = document.createElement('select');
  hintSel.className = 'wb-compmap-select';
  hintSel.dataset.role = 'hint';
  for (const h of DIRECTIONAL_HINTS) {
    const o = document.createElement('option');
    o.value = h;
    o.textContent = h;
    hintSel.appendChild(o);
  }
  hintSel.value = cardHint;
  hintSel.addEventListener('change', () => { cardHint = hintSel.value; });
  hintRow.append(hintLab, hintSel);

  let showBeak = true;
  const beakRow = document.createElement('label');
  beakRow.className = 'wb-compmap-row';
  beakRow.hidden = true;
  const beakLab = document.createElement('span');
  beakLab.className = 'wb-compmap-label';
  beakLab.textContent = 'Pointer beak';
  const beakBox = document.createElement('input');
  beakBox.type = 'checkbox';
  beakBox.checked = showBeak;
  beakBox.dataset.role = 'beak';
  beakBox.title = 'Show the little arrow pointing from the card back at its trigger (isBeakVisible)';
  beakBox.addEventListener('change', () => { showBeak = beakBox.checked; });
  beakRow.append(beakLab, beakBox);

  const fine = document.createElement('div');
  fine.className = 'wb-compmap-note wb-compmap-fine';
  fine.hidden = true;
  fine.textContent = 'Only elements without another card or action anywhere inside them are offered — '
    + 'triggers never collide. Click cards get a full-surface overlay button, so child elements '
    + 'can\'t swallow the click; hover-reveal classes on the same element compose fine.';

  if (!isRow && !applyField) {
    panel.append(whereRow, hostRow, hintRow, beakRow, fine);
    if (!hosts.length) {
      whereSel.disabled = true;
      whereRow.title = 'No element on the canvas can host a card yet — it needs a container with children and no existing card or action inside.';
    }
  }

  panel.appendChild(preview);
  refreshPreview();

  const foot = document.createElement('div');
  foot.className = 'wb-compmap-foot';
  const insert = document.createElement('button');
  insert.type = 'button';
  insert.className = 'wb-compmap-insert';
  const inlineButtonText = applyField ? `Apply to the ${applyLabel} column`
    : isRow ? 'Use as the row layout'
      : 'Add to the view';
  const refreshAppear = (): void => {
    const card = appear !== 'inline';
    hostRow.hidden = !card;
    hintRow.hidden = !card;
    beakRow.hidden = !card;
    fine.hidden = !card;
    insert.textContent = !card ? inlineButtonText
      : appear === 'hover-card' ? 'Attach as a hover card' : 'Attach as a click card';
  };
  whereSel.addEventListener('change', () => {
    appear = whereSel.value as AppearMode;
    refreshAppear();
  });
  refreshAppear();
  insert.disabled = !mappingComplete(def, mapping);
  insert.title = applyField
    ? `Bake the mapped component and make it the ${applyLabel} column's look — one undoable step`
    : isRow
      ? 'Replace this view\'s row layout with the bound component — one undoable step'
      : 'Insert the bound component — one undoable step';
  insert.addEventListener('click', () => {
    if (applyField) {
      // the column-apply gesture: bake + store the look + rewrite the placed
      // grid cell, ONE undoable step inside state
      state.applyComponentToColumn(applyField.name, def, mapping);
      close();
      onInserted?.();
      onToast(`${def.name} is now the ${applyLabel} column's look — Ctrl+Z undoes`);
      return;
    }
    // bind AND stamp — insertions carry instance provenance for the inventory
    const bound = bindComponentInstance(def, mapping);
    if (isRow) {
      // a row component IS the view body — same apply as a row template
      state.applyRowTemplate(bound, def.additionalRowClass);
      close();
      onInserted?.();
      onToast(`${def.name} is now this view's row layout — Ctrl+Z restores what you had`);
      return;
    }
    if (appear !== 'inline') {
      // content meets trigger (issue #204): overlay + card props + component
      // land together as ONE undoable mutation, and the trigger carrier gets
      // selected so the inspector opens on it
      const hostPath = hosts[hostIdx];
      const where = hostLabel(state.doc.root, hostPath);
      let at: NodePath | null = null;
      state.mutateDocument(() => {
        at = applyTriggerAt(state.doc.root, hostPath, {
          action: 'card',
          event: appear === 'hover-card' ? 'hover' : 'click',
          directionalHint: cardHint,
          isBeakVisible: showBeak,
          cursor: 'pointer',
          label: `Open the ${def.name} card`,
        }, bound);
      });
      if (!at) {
        onToast('Could not attach the card there — the element seems to have changed. Reopen the dialog and pick again.');
        return;
      }
      state.select(at);
      close();
      onInserted?.();
      onToast(`${def.name} now opens as a ${appear === 'hover-card' ? 'hover' : 'click'} card from ${where} — Ctrl+Z undoes it`);
      return;
    }
    // on the grid, root children ARE the view columns — arrive as a new one;
    // elsewhere insert at the selection like a palette drop
    const at = target.grid ? [] : undefined;
    state.insertNode(bound, at as NodePath | undefined);
    close();
    onInserted?.();
    onToast(`Added ${def.name}${target.grid ? ' as a new grid column' : ''} — Ctrl+Z removes it`);
  });
  if (applyField && !forcedSlot) {
    // refuse and teach: nothing in this component can render the column
    const no = document.createElement('div');
    no.className = 'wb-complib-empty';
    no.textContent = componentKind(def) === 'row'
      ? `${def.name} is a whole-row layout — it can't be a single column's look. Use it from the view side instead (“Use as the row layout…”).`
      : `${def.name} has no slot that takes a ${slotTypesLabel([applyField.type])} column, so it can't become the ${applyLabel} column's look. Pick a component with a ${slotTypesLabel([applyField.type])} slot.`;
    foot.appendChild(no);
  } else {
    foot.appendChild(insert);
  }
  panel.appendChild(foot);

  document.body.appendChild(overlay);
}

// ─── "Import from formatter JSON…" (the pnp/List-Formatting bridge) ──────────

function openImportComponentDialog(onSaved: () => void, onToast: (m: string) => void): void {
  const { overlay, close } = createOverlay('wb-compmap-overlay', () => close());
  const panel = document.createElement('div');
  panel.className = 'wb-compmap';
  overlay.appendChild(panel);

  const head = document.createElement('div');
  head.className = 'wb-compmap-head';
  const title = document.createElement('span');
  title.className = 'wb-compmap-title';
  title.textContent = 'Import a component from formatter JSON';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'wb-compmap-close';
  closeBtn.textContent = '✕';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.addEventListener('click', () => close());
  head.append(title, closeBtn);
  panel.appendChild(head);

  const note = document.createElement('div');
  note.className = 'wb-compmap-note';
  note.textContent = 'Paste a column formatter or a view (row) formatter — e.g. a pnp/List-Formatting sample. Its column references become typed slots you map to YOUR columns when you use it.';
  panel.appendChild(note);

  const nameRow = document.createElement('label');
  nameRow.className = 'wb-compmap-row';
  const nameLab = document.createElement('span');
  nameLab.className = 'wb-compmap-label';
  nameLab.textContent = 'Name';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'wb-compmap-name';
  nameInput.value = 'Imported component';
  nameRow.append(nameLab, nameInput);
  panel.appendChild(nameRow);

  const jsonBox = document.createElement('textarea');
  jsonBox.className = 'wb-compmap-json';
  jsonBox.placeholder = 'Paste the formatter JSON here…';
  jsonBox.setAttribute('aria-label', 'Formatter JSON to import');
  jsonBox.rows = 10;
  panel.appendChild(jsonBox);

  const err = document.createElement('div');
  err.className = 'wb-compmap-error';
  err.hidden = true;
  panel.appendChild(err);

  const foot = document.createElement('div');
  foot.className = 'wb-compmap-foot';
  const doImport = document.createElement('button');
  doImport.type = 'button';
  doImport.className = 'wb-compmap-insert';
  doImport.textContent = 'Import to the library';
  doImport.addEventListener('click', () => {
    err.hidden = true;
    try {
      const doc = importJson(jsonBox.value);
      const name = nameInput.value.trim() || 'Imported component';
      const def = componentFromFormatterDoc(doc, name, state.fields, componentId(new Date()));
      if (!writeCustom(addComponent(readCustom(), def))) {
        throw new Error('Could not save — browser storage is full or blocked.');
      }
      close();
      onSaved();
      onToast(`Imported “${name}” — ${componentKind(def) === 'row' ? 'a whole-row layout' : 'an element component'} with ${def.slots.length} slot${def.slots.length === 1 ? '' : 's'}`);
    } catch (e) {
      // refuse-and-teach: the serializer/converter errors explain themselves
      err.textContent = (e as Error).message;
      err.hidden = false;
    }
  });
  foot.appendChild(doImport);
  panel.appendChild(foot);

  document.body.appendChild(overlay);
  jsonBox.focus();
}

// ─── "Save as component…" (element context menu) ─────────────────────────────

/**
 * Package the subtree at `path` as a reusable component: derive typed slots
 * from the fields it references and stash it in the library. Refuses trees
 * carrying a raw columnFormatterReference key (a foreign paste — nothing in
 * this workspace resolves references anymore; refuse-and-teach).
 */
export function openSaveAsComponent(path: NodePath, onToast: (m: string) => void): void {
  const node = state.nodeAt(path);
  if (!node) return;
  if (containsCfr(node)) {
    onToast('This element references another column\'s formatter (columnFormatterReference) — components must be self-contained. Inline that content first, then save it as a component.');
    return;
  }
  const tree = JSON.parse(JSON.stringify(node)) as SPElement;
  // the ROOT of an explicit row view is the whole row layout — save it as a
  // row component (applying one replaces a view's body, template-style)
  const isRowRoot = path.length === 0 && state.doc.kind === 'row';
  const arc = state.doc.viewExtras?.additionalRowClass;
  openSaveDialog(tree, node._elmName ?? (isRowRoot ? 'My row layout' : 'My component'), onToast,
    isRowRoot ? { kind: 'row', ...(typeof arc === 'string' ? { additionalRowClass: arc } : {}) } : {});
}

/**
 * Package a column's LOOK as a component: the stored tree is already in
 * explicit-[$Field] dialect, so its typed slots derive straight from it.
 * This is the one-gesture lift for IMPORTED (unstamped) looks — they aren't
 * silently editable, but saving one as a component makes it a def you can
 * edit and re-apply (refuse-and-teach).
 */
export function openSaveColumnAsComponent(field: MockField, onToast: (m: string) => void): void {
  const look = Object.hasOwn(state.columnLooks, field.name) ? state.columnLooks[field.name] : undefined;
  if (!look) { onToast('This column has no look yet — apply a component to it first, then save that as your own.'); return; }
  const tree = JSON.parse(JSON.stringify(look)) as SPElement;
  delete tree._component; // the def stands on its own — stamps belong to instances
  openSaveDialog(tree, `${field.displayName ?? field.name} look`, onToast);
}

/** The shared save dialog: name it, see its derived slots and preview, save.
 *  Saving over an existing name REPLACES that component and, for a single-slot
 *  element component, pushes the new recipe to every column wearing it. */
function openSaveDialog(
  tree: SPElement,
  defaultName: string,
  onToast: (m: string) => void,
  opts: { kind?: 'row'; additionalRowClass?: string } = {},
): void {
  const slots = deriveSlots(tree, state.fields);

  const { overlay, close } = createOverlay('wb-compmap-overlay', () => close());
  const panel = document.createElement('div');
  panel.className = 'wb-compmap';
  overlay.appendChild(panel);

  const head = document.createElement('div');
  head.className = 'wb-compmap-head';
  const title = document.createElement('span');
  title.className = 'wb-compmap-title';
  title.textContent = 'Save as component';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'wb-compmap-close';
  closeBtn.textContent = '✕';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.addEventListener('click', () => close());
  head.append(title, closeBtn);
  panel.appendChild(head);

  const note = document.createElement('div');
  note.className = 'wb-compmap-note';
  note.textContent = opts.kind === 'row'
    ? 'This saves the WHOLE row layout as a component — using it later replaces a view\'s body (one undoable step), with your columns mapped into these slots:'
    : slots.length
      ? 'A component is formatting without a column to call home — anyone adding it maps their own columns into these slots:'
      : 'A component is formatting without a column to call home. This one references no columns, so it will drop in anywhere as-is.';
  panel.appendChild(note);

  if (slots.length) {
    const list = document.createElement('div');
    list.className = 'wb-comp-slots';
    for (const slot of slots) {
      const chip = document.createElement('span');
      chip.className = 'wb-comp-slot';
      chip.textContent = `${slot.key} · ${slotTypesLabel(slot.types)}`;
      list.appendChild(chip);
    }
    panel.appendChild(list);
  }

  panel.appendChild(previewBox(tree, 'wb-comp-preview'));

  const row = document.createElement('label');
  row.className = 'wb-compmap-row';
  const lab = document.createElement('span');
  lab.className = 'wb-compmap-label';
  lab.textContent = 'Name';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'wb-compmap-name';
  nameInput.value = defaultName;
  row.append(lab, nameInput);
  panel.appendChild(row);

  const foot = document.createElement('div');
  foot.className = 'wb-compmap-foot';
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'wb-compmap-insert';
  save.textContent = 'Save to the library';
  save.addEventListener('click', () => {
    // a cleared Name falls back to the dialog's own default ("My row layout"
    // for a row save), never a generic that mislabels the kind
    const name = nameInput.value.trim() || defaultName;
    // saving over an existing name replaces it (keeps its identity, so
    // columns wearing it can be re-baked below)
    const existing = readCustom().find((c) => c.name.toLowerCase() === name.toLowerCase());
    const def: ComponentDef = {
      id: existing?.id ?? componentId(new Date()),
      name,
      description: opts.kind === 'row'
        ? 'Saved from this workspace — a whole-row layout.'
        : slots.length
          ? `Saved from this workspace — maps ${slots.map((s) => slotTypesLabel(s.types)).join(', ')}.`
          : 'Saved from this workspace.',
      slots,
      root: tree,
      ...(opts.kind === 'row' ? { kind: 'row' as const } : {}),
      ...(opts.additionalRowClass ? { additionalRowClass: opts.additionalRowClass } : {}),
    };
    const base = existing ? removeComponent(readCustom(), existing.id) : readCustom();
    if (!writeCustom(addComponent(base, def))) {
      onToast('Could not save the component — browser storage is full or blocked');
      return;
    }
    close();
    // replace + push: columns WEARING this component (their look's root stamp
    // carries its id) re-bake to the new recipe — the look store and every
    // placed floor cell rewrite together as ONE undoable step
    if (existing && componentKind(def) === 'element') {
      const wearing = Object.entries(state.columnLooks)
        .filter(([, look]) => look._component?.id === def.id);
      if (wearing.length) {
        state.mutateDocument(() => {
          for (const [fieldName, look] of wearing) {
            state.columnLooks[fieldName] = bindComponentInstance(def, look._component!.map);
            const f = state.fields.find((x) => x.name === fieldName);
            const children = state.floorDoc.root.children;
            const i = children?.findIndex((c) => gridColumnField(c) === fieldName) ?? -1;
            if (f && children && i >= 0) children[i] = gridCellForField(f, state.columnLooks);
          }
        });
        state.emit('data'); // look changes show up in pickers/tree/inventory
        onToast(`Replaced “${name}” and re-baked the ${wearing.length} column${wearing.length === 1 ? '' : 's'} wearing it — one Ctrl+Z reverts them`);
        return;
      }
    }
    // the library is a standing pane now (no tab remount to re-scan it) —
    // tell it the offering changed so the new def shows up immediately
    state.emit('data');
    onToast(`${existing ? 'Replaced' : 'Saved'} “${name}” ${existing ? 'in' : 'to'} the component library (the ⬡ Components tab)`);
  });
  foot.appendChild(save);
  panel.appendChild(foot);

  document.body.appendChild(overlay);
  nameInput.focus();
  nameInput.select();
}
