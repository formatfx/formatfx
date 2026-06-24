/**
 * editor/templateModal.ts — the "Templates…" modal: a config pane (left) and a
 * multi-row live preview (right). Apply is ONE undoable mutation via
 * state.applyRowTemplate, gated by the structural isPureGrid safety check.
 * The pure brain (skeletons, style precedence, kebab) lives in rowTemplates.ts;
 * this file is the thin DOM caller.
 */
import { state } from './state';
import { renderElement, type RenderOptions } from '../core/renderer';
import { evaluate } from '../core/expressions';
import { themePalette } from '../core/theme';
import { isPureGrid } from './gridScaffold';
import { ctxForRow, resolveColumnRef } from './previewCtx';
import {
  defaultConfigFor, buildTemplateView, composeRowStyle,
  type RowTemplateConfig, type RowTemplateId, type RowStyle, type StyleToggle,
} from './rowTemplates';

const TEMPLATES: [RowTemplateId, string][] = [
  ['split', 'Split (Title + 2 areas)'],
  ['avatar', 'Avatar + Title + details'],
  ['equal', 'Equal columns'],
  ['header-detail', 'Header + detail'],
];
const ROW_STYLES: [RowStyle, string][] = [
  ['flat', 'Flat'], ['card', 'White card'], ['minimalist', 'Minimalist'],
];
/** Drag MIME for a field chip → area drop, mirroring the palette/tree/grid channels. */
const FIELD_MIME = 'application/x-wb-field';

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/** Deep-clone the (pure-data) config — JSON, not structuredClone, so it doesn't
 *  depend on a global the test DOM environment may not provide. */
function cloneCfg(c: RowTemplateConfig): RowTemplateConfig {
  return JSON.parse(JSON.stringify(c)) as RowTemplateConfig;
}

export function openTemplateModal(onToast: (m: string) => void): void {
  let config: RowTemplateConfig = defaultConfigFor('split', state.fields);

  const overlay = el('div', 'wb-template-modal-overlay');
  const modal = el('div', 'wb-template-modal');
  const pane = el('div', 'wb-template-config');
  const preview = el('div', 'wb-template-preview');
  modal.append(pane, preview);
  overlay.appendChild(modal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);

  const setConfig = (next: RowTemplateConfig): void => { config = next; rerender(); };

  function rerender(): void {
    const composed = composeRowStyle(config, themePalette(state.themeMode));
    renderConfigPane(pane, config, composed.disabled, setConfig, onToast, overlay);
    renderPreview(preview, config);
  }
  rerender();
}

function renderConfigPane(
  pane: HTMLElement, config: RowTemplateConfig,
  disabled: Partial<Record<StyleToggle, string>>,
  setConfig: (c: RowTemplateConfig) => void,
  onToast: (m: string) => void, overlay: HTMLElement,
): void {
  pane.innerHTML = '';
  pane.appendChild(el('h2', 'wb-template-title', 'Row layout template'));

  pane.appendChild(labeledSelect('Template', 'templateId', TEMPLATES, config.templateId,
    (v) => setConfig(defaultConfigFor(v as RowTemplateId, state.fields)))); // skeleton reseeds areas

  pane.appendChild(el('div', 'wb-template-section', 'Areas'));
  pane.appendChild(fieldChips());
  config.areas.forEach((_a, i) => pane.appendChild(areaRow(config, i, setConfig)));

  pane.appendChild(el('div', 'wb-template-section', 'Row style'));
  pane.appendChild(labeledSelect('Style', 'rowStyle', ROW_STYLES, config.rowStyle,
    (v) => setConfig({ ...config, rowStyle: v as RowStyle })));
  pane.appendChild(toggle('border', 'Border', config.borderStyle !== 'none', disabled.border,
    (on) => setConfig({ ...config, borderStyle: on ? 'solid' : 'none' })));
  pane.appendChild(toggle('zebra', 'Zebra striping', config.zebraStriping, disabled.zebra,
    (on) => setConfig({ ...config, zebraStriping: on })));
  pane.appendChild(toggle('hoverHighlight', 'Hover highlight', config.hoverHighlight, disabled.hoverHighlight,
    (on) => setConfig({ ...config, hoverHighlight: on })));
  pane.appendChild(toggle('leftStripe', 'Left accent stripe', config.leftStripe !== 'none', disabled.leftStripe,
    (on) => setConfig({ ...config, leftStripe: on ? 'neutral' : 'none' })));

  const actions = el('div', 'wb-template-buttons');
  const cancel = el('button', 'wb-template-cancel', 'Cancel');
  cancel.addEventListener('click', () => overlay.remove());
  const apply = el('button', 'wb-template-apply', 'Apply') as HTMLButtonElement;
  apply.addEventListener('click', () => {
    // structural click-safety gate: confirm only when the current row layout is
    // genuinely hand-built (not a pristine grid). Single-undo is the safety net.
    const dirty = state.doc.kind !== 'grid' && !isPureGrid(state.doc.root);
    if (dirty && !confirm('Replace the current row layout with this template? Ctrl+Z reverts it in one step.')) return;
    const { root, additionalRowClass } = buildTemplateView(config, state.fields, state.columnRefs, themePalette(state.themeMode));
    state.applyRowTemplate(root, additionalRowClass);
    onToast('Template applied');
    overlay.remove();
  });
  actions.append(cancel, apply);
  pane.appendChild(actions);
}

