/**
 * editor/componentLibrary.ts — the COMPONENTS tab of the Left Edit Pane (the
 * teal channel: formatting without a column to call home). First an INVENTORY
 * of the current project, then the add-a-component browser, plus the dialogs
 * around them:
 *
 *   · "In this project" — one card per component in use (built-in or custom):
 *     usage count, live preview, "Show usages" (one jump row per place — a
 *     view instance selects it on the canvas, a column usage opens that
 *     column formatter) and "Add another…". Usage data comes from the pure
 *     componentUsage.ts scan over the instance stamps + field subtype tags.
 *   · "Add components" — Built-in / Yours / Whole rows / Bring your own,
 *     each card a live preview rendered with a best-guess binding against
 *     the CURRENT schema
 *   · the typed mapping dialog — one type-filtered column picker per slot,
 *     prefilled with the best guess; Insert binds + STAMPS the instance
 *     (bindComponentInstance) and lands it as ONE undoable step wherever the
 *     canvas points: the OPEN column formatter when one is active
 *     (componentInsertTarget), else the view (a new root column on the grid)
 *   · "Save as component…" (reached from the element context menu) — derives
 *     typed slots from the fields a subtree references; refuses subtrees
 *     carrying a columnFormatterReference (components are self-contained —
 *     that content lives in the registry; detach from the style first)
 *
 * Persistence: localStorage under COMPONENTS_KEY via the pure components.ts
 * store helpers. Built-ins never persist.
 */

import { state } from './state';
import { renderElement } from '../core/renderer';
import { importJson } from '../core/serializer';
import type { EvalContext } from '../core/expressions';
import type { SPElement, NodePath, MockField } from '../core/types';
import { createOverlay } from './overlay';
import { inlineColumnFormatter, toColumnFormatter } from './cfr';
import { listSubtypes } from './subtypes';
import { openTemplateModal } from './templateModal';
import {
  COMPONENTS_KEY, BUILTIN_COMPONENTS,
  loadComponents, serializeComponents, addComponent, removeComponent,
  bestGuessMapping, mappingComplete, bindComponent, bindComponentInstance,
  deriveSlots, containsCfr, componentId, widenType, componentKind,
  componentFromFormatterDoc, componentInsertTarget,
  type ComponentDef, type ComponentInsertTarget,
} from './components';
import { scanComponentUsages, mainUsageLabel, type ComponentUsage } from './componentUsage';
import { paletteComponents } from './paletteComponents';
import { openComponentEditor } from './componentEditor';

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
 */
