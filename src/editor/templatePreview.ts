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
import { buildTemplateView, childSlotOrder, WIREFRAMES, ZONE_SIZE_LABEL, type Wireframe } from './rowTemplates';
import { WEIGHT_FLEX } from './areas';
import type { SPElement } from '../core/types';
import {
  el, segmented, STAGE_WIDTHS,
  FIELD_MIME, COMPONENT_MIME, ZONE_MIME, ITEM_MIME,
  type Mode, type ModalUI, type ModalApi,
} from './templateUi';

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

function renderGallery(host: HTMLElement, api: ModalApi): void {
  host.appendChild(el('div', 'wb-template-gallery-title', 'Start from a layout'));
  host.appendChild(el('div', 'wb-template-gallery-sub',
    'Each layout is a set of zones. Drop fields and components into them, then tune how every zone shares space and wraps.'));
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
  if (ui.stage === 'pick') { renderGallery(host, api); return; }

  const head = el('div', 'wb-template-prev-head');
  const left = el('div', 'wb-template-prev-headgroup');
  const back = el('button', 'wb-template-mini wb-template-layouts', '▤ Layouts') as HTMLButtonElement;
  back.type = 'button';
  back.title = 'Start from a different pre-built layout';
  back.addEventListener('click', () => api.openGallery());
  left.append(el('span', 'wb-template-prev-title', 'Preview'), back);
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
  if (kids.length !== slots.length) { addEndGap(editRoot, api); return; } // fail-safe

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
  addEndGap(editRoot, api);
}

function acceptedPayload(dt: DataTransfer | null): boolean {
  return Boolean(dt && [FIELD_MIME, COMPONENT_MIME, ZONE_MIME, ITEM_MIME].some((m) => dt.types.includes(m)));
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
  const tag = el('span', 'wb-edit-zone-tag', `${zone.label} · ${ZONE_SIZE_LABEL[zone.size]}`);
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
    if (acceptedPayload((e as DragEvent).dataTransfer)) {
      e.preventDefault();
      node.classList.add('wb-drop-hover');
    }
  });
  node.addEventListener('dragleave', () => node.classList.remove('wb-drop-hover'));
  node.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    node.classList.remove('wb-drop-hover');
    const dt = (e as DragEvent).dataTransfer;
    if (!dt) return;
    const fld = dt.getData(FIELD_MIME);
    if (fld) { api.dropField(zi, fld); return; }
    const comp = dt.getData(COMPONENT_MIME);
    if (comp) { api.dropComponent(zi, comp); return; }
    const item = dt.getData(ITEM_MIME);
    if (item) {
      const [fz, fi] = item.split(':').map(Number);
      if (Number.isInteger(fz) && Number.isInteger(fi)) api.moveItem(fz, fi, zi, ui.config.zones[zi].items.length);
      return;
    }
    const from = Number(dt.getData(ZONE_MIME));
    if (Number.isInteger(from)) api.reorderZone(from, zi); // ignore empty/garbage payloads
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
  // an item is a positional drop target for OTHER items (insert before it);
  // field/component chips fall through to the zone (append)
  node.addEventListener('dragover', (e) => {
    const dt = (e as DragEvent).dataTransfer;
    if (dt?.types.includes(ITEM_MIME)) {
      e.preventDefault();
      e.stopPropagation();
      node.classList.add('wb-drop-hover');
    }
  });
  node.addEventListener('dragleave', () => node.classList.remove('wb-drop-hover'));
  node.addEventListener('drop', (e) => {
    const dt = (e as DragEvent).dataTransfer;
    const payload = dt?.getData(ITEM_MIME);
    if (!payload) return; // chip drops bubble to the zone handler
    e.preventDefault();
    e.stopPropagation();
    node.classList.remove('wb-drop-hover');
    const [fz, fi] = payload.split(':').map(Number);
    if (!Number.isInteger(fz) || !Number.isInteger(fi)) return;
    // moving forward within the same zone: the removal shifts our slot left
    const to = fz === zi && fi < ii ? ii - 1 : ii;
    api.moveItem(fz, fi, zi, to);
  });
}

function makeDivider(leftZoneIdx: number, ui: ModalUI, api: ModalApi): HTMLElement {
  const d = el('div', 'wb-edit-divider');
  const next = ZONE_SIZE_LABEL[ui.config.zones[leftZoneIdx].size];
  d.title = `Resize: click to cycle the left zone (now ${next}: Hug → Fill → Fill 2× → Fill 3×)`;
  d.addEventListener('click', (e) => { e.stopPropagation(); api.cycleZoneSize(leftZoneIdx); });
  return d;
}

function addEndGap(editRoot: HTMLElement, api: ModalApi): void {
  const gap = el('div', 'wb-edit-endgap', '＋ drop for a new zone');
  gap.addEventListener('dragover', (e) => {
    const dt = (e as DragEvent).dataTransfer;
    if (dt && (dt.types.includes(FIELD_MIME) || dt.types.includes(COMPONENT_MIME))) {
      e.preventDefault();
      gap.classList.add('wb-drop-hover');
    }
  });
  gap.addEventListener('dragleave', () => gap.classList.remove('wb-drop-hover'));
  gap.addEventListener('drop', (e) => {
    e.preventDefault();
    gap.classList.remove('wb-drop-hover');
    const dt = (e as DragEvent).dataTransfer;
    if (!dt) return;
    const field = dt.getData(FIELD_MIME);
    if (field) { api.dropNewZone({ field }); return; }
    const componentId = dt.getData(COMPONENT_MIME);
    if (componentId) api.dropNewZone({ componentId });
  });
  editRoot.appendChild(gap);
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
