/**
 * editor/templatePreview.ts — the CHIPS bar (fields + components, the drag
 * sources), the WIREFRAME GALLERY (stage 'pick'), and the PREVIEW canvas
 * (stage 'edit'). The canvas renders the row with the REAL renderer (same path
 * as the live grid), then:
 *   • Edit mode  — clones the rendered row to strip the renderer's own click
 *     handlers, then decorates each ZONE (select / drop / reorder / divider-
 *     resize) and each ITEM inside it (select / move), with a trailing new-zone
 *     gap. The clone is throwaway preview DOM — Apply rebuilds from config.
 *   • Preview mode — renders up to 3 live rows; hover and custom kebab flyouts
 *     are real, native kebab / row-click are honest stubs via onAction.
 * Both modes share the WIDTH SCRUBBER: presets + a draggable right edge that
 * squeezes the stage so makers can WATCH zones shrink and items wrap — that is
 * how wrap behavior is understood, not by imagining CSS.
 */
import { state } from './state';
import { renderElement, type RenderOptions } from '../core/renderer';
import { evaluate, type EvalContext } from '../core/expressions';
import { ctxForRow, resolveColumnRef } from './previewCtx';
import {
  buildTemplateView, childSlotOrder, WIREFRAMES,
  ZONE_SIZE_LABEL, ZONE_FLOW_LABEL, type Wireframe,
} from './rowTemplates';
import { WEIGHT_FLEX } from './areas';
import type { SPElement } from '../core/types';
import {
  el, segmented, dropPos, STAGE_WIDTHS,
  FIELD_MIME, COMPONENT_MIME, ZONE_MIME, ITEM_MIME,
  type Mode, type ModalUI, type ModalApi, type DropPos,
} from './templateUi';

// ─── positional drag-drop plumbing (shared by canvas + tree) ────────────────
// Near an edge = BETWEEN (an insertion bar paints there); on the body = INTO
// (highlight) when the target can contain the payload. One vocabulary
// everywhere so drops feel predictable.

const ITEMISH = [ITEM_MIME, FIELD_MIME, COMPONENT_MIME];

function hasAny(dt: DataTransfer | null, mimes: string[]): boolean {
  return Boolean(dt && mimes.some((m) => dt.types.includes(m)));
}

const DROP_CLASSES = ['wb-drop-hover', 'wb-ins-before-h', 'wb-ins-after-h', 'wb-ins-before-v', 'wb-ins-after-v'];

function clearDrop(node: HTMLElement): void {
  node.classList.remove(...DROP_CLASSES);
}

function markDrop(node: HTMLElement, pos: DropPos, horizontal: boolean): void {
  clearDrop(node);
  if (pos === 'into') node.classList.add('wb-drop-hover');
  else node.classList.add(`wb-ins-${pos}-${horizontal ? 'h' : 'v'}`);
}

/** Pointer → before/after/into for `node` along its axis. */
function posFor(e: DragEvent, node: HTMLElement, horizontal: boolean, canInto: boolean): DropPos {
  const rect = node.getBoundingClientRect();
  const offset = horizontal ? e.clientX - rect.left : e.clientY - rect.top;
  return dropPos(offset, horizontal ? rect.width : rect.height, canInto);
}

/** The `{zone, item}` an ITEM_MIME payload names, or null. */
function itemPayload(dt: DataTransfer): { zone: number; item: number } | null {
  const raw = dt.getData(ITEM_MIME);
  if (!raw) return null;
  const [zone, item] = raw.split(':').map(Number);
  return Number.isInteger(zone) && Number.isInteger(item) ? { zone, item } : null;
}

// ─── CHIPS bar (pinned drag sources: fields + components) ────────────────────

