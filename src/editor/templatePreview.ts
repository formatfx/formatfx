// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * editor/templatePreview.ts — the CHIPS bar (fields + components, the drag
 * sources), the WIREFRAME GALLERY (stage 'pick', grouped Row/Tile), the
 * recursive ZONE TREE, and the PREVIEW canvas. The canvas renders the row (or
 * tile) with the REAL renderer (same path as the live grid), then decorates
 * the EDIT exemplar (zones select zone-first; items drill in on the second
 * click; everything drags) and, right below it, renders up to 3 always-LIVE
 * rows/tiles of the PRUNED layout — exactly what Apply writes, hover/kebab
 * behaviors real, stubs honest. The WIDTH SCRUBBER squeezes rows so wrap
 * behavior is watched while editing; tiles size by their own width/height
 * knobs instead.
 *
 * Zones NEST, so every address here is a ZonePath and drag payloads carry one
 * NODE_MIME path — a zone drops INTO a zone to nest, between zones to sit
 * beside them, and the same edges/body rule applies at every depth, in the
 * tree and on the canvas alike.
 */
import { state } from './state';
import { renderElement, type RenderOptions } from '../core/renderer';
import { evaluate, type EvalContext } from '../core/expressions';
import { ctxForRow } from './previewCtx';
import {
  buildTemplateView, childSlotOrder, WIREFRAMES,
  ZONE_SIZE_LABEL, ZONE_FLOW_LABEL, ZONE_VALIGN_LABEL,
  type Wireframe, type ZoneConfig, type ZoneItem, type ZonePath,
} from './rowTemplates';
import { WEIGHT_FLEX } from './areas';
import type { SPElement } from '../core/types';
import {
  el, dropPos, STAGE_WIDTHS,
  FIELD_MIME, COMPONENT_MIME, NODE_MIME,
  type ModalUI, type ModalApi, type DropPos, type Selection,
} from './templateUi';
import { clampDragWidth, commitDragWidth } from './viewport';

// ─── path plumbing ───────────────────────────────────────────────────────────

/** "0:2:1" — stable DOM keys; root zones keep their old single-index keys. */
const pathKey = (path: ZonePath): string => path.join(':');

const samePath = (a: Selection, b: ZonePath): boolean =>
  Boolean(a && a.length === b.length && b.every((v, i) => a[i] === v));

/** Is `sel` this path or inside its subtree? (zone-first click uses this) */
const withinPath = (sel: Selection, path: ZonePath): boolean =>
  Boolean(sel && sel.length >= path.length && path.every((v, i) => sel[i] === v));

// ─── positional drag-drop plumbing (shared by canvas + tree) ────────────────
// Near an edge = BETWEEN (an insertion bar paints there); on the body = INTO
// (highlight) when the target can contain the payload. One vocabulary
// everywhere so drops feel predictable.

const PAYLOADS = [NODE_MIME, FIELD_MIME, COMPONENT_MIME];

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

/** The ZonePath a NODE_MIME payload names, or null. */
function nodePayload(dt: DataTransfer): ZonePath | null {
  const raw = dt.getData(NODE_MIME);
  if (!raw) return null;
  try {
    const path = JSON.parse(raw) as unknown;
    return Array.isArray(path) && path.length > 0 && path.every(Number.isInteger) ? path as ZonePath : null;
  } catch { return null; }
}

/** Any payload dropped on a ZONE surface (canvas box or tree row):
 *  edges = a SIBLING beside it (root edges spawn a root zone), body = INTO. */
function dropOnZone(e: DragEvent, dt: DataTransfer, node: HTMLElement, path: ZonePath, horizontal: boolean, api: ModalApi): void {
  const pos = posFor(e, node, horizontal, true);
  const field = dt.getData(FIELD_MIME);
  const componentId = dt.getData(COMPONENT_MIME);
  const moved = nodePayload(dt);
  if (pos === 'into') {
    if (field) api.dropField(path, field);
    else if (componentId) api.dropComponent(path, componentId);
    else if (moved) api.moveNode(moved, path, Number.MAX_SAFE_INTEGER);
    return;
  }
  const at = path[path.length - 1] + (pos === 'after' ? 1 : 0);
  const parent = path.slice(0, -1);
  if (moved) { api.moveNode(moved, parent, at); return; }
  if (parent.length === 0) {
    // beside a root zone: chips get a zone of their own
    if (field) api.newRootZoneAt(at, { field });
    else if (componentId) api.newRootZoneAt(at, { componentId });
    return;
  }
  // beside a nested zone: chips land as plain sibling items in the parent
  if (field) api.dropField(parent, field, at);
  else if (componentId) api.dropComponent(parent, componentId, at);
}

