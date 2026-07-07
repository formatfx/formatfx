// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0 (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * editor/templateInspector.ts — the contextual inspector. With a block selected
 * it edits that block (field shown, width/wrap/align, remove); with nothing
 * selected it edits the row (style, density, toggles, "start from" skeleton) and
 * the kebab. Every control is a segmented group or checkbox — no dropdowns — and
 * blank kebab params are refused with an inline hint, mirroring the engine.
 */
import { state } from './state';
import {
  composeRowStyle,
  type RowStyle, type KebabBehavior, type KebabPosition, type KebabActionFlags, type RowTemplateId,
} from './rowTemplates';
import type { AreaWeight, RowDensity } from './areas';
import { el, segmented, toggleCtl, type ModalUI, type ModalApi } from './templateUi';

export function renderInspector(host: HTMLElement, ui: ModalUI, api: ModalApi): void {
  host.innerHTML = '';

  const head = el('div', 'wb-template-insp-head');
  head.appendChild(el('span', 'wb-template-insp-title',
    ui.selected != null ? `Block ${ui.selected + 1}` : 'Row'));
  const dock = el('button', 'wb-template-dock', ui.dock === 'bottom' ? '⇤ dock left' : '⇥ dock bottom') as HTMLButtonElement;
  dock.type = 'button';
  dock.addEventListener('click', () => api.toggleDock());
  head.appendChild(dock);
  host.appendChild(head);

  const body = el('div', 'wb-template-insp-body');
  host.appendChild(body);

  if (ui.mode === 'preview') {
    body.appendChild(el('div', 'wb-template-note', 'Switch to Edit to change the layout.'));
  } else if (ui.selected != null && ui.config.areas[ui.selected]) {
    renderBlockView(body, ui, api);
  } else {
    renderRowView(body, ui, api);
  }

  host.appendChild(renderFooter(api));
}

// ─── block view ──────────────────────────────────────────────────────────────

function renderBlockView(host: HTMLElement, ui: ModalUI, api: ModalApi): void {
  const i = ui.selected as number;
  const a = ui.config.areas[i];
  const field = state.fields.find((f) => f.name === a.fieldName);

  host.appendChild(section('Field'));
  const fieldRow = el('div', 'wb-template-fieldrow');
  fieldRow.appendChild(el('span', 'wb-template-fieldname',
    field ? (field.displayName ?? field.name) : '(empty — drag a field onto the block)'));
  if (a.fieldName) {
    const clr = el('button', 'wb-template-mini', 'Clear') as HTMLButtonElement;
    clr.type = 'button';
    clr.addEventListener('click', () => api.assign(i, ''));
    fieldRow.appendChild(clr);
  }
  host.appendChild(fieldRow);

  host.appendChild(section('Width'));
  host.appendChild(segmented<AreaWeight>('weight',
    [['normal', 'Normal'], ['wide', 'Wide'], ['widest', 'Widest']], a.weight,
    (w) => api.patchArea(i, { weight: w })));

  host.appendChild(section('Wrapping'));
  host.appendChild(segmented<'wrap' | 'truncate'>('wrap',
    [['truncate', 'Truncate'], ['wrap', 'Wrap']], a.wrapping,
    (w) => api.patchArea(i, { wrapping: w })));

  host.appendChild(section('Align'));
  host.appendChild(segmented<'left' | 'center' | 'right'>('align',
    [['left', 'Left'], ['center', 'Center'], ['right', 'Right']], a.align,
    (al) => api.patchArea(i, { align: al })));

  const rm = el('button', 'wb-template-remove', '✕ Remove block') as HTMLButtonElement;
  rm.type = 'button';
  rm.setAttribute('aria-label', 'Remove block');
  rm.addEventListener('click', () => api.remove(i));
  host.appendChild(rm);
}

// ─── row view + kebab ────────────────────────────────────────────────────────

function renderRowView(host: HTMLElement, ui: ModalUI, api: ModalApi): void {
  const config = ui.config;
  const composed = composeRowStyle(config, api.palette());

  host.appendChild(section('Row style'));
  host.appendChild(segmented<RowStyle>('rowstyle',
    [['flat', 'Flat'], ['card', 'Card'], ['minimalist', 'Minimalist']], config.rowStyle,
    (v) => api.setConfig({ ...config, rowStyle: v })));

  host.appendChild(section('Density'));
  host.appendChild(segmented<RowDensity>('density',
    [['roomy', 'Roomy'], ['compact', 'Compact']], config.density,
    (v) => api.setConfig({ ...config, density: v })));

  host.appendChild(section('Style toggles'));
  host.appendChild(toggleCtl('border', 'Border', config.borderStyle !== 'none', composed.disabled.border,
    (on) => api.setConfig({ ...config, borderStyle: on ? 'solid' : 'none' })));
  host.appendChild(toggleCtl('zebra', 'Zebra striping', config.zebraStriping, composed.disabled.zebra,
    (on) => api.setConfig({ ...config, zebraStriping: on })));
  host.appendChild(toggleCtl('hoverHighlight', 'Hover highlight', config.hoverHighlight, composed.disabled.hoverHighlight,
    (on) => api.setConfig({ ...config, hoverHighlight: on })));
  host.appendChild(toggleCtl('leftStripe', 'Left accent stripe', config.leftStripe !== 'none', composed.disabled.leftStripe,
    (on) => api.setConfig({ ...config, leftStripe: on ? 'neutral' : 'none' })));

  host.appendChild(section('Start from'));
  const skels = el('div', 'wb-template-skels');
  (([['split', 'Split'], ['avatar', 'Avatar'], ['equal', 'Equal'], ['header-detail', 'Header+detail']]) as [RowTemplateId, string][])
    .forEach(([id, label]) => {
      const b = el('button', 'wb-template-mini', label) as HTMLButtonElement;
      b.type = 'button';
      b.dataset.skeleton = id;
      if (id === config.templateId) b.classList.add('wb-seg-on');
      b.addEventListener('click', () => api.reseed(id));
      skels.appendChild(b);
    });
  host.appendChild(skels);

  renderKebabSection(host, ui, api);
}