export function renderChips(host: HTMLElement, ui: ModalUI, api: ModalApi): void {
  host.innerHTML = '';
  const placedFields = new Set(ui.config.zones.flatMap((z) => z.items)
    .flatMap((it) => (it.kind === 'field' ? [it.fieldName] : [])));

  const fieldsRow = el('div', 'wb-template-chiprow');
  fieldsRow.appendChild(el('span', 'wb-template-fields-label', 'Fields'));
  const bar = el('div', 'wb-template-chips');
  for (const f of state.fields) {
    const chip = el('span', 'wb-template-field-chip', f.displayName ?? f.name);
    chip.dataset.field = f.name;
    if (placedFields.has(f.name)) chip.classList.add('wb-chip-placed');
    makeChipDraggable(chip, ui, FIELD_MIME, f.name);
    bar.appendChild(chip);
  }
  fieldsRow.appendChild(bar);
  host.appendChild(fieldsRow);

  const comps = api.components();
  if (comps.length) {
    const compRow = el('div', 'wb-template-chiprow');
    compRow.appendChild(el('span', 'wb-template-fields-label', 'Components'));
    const cbar = el('div', 'wb-template-chips');
    for (const def of comps) {
      const chip = el('span', 'wb-template-field-chip wb-template-comp-chip', `⬡ ${def.name}`);
      chip.dataset.component = def.id;
      chip.title = def.description;
      makeChipDraggable(chip, ui, COMPONENT_MIME, def.id);
      cbar.appendChild(chip);
    }
    compRow.appendChild(cbar);
    host.appendChild(compRow);
  }
}

function makeChipDraggable(chip: HTMLElement, ui: ModalUI, mime: string, payload: string): void {
  if (ui.mode === 'edit') {
    chip.draggable = true;
    chip.addEventListener('dragstart', (e) => { (e as DragEvent).dataTransfer?.setData(mime, payload); });
  } else {
    chip.classList.add('wb-chip-inert');
  }
}

// ─── the wireframe gallery (stage 'pick') ────────────────────────────────────

/** A CSS-drawn thumbnail of a wireframe: zone boxes at their flex proportions,
 *  item marks laid out by the zone's flow — the layout IS the picker. */
function wireframeThumb(wf: Wireframe): HTMLElement {
  const t = el('div', 'wb-wf-thumb');
  for (const z of wf.zones) {
    const zb = el('div', `wb-wf-zone wb-wf-zone--${z.flow}`);
    zb.style.flex = z.size === 'hug' ? '0 0 16%' : `${WEIGHT_FLEX[z.size]} 1 0%`;
    const marks = Math.min(3, Math.max(1, z.flow === 'stack' ? 2 : z.want.length || 1));
    for (let i = 0; i < marks; i++) zb.appendChild(el('span', 'wb-wf-mark'));
    t.appendChild(zb);
  }
  return t;
}

function renderGallery(host: HTMLElement, ui: ModalUI, api: ModalApi): void {
  host.appendChild(el('div', 'wb-template-gallery-title', 'Start from a layout'));
  host.appendChild(el('div', 'wb-template-gallery-sub',
    'Each layout is a set of zones. Drop fields and components into them, then tune how every zone shares space and wraps.'));
  if (ui.foreignRow) {
    host.appendChild(el('div', 'wb-template-foreign-note',
      'The current row layout was built or edited outside this builder, so it can\'t be reopened as zones. '
      + 'Picking a layout starts fresh — Apply replaces the row (one Ctrl+Z brings it back).'));
  }
  const grid = el('div', 'wb-template-gallery');
  for (const wf of WIREFRAMES) {
    const card = el('button', 'wb-wf-card') as HTMLButtonElement;
    card.type = 'button';
    card.dataset.wireframe = wf.id;
    card.appendChild(wireframeThumb(wf));
    card.appendChild(el('span', 'wb-wf-name', wf.name));
    card.appendChild(el('span', 'wb-wf-blurb', wf.blurb));
    card.addEventListener('click', () => api.pickWireframe(wf.id));
    grid.appendChild(card);
  }
  host.appendChild(grid);
}

// ─── PREVIEW canvas (stage 'edit') ───────────────────────────────────────────