/** An ITEM row/block as a positional target: payloads insert before/after it
 *  inside its parent zone (no 'into' — leaf items don't contain). */
function wireItemTarget(node: HTMLElement, itemPath: ZonePath, horizontal: boolean, api: ModalApi): void {
  node.addEventListener('dragover', (e) => {
    const dt = (e as DragEvent).dataTransfer;
    if (!hasAny(dt, PAYLOADS)) return;
    e.preventDefault();
    e.stopPropagation();
    markDrop(node, posFor(e as DragEvent, node, horizontal, false), horizontal);
  });
  node.addEventListener('dragleave', () => clearDrop(node));
  node.addEventListener('drop', (e) => {
    const dt = (e as DragEvent).dataTransfer;
    if (!hasAny(dt, PAYLOADS)) return;
    e.preventDefault();
    e.stopPropagation();
    clearDrop(node);
    const pos = posFor(e as DragEvent, node, horizontal, false);
    const parent = itemPath.slice(0, -1);
    const ii = itemPath[itemPath.length - 1];
    let ins = ii + (pos === 'after' ? 1 : 0);
    const field = dt!.getData(FIELD_MIME);
    if (field) { api.dropField(parent, field, ins); return; }
    const componentId = dt!.getData(COMPONENT_MIME);
    if (componentId) { api.dropComponent(parent, componentId, ins); return; }
    const moved = nodePayload(dt!);
    if (!moved) return;
    // moving forward within the same parent: the removal shifts the slot left
    const sameParent = moved.length === itemPath.length && parent.every((v, i) => moved[i] === v);
    if (sameParent && moved[moved.length - 1] < ins) ins -= 1;
    api.moveNode(moved, parent, ins);
  });
}

// ─── CHIPS bar (pinned drag sources: fields + components) ────────────────────

export function renderChips(host: HTMLElement, ui: ModalUI, api: ModalApi): void {
  host.innerHTML = '';
  const placedFields = new Set<string>();
  const collect = (z: ZoneConfig): void => z.items.forEach((it) => {
    if (it.kind === 'field') placedFields.add(it.fieldName);
    else if (it.kind === 'zone') collect(it.zone);
  });
  ui.config.zones.forEach(collect);

  const fieldsRow = el('div', 'wb-template-chiprow');
  fieldsRow.appendChild(el('span', 'wb-template-fields-label', 'Fields'));
  const bar = el('div', 'wb-template-chips');
  for (const f of state.fields) {
    const chip = el('span', 'wb-template-field-chip', f.displayName ?? f.name);
    chip.dataset.field = f.name;
    if (placedFields.has(f.name)) chip.classList.add('wb-chip-placed');
    chip.draggable = true;
    chip.addEventListener('dragstart', (e) => { (e as DragEvent).dataTransfer?.setData(FIELD_MIME, f.name); });
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
      chip.draggable = true;
      chip.addEventListener('dragstart', (e) => { (e as DragEvent).dataTransfer?.setData(COMPONENT_MIME, def.id); });
      cbar.appendChild(chip);
    }
    compRow.appendChild(cbar);
    host.appendChild(compRow);
  }
}

// ─── the wireframe gallery (stage 'pick') ────────────────────────────────────

/** A CSS-drawn thumbnail of a wireframe: zone boxes at their flex proportions,
 *  item marks laid out by the zone's flow — the layout IS the picker. Tile
 *  wireframes draw as a vertical stack in a tile-shaped box. */