function renderKebabSection(host: HTMLElement, ui: ModalUI, api: ModalApi): void {
  const config = ui.config;
  const k = config.kebab;
  host.appendChild(section('Row actions (kebab)'));
  host.appendChild(toggleCtl('kebab', 'Enable kebab', k.enabled, undefined,
    (on) => api.setConfig({ ...config, kebab: { ...k, enabled: on } })));
  if (!k.enabled) return;

  host.appendChild(segmented<KebabBehavior>('kebabBehavior',
    [['native', 'Native'], ['custom', 'Custom']], k.behavior,
    (v) => api.setConfig({ ...config, kebab: { ...k, behavior: v } })));
  host.appendChild(segmented<KebabPosition>('kebabPos',
    [['left', 'Left'], ['title', 'After title'], ['right', 'Right'], ['hover', 'Hover']], k.position,
    (v) => api.setConfig({ ...config, kebab: { ...k, position: v } })));

  if (k.behavior === 'native') {
    host.appendChild(el('div', 'wb-template-note', "Native opens SharePoint's built-in item menu."));
    return;
  }

  host.appendChild(el('div', 'wb-template-subsection', 'Actions'));
  const setAction = (key: keyof KebabActionFlags, on: boolean): void =>
    api.setConfig({ ...config, kebab: { ...k, actions: { ...k.actions, [key]: on } } });
  const setK = (patch: Partial<typeof k>): void => api.setConfig({ ...config, kebab: { ...k, ...patch } });

  (([['defaultClick', 'Open'], ['editProps', 'Edit'], ['share', 'Share'], ['delete', 'Delete'],
    ['executeFlow', 'Run flow'], ['setValue', 'Set value']]) as [keyof KebabActionFlags, string][])
    .forEach(([key, label]) => {
      host.appendChild(toggleCtl(`kebab-${key}`, label, k.actions[key], undefined, (on) => setAction(key, on)));
    });

  if (k.actions.executeFlow) {
    host.appendChild(textField('Flow ID', k.flowId ?? '', (v) => setK({ flowId: v })));
    if (!k.flowId?.trim()) host.appendChild(hint('Add a flow ID to enable the Run-flow action.'));
  }
  if (k.actions.setValue) {
    host.appendChild(textField('Set field', k.setValueField ?? '', (v) => setK({ setValueField: v })));
    host.appendChild(textField('To value', k.setValueVal ?? '', (v) => setK({ setValueVal: v })));
    if (!(k.setValueField?.trim() && k.setValueVal?.trim())) {
      host.appendChild(hint('Add a field and value to enable the Set-value action.'));
    }
  }
}

// ─── small helpers ───────────────────────────────────────────────────────────

function section(label: string): HTMLElement {
  return el('div', 'wb-template-section', label);
}

function hint(text: string): HTMLElement {
  return el('div', 'wb-template-hint', text);
}

/** A text input that commits on `change` (blur/Enter) — never on every keystroke,
 *  so the rerender that follows can't steal focus mid-type. */
function textField(label: string, value: string, onCommit: (v: string) => void): HTMLElement {
  const wrap = el('label', 'wb-template-ctl');
  wrap.appendChild(el('span', undefined, label));
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.value = value;
  inp.addEventListener('change', () => onCommit(inp.value));
  wrap.appendChild(inp);
  return wrap;
}

function renderFooter(api: ModalApi): HTMLElement {
  const footer = el('div', 'wb-template-buttons');
  const cancel = el('button', 'wb-template-cancel', 'Cancel') as HTMLButtonElement;
  cancel.type = 'button';
  cancel.addEventListener('click', () => api.cancel());
  const apply = el('button', 'wb-template-apply', 'Apply') as HTMLButtonElement;
  apply.type = 'button';
  apply.disabled = !api.canApply();
  apply.title = apply.disabled ? 'Add at least one field to a block first' : '';
  apply.addEventListener('click', () => api.apply());
  footer.append(cancel, apply);
  return footer;
}