export function renderPreview(host: HTMLElement, ui: ModalUI, api: ModalApi): void {
  host.innerHTML = '';
  if (ui.stage === 'pick') { renderGallery(host, ui, api); return; }

  const head = el('div', 'wb-template-prev-head');
  const left = el('div', 'wb-template-prev-headgroup');
  const back = el('button', 'wb-template-mini wb-template-layouts', '▤ Layouts') as HTMLButtonElement;
  back.type = 'button';
  back.title = 'Start from a different pre-built layout';
  back.addEventListener('click', () => api.openGallery());
  left.append(el('span', 'wb-template-prev-title', 'Preview'), back);
  // modal-local undo/redo — the keyboard twins live on Ctrl/Cmd+Z
  const un = el('button', 'wb-template-mini wb-template-undo', '↶') as HTMLButtonElement;
  un.type = 'button';
  un.title = 'Undo (Ctrl+Z) — inside the builder only';
  un.disabled = !api.canUndo();
  un.addEventListener('click', () => api.undo());
  const re = el('button', 'wb-template-mini wb-template-redo', '↷') as HTMLButtonElement;
  re.type = 'button';
  re.title = 'Redo (Ctrl+Shift+Z)';
  re.disabled = !api.canRedo();
  re.addEventListener('click', () => api.redo());
  left.append(un, re);
  head.appendChild(left);

  const right = el('div', 'wb-template-prev-headgroup');
  right.appendChild(widthPresets(ui, api));
  right.appendChild(segmented<Mode>('mode', [['edit', 'Edit'], ['preview', 'Preview']], ui.mode, (m) => api.setMode(m)));
  head.appendChild(right);
  host.appendChild(head);

  const body = el('div', 'wb-template-prev-body');
  const stage = el('div', 'wb-template-stage');
  if (ui.stageWidth) stage.style.width = `${ui.stageWidth}px`;
  body.appendChild(stage);
  body.appendChild(widthHandle(stage, api));
  host.appendChild(body);

  const { root, additionalRowClass } = buildTemplateView(
    ui.config, state.fields, state.columnRefs, api.palette(), api.components());
  if (ui.mode === 'edit') renderEditExemplar(stage, root, additionalRowClass, ui, api);
  else renderLiveRows(stage, root, additionalRowClass, ui, api);

  host.appendChild(statusStrip(ui));
}

/** The zone TREE — the builder's structure pane, sitting ABOVE the inspector
 *  in the left side column (the Left-Edit-Pane shape): one row per zone, its
 *  items nested beneath, "+ Zone" at the foot. The deterministic selection
 *  surface (canvas clicks can land on whichever item fills a zone's center;
 *  a tree row can't miss) AND a full drag-drop surface: rows drag, edges
 *  insert BETWEEN (bar), a zone row's body drops INTO it (highlight). Visible
 *  in BOTH modes so nothing shifts on the Edit/Preview flip; interacting in
 *  Preview switches back to Edit. */