function wireframeThumb(wf: Wireframe): HTMLElement {
  const t = el('div', `wb-wf-thumb${wf.target === 'tile' ? ' wb-wf-thumb--tile' : ''}`);
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
    'Each layout is a set of zones. Drop fields and components into them — or whole zones into zones — then tune how every zone shares space and wraps. '
    + 'Row layouts fill the list row; tile layouts stack their zones inside a gallery tile.'));
  if (ui.foreignRow) {
    host.appendChild(el('div', 'wb-template-foreign-note',
      'The current view layout was built or edited outside this builder, so it can\'t be reopened as zones. '
      + 'Picking a layout starts fresh — Apply replaces it (one Ctrl+Z brings it back).'));
  }
  const groups: readonly (readonly ['row' | 'tile', string])[] = ui.galleryFirst === 'tile'
    ? [['tile', 'Tile layouts'], ['row', 'Row layouts']]
    : [['row', 'Row layouts'], ['tile', 'Tile layouts']];
  for (const [target, label] of groups) {
    host.appendChild(el('div', 'wb-template-gallery-head', label));
    const grid = el('div', 'wb-template-gallery');
    for (const wf of WIREFRAMES.filter((w) => w.target === target)) {
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
}

// ─── the zone TREE (structure pane, above the inspector) ─────────────────────

/** One row per zone with its items nested beneath — recursively, since zones
 *  nest. The deterministic selection surface AND a full drag surface: rows
 *  drag as NODE paths, edges insert beside, a zone row's body drops into it. */
export function renderZoneTree(host: HTMLElement, ui: ModalUI, api: ModalApi): void {
  host.innerHTML = '';
  if (ui.stage === 'pick') return; // the side column is CSS-hidden in the gallery
  const head = el('div', 'wb-template-tree-headrow');
  head.appendChild(el('span', 'wb-template-tree-head', 'Zones'));
  const layouts = el('button', 'wb-template-mini wb-template-layouts', '▤ Layouts') as HTMLButtonElement;
  layouts.type = 'button';
  layouts.title = 'Start from a different pre-built layout';
  layouts.addEventListener('click', () => api.openGallery());
  head.appendChild(layouts);
  host.appendChild(head);

  const rows = el('div', 'wb-template-tree-rows');
  // the STANDING root row: the row/tile itself is a first-class selection —
  // its alignment (how the zones line up) and style live in the inspector.
  // Selected whenever nothing deeper is (Selection null = the root).
  const tile = ui.config.target === 'tile';
  const rootRow = el('button', 'wb-ztree-row wb-ztree-zone wb-ztree-root') as HTMLButtonElement;
  rootRow.type = 'button';
  rootRow.dataset.treeRoot = '1';
  rootRow.title = tile
    ? 'The tile itself — content placement, style, size'
    : 'The row itself — how the zones line up, style, density';
  rootRow.append(
    el('span', 'wb-ztree-icon', tile ? '▢' : '▦'),
    el('span', 'wb-ztree-label', tile ? 'Tile layout' : 'Row layout'));
  if (ui.selected === null) rootRow.classList.add('wb-ztree-on');
  rootRow.addEventListener('click', () => api.deselect());
  // a drop on the root row lands at the END of the row — the quick
  // "make this top-level" gesture, mirroring a drop on the canvas edge
  rootRow.addEventListener('dragover', (e) => {
    const dt = (e as DragEvent).dataTransfer;
    if (!hasAny(dt, PAYLOADS)) return;
    e.preventDefault();
    rootRow.classList.add('wb-drop-hover');
  });
  rootRow.addEventListener('dragleave', () => rootRow.classList.remove('wb-drop-hover'));
  rootRow.addEventListener('drop', (e) => {
    const dt = (e as DragEvent).dataTransfer;
    if (!hasAny(dt, PAYLOADS)) return;
    e.preventDefault();
    rootRow.classList.remove('wb-drop-hover');
    const field = dt!.getData(FIELD_MIME);
    if (field) { api.newRootZoneAt(ui.config.zones.length, { field }); return; }
    const componentId = dt!.getData(COMPONENT_MIME);
    if (componentId) { api.newRootZoneAt(ui.config.zones.length, { componentId }); return; }
    const moved = nodePayload(dt!);
    if (moved) api.moveNode(moved, [], Number.MAX_SAFE_INTEGER);
  });
  rows.appendChild(rootRow);

  const comps = api.components();
  ui.config.zones.forEach((zone, zi) => treeZoneRows(rows, zone, [zi], 0, ui, api, comps));
  host.appendChild(rows);

  const add = el('button', 'wb-template-mini wb-template-addzone', '＋ Zone') as HTMLButtonElement;
  add.type = 'button';
  add.title = 'Add an empty zone (drop fields, components — or other zones — into it)';
  add.addEventListener('click', () => api.addEmptyZone());
  host.appendChild(add);
}

function treeZoneRows(
  rows: HTMLElement, zone: ZoneConfig, path: ZonePath, depth: number,
  ui: ModalUI, api: ModalApi, comps: ReturnType<ModalApi['components']>,
): void {
  // NAMESPACED classes (wb-ztree-*): the studio structure tree owns wb-tree-*
  const zrow = el('button', 'wb-ztree-row wb-ztree-zone') as HTMLButtonElement;
  zrow.type = 'button';
  zrow.dataset.treeZone = pathKey(path);
  zrow.style.paddingLeft = `${6 + depth * 14}px`;
  zrow.append(el('span', 'wb-ztree-icon', '▤'), el('span', 'wb-ztree-label', zone.label));
  if (samePath(ui.selected, path)) zrow.classList.add('wb-ztree-on');
  zrow.addEventListener('click', () => api.select(path));
  zrow.draggable = true;
  zrow.addEventListener('dragstart', (e) => {
    e.stopPropagation();
    (e as DragEvent).dataTransfer?.setData(NODE_MIME, JSON.stringify(path));
  });
  zrow.addEventListener('dragover', (e) => {
    const dt = (e as DragEvent).dataTransfer;
    if (!hasAny(dt, PAYLOADS)) return;
    e.preventDefault();
    markDrop(zrow, posFor(e as DragEvent, zrow, false, true), false);
  });
  zrow.addEventListener('dragleave', () => clearDrop(zrow));
  zrow.addEventListener('drop', (e) => {
    const dt = (e as DragEvent).dataTransfer;
    if (!hasAny(dt, PAYLOADS)) return;
    e.preventDefault();
    clearDrop(zrow);
    dropOnZone(e as DragEvent, dt!, zrow, path, false, api);
  });
  rows.appendChild(zrow);

  zone.items.forEach((item, ii) => {
    const itemPath = [...path, ii];
    if (item.kind === 'zone') {
      treeZoneRows(rows, item.zone, itemPath, depth + 1, ui, api, comps);
      return;
    }
    const irow = el('button', 'wb-ztree-row wb-ztree-item') as HTMLButtonElement;
    irow.type = 'button';
    irow.dataset.treeItem = pathKey(itemPath);
    irow.style.paddingLeft = `${22 + depth * 14}px`;
    const label = item.kind === 'field'
      ? item.fieldName || '(empty)'
      : `⬡ ${comps.find((c) => c.id === item.componentId)?.name ?? '(missing)'}`;
    irow.appendChild(el('span', 'wb-ztree-label', label));
    if (item.kind === 'component') irow.classList.add('wb-ztree-comp');
    if (samePath(ui.selected, itemPath)) irow.classList.add('wb-ztree-on');
    irow.addEventListener('click', () => api.select(itemPath));
    irow.draggable = true;
    irow.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      (e as DragEvent).dataTransfer?.setData(NODE_MIME, JSON.stringify(itemPath));
    });
    wireItemTarget(irow, itemPath, false, api);
    rows.appendChild(irow);
  });
}