const SUBTYPES_MIGRATED_FLAG = 'wb-components.subtypes-migrated.v1';
function migrateCustomSubtypes(): void {
  try {
    if (localStorage.getItem(SUBTYPES_MIGRATED_FLAG)) return;
    const customs = listSubtypes();
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

/** Drag payload for component cards → the canvas (carries the def id). */
export const COMPONENT_MIME = 'application/x-wb-component';

/** Look a component up across every offering: built-ins, the palette
 *  derivations, and the maker's saved customs. */
export function componentById(id: string): ComponentDef | undefined {
  return [...BUILTIN_COMPONENTS, ...paletteComponents(), ...customComponents()]
    .find((d) => d.id === id);
}

/** The typed mapping dialog, openable from outside the library — the canvas
 *  drop path uses it when the best guess can't complete a mapping. */
export function openComponentMapper(def: ComponentDef, onToast: (m: string) => void): void {
  openMappingDialog(def, onToast);
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
    box.appendChild(renderElement(tree, previewCtx(0), {
      resolveColumnRef: () => null, // components are self-contained by contract
    }));
  } catch {
    box.textContent = '—';
  }
  return box;
}

/** A field's display name for copy ("Add to the Due date column formatter"). */
function fieldLabel(name: string): string {
  return state.fields.find((f) => f.name === name)?.displayName ?? name;
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
  // the active column doc's LIVE root wins over its registry copy (they're
  // synced on emit, but the merge keeps the scan honest mid-edit)
  const refs = state.activeDocKey !== 'main'
    ? { ...state.columnRefs, [state.activeDocKey]: state.doc.root }
    : state.columnRefs;
  const usages = scanComponentUsages(allDefs, state.mainRootForScope, refs, state.fields);
  // where would an element insert land right now? (drives every "Add" label)
  const target = componentInsertTarget(state.activeDocKey, state.doc.kind, state.currentFieldName);

  const heading = (title: string, cls: string): void => {
    const head = document.createElement('div');
    head.className = cls;
    head.textContent = title;
    host.appendChild(head);
  };
  const emptyNote = (text: string): void => {
    const none = document.createElement('div');
    none.className = 'wb-complib-empty';
    none.textContent = text;
    host.appendChild(none);
  };
  const section = (title: string, defs: ComponentDef[], empty?: string): void => {
    heading(title, 'wb-complib-group');
    if (!defs.length) {
      if (empty) emptyNote(empty);
      return;
    }
    for (const def of defs) host.appendChild(card(def));
  };

  /** Shared card head: ⬡ + name (+ delete on customs, + count on inventory). */
  const cardTitle = (def: ComponentDef, el: HTMLElement, opts: { del: boolean; count?: number }): void => {
    const title = document.createElement('div');
    title.className = 'wb-comp-title';
    const mark = document.createElement('span');
    mark.className = 'wb-comp-mark';
    mark.textContent = '⬡';
    mark.setAttribute('aria-hidden', 'true');
    const nm = document.createElement('span');
    nm.className = 'wb-comp-name';
    nm.textContent = def.name;
    title.append(mark, nm);
    if (def.variantOf) {
      const vt = document.createElement('span');
      vt.className = 'wb-comp-vtag';
      vt.textContent = 'as-found one-off';
      vt.title = 'A one-off frozen from an older recipe when its usages were pinned "keep as-found"';
      title.appendChild(vt);
    }
    if (opts.count !== undefined) {
      const chip = document.createElement('span');
      chip.className = 'wb-comp-count';
      chip.textContent = `used in ${opts.count} place${opts.count === 1 ? '' : 's'}`;
      title.appendChild(chip);
    }
    if (opts.del && !def.builtin) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'wb-comp-del';
      del.textContent = '✕';
      del.title = `Delete the ${def.name} component`;
      del.setAttribute('aria-label', del.title);
      del.addEventListener('click', () => {
        if (!writeCustom(removeComponent(readCustom(), def.id))) {
          onToast('Could not delete the component — browser storage is blocked, so it would just come back');
          return; // don't rerender a deletion that didn't persist
        }
        rerender();
      });
      title.appendChild(del);
    }
    el.appendChild(title);
  };

  /** The variant lineage line — "a variant card shows its lineage" (guarding
   *  a dangling variantOf: the parent may have been deleted). */
  const lineage = (def: ComponentDef, el: HTMLElement): void => {
    if (!def.variantOf) return;
    const parent = allDefs.find((d) => d.id === def.variantOf);
    const line = document.createElement('div');
    line.className = 'wb-comp-lineage';
    line.textContent = parent
      ? `Kept as-found from “${parent.name}”`
      : 'Kept as-found from a component since deleted';
    el.appendChild(line);
  };

  /** The Edit… action every card gets — opens the component editor over the
   *  canvas pane. Editing a built-in can only ever save as a NEW component. */
  const editButton = (def: ComponentDef): HTMLElement => {
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'wb-comp-edit';
    edit.textContent = 'Edit…';
    edit.title = def.builtin
      ? `Open ${def.name} in the component editor — built-ins can't be overwritten, saving creates your own copy`
      : `Edit ${def.name} — name, slot labels and elements; nothing changes until you save`;
    edit.addEventListener('click', () => openComponentEditor(def, onToast, rerender));
    return edit;
  };

  /** Live preview with the best-guess binding against the current schema. */
  const cardPreview = (def: ComponentDef, el: HTMLElement): void => {
    const guess = bestGuessMapping(def, state.fields);
    if (mappingComplete(def, guess)) {
      el.appendChild(previewBox(bindComponent(def, guess), 'wb-comp-preview'));
    } else {
      const miss = document.createElement('div');
      miss.className = 'wb-complib-empty';
      miss.textContent = 'No preview — your schema has no column of the needed type yet.';
      el.appendChild(miss);
    }
  };

  const addLabel = (def: ComponentDef): string =>
    componentKind(def) === 'row' ? 'Use as the row layout…'
      : target.kind === 'column' ? `Add to the ${fieldLabel(target.field)} column formatter…`
        : 'Add to view…';
  const addTitle = (def: ComponentDef): string =>
    componentKind(def) === 'row'
      ? 'Map your columns into this layout and make it THE row layout for this view (one undoable step)'
      : target.kind === 'column'
        ? `Map your columns into this component and add it to the open ${fieldLabel(target.field)} column formatter`
        : 'Map your columns into this component and add it to the canvas';

  /** A browse card (the "Add components" sections). */
  const card = (def: ComponentDef): HTMLElement => {
    const el = document.createElement('div');
    el.className = 'wb-comp-card';
    // element components are DRAG SOURCES onto the canvas — the palette's
    // signature gesture, generalized to every component (owner, 2026-07-05).
    // Row components stay click-only: replacing the whole view is never a
    // gesture a stray drop should perform.
    if (componentKind(def) === 'element') {
      el.draggable = true;
      el.addEventListener('dragstart', (e) => {
        if (!e.dataTransfer) return;
        e.dataTransfer.setData(COMPONENT_MIME, def.id);
        e.dataTransfer.effectAllowed = 'copy';
      });
    }
    cardTitle(def, el, { del: true });
    lineage(def, el);

    const desc = document.createElement('div');
    desc.className = 'wb-comp-desc';
    desc.textContent = def.description;
    el.appendChild(desc);

    // slot chips: what this component needs from a schema
    const slots = document.createElement('div');
    slots.className = 'wb-comp-slots';
    for (const slot of def.slots) {
      const chip = document.createElement('span');
      chip.className = 'wb-comp-slot';
      chip.textContent = `${slot.label} · ${slotTypesLabel(slot.types)}`;
      chip.title = slot.description ?? `Needs a ${slotTypesLabel(slot.types)} column`;
      slots.appendChild(chip);
    }
    el.appendChild(slots);
    cardPreview(def, el);

    const actions = document.createElement('div');
    actions.className = 'wb-comp-actions';
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'wb-comp-add';
    add.textContent = addLabel(def);
    add.title = addTitle(def);
    add.addEventListener('click', () => openMappingDialog(def, onToast, rerender));
    actions.append(add, editButton(def));
    el.appendChild(actions);

    return el;
  };

  /** An inventory card ("In this project"): count, preview, usages, add.
   *  Deliberately NOT .wb-comp-card — that class stays "a browse card", so a
   *  used component never doubles selectors pointed at its browse entry. */
  const inventoryCard = (def: ComponentDef, inUse: ComponentUsage[]): HTMLElement => {
    const el = document.createElement('div');
    el.className = 'wb-comp-used';
    cardTitle(def, el, { del: false, count: inUse.length });
    lineage(def, el);
    cardPreview(def, el);

    // the usage list: one jump row per place, toggled by "Show usages"
    const list = document.createElement('div');
    list.className = 'wb-comp-usages';
    list.id = `wb-comp-uses-${def.id}`; // aria-controls target for the toggle
    list.hidden = true;
    // main-doc usages normally read "View — X", but the MAIN doc can itself
    // be a column formatter (a JSON-tab import) — then the rows must speak
    // the same column-formatter noun the insert copy does
    const mainIsColumn = state.activeDocKey === 'main' && state.doc.kind === 'column';
    const mainField = fieldLabel(state.currentFieldName);
    for (const u of inUse) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'wb-comp-usage';
      if (u.kind === 'view') {
        row.textContent = mainUsageLabel(u, mainIsColumn, mainField);
        row.title = mainIsColumn
          ? `Jump to this instance in the ${mainField} column formatter`
          : 'Jump to this instance in the view formatter';
        row.addEventListener('click', () => {
          state.openMain(); // no-op when the main doc is already on the canvas
          state.select(u.path);
        });
      } else {
        row.textContent = `${fieldLabel(u.field)} — column formatter`;
        row.title = `Open the ${fieldLabel(u.field)} column formatter`;
        row.addEventListener('click', () => state.openColumnRef(u.field));
      }
      list.appendChild(row);
    }

    const actions = document.createElement('div');
    actions.className = 'wb-comp-actions';
    const show = document.createElement('button');
    show.type = 'button';
    show.className = 'wb-comp-showuses';
    show.textContent = 'Show usages';
    show.title = 'List every place this component is used — click one to jump there';
    show.setAttribute('aria-expanded', 'false');
    show.setAttribute('aria-controls', list.id);
    show.addEventListener('click', () => {
      list.hidden = !list.hidden;
      show.textContent = list.hidden ? 'Show usages' : 'Hide usages';
      show.setAttribute('aria-expanded', String(!list.hidden));
    });
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'wb-comp-addmore';
    add.textContent = 'Add another…';
    add.title = addTitle(def);
    add.addEventListener('click', () => openMappingDialog(def, onToast, rerender));
    actions.append(show, add, editButton(def));
    el.append(actions, list);
    return el;
  };

  // ── the inventory: what this project already uses ─────────────────────────
  // As-found variants nest (indented) under their parent's card when it's
  // shown; a variant whose parent is unused/deleted renders top-level.
  heading('In this project', 'wb-complib-h1');
  const used = allDefs.filter((d) => (usages.get(d.id)?.length ?? 0) > 0);
  if (!used.length) {
    emptyNote('Nothing in use yet — add a component from the sections below and it shows up here.');
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
      host.appendChild(inventoryCard(def, usages.get(def.id)!));
      for (const v of used.filter((x) => parentOf(x)?.id === def.id)) {
        const nested = inventoryCard(v, usages.get(v.id)!);
        nested.classList.add('wb-comp-variantcard');
        host.appendChild(nested);
      }
    }
  }

  // ── the browser: everything addable (used ones simply also appear above) ──
  heading('Add components', 'wb-complib-h1');
  section('Built-in', BUILTIN_COMPONENTS.filter((c) => componentKind(c) === 'element'));
  section('From the palette', fromPalette.filter((c) => componentKind(c) === 'element'));
  section('Yours', customs.filter((c) => componentKind(c) === 'element'),
    'Nothing saved yet — right-click an element and “Save as component…” to package it.');

  // ── the row-scoped siblings: whole-row components + New rowview ───────────
  section('Whole rows', customs.filter((c) => componentKind(c) === 'row'));
  const rowCard = document.createElement('button');
  rowCard.type = 'button';
  rowCard.className = 'wb-comp-rowlink';
  rowCard.innerHTML = '<span class="wb-comp-rowlink-name">▤ New rowview…</span><span class="wb-comp-rowlink-desc">Start the whole row from a pre-built layout; save a row you like as a component (right-click its root) to see it here.</span>';
  rowCard.title = 'Start the whole row from a pre-built layout (the same templates as the View dropdown)';
  rowCard.addEventListener('click', () => openTemplateModal(onToast));
  host.appendChild(rowCard);

  // ── the pnp/List-Formatting bridge: paste any formatter JSON ──────────────
  const importHead = document.createElement('div');
  importHead.className = 'wb-complib-group';
  importHead.textContent = 'Bring your own';
  host.appendChild(importHead);
  const importCard = document.createElement('button');
  importCard.type = 'button';
  importCard.className = 'wb-comp-rowlink';
  importCard.innerHTML = '<span class="wb-comp-rowlink-name">⤓ Import from formatter JSON…</span><span class="wb-comp-rowlink-desc">Paste any column or view formatter — a pnp/List-Formatting sample, a teammate’s copy — and it becomes a mappable component.</span>';
  importCard.title = 'Convert formatter JSON into a component with typed slots';
  importCard.addEventListener('click', () => openImportComponentDialog(() => renderComponentLibrary(host, onToast), onToast));
  host.appendChild(importCard);
}

