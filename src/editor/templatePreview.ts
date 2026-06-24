/**
 * editor/templatePreview.ts — the FIELDS bar (drag source) and the PREVIEW
 * canvas. The canvas renders the row with the REAL renderer (same path as the
 * live grid), then:
 *   • Edit mode  — clones the rendered row to strip the renderer's own click
 *     handlers, then decorates each block as selectable / droppable / draggable,
 *     with dividers (resize) and a trailing drop-gap (add). The clone is throwaway
 *     preview DOM — Apply rebuilds cleanly from config, so nothing leaks.
 *   • Preview mode — renders up to 3 live rows; hover and custom kebab flyouts
 *     are real, native kebab / row-click are honest stubs via onAction.
 */
import { state } from './state';
import { renderElement, type RenderOptions } from '../core/renderer';
import { evaluate, type EvalContext } from '../core/expressions';
import { ctxForRow, resolveColumnRef } from './previewCtx';
import { buildTemplateView, childSlotOrder } from './rowTemplates';
import type { SPElement } from '../core/types';
import { el, segmented, FIELD_MIME, ORDER_MIME, type Mode, type ModalUI, type ModalApi } from './templateUi';

// ─── FIELDS bar (pinned drag source) ─────────────────────────────────────────

export function renderFields(host: HTMLElement, ui: ModalUI, _api: ModalApi): void {
  host.innerHTML = '';
  host.appendChild(el('span', 'wb-template-fields-label', 'Fields'));
  const bar = el('div', 'wb-template-chips');
  for (const f of state.fields) {
    const chip = el('span', 'wb-template-field-chip', f.displayName ?? f.name);
    chip.dataset.field = f.name;
    if (ui.config.areas.some((a) => a.fieldName === f.name)) chip.classList.add('wb-chip-placed');
    if (ui.mode === 'edit') {
      chip.draggable = true;
      chip.addEventListener('dragstart', (e) => { (e as DragEvent).dataTransfer?.setData(FIELD_MIME, f.name); });
    } else {
      chip.classList.add('wb-chip-inert');
    }
    bar.appendChild(chip);
  }
  host.appendChild(bar);
}

// ─── PREVIEW canvas ──────────────────────────────────────────────────────────

export function renderPreview(host: HTMLElement, ui: ModalUI, api: ModalApi): void {
  host.innerHTML = '';

  const head = el('div', 'wb-template-prev-head');
  head.appendChild(el('span', 'wb-template-prev-title', 'Preview'));
  head.appendChild(segmented<Mode>('mode', [['edit', 'Edit'], ['preview', 'Preview']], ui.mode, (m) => api.setMode(m)));
  host.appendChild(head);

  const body = el('div', 'wb-template-prev-body');
  host.appendChild(body);

  const { root, additionalRowClass } = buildTemplateView(ui.config, state.fields, state.columnRefs, api.palette());
  if (ui.mode === 'edit') renderEditExemplar(body, root, additionalRowClass, ui, api);
  else renderLiveRows(body, root, additionalRowClass, ui, api);

  host.appendChild(statusStrip(ui));
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
  // click in Edit selects a block rather than firing the row's real behavior.
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
  if (kids.length !== slots.length) { addEndGap(editRoot, config.areas.length, api); return; } // fail-safe

  let prevArea: number | null = null;
  slots.forEach((slot, k) => {
    const node = kids[k];
    if (slot === 'kebab') {
      node.classList.add('wb-edit-kebab');
      node.title = 'Row actions — configure in the inspector';
      node.addEventListener('click', (e) => { e.stopPropagation(); api.selectKebab(); }, true);
      prevArea = null;
      return;
    }
    decorateBlock(node, slot, ui, api);
    if (prevArea !== null) editRoot.insertBefore(makeDivider(prevArea, api), node);
    prevArea = slot;
  });
  addEndGap(editRoot, config.areas.length, api);
}

function decorateBlock(node: HTMLElement, i: number, ui: ModalUI, api: ModalApi): void {
  const a = ui.config.areas[i];
  node.classList.add('wb-edit-block');
  node.dataset.editArea = String(i);
  if (a.fieldName) {
    node.dataset.fieldName = a.fieldName;
  } else {
    node.classList.add('wb-edit-empty');
    node.appendChild(el('span', 'wb-edit-empty-hint', '＋ field'));
  }
  if (ui.selected === i) node.classList.add('wb-edit-selected');
  node.setAttribute('draggable', 'true');

  node.addEventListener('click', (e) => { e.stopPropagation(); api.select(i); }, true);
  node.addEventListener('dragstart', (e) => { (e as DragEvent).dataTransfer?.setData(ORDER_MIME, String(i)); });
  node.addEventListener('dragover', (e) => {
    const dt = (e as DragEvent).dataTransfer;
    if (dt && (dt.types.includes(FIELD_MIME) || dt.types.includes(ORDER_MIME))) {
      e.preventDefault();
      node.classList.add('wb-drop-hover');
    }
  });
  node.addEventListener('dragleave', () => node.classList.remove('wb-drop-hover'));
  node.addEventListener('drop', (e) => {
    e.preventDefault();
    node.classList.remove('wb-drop-hover');
    const dt = (e as DragEvent).dataTransfer;
    if (!dt) return;
    const fld = dt.getData(FIELD_MIME);
    if (fld) { api.assign(i, fld); return; }
    const from = Number(dt.getData(ORDER_MIME));
    if (Number.isInteger(from)) api.reorder(from, i); // ignore empty/garbage payloads
  });
}

function makeDivider(leftAreaIdx: number, api: ModalApi): HTMLElement {
  const d = el('div', 'wb-edit-divider');
  d.title = 'Resize: click to cycle the left block width (Normal → Wide → Widest)';
  d.addEventListener('click', (e) => { e.stopPropagation(); api.cycleWeight(leftAreaIdx); });
  return d;
}

function addEndGap(editRoot: HTMLElement, areaCount: number, api: ModalApi): void {
  const empty = areaCount === 0;
  const gap = el('div', 'wb-edit-endgap', empty ? 'Drag a field here to start' : '＋ drop a field');
  if (empty) gap.classList.add('wb-edit-endgap--empty');
  gap.addEventListener('dragover', (e) => {
    const dt = (e as DragEvent).dataTransfer;
    if (dt?.types.includes(FIELD_MIME)) { e.preventDefault(); gap.classList.add('wb-drop-hover'); }
  });
  gap.addEventListener('dragleave', () => gap.classList.remove('wb-drop-hover'));
  gap.addEventListener('drop', (e) => {
    e.preventDefault();
    gap.classList.remove('wb-drop-hover');
    const f = (e as DragEvent).dataTransfer?.getData(FIELD_MIME);
    if (f) api.add(f);
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
    ? 'Edit — drag fields onto blocks, click a block to style it, click a divider to resize.'
    : 'Preview — hover & custom kebab flyouts are live; the native menu and row-click are honest stubs.');
}

function applyRowClass(prow: HTMLElement, expr: string | undefined, ctx: EvalContext): void {
  if (!expr) return;
  try {
    const cls = String(evaluate(expr, ctx) ?? '').trim();
    if (cls) for (const c of cls.split(/\s+/)) prow.classList.add(c);
  } catch { /* preview-only — ignore evaluation noise */ }
}
