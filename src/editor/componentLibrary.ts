/**
 * editor/componentLibrary.ts — the COMPONENTS tab of the Left Edit Pane (the
 * teal channel: formatting without a column to call home) and the two dialogs
 * around it:
 *
 *   · the library list — built-ins + "Yours", each card a live preview
 *     rendered with a best-guess binding against the CURRENT schema
 *   · "Add to view…" — the typed mapping dialog: one type-filtered column
 *     picker per slot, prefilled with the best guess; Insert binds the
 *     component ([$SlotKey] → [$YourColumn]) and inserts it as ONE undoable
 *     step (a new grid column on the grid; at the selection elsewhere)
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
import type { EvalContext } from '../core/expressions';
import type { SPElement, NodePath, MockField } from '../core/types';
import { createOverlay } from './overlay';
import { inlineColumnFormatter } from './cfr';
import { listSubtypes } from './subtypes';
import { openTemplateModal } from './templateModal';
import {
  COMPONENTS_KEY, BUILTIN_COMPONENTS,
  loadComponents, serializeComponents, addComponent, removeComponent,
  bestGuessMapping, mappingComplete, bindComponent, deriveSlots, containsCfr,
  componentId, widenType,
  type ComponentDef,
} from './components';

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

/** (Re)render the component library into `host`. */
export function renderComponentLibrary(host: HTMLElement, onToast: (m: string) => void): void {
  host.replaceChildren();

  const section = (title: string, defs: ComponentDef[], empty?: string): void => {
    const head = document.createElement('div');
    head.className = 'wb-complib-group';
    head.textContent = title;
    host.appendChild(head);
    if (!defs.length) {
      if (empty) {
        const none = document.createElement('div');
        none.className = 'wb-complib-empty';
        none.textContent = empty;
        host.appendChild(none);
      }
      return;
    }
    for (const def of defs) host.appendChild(card(def));
  };

  const card = (def: ComponentDef): HTMLElement => {
    const el = document.createElement('div');
    el.className = 'wb-comp-card';

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
    if (!def.builtin) {
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
        renderComponentLibrary(host, onToast);
      });
      title.appendChild(del);
    }
    el.appendChild(title);

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

    // live preview with the best-guess binding against the current schema
    const guess = bestGuessMapping(def, state.fields);
    if (mappingComplete(def, guess)) {
      el.appendChild(previewBox(bindComponent(def, guess), 'wb-comp-preview'));
    } else {
      const miss = document.createElement('div');
      miss.className = 'wb-complib-empty';
      miss.textContent = 'No preview — your schema has no column of the needed type yet.';
      el.appendChild(miss);
    }

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'wb-comp-add';
    add.textContent = 'Add to view…';
    add.title = 'Map your columns into this component and add it to the canvas';
    add.addEventListener('click', () => openMappingDialog(def, onToast));
    el.appendChild(add);

    return el;
  };

  section('Built-in', BUILTIN_COMPONENTS);
  section('Yours', customComponents(),
    'Nothing saved yet — right-click an element and “Save as component…” to package it.');

  // ── the row-scoped sibling: whole-row shapes live in New rowview ──────────
  const rowHead = document.createElement('div');
  rowHead.className = 'wb-complib-group';
  rowHead.textContent = 'Whole rows';
  host.appendChild(rowHead);
  const rowCard = document.createElement('button');
  rowCard.type = 'button';
  rowCard.className = 'wb-comp-rowlink';
  rowCard.innerHTML = '<span class="wb-comp-rowlink-name">▤ New rowview…</span><span class="wb-comp-rowlink-desc">Components drop INTO a view; a whole-row shape replaces it — pre-built row layouts live here.</span>';
  rowCard.title = 'Start the whole row from a pre-built layout (the same templates as the View dropdown)';
  rowCard.addEventListener('click', () => openTemplateModal(onToast));
  host.appendChild(rowCard);
}

// ─── "Add to view…": the typed mapping dialog ────────────────────────────────

function openMappingDialog(def: ComponentDef, onToast: (m: string) => void): void {
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
  const insert = document.createElement('button');
  insert.type = 'button';
  insert.className = 'wb-compmap-insert';
  insert.textContent = 'Add to the view';
  insert.disabled = !mappingComplete(def, mapping);
  insert.title = 'Insert the bound component — one undoable step';
  insert.addEventListener('click', () => {
    const bound = bindComponent(def, mapping);
    // on the grid, root children ARE the view columns — arrive as a new one;
    // elsewhere insert at the selection like a palette drop
    const at = state.doc.kind === 'grid' ? [] : undefined;
    state.insertNode(bound, at as NodePath | undefined);
    close();
    onToast(`Added ${def.name}${state.doc.kind === 'grid' ? ' as a new grid column' : ''} — Ctrl+Z removes it`);
  });
  foot.appendChild(insert);
  panel.appendChild(foot);

  document.body.appendChild(overlay);
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
  openSaveDialog(tree, node._elmName ?? 'My component', onToast);
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

/** The shared save dialog: name it, see its derived slots and preview, save. */
function openSaveDialog(tree: SPElement, defaultName: string, onToast: (m: string) => void): void {
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
  note.textContent = slots.length
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
    const name = nameInput.value.trim() || 'My component';
    const def: ComponentDef = {
      id: componentId(new Date()),
      name,
      description: slots.length
        ? `Saved from this workspace — maps ${slots.map((s) => slotTypesLabel(s.types)).join(', ')}.`
        : 'Saved from this workspace.',
      slots,
      root: tree,
    };
    if (!writeCustom(addComponent(readCustom(), def))) {
      onToast('Could not save the component — browser storage is full or blocked');
      return;
    }
    close();
    onToast(`Saved “${name}” to the component library (the ⬡ Components tab)`);
  });
  foot.appendChild(save);
  panel.appendChild(foot);

  document.body.appendChild(overlay);
  nameInput.focus();
  nameInput.select();
}