// ─── the typed mapping dialog (context-aware: view OR open column formatter) ─

function openMappingDialog(def: ComponentDef, onToast: (m: string) => void, onInserted?: () => void): void {
  // where the insert lands is decided by what's OPEN on the canvas — pinned
  // here so the button copy and the insert can never disagree
  const target: ComponentInsertTarget = componentInsertTarget(state.activeDocKey, state.doc.kind, state.currentFieldName);
  const targetLabel = target.kind === 'column' ? fieldLabel(target.field) : '';
  const { overlay, close } = createOverlay('wb-compmap-overlay', () => close());

  const panel = document.createElement('div');
  panel.className = 'wb-compmap';
  overlay.appendChild(panel);

  const head = document.createElement('div');
  head.className = 'wb-compmap-head';
  const title = document.createElement('span');
  title.className = 'wb-compmap-title';
  title.textContent = `Add ${def.name}`;
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
  const preview = document.createElement('div');
  // slots with NO acceptable column at all — "pick one" would be impossible
  const unfillable = def.slots.filter(
    (slot) => !state.fields.some((f) => !f.protected && slot.types.includes(f.type)),
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

  panel.appendChild(preview);
  refreshPreview();

  const foot = document.createElement('div');
  foot.className = 'wb-compmap-foot';
  const isRow = componentKind(def) === 'row';
  const insert = document.createElement('button');
  insert.type = 'button';
  insert.className = 'wb-compmap-insert';
  insert.textContent = isRow ? 'Use as the row layout'
    : target.kind === 'column' ? `Add to the ${targetLabel} column formatter`
      : 'Add to the view';
  insert.disabled = !mappingComplete(def, mapping);
  insert.title = isRow
    ? (target.kind === 'column'
      // honest copy: a row component IS the row layout, so with a column
      // formatter open it still replaces the VIEW's body, not the column
      ? 'This replaces the VIEW\'s row layout (not the open column formatter) — one undoable step'
      : 'Replace this view\'s row layout with the bound component — one undoable step')
    : target.kind === 'column'
      ? `Insert the bound component into the open ${targetLabel} column formatter at the selection — one undoable step`
      : 'Insert the bound component — one undoable step';
  insert.addEventListener('click', () => {
    // bind AND stamp — insertions carry instance provenance for the inventory
    const bound = bindComponentInstance(def, mapping);
    if (isRow) {
      // a row component IS the view body — same apply as a row template
      if (state.activeDocKey !== 'main') state.openMain();
      state.applyRowTemplate(bound, def.additionalRowClass);
      close();
      onInserted?.();
      onToast(`${def.name} is now this view's row layout — Ctrl+Z restores what you had`);
      return;
    }
    if (target.kind === 'column') {
      // into the OPEN column formatter, at the selection like a palette drop —
      // components in column formatters/CFRs are allowed (owner decision):
      // the bound tree references explicit [$Field]s, valid there
      state.insertNode(bound);
      close();
      onInserted?.();
      onToast(`Added ${def.name} to the ${targetLabel} column formatter — Ctrl+Z removes it`);
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
  foot.appendChild(insert);
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
 * from the fields it references and stash it in the library. Refuses subtrees
 * carrying a columnFormatterReference (refuse-and-teach, like the linter).
 */
export function openSaveAsComponent(path: NodePath, onToast: (m: string) => void): void {
  const node = state.nodeAt(path);
  if (!node) return;
  if (containsCfr(node)) {
    onToast('This element renders a shared column formatter (§) — components must be self-contained. Detach from the style first, then save it as a component.');
    return;
  }
  // written inside a column formatter, @currentField IS that column — make the
  // reference explicit so the component is portable
  const inColumn = state.activeDocKey !== 'main' || state.doc.kind === 'column';
  const tree = inColumn ? inlineColumnFormatter(node, state.currentFieldName)
    : JSON.parse(JSON.stringify(node)) as SPElement;
  // the ROOT of an explicit row view is the whole row layout — save it as a
  // row component (applying one replaces a view's body, template-style)
  const isRowRoot = path.length === 0 && state.activeDocKey === 'main' && state.doc.kind === 'row';
  const arc = state.doc.viewExtras?.additionalRowClass;
  openSaveDialog(tree, node._elmName ?? (isRowRoot ? 'My row layout' : 'My component'), onToast,
    isRowRoot ? { kind: 'row', ...(typeof arc === 'string' ? { additionalRowClass: arc } : {}) } : {});
}

/**
 * Package a column's registered format as a component (the surface that
 * swallowed "Save as reusable subtype…"): the recipe is written in
 * @currentField terms in the registry, so it inlines to an explicit reference
 * first and derives its one typed slot from there.
 */
export function openSaveColumnAsComponent(field: MockField, onToast: (m: string) => void): void {
  const formatter = Object.hasOwn(state.columnRefs, field.name) ? state.columnRefs[field.name] : undefined;
  if (!formatter) { onToast('Format this column first, then save it as a component.'); return; }
  openSaveDialog(inlineColumnFormatter(formatter, field.name), `${field.displayName ?? field.name} look`, onToast);
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
    // replace + push: columns wearing this component (tagged by its id via the
    // Format-this-column catalog) re-bake to the new recipe as ONE undo step
    if (existing && componentKind(def) === 'element' && def.slots.length === 1) {
      const key = def.slots[0].key;
      const pushed = state.pushSubtypeUpdate(def.id, () =>
        toColumnFormatter(bindComponent(def, { [key]: key }), key));
      if (pushed > 0) {
        onToast(`Replaced “${name}” and updated the ${pushed} column${pushed === 1 ? '' : 's'} wearing it — one Ctrl+Z reverts them`);
        return;
      }
    }
    onToast(`${existing ? 'Replaced' : 'Saved'} “${name}” ${existing ? 'in' : 'to'} the component library (the ⬡ Components tab)`);
  });
  foot.appendChild(save);
  panel.appendChild(foot);

  document.body.appendChild(overlay);
  nameInput.focus();
  nameInput.select();
}