// ─── PREVIEW canvas (stage 'edit') ───────────────────────────────────────────

export function renderPreview(host: HTMLElement, ui: ModalUI, api: ModalApi): void {
  host.innerHTML = '';
  if (ui.stage === 'pick') { renderGallery(host, ui, api); return; }
  const tile = ui.config.target === 'tile';

  const head = el('div', 'wb-template-prev-head');
  head.appendChild(el('span', 'wb-template-prev-title', 'Preview'));
  // a tile's width is its own knob (the Tile size section) — no viewport scrubber
  if (!tile) head.appendChild(widthPresets(ui, api));
  host.appendChild(head);

  const body = el('div', 'wb-template-prev-body');
  const stage = el('div', 'wb-template-stage');
  if (!tile && ui.stageWidth) stage.style.width = `${ui.stageWidth}px`;
  body.appendChild(stage);
  if (!tile) body.appendChild(widthHandle(stage, api));
  host.appendChild(body);

  // the EDIT row/tile (full config — empty zones stay visible as drop targets)…
  const { root, additionalRowClass } = buildTemplateView(
    ui.config, state.fields, state.columnLooks, api.palette(), api.components());
  renderEditExemplar(stage, root, additionalRowClass, ui, api);

  // …and the always-LIVE rows/tiles beneath it: the PRUNED layout, exactly
  // what Apply writes — hover and custom kebab flyouts are real
  stage.appendChild(el('div', 'wb-template-livehead', 'Live'));
  const pruned = buildTemplateView(
    ui.config, state.fields, state.columnLooks, api.palette(), api.components(), { prune: true });
  if (tile) renderLiveTiles(stage, pruned.root, ui, api);
  else renderLiveRows(stage, pruned.root, pruned.additionalRowClass, ui, api);

  host.appendChild(el('div', 'wb-template-note',
    'Click selects the zone; click again drills into what\'s inside. Drag anything anywhere — edges drop beside, the middle drops inside. '
    + (tile ? 'The tiles under “Live” behave like the real gallery.' : 'The rows under “Live” behave like the real list.')));
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
 *  style writes — no rerender churn), commit once on release. The clamp and
 *  snap-to-full math is shared with the main canvas's viewport handle
 *  (viewport.ts — #224's one width→reflow module). */
function widthHandle(stage: HTMLElement, api: ModalApi): HTMLElement {
  const handle = el('div', 'wb-template-widthhandle');
  handle.title = 'Drag to squeeze the row and watch it respond';
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('wb-dragging');
    const widthAt = (clientX: number): number => {
      const rect = stage.getBoundingClientRect();
      return clampDragWidth(clientX - rect.left, stage.parentElement!.clientWidth);
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
      api.setStageWidth(commitDragWidth(w, stage.parentElement!.clientWidth));
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
  const tile = ui.config.target === 'tile';
  const prow = el('div', 'wb-template-prow wb-template-prow--edit'
    + (tile ? ' wb-template-ptile wb-template-prow--tile' : ''));
  if (tile) {
    // the edit tile keeps the real WIDTH but only a MIN height — structure
    // stays reachable while editing; the Live tiles below are the exact box
    prow.style.width = `${ui.config.tileWidth ?? 254}px`;
    prow.style.minHeight = `${ui.config.tileHeight ?? 220}px`;
  }
  applyRowClass(prow, additionalRowClass, ctx);
  let rendered: HTMLElement;
  try {
    rendered = renderElement(root, ctx, { tagPaths: false, issues: [] }) as HTMLElement;
  } catch (e) {
    prow.textContent = `⚠ ${(e as Error).message}`;
    body.appendChild(prow);
    return;
  }
  // clone strips the renderer's customRowAction/customCardProps listeners so a
  // click in the edit row selects a zone rather than firing the row's behavior.
  const editRoot = rendered.cloneNode(true) as HTMLElement;
  prow.appendChild(editRoot);
  decorateEditRow(editRoot, ui, api);
  // the root is a first-class selection: builder chrome for the guide lines +
  // a standing tag pill that selects the whole row/tile (zone tags' sibling)
  editRoot.classList.add('wb-edit-rowroot');
  editRoot.dataset.rootValign = ui.config.rootVAlign;
  const rootTag = el('button', 'wb-edit-root-tag', tile ? '▢ Tile' : '▦ Row') as HTMLButtonElement;
  rootTag.type = 'button';
  rootTag.title = tile
    ? 'Select the tile itself — content placement, style, size'
    : 'Select the whole row — how the zones line up, style, density';
  rootTag.addEventListener('click', (e) => { e.stopPropagation(); api.deselect(); });
  prow.appendChild(rootTag);
  if (ui.selected === null) prow.classList.add('wb-edit-root-on');
  prow.addEventListener('click', () => api.deselect()); // bare-canvas click deselects
  body.appendChild(prow);

  // honest squeeze: rows clip at the simulated width (CSS), and a row that
  // CAN'T shrink to it says so instead of silently painting past the edge
  if (!tile) {
    const note = el('div', 'wb-template-overflow-note');
    note.style.display = 'none';
    body.appendChild(note);
    requestAnimationFrame(() => {
      const over = editRoot.scrollWidth - editRoot.clientWidth;
      if (over > 1) {
        note.textContent = `⚠ Doesn't fit — the content needs about ${over}px more than this width. `
          + 'Let zones Fill instead of Hug, or set items to Wrap, so the row can shrink.';
        note.style.display = '';
      }
    });
  }
}

function decorateEditRow(editRoot: HTMLElement, ui: ModalUI, api: ModalApi): void {
  const config = ui.config;
  const slots = childSlotOrder(config);
  const kids = Array.from(editRoot.children) as HTMLElement[];
  if (kids.length !== slots.length) return; // fail-safe: undecorated but visible

  // root zones sit side by side in a row, top to bottom in a tile — the drop
  // axis and the divider orientation follow
  const horizontal = config.target !== 'tile';
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
    decorateZone(node, [slot], config.zones[slot], ui, api, horizontal);
    if (prevZone !== null) editRoot.insertBefore(makeDivider(prevZone, ui, api), node);
    prevZone = slot;
  });
}