export function renderZoneTree(host: HTMLElement, ui: ModalUI, api: ModalApi): void {
  host.innerHTML = '';
  if (ui.stage === 'pick') return; // the side column is CSS-hidden in the gallery
  host.appendChild(el('div', 'wb-template-tree-head', 'Zones'));
  const rows = el('div', 'wb-template-tree-rows');
  const comps = api.components();
  const editable = ui.mode === 'edit';

  ui.config.zones.forEach((zone, zi) => {
    // NAMESPACED classes (wb-ztree-*): the studio structure tree owns wb-tree-*
    const zrow = el('button', 'wb-ztree-row wb-ztree-zone') as HTMLButtonElement;
    zrow.type = 'button';
    zrow.dataset.treeZone = String(zi);
    zrow.append(el('span', 'wb-ztree-icon', '▤'), el('span', 'wb-ztree-label', zone.label));
    if (ui.selected?.zone === zi && ui.selected.item === null && editable) zrow.classList.add('wb-ztree-on');
    zrow.addEventListener('click', () => {
      if (ui.mode === 'preview') api.setMode('edit');
      api.selectZone(zi);
    });
    if (editable) {
      zrow.draggable = true;
      zrow.addEventListener('dragstart', (e) => { (e as DragEvent).dataTransfer?.setData(ZONE_MIME, String(zi)); });
      zrow.addEventListener('dragover', (e) => {
        const dt = (e as DragEvent).dataTransfer;
        if (!hasAny(dt, [ZONE_MIME, ...ITEMISH])) return;
        e.preventDefault();
        // zones reorder between rows; item-ish payloads may also land INTO the body
        const canInto = !dt!.types.includes(ZONE_MIME);
        markDrop(zrow, posFor(e as DragEvent, zrow, false, canInto), false);
      });
      zrow.addEventListener('dragleave', () => clearDrop(zrow));
      zrow.addEventListener('drop', (e) => {
        e.preventDefault();
        clearDrop(zrow);
        const dt = (e as DragEvent).dataTransfer;
        if (!dt) return;
        const zonePayload = dt.getData(ZONE_MIME);
        if (zonePayload) {
          const from = Number(zonePayload);
          const pos = posFor(e as DragEvent, zrow, false, false);
          const ins = zi + (pos === 'after' ? 1 : 0);
          const to = ins > from ? ins - 1 : ins;
          if (Number.isInteger(from) && to !== from) api.reorderZone(from, to);
          return;
        }
        dropItemishOnZone(e as DragEvent, dt, zrow, zi, false, api);
      });
    }
    rows.appendChild(zrow);

    zone.items.forEach((item, ii) => {
      const irow = el('button', 'wb-ztree-row wb-ztree-item') as HTMLButtonElement;
      irow.type = 'button';
      irow.dataset.treeItem = `${zi}:${ii}`;
      const label = item.kind === 'field'
        ? item.fieldName || '(empty)'
        : `⬡ ${comps.find((c) => c.id === item.componentId)?.name ?? '(missing)'}`;
      irow.appendChild(el('span', 'wb-ztree-label', label));
      if (item.kind === 'component') irow.classList.add('wb-ztree-comp');
      if (ui.selected?.zone === zi && ui.selected.item === ii && editable) irow.classList.add('wb-ztree-on');
      irow.addEventListener('click', () => {
        if (ui.mode === 'preview') api.setMode('edit');
        api.selectItem(zi, ii);
      });
      if (editable) {
        irow.draggable = true;
        irow.addEventListener('dragstart', (e) => {
          e.stopPropagation();
          (e as DragEvent).dataTransfer?.setData(ITEM_MIME, `${zi}:${ii}`);
        });
        wireItemTarget(irow, zi, ii, false, api);
      }
      rows.appendChild(irow);
    });
  });
  host.appendChild(rows);

  const add = el('button', 'wb-template-mini wb-template-addzone', '＋ Zone') as HTMLButtonElement;
  add.type = 'button';
  add.title = 'Add an empty zone (drop fields or components into it whenever)';
  add.disabled = ui.mode === 'preview';
  add.addEventListener('click', () => api.addEmptyZone());
  host.appendChild(add);
}

/** An item-ish payload (chip or item) dropped on a ZONE surface: edges spawn a
 *  NEW zone between rows/columns, the body drops INTO the zone (append). */
function dropItemishOnZone(
  e: DragEvent, dt: DataTransfer, node: HTMLElement, zi: number, horizontal: boolean, api: ModalApi,
): void {
  const pos = posFor(e, node, horizontal, true);
  const field = dt.getData(FIELD_MIME);
  const componentId = dt.getData(COMPONENT_MIME);
  const moved = itemPayload(dt);
  if (pos === 'into') {
    if (field) api.dropField(zi, field);
    else if (componentId) api.dropComponent(zi, componentId);
    else if (moved) api.moveItem(moved.zone, moved.item, zi, Number.MAX_SAFE_INTEGER);
    return;
  }
  const at = zi + (pos === 'after' ? 1 : 0);
  if (field) api.newZoneAt(at, { field });
  else if (componentId) api.newZoneAt(at, { componentId });
  else if (moved) api.newZoneAt(at, { move: moved });
}

/** An ITEM row/block as a positional target: item-ish payloads insert
 *  before/after it inside its zone (no 'into' — items don't nest). */