function renderPreview(host: HTMLElement, config: RowTemplateConfig): void {
  host.innerHTML = '';
  const { root, additionalRowClass } = buildTemplateView(config, state.fields, state.columnRefs, themePalette(state.themeMode));
  const opts: RenderOptions = { tagPaths: false, resolveColumnRef, issues: [] };
  // 3 rows so zebra alternation is visible (a single row never shows the stripe).
  const rowCount = Math.min(3, Math.max(1, state.rows.length));
  for (let i = 0; i < rowCount; i++) {
    const ctx = ctxForRow(i);
    const wrap = el('div', 'wb-template-prow');
    if (additionalRowClass) {
      try {
        const cls = String(evaluate(additionalRowClass, ctx) ?? '').trim();
        if (cls) for (const c of cls.split(/\s+/)) wrap.classList.add(c);
      } catch { /* preview-only — ignore evaluation noise */ }
    }
    try {
      wrap.appendChild(renderElement(root, ctx, opts));
    } catch (e) {
      wrap.textContent = `⚠ ${(e as Error).message}`;
    }
    host.appendChild(wrap);
  }
  // Honesty labels for what a static single-tenant preview cannot fully show.
  if (config.kebab.enabled && config.kebab.behavior === 'native') {
    host.appendChild(el('div', 'wb-template-note', 'The native kebab opens the SharePoint item menu on a real list — not emulated here.'));
  }
  if (config.hoverHighlight) {
    host.appendChild(el('div', 'wb-template-note', 'Hover highlight shows on pointer-over in the real list.'));
  }
}

// ─── controls ────────────────────────────────────────────────────────────────

function labeledSelect(
  label: string, field: string, opts: [string, string][], value: string, onChange: (v: string) => void,
): HTMLElement {
  const wrap = el('label', 'wb-template-ctl');
  wrap.appendChild(el('span', undefined, label));
  const sel = document.createElement('select');
  sel.dataset.field = field;
  for (const [v, t] of opts) {
    const o = document.createElement('option');
    o.value = v; o.textContent = t;
    sel.appendChild(o);
  }
  sel.value = value; // set after options exist (robust across DOM impls)
  sel.addEventListener('change', () => onChange(sel.value));
  wrap.appendChild(sel);
  return wrap;
}

function toggle(
  name: StyleToggle, label: string, checked: boolean, disabledReason: string | undefined, onChange: (on: boolean) => void,
): HTMLElement {
  const wrap = el('label', 'wb-template-ctl wb-template-toggle');
  wrap.dataset.toggle = name;
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = checked && !disabledReason;
  if (disabledReason) {
    wrap.classList.add('wb-disabled');
    wrap.title = disabledReason;        // the reason is shown, so the exclusion is FELT
    cb.disabled = true;
  }
  cb.addEventListener('change', () => onChange(cb.checked));
  wrap.append(cb, el('span', undefined, label));
  return wrap;
}

function areaRow(config: RowTemplateConfig, i: number, setConfig: (c: RowTemplateConfig) => void): HTMLElement {
  const row = el('div', 'wb-template-area');
  row.dataset.area = String(i);
  const sel = document.createElement('select');
  sel.dataset.field = 'areaField';
  const none = document.createElement('option');
  none.value = ''; none.textContent = `Area ${i + 1}: (empty)`;
  sel.appendChild(none);
  for (const f of state.fields) {
    const o = document.createElement('option');
    o.value = f.name; o.textContent = f.displayName ?? f.name;
    sel.appendChild(o);
  }
  sel.value = config.areas[i].fieldName; // set after options exist (robust across DOM impls)
  sel.addEventListener('change', () => {
    const next = cloneCfg(config);
    next.areas[i].fieldName = sel.value;
    setConfig(next);
  });
  row.appendChild(sel);

  // drop target — accept a field chip dragged from the palette above (both the
  // dropdown AND drag-drop, per the maker's "why not both 1 and 3?").
  row.addEventListener('dragover', (e) => {
    if ((e as DragEvent).dataTransfer?.types.includes(FIELD_MIME)) {
      e.preventDefault();
      row.classList.add('wb-drop-hover');
    }
  });
  row.addEventListener('dragleave', () => row.classList.remove('wb-drop-hover'));
  row.addEventListener('drop', (e) => {
    row.classList.remove('wb-drop-hover');
    const name = (e as DragEvent).dataTransfer?.getData(FIELD_MIME);
    if (!name) return;
    e.preventDefault();
    const next = cloneCfg(config);
    next.areas[i].fieldName = name;
    setConfig(next);
  });
  return row;
}

/** Draggable field chips — the drag SOURCE that pairs with the area drop targets. */
function fieldChips(): HTMLElement {
  const box = el('div', 'wb-template-chips');
  for (const f of state.fields) {
    const chip = el('span', 'wb-template-field-chip', f.displayName ?? f.name);
    chip.draggable = true;
    chip.dataset.field = f.name;
    chip.addEventListener('dragstart', (e) => {
      (e as DragEvent).dataTransfer?.setData(FIELD_MIME, f.name);
    });
    box.appendChild(chip);
  }
  return box;
}