function decorateZone(node: HTMLElement, path: ZonePath, zone: ZoneConfig, ui: ModalUI, api: ModalApi, horizontal: boolean): void {
  // decorate the children FIRST — the 1:1 children↔items mapping must be
  // captured before the tag/hint elements are appended below. Nested zones
  // recurse; leaves become items.
  const itemNodes = Array.from(node.children) as HTMLElement[];
  zone.items.forEach((item, ii) => {
    const child = itemNodes[ii];
    if (!child) return;
    const itemPath = [...path, ii];
    // a nested zone's drop axis follows how THIS zone lays its items out
    if (item.kind === 'zone') decorateZone(child, itemPath, item.zone, ui, api, zone.flow !== 'stack');
    else decorateItem(child, itemPath, item, zone, ui, api);
  });

  node.classList.add('wb-edit-zone');
  if (path.length > 1) node.classList.add('wb-edit-zone--nested');
  node.dataset.editZone = pathKey(path);
  // the valign stamp feeds the hover guide lines (peeking a vertical-align
  // control draws each zone's line at ITS value — pure CSS, no rerender);
  // namespaced so the inspector pad's data-valign buttons stay unique
  node.dataset.zoneValign = zone.valign;
  if (samePath(ui.selected, path)) node.classList.add('wb-edit-selected');
  // the tag leads with the zone's NAME; the other spans are the hover-peek
  // values (data-peek on the modal picks which one paints — pure CSS, no rerender)
  const tag = el('span', 'wb-edit-zone-tag');
  tag.append(
    el('span', 'wb-zt wb-zt-name', zone.label),
    el('span', 'wb-zt wb-zt-size', ZONE_SIZE_LABEL[zone.size]),
    el('span', 'wb-zt wb-zt-flow', ZONE_FLOW_LABEL[zone.flow]),
    el('span', 'wb-zt wb-zt-align', zone.align[0].toUpperCase() + zone.align.slice(1)),
    el('span', 'wb-zt wb-zt-valign', ZONE_VALIGN_LABEL[zone.valign]),
  );
  tag.title = `${zone.label} — ${ZONE_SIZE_LABEL[zone.size]} · ${ZONE_FLOW_LABEL[zone.flow]} · ${ZONE_VALIGN_LABEL[zone.valign]}`;
  node.appendChild(tag);
  if (zone.items.length === 0) {
    node.classList.add('wb-edit-zone--empty');
    // the hint is a zero-footprint OVERLAY — it must never drive the zone's
    // size (a hug zone hugs its real content, not this helper text)
    node.appendChild(el('span', 'wb-edit-zone-hint', '＋ drop here'));
  }

  node.setAttribute('draggable', 'true');
  // zone-first selection: clicking anywhere in an unselected zone selects THE
  // ZONE; once the selection is this zone (or inside it), the click falls
  // through to whatever's deeper — the second click drills in.
  node.addEventListener('click', (e) => {
    if (withinPath(ui.selected, path)) return; // let the deeper handler take it
    e.stopPropagation();
    api.select(path);
  }, true);
  // …and clicks inside a selected zone never bubble out to the deselect
  node.addEventListener('click', (e) => e.stopPropagation());

  node.addEventListener('dragstart', (e) => {
    e.stopPropagation(); // a nested zone drags itself, not its ancestors
    (e as DragEvent).dataTransfer?.setData(NODE_MIME, JSON.stringify(path));
  });
  node.addEventListener('dragover', (e) => {
    const dt = (e as DragEvent).dataTransfer;
    if (!hasAny(dt, PAYLOADS)) return;
    e.preventDefault();
    e.stopPropagation();
    markDrop(node, posFor(e as DragEvent, node, horizontal, true), horizontal);
  });
  node.addEventListener('dragleave', () => clearDrop(node));
  node.addEventListener('drop', (e) => {
    const dt = (e as DragEvent).dataTransfer;
    if (!hasAny(dt, PAYLOADS)) return;
    e.preventDefault();
    e.stopPropagation();
    clearDrop(node);
    dropOnZone(e as DragEvent, dt!, node, path, horizontal, api);
  });
}