function wireItemTarget(node: HTMLElement, zi: number, ii: number, horizontal: boolean, api: ModalApi): void {
  node.addEventListener('dragover', (e) => {
    const dt = (e as DragEvent).dataTransfer;
    if (!hasAny(dt, ITEMISH)) return;
    e.preventDefault();
    e.stopPropagation();
    markDrop(node, posFor(e as DragEvent, node, horizontal, false), horizontal);
  });
  node.addEventListener('dragleave', () => clearDrop(node));
  node.addEventListener('drop', (e) => {
    const dt = (e as DragEvent).dataTransfer;
    if (!hasAny(dt, ITEMISH)) return;
    e.preventDefault();
    e.stopPropagation();
    clearDrop(node);
    const pos = posFor(e as DragEvent, node, horizontal, false);
    const ins = ii + (pos === 'after' ? 1 : 0);
    const field = dt!.getData(FIELD_MIME);
    if (field) { api.dropField(zi, field, ins); return; }
    const componentId = dt!.getData(COMPONENT_MIME);
    if (componentId) { api.dropComponent(zi, componentId, ins); return; }
    const moved = itemPayload(dt!);
    if (!moved) return;
    // moving forward within the same zone: the removal shifts the slot left
    const to = moved.zone === zi && moved.item < ins ? ins - 1 : ins;
    api.moveItem(moved.zone, moved.item, zi, to);
  });
}

/** The Full / Medium / Narrow squeeze presets. */
function widthPresets(ui: ModalUI, api: ModalApi): HTMLElement {
  const current = STAGE_WIDTHS.find(([, w]) => w === ui.stageWidth)?.[0]
    ?? `${ui.stageWidth}px`; // a scrubbed custom width shows as its own value
  const wrap = el('div', 'wb-seg wb-template-widths');
  for (const [label, w] of STAGE_WIDTHS) {
    const b = el('button', 'wb-seg-btn', label) as HTMLButtonElement;
    b.type = 'button';
    b.dataset.stagewidth = label.toLowerCase();
    b.title = 'Squeeze the preview to watch zones shrink and items wrap';
    if (label === current) b.classList.add('wb-seg-on');
    b.addEventListener('click', (e) => { e.stopPropagation(); api.setStageWidth(w); });
    wrap.appendChild(b);
  }
  return wrap;
}

/** The draggable right edge of the stage: live-squeeze while dragging (direct
 *  style writes — no rerender churn), commit once on release. */
function widthHandle(stage: HTMLElement, api: ModalApi): HTMLElement {
  const handle = el('div', 'wb-template-widthhandle');
  handle.title = 'Drag to squeeze the row and watch it respond';
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('wb-dragging');
    const widthAt = (clientX: number): number => {
      const rect = stage.getBoundingClientRect();
      return Math.round(Math.min(Math.max(clientX - rect.left, 240), stage.parentElement!.clientWidth));
    };
    const move = (ev: PointerEvent): void => { stage.style.width = `${widthAt(ev.clientX)}px`; };
    const end = (ev: PointerEvent): void => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      handle.classList.remove('wb-dragging');
      // pointercancel carries no useful coordinates — commit what's on screen
      const w = ev.type === 'pointercancel'
        ? Math.round(stage.getBoundingClientRect().width)
        : widthAt(ev.clientX);
      const full = stage.parentElement!.clientWidth;
      api.setStageWidth(w >= full - 8 ? null : w);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  });
  return handle;
}

function renderEditExemplar(
  body: HTMLElement, root: SPElement, additionalRowClass: string | undefined, ui: ModalUI, api: ModalApi,
): void {
  const ctx = ctxForRow(0);
  const prow = el('div', 'wb-template-prow wb-template-prow--edit');
  applyRowClass(prow, additionalRowClass, ctx);
  let rendered: HTMLElement;
  try {
    rendered = renderElement(root, ctx, { tagPaths: false, resolveColumnRef, issues: [] }) as HTMLElement;
  } catch (e) {
    prow.textContent = `⚠ ${(e as Error).message}`;
    body.appendChild(prow);
    return;
  }
  // clone strips the renderer's customRowAction/customCardProps listeners so a
  // click in Edit selects a zone rather than firing the row's real behavior.
  const editRoot = rendered.cloneNode(true) as HTMLElement;
  prow.appendChild(editRoot);
  decorateEditRow(editRoot, ui, api);
  prow.addEventListener('click', () => api.deselect()); // bare-canvas click deselects
  body.appendChild(prow);
}

function decorateEditRow(editRoot: HTMLElement, ui: ModalUI, api: ModalApi): void {
  const config = ui.config;
  const slots = childSlotOrder(config);
  const kids = Array.from(editRoot.children) as HTMLElement[];
  if (kids.length !== slots.length) return; // fail-safe: undecorated but visible

  let prevZone: number | null = null;
  slots.forEach((slot, k) => {
    const node = kids[k];
    if (slot === 'kebab') {
      node.classList.add('wb-edit-kebab');
      node.title = 'Row actions — configure in the inspector';
      node.addEventListener('click', (e) => { e.stopPropagation(); api.selectKebab(); }, true);
      prevZone = null;
      return;
    }
    decorateZone(node, slot, ui, api);
    if (prevZone !== null) editRoot.insertBefore(makeDivider(prevZone, ui, api), node);
    prevZone = slot;
  });
}

function decorateZone(node: HTMLElement, zi: number, ui: ModalUI, api: ModalApi): void {
  const zone = ui.config.zones[zi];
  // decorate the ITEM children FIRST — the 1:1 children↔items mapping must be
  // captured before the label/hint elements are appended below.
  const itemNodes = Array.from(node.children) as HTMLElement[];
  itemNodes.forEach((itemNode, ii) => decorateItem(itemNode, zi, ii, ui, api));

  node.classList.add('wb-edit-zone');
  node.dataset.editZone = String(zi);
  if (ui.selected?.zone === zi && ui.selected.item === null) node.classList.add('wb-edit-selected');
  // the tag leads with the zone's NAME; the other spans are the hover-peek
  // values (data-peek on the modal picks which one paints — pure CSS, no rerender)
  const tag = el('span', 'wb-edit-zone-tag');
  tag.append(
    el('span', 'wb-zt wb-zt-name', zone.label),
    el('span', 'wb-zt wb-zt-size', ZONE_SIZE_LABEL[zone.size]),
    el('span', 'wb-zt wb-zt-flow', ZONE_FLOW_LABEL[zone.flow]),
    el('span', 'wb-zt wb-zt-align', zone.align[0].toUpperCase() + zone.align.slice(1)),
  );
  tag.title = `${zone.label} — ${ZONE_SIZE_LABEL[zone.size]} · ${ZONE_FLOW_LABEL[zone.flow]}`;
  node.appendChild(tag);
  if (zone.items.length === 0) node.appendChild(el('span', 'wb-edit-zone-hint', '＋ drop a field or component'));

  node.setAttribute('draggable', 'true');
  node.addEventListener('click', (e) => {
    // capture runs outer-first: let clicks on an ITEM fall through to its own handler
    if ((e.target as HTMLElement).closest?.('.wb-edit-item')) return;
    e.stopPropagation();
    api.selectZone(zi);
  }, true);
  node.addEventListener('dragstart', (e) => { (e as DragEvent).dataTransfer?.setData(ZONE_MIME, String(zi)); });
  node.addEventListener('dragover', (e) => {
    const dt = (e as DragEvent).dataTransfer;
    if (!hasAny(dt, [ZONE_MIME, ...ITEMISH])) return;
    e.preventDefault();
    // zone-on-zone = reorder BETWEEN (bar); item-ish payloads may also land INTO
    const canInto = !dt!.types.includes(ZONE_MIME);
    markDrop(node, posFor(e as DragEvent, node, true, canInto), true);
  });
  node.addEventListener('dragleave', () => clearDrop(node));
  node.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    clearDrop(node);
    const dt = (e as DragEvent).dataTransfer;
    if (!dt) return;
    const zonePayload = dt.getData(ZONE_MIME);
    if (zonePayload) {
      const from = Number(zonePayload);
      const pos = posFor(e as DragEvent, node, true, false);
      const ins = zi + (pos === 'after' ? 1 : 0);
      const to = ins > from ? ins - 1 : ins;
      if (Number.isInteger(from) && to !== from) api.reorderZone(from, to);
      return;
    }
    dropItemishOnZone(e as DragEvent, dt, node, zi, true, api);
  });
}