function decorateItem(node: HTMLElement, itemPath: ZonePath, item: ZoneItem, zone: ZoneConfig, ui: ModalUI, api: ModalApi): void {
  node.classList.add('wb-edit-item');
  node.dataset.editItem = pathKey(itemPath);
  if (item.kind === 'field') node.dataset.fieldName = item.fieldName;
  else if (item.kind === 'component') node.dataset.componentId = item.componentId;
  if (samePath(ui.selected, itemPath)) node.classList.add('wb-edit-selected');
  node.setAttribute('draggable', 'true');

  node.addEventListener('click', (e) => { e.stopPropagation(); api.select(itemPath); }, true);
  node.addEventListener('dragstart', (e) => {
    e.stopPropagation(); // don't also start the zone drag
    (e as DragEvent).dataTransfer?.setData(NODE_MIME, JSON.stringify(itemPath));
  });
  // an item is a positional target for chips AND nodes: near an edge inserts
  // before/after it (insertion bar); the item axis follows the zone's flow
  wireItemTarget(node, itemPath, zone.flow !== 'stack', api);
}

function makeDivider(leftZoneIdx: number, ui: ModalUI, api: ModalApi): HTMLElement {
  const tile = ui.config.target === 'tile';
  const d = el('div', `wb-edit-divider${tile ? ' wb-edit-divider--h' : ''}`);
  // the divider IS the between-zones gap — dropping a chip, item or zone here
  // lands it right at this seam (zones stay zones, leaves get a zone of their
  // own). Invisible at rest (no tooltip — a ghost strip must not chat); it
  // paints only while a payload hovers it.
  d.addEventListener('dragover', (e) => {
    if (!hasAny((e as DragEvent).dataTransfer, PAYLOADS)) return;
    e.preventDefault();
    e.stopPropagation();
    d.classList.add('wb-drop-hover');
  });
  d.addEventListener('dragleave', () => d.classList.remove('wb-drop-hover'));
  d.addEventListener('drop', (e) => {
    const dt = (e as DragEvent).dataTransfer;
    if (!hasAny(dt, PAYLOADS)) return;
    e.preventDefault();
    e.stopPropagation();
    d.classList.remove('wb-drop-hover');
    const at = leftZoneIdx + 1;
    const field = dt!.getData(FIELD_MIME);
    if (field) { api.newRootZoneAt(at, { field }); return; }
    const componentId = dt!.getData(COMPONENT_MIME);
    if (componentId) { api.newRootZoneAt(at, { componentId }); return; }
    const moved = nodePayload(dt!);
    if (moved) api.moveNode(moved, [], at);
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
    const opts: RenderOptions = { tagPaths: false, issues: [], onAction };
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

/** The live TILE deck: up to 3 tiles at the exact configured box, side by
 *  side like the real gallery — hover behaviors and stubs are real. */
function renderLiveTiles(body: HTMLElement, root: SPElement, ui: ModalUI, api: ModalApi): void {
  const deck = el('div', 'wb-template-tiledeck');
  const tileCount = Math.min(3, Math.max(1, state.rows.length));
  const onAction = (elx: SPElement, summary: string): void => api.notify(stubMessage(elx, summary));
  for (let i = 0; i < tileCount; i++) {
    const box = el('div', 'wb-template-ptile');
    box.style.width = `${ui.config.tileWidth ?? 254}px`;
    box.style.height = `${ui.config.tileHeight ?? 220}px`;
    if (ui.config.hoverHighlight) box.classList.add('wb-prow-hoverable');
    try {
      box.appendChild(renderElement(root, ctxForRow(i), { tagPaths: false, issues: [], onAction }));
    } catch (e) {
      box.textContent = `⚠ ${(e as Error).message}`;
    }
    deck.appendChild(box);
  }
  body.appendChild(deck);
}

function stubMessage(elx: SPElement, summary: string): string {
  if (elx.customRowAction?.action === 'openContextMenu') {
    return "Native kebab — SharePoint's item menu opens here (stubbed in preview).";
  }
  return summary;
}

function applyRowClass(prow: HTMLElement, expr: string | undefined, ctx: EvalContext): void {
  if (!expr) return;
  try {
    const cls = String(evaluate(expr, ctx) ?? '').trim();
    if (cls) for (const c of cls.split(/\s+/)) prow.classList.add(c);
  } catch { /* preview-only — ignore evaluation noise */ }
}