function decorateItem(node: HTMLElement, zi: number, ii: number, ui: ModalUI, api: ModalApi): void {
  const item = ui.config.zones[zi]?.items[ii];
  if (!item) return;
  node.classList.add('wb-edit-item');
  node.dataset.editItem = `${zi}:${ii}`;
  if (item.kind === 'field') node.dataset.fieldName = item.fieldName;
  else node.dataset.componentId = item.componentId;
  if (ui.selected?.zone === zi && ui.selected.item === ii) node.classList.add('wb-edit-selected');
  node.setAttribute('draggable', 'true');

  node.addEventListener('click', (e) => { e.stopPropagation(); api.selectItem(zi, ii); }, true);
  node.addEventListener('dragstart', (e) => {
    e.stopPropagation(); // don't also start the zone drag
    (e as DragEvent).dataTransfer?.setData(ITEM_MIME, `${zi}:${ii}`);
  });
  // an item is a positional target for chips AND items: near an edge inserts
  // before/after it (insertion bar); the item axis follows the zone's flow
  wireItemTarget(node, zi, ii, ui.config.zones[zi].flow !== 'stack', api);
}

function makeDivider(leftZoneIdx: number, ui: ModalUI, api: ModalApi): HTMLElement {
  const d = el('div', 'wb-edit-divider');
  const next = ZONE_SIZE_LABEL[ui.config.zones[leftZoneIdx].size];
  d.title = `Resize: click to cycle the left zone (now ${next}: Hug → Fill → Fill 2× → Fill 3×). Drop here for a new zone between.`;
  d.addEventListener('click', (e) => { e.stopPropagation(); api.cycleZoneSize(leftZoneIdx); });
  // the divider IS the between-zones gap — dropping a chip or item here spawns
  // a new zone right at this seam
  d.addEventListener('dragover', (e) => {
    if (!hasAny((e as DragEvent).dataTransfer, ITEMISH)) return;
    e.preventDefault();
    e.stopPropagation();
    d.classList.add('wb-drop-hover');
  });
  d.addEventListener('dragleave', () => d.classList.remove('wb-drop-hover'));
  d.addEventListener('drop', (e) => {
    const dt = (e as DragEvent).dataTransfer;
    if (!hasAny(dt, ITEMISH)) return;
    e.preventDefault();
    e.stopPropagation();
    d.classList.remove('wb-drop-hover');
    const at = leftZoneIdx + 1;
    const field = dt!.getData(FIELD_MIME);
    if (field) { api.newZoneAt(at, { field }); return; }
    const componentId = dt!.getData(COMPONENT_MIME);
    if (componentId) { api.newZoneAt(at, { componentId }); return; }
    const moved = itemPayload(dt!);
    if (moved) api.newZoneAt(at, { move: moved });
  });
  return d;
}

function renderLiveRows(
  body: HTMLElement, root: SPElement, additionalRowClass: string | undefined, ui: ModalUI, api: ModalApi,
): void {
  const rowCount = Math.min(3, Math.max(1, state.rows.length));
  const onAction = (elx: SPElement, summary: string): void => api.notify(stubMessage(elx, summary));
  for (let i = 0; i < rowCount; i++) {
    const ctx = ctxForRow(i);
    const opts: RenderOptions = { tagPaths: false, resolveColumnRef, issues: [], onAction };
    const prow = el('div', 'wb-template-prow');
    if (ui.config.hoverHighlight) prow.classList.add('wb-prow-hoverable');
    applyRowClass(prow, additionalRowClass, ctx);
    try {
      prow.appendChild(renderElement(root, ctx, opts));
    } catch (e) {
      prow.textContent = `⚠ ${(e as Error).message}`;
    }
    body.appendChild(prow);
  }
}

function stubMessage(elx: SPElement, summary: string): string {
  if (elx.customRowAction?.action === 'openContextMenu') {
    return "Native kebab — SharePoint's item menu opens here (stubbed in preview).";
  }
  return summary;
}

function statusStrip(ui: ModalUI): HTMLElement {
  return el('div', 'wb-template-note', ui.mode === 'edit'
    ? 'Edit — drop fields & components into zones, click to style, drag the row edge to watch it squeeze and wrap.'
    : 'Preview — hover & custom kebab flyouts are live; the native menu and row-click are honest stubs. The width scrubber still works.');
}

function applyRowClass(prow: HTMLElement, expr: string | undefined, ctx: EvalContext): void {
  if (!expr) return;
  try {
    const cls = String(evaluate(expr, ctx) ?? '').trim();
    if (cls) for (const c of cls.split(/\s+/)) prow.classList.add(c);
  } catch { /* preview-only — ignore evaluation noise */ }
}
