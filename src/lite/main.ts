// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Sam Yost

/**
 * lite/main.ts — FormatFX Lite, the cards-only test page (lite.html).
 *
 * The pitch: Copilot can make a SharePoint card; Lite makes it look right.
 * Start from a card or paste one, click a part, then drag, resize, nudge
 * and recolor it, and copy the JSON. No formula bar, no JSON editor, no
 * tree: the main app keeps all of that.
 *
 * Every change to the card goes through commit(), so one gesture is one
 * undo step: a drag commits once on release, and held arrow keys merge.
 */

import './lite.css';
import { applyTheme } from '../core/theme';
import { renderElement, closeFlyout } from '../core/renderer';
import { importJson } from '../core/serializer';
import type { FormatterDocument, SPElement } from '../core/types';
import {
  STARTERS, DEFAULT_W, DEFAULT_H, type Rect, type Target,
  cardSize, innerSize, borderWidth, partIndices, partRect, partKind, partName, isFreeCard, isRule, px,
  setPartRect, setStyle, setStyles, setText, setFontSize, renamePart, addPart, removePart, duplicatePart, moveLayer,
  setCardSize, bindableFields, boundField, fieldText, newText, newShape, newPhoto, centered, exportCard,
} from './model';
import { snapLines, snapMove, snapResize, resizeRect, nudge, type Handle, type Guide, type Lines } from './snap';
import { flattenCard } from './flatten';
import { domMeasure } from './measure';
import { sampleFields, sampleRows, withExtraFields, ctxFor } from './sample';

type Doc = FormatterDocument;

const STORE_KEY = 'formatfx-lite:v1';
const SNAP_PX = 6; // snap reach on screen, in CSS px
const DRAG_START_PX = 3; // movement before a press becomes a drag
const NUDGE_MERGE_MS = 900; // rapid or held arrow presses = one undo step
const ALL_HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const CARD_HANDLES: Handle[] = ['e', 's', 'se'];

const PALETTE = [
  '#ffffff', '#f3f2f1', '#edebe9', '#a19f9d', '#605e5c', '#323130',
  '#deecf9', '#c7e0f4', '#0078d4', '#004578', '#dff6dd', '#107c10',
  '#fde7e9', '#d13438', '#a4262c', '#fff4ce', '#ffb900', '#8764b8',
];

const S = {
  doc: STARTERS[0].build() as Doc,
  fields: sampleFields(),
  rows: sampleRows(),
  row: 0,
  sel: null as Target | null,
  past: [] as Doc[],
  future: [] as Doc[],
  guides: [] as Guide[],
  chip: null as string | null,
  zoom: 1,
  stripScale: 0.75,
  lastNudge: { index: -1, at: 0 },
};

// ─── tiny DOM helpers ────────────────────────────────────────────────────────

type Kid = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean | undefined> = {}, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') node.className = String(v);
    else if (k === 'text') node.textContent = String(v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids) if (kid) node.append(kid);
  return node;
}

const SVG: Record<string, string> = {
  undo: '<path d="M5.5 3.5 2.5 6.5l3 3"/><path d="M3 6.5h6.5a3.5 3.5 0 0 1 0 7H7"/>',
  redo: '<path d="M10.5 3.5l3 3-3 3"/><path d="M13 6.5H6.5a3.5 3.5 0 0 0 0 7H9"/>',
  minus: '<path d="M3 8h10"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  left: '<path d="M2.5 4h11M2.5 8h7M2.5 12h9"/>',
  center: '<path d="M2.5 4h11M4.5 8h7M3.5 12h9"/>',
  right: '<path d="M2.5 4h11M6.5 8h7M4.5 12h9"/>',
  wrap: '<path d="M2.5 4h11M2.5 8h8.5a2 2 0 0 1 0 4H8"/><path d="M9.5 10.5 8 12l1.5 1.5"/><path d="M2.5 12h3"/>',
  forward: '<path d="M8 13V3.5M4.5 7 8 3.5 11.5 7"/>',
  back: '<path d="M8 3v9.5M4.5 9 8 12.5 11.5 9"/>',
  copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 3.5V3a.5.5 0 0 0-.5-.5H3a.5.5 0 0 0-.5.5v7a.5.5 0 0 0 .5.5h.5"/>',
  trash: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 9h5.8l.6-9"/>',
  add: '<path d="M8 3v10M3 8h10"/>',
};

function icon(name: string): HTMLElement {
  const span = h('span', { 'aria-hidden': 'true', class: 'lt-svg' });
  span.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${SVG[name]}</svg>`;
  span.style.display = 'inline-grid';
  return span;
}

function button(label: string, onClick: () => void, opts: { svg?: string; cls?: string; title?: string; pressed?: boolean; disabled?: boolean; showLabel?: boolean } = {}): HTMLButtonElement {
  const iconOnly = opts.svg && !opts.showLabel;
  const b = h('button', {
    type: 'button',
    class: `lt-btn${iconOnly ? ' lt-icon' : ''}${opts.cls ? ` ${opts.cls}` : ''}`,
    'aria-label': iconOnly ? label : undefined,
    title: opts.title ?? (iconOnly ? label : undefined),
    'aria-pressed': opts.pressed === undefined ? undefined : String(opts.pressed),
    disabled: opts.disabled,
    'data-key': label, // lets renderCtx() put focus back after a re-render
  }, opts.svg ? icon(opts.svg) : null, iconOnly ? null : label);
  b.addEventListener('click', onClick);
  return b;
}

// ─── state changes ───────────────────────────────────────────────────────────

function save(): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ doc: S.doc, row: S.row }));
  } catch { /* private mode or full storage: the card still works, it just won't survive a reload */ }
}

const referencedFields = (text: string): string[] =>
  [...new Set([...text.matchAll(/\[\$([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]))];

function load(): void {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as { doc?: Doc; row?: number };
    if (!saved.doc || !isFreeCard(saved.doc)) return;
    S.doc = saved.doc;
    withExtraFields(S.fields, S.rows, referencedFields(raw));
    S.row = Math.min(Math.max(0, saved.row ?? 0), S.rows.length - 1);
  } catch { /* unreadable storage: start from the default card */ }
}

/** Make `next` the card, with `before` as the undo step. */
function commit(next: Doc, before: Doc = S.doc): void {
  if (next === before) return;
  S.past.push(before);
  if (S.past.length > 200) S.past.shift();
  S.future = [];
  S.doc = next;
  changed();
}

function changed(): void {
  if (typeof S.sel === 'number' && !partIndices(S.doc).includes(S.sel)) S.sel = null;
  save();
  fit();
  renderAll();
}

function undo(): void {
  const prev = S.past.pop();
  if (!prev) return;
  S.future.push(S.doc);
  S.doc = prev;
  changed();
}

function redo(): void {
  const next = S.future.pop();
  if (!next) return;
  S.past.push(S.doc);
  S.doc = next;
  changed();
}

function select(t: Target | null): void {
  if (S.sel === t) return;
  S.sel = t;
  renderOverlay();
  renderCtx();
}

// ─── shell ───────────────────────────────────────────────────────────────────

const app = h('div', { class: 'lt-app' });
const bar = h('header', { class: 'lt-bar' });
const ctxBar = h('div', { class: 'lt-ctx', role: 'toolbar', 'aria-label': 'Selected part' });
const canvas = h('main', { class: 'lt-canvas' });
const stage = h('div', { class: 'lt-stage', tabindex: '0', 'aria-label': 'Card editor. Tab selects the next part; arrow keys move it.' });
const host = h('div', { class: 'lt-card-host' });
const overlay = h('div', { class: 'lt-overlay' });
const hint = h('p', { class: 'lt-hint', text: 'Drag to move. Drag a handle to resize. Arrow keys nudge 1 px, or 10 px with Shift. Hold Alt to stop snapping.' });
const strip = h('section', { class: 'lt-strip', 'aria-label': 'Every item' });
const stripRow = h('div', { class: 'lt-strip-row' });
const toastEl = h('div', { class: 'lt-toast', role: 'status', 'aria-live': 'polite' });
const undoBtn = button('Undo', undo, { svg: 'undo', title: 'Undo (Ctrl+Z)' });
const redoBtn = button('Redo', redo, { svg: 'redo', title: 'Redo (Ctrl+Shift+Z)' });

function buildShell(): void {
  const starters = h('div', { class: 'lt-group' },
    h('span', { class: 'lt-group-label', text: 'Start from' }),
    h('div', { class: 'lt-seg', role: 'group', 'aria-label': 'Start from' },
      ...STARTERS.map((s) => button(s.label, () => { S.sel = null; commit(s.build()); }))));
  const addBtn = button('Add part', () => openAddMenu(addBtn), { svg: 'add', showLabel: true });
  bar.append(
    h('a', { class: 'lt-brand', href: 'https://formatfx.dev', title: 'FormatFX — the full editor' }, 'FormatFX Lite'),
    starters,
    button('Paste JSON', () => openDialog('paste')),
    addBtn,
    h('span', { class: 'lt-spacer' }),
    undoBtn,
    redoBtn,
    button('Copy JSON', () => { void copyJson(); }, { cls: 'lt-primary' }),
    h('a', { class: 'lt-link', href: 'https://formatfx.dev', text: 'Full editor' }),
  );
  stage.append(host, overlay);
  canvas.append(stage, hint);
  strip.append(
    h('div', { class: 'lt-strip-head' },
      h('h2', { text: 'Every item' }),
      h('p', { text: 'The same card on each sample item. Click one to edit with its data.' })),
    stripRow);
  app.append(bar, ctxBar, canvas, strip);
  document.body.append(app, toastEl);
}

// ─── rendering ───────────────────────────────────────────────────────────────

function renderCard(root: SPElement, row: number, tag: boolean): Node {
  try {
    return renderElement(root, ctxFor(S.fields, S.rows, row), { tagPaths: tag, interactive: false });
  } catch (e) {
    return h('div', { class: 'lt-render-error', text: `This card does not render: ${(e as Error).message}` });
  }
}

function fit(): void {
  const { w, h: ht } = cardSize(S.doc);
  const availW = Math.max(120, canvas.clientWidth - 48);
  const availH = Math.max(120, canvas.clientHeight - 96);
  const z = Math.min(2, availW / w, availH / ht);
  S.zoom = Math.max(0.5, Math.floor(z * 4) / 4);
  S.stripScale = window.innerHeight >= 1000 ? 1 : window.innerHeight >= 760 ? 0.75 : 0.6;
}

function renderAll(): void {
  renderEditor();
  renderCtx();
  renderStrip();
  undoBtn.disabled = !S.past.length;
  redoBtn.disabled = !S.future.length;
}

function renderEditor(): void {
  closeFlyout();
  const { w, h: ht } = cardSize(S.doc);
  stage.style.width = `${w * S.zoom}px`;
  stage.style.height = `${ht * S.zoom}px`;
  host.style.width = `${w}px`;
  host.style.height = `${ht}px`;
  host.style.transform = `scale(${S.zoom})`;
  host.replaceChildren(renderCard(S.doc.root, S.row, true));
  renderOverlay();
}

function renderOverlay(): void {
  overlay.replaceChildren();
  const z = S.zoom;
  const b = borderWidth(S.doc.root);
  const place = (node: HTMLElement, r: Rect, inBorder = true): HTMLElement => {
    const o = inBorder ? b : 0;
    node.style.left = `${(o + r.x) * z}px`;
    node.style.top = `${(o + r.y) * z}px`;
    node.style.width = `${r.w * z}px`;
    node.style.height = `${r.h * z}px`;
    return node;
  };
  let box: HTMLElement | null = null;
  if (S.sel === 'card') {
    const { w, h: ht } = cardSize(S.doc);
    box = place(h('div', { class: 'lt-sel is-card' }), { x: 0, y: 0, w, h: ht }, false);
    for (const hd of CARD_HANDLES) box.append(h('div', { class: 'lt-handle', 'data-handle': hd }));
  } else if (typeof S.sel === 'number') {
    const r = partRect(S.doc.root.children![S.sel]);
    if (r) {
      box = place(h('div', { class: 'lt-sel' }), r);
      for (const hd of ALL_HANDLES) box.append(h('div', { class: 'lt-handle', 'data-handle': hd }));
    }
  }
  if (box) overlay.append(box);
  // guides go above the selection: the edge that snapped turns magenta
  const inner = innerSize(S.doc);
  for (const g of S.guides) {
    const line = place(h('div', { class: `lt-guide is-${g.axis}` }),
      g.axis === 'x' ? { x: g.at, y: 0, w: 0, h: inner.h } : { x: 0, y: g.at, w: inner.w, h: 0 });
    line.style[g.axis === 'x' ? 'width' : 'height'] = ''; // the 1px thickness comes from the CSS
    overlay.append(line);
  }
  if (box && S.chip) {
    const chip = h('div', { class: 'lt-chip', text: S.chip });
    chip.style.left = `${parseFloat(box.style.left) + parseFloat(box.style.width) / 2}px`;
    chip.style.top = `${parseFloat(box.style.top) + parseFloat(box.style.height)}px`;
    overlay.append(chip);
  }
}

function renderStrip(): void {
  const { w, h: ht } = cardSize(S.doc);
  const s = S.stripScale;
  stripRow.replaceChildren(...S.rows.map((row, i) => {
    const card = h('div', { class: 'lt-item-card' }, renderCard(S.doc.root, i, false));
    card.style.width = `${w}px`;
    card.style.height = `${ht}px`;
    card.style.transform = `scale(${s})`;
    const frame = h('div', { class: 'lt-item-frame', 'aria-hidden': 'true' }, card);
    frame.style.width = `${w * s}px`;
    frame.style.height = `${ht * s}px`;
    const pick = (): void => { S.row = i; save(); renderEditor(); renderStrip(); };
    frame.addEventListener('click', pick);
    const title = typeof row.Title === 'string' && row.Title ? row.Title : `Item ${i + 1}`;
    const label = h('button', { type: 'button', class: 'lt-item-label', 'aria-pressed': String(i === S.row), title }, title);
    label.style.width = `${w * s}px`;
    label.addEventListener('click', pick);
    return h('div', { class: `lt-item${i === S.row ? ' is-active' : ''}` }, frame, label);
  }));
}

// ─── the context bar ─────────────────────────────────────────────────────────

function styleOf(t: Target): NonNullable<SPElement['style']> {
  return (t === 'card' ? S.doc.root : S.doc.root.children![t]).style ?? {};
}

function stepper(label: string, t: Target, prop: string, min: number, max: number, step: number, fallback: number,
  apply: (n: number) => Doc = (n) => setStyle(S.doc, t, prop, `${n}px`)): HTMLElement {
  const raw = styleOf(t)[prop];
  const rule = isRule(raw);
  const value = px(raw);
  const shown = value ?? fallback;
  const set = (n: number): void => {
    if (!Number.isFinite(n)) return;
    commit(apply(Math.min(max, Math.max(min, Math.round(n)))));
  };
  const input = h('input', {
    type: 'number', min: String(min), max: String(max), 'aria-label': label,
    value: rule ? '' : String(shown), placeholder: rule ? 'rule' : undefined, disabled: rule,
    title: rule ? 'Set by a rule (changes per item). Edit it in the full editor.' : label,
    'data-key': `${label}`,
  });
  input.addEventListener('change', () => set(Number(input.value)));
  const minus = h('button', { type: 'button', 'aria-label': `Smaller ${label.toLowerCase()}`, disabled: rule }, icon('minus'));
  const plus = h('button', { type: 'button', 'aria-label': `Larger ${label.toLowerCase()}`, disabled: rule }, icon('plus'));
  minus.addEventListener('click', () => set(shown - step));
  plus.addEventListener('click', () => set(shown + step));
  return h('label', { class: 'lt-field' }, label, h('span', { class: 'lt-stepper' }, minus, input, plus));
}

function colorButton(label: string, t: Target, prop: string, allowNone: boolean, onPick?: (v: string | undefined) => Doc): HTMLElement {
  const raw = styleOf(t)[prop];
  const rule = isRule(raw);
  const chip = h('span', { class: `lt-swatch${rule ? ' is-rule' : raw === undefined ? ' is-none' : ''}` });
  if (!rule && typeof raw === 'string') chip.style.background = raw;
  const b = h('button', {
    type: 'button', class: 'lt-btn', 'data-key': label,
    title: rule ? `${label}: changes per item (set by a rule)` : `${label}: ${raw ?? 'none'}`,
  }, chip, label);
  b.addEventListener('click', () => openColors(b, {
    allowNone,
    rule,
    current: typeof raw === 'string' && !rule ? raw : undefined,
    pick: (v) => commit(onPick ? onPick(v) : setStyle(S.doc, t, prop, v)),
  }));
  return b;
}

function sep(): HTMLElement { return h('span', { class: 'lt-sep', 'aria-hidden': 'true' }); }

function boldButton(on: boolean, toggle: () => void): HTMLButtonElement {
  const b = h('button', {
    type: 'button', class: 'lt-btn lt-icon', 'aria-label': 'Bold', title: 'Bold',
    'aria-pressed': String(on), 'data-key': 'Bold',
  }, h('b', { text: 'B' }));
  b.addEventListener('click', toggle);
  return b;
}

function renderCtx(): void {
  const focusKey = (document.activeElement as HTMLElement | null)?.closest('.lt-ctx') ? (document.activeElement as HTMLElement).dataset.key : undefined;
  ctxBar.replaceChildren(...ctxContent());
  if (focusKey) ctxBar.querySelector<HTMLElement>(`[data-key="${focusKey}"]`)?.focus();
}

function ctxContent(): Node[] {
  const t = S.sel;
  if (t === null) {
    return [h('p', { class: 'lt-ctx-hint', text: 'Click a part of the card to change it. Click an empty area of the card to change the card.' })];
  }
  if (t === 'card') {
    const { w, h: ht } = cardSize(S.doc);
    const size = (label: string, value: number, apply: (n: number) => Doc): HTMLElement => {
      const input = h('input', { type: 'number', class: 'lt-num', min: '40', max: '1200', value: String(value), 'aria-label': `Card ${label.toLowerCase()}`, 'data-key': label });
      input.addEventListener('change', () => { const n = Number(input.value); if (Number.isFinite(n)) commit(apply(n)); });
      return h('label', { class: 'lt-field' }, label, input);
    };
    return [
      h('strong', { class: 'lt-ctx-name', text: 'Card' }),
      size('Width', w, (n) => setCardSize(S.doc, n, ht)),
      size('Height', ht, (n) => setCardSize(S.doc, w, n)),
      sep(),
      colorButton('Fill', 'card', 'background-color', true),
      colorButton('Border', 'card', 'border-color', true, (v) => v === undefined
        ? setStyles(S.doc, 'card', { 'border-width': '0px' })
        : setStyles(S.doc, 'card', { 'border-color': v, 'border-style': 'solid', 'border-width': `${Math.max(1, borderWidth(S.doc.root))}px` })),
      stepper('Corners', 'card', 'border-radius', 0, 48, 2, 0),
    ];
  }
  const part = S.doc.root.children![t];
  const kind = partKind(part);
  const style = part.style ?? {};
  const out: Node[] = [h('strong', { class: 'lt-ctx-name', text: partName(part) })];
  if (kind === 'text') {
    const bold = /^(bold|[6-9]00)$/.test(String(style['font-weight'] ?? ''));
    const align = String(style['text-align'] ?? 'left');
    const wrapped = style['white-space'] !== 'nowrap';
    out.push(
      fieldPicker(t, part),
      sep(),
      stepper('Text size', t, 'font-size', 8, 72, 1, 14, (n) => setFontSize(S.doc, t, n)),
      boldButton(bold, () => commit(setStyle(S.doc, t, 'font-weight', bold ? '400' : '600'))),
      colorButton('Text', t, 'color', false),
      colorButton('Fill', t, 'background-color', true),
      h('div', { class: 'lt-seg', role: 'group', 'aria-label': 'Align text' },
        ...(['left', 'center', 'right'] as const).map((a) =>
          button(`Align ${a}`, () => commit(setStyle(S.doc, t, 'text-align', a)), { svg: a, pressed: align === a }))),
      button('Wrap text', () => commit(setStyles(S.doc, t, wrapped
        ? { 'white-space': 'nowrap', overflow: 'hidden', 'text-overflow': 'ellipsis', display: undefined, '-webkit-box-orient': undefined, '-webkit-line-clamp': undefined }
        : { 'white-space': 'normal', 'text-overflow': undefined, overflow: 'hidden' })),
      { svg: 'wrap', pressed: wrapped, title: wrapped ? 'Text wraps onto more lines. Click for one line with …' : 'One line, cut with …. Click to wrap.' }),
    );
  } else if (kind === 'image') {
    const round = style['border-radius'] === '50%';
    out.push(button('Circle', () => commit(setStyle(S.doc, t, 'border-radius', round ? '0px' : '50%')), { pressed: round, showLabel: true }));
  } else {
    out.push(colorButton('Fill', t, 'background-color', true));
    if (kind === 'group') out.push(h('span', { class: 'lt-ctx-note', text: 'Has its own inner layout' }));
  }
  if (!(kind === 'image' && style['border-radius'] === '50%')) out.push(stepper('Corners', t, 'border-radius', 0, 48, 2, 0));
  out.push(
    h('span', { class: 'lt-spacer' }),
    button('Send back', () => { const r = moveLayer(S.doc, t, -1); S.sel = r.index; commit(r.doc); }, { svg: 'back' }),
    button('Bring forward', () => { const r = moveLayer(S.doc, t, 1); S.sel = r.index; commit(r.doc); }, { svg: 'forward' }),
    button('Duplicate', () => { const r = duplicatePart(S.doc, t); S.sel = r.index; commit(r.doc); }, { svg: 'copy', title: 'Duplicate (Ctrl+D)' }),
    button('Delete', () => deleteSelected(), { svg: 'trash', cls: 'lt-danger', title: 'Delete (Del)' }),
  );
  return out;
}

function fieldPicker(i: number, part: SPElement): HTMLElement {
  const current = boundField(part.txtContent);
  const select = h('select', { class: 'lt-select', 'aria-label': 'Column this text shows', 'data-key': 'field' });
  if (!current) select.append(h('option', { value: '', text: 'A formula', selected: true, disabled: true }));
  for (const f of bindableFields(S.fields)) {
    select.append(h('option', { value: f.name, text: f.displayName ?? f.name, selected: f.name === current }));
  }
  select.addEventListener('change', () => {
    const f = S.fields.find((x) => x.name === select.value);
    if (!f) return;
    let next = setText(S.doc, i, fieldText(f));
    const was = S.fields.find((x) => x.name === current);
    if (!part._elmName || (was && (part._elmName === was.name || part._elmName === was.displayName))) {
      next = renamePart(next, i, f.displayName ?? f.name);
    }
    commit(next);
  });
  return h('label', { class: 'lt-field' }, 'Shows', select);
}

function deleteSelected(): void {
  if (typeof S.sel !== 'number') return;
  const t = S.sel;
  S.sel = null;
  commit(removePart(S.doc, t));
}

// ─── popovers ────────────────────────────────────────────────────────────────

let pop: HTMLElement | null = null;
let popAnchor: HTMLElement | null = null;

function closePop(): void {
  pop?.remove();
  pop = null;
  popAnchor = null;
}

/** Open `content` under `anchor`; a second click on the same anchor closes it. */
function openPop(anchor: HTMLElement, content: HTMLElement): void {
  const toggleOff = pop && popAnchor === anchor;
  closePop();
  if (toggleOff) return;
  popAnchor = anchor;
  pop = h('div', { class: 'lt-pop' }, content);
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  const left = Math.max(8, Math.min(r.left, window.innerWidth - pw - 8));
  const below = r.bottom + 6 + ph < window.innerHeight;
  pop.style.left = `${left}px`;
  pop.style.top = `${below ? r.bottom + 6 : Math.max(8, r.top - ph - 6)}px`;
  pop.querySelector<HTMLElement>('button, input')?.focus();
}

function openColors(anchor: HTMLElement, o: { allowNone: boolean; rule: boolean; current?: string; pick: (v: string | undefined) => void }): void {
  const choose = (v: string | undefined): void => { closePop(); o.pick(v); };
  const grid = h('div', { class: 'lt-swatches', role: 'group', 'aria-label': 'Colors' },
    ...PALETTE.map((c) => {
      const b = h('button', { type: 'button', 'aria-label': c, title: c });
      b.style.background = c;
      if (o.current?.toLowerCase() === c) b.style.boxShadow = '0 0 0 2px var(--lt-bar), 0 0 0 4px var(--lt-accent)';
      b.addEventListener('click', () => choose(c));
      return b;
    }));
  const custom = h('input', { type: 'color', value: o.current && /^#[0-9a-f]{6}$/i.test(o.current) ? o.current : '#0078d4', 'aria-label': 'Custom color' });
  custom.addEventListener('change', () => choose(custom.value));
  const row = h('div', { class: 'lt-pop-row' }, custom, h('span', { class: 'lt-ctx-note', text: 'Custom' }));
  if (o.allowNone) row.append(h('span', { class: 'lt-spacer' }), button('None', () => choose(undefined)));
  openPop(anchor, h('div', {},
    o.rule ? h('p', { class: 'lt-pop-note', text: 'A rule sets this color now, so it changes per item. A color you pick here is used for every item.' }) : null,
    grid, row));
}

function openAddMenu(anchor: HTMLElement): void {
  const add = (el: SPElement): void => {
    closePop();
    const r = addPart(S.doc, el);
    S.sel = r.index;
    commit(r.doc);
  };
  const title = bindableFields(S.fields)[0];
  const person = S.fields.find((f) => f.type === 'person');
  const item = (label: string, note: string, run: (() => void) | null): HTMLButtonElement => {
    const b = h('button', { type: 'button', disabled: !run }, label, h('small', { text: note }));
    if (run) b.addEventListener('click', run);
    return b;
  };
  openPop(anchor, h('div', { class: 'lt-menu', role: 'menu' },
    item('Text', 'Shows one column; pick which in the bar', title ? () => add(newText(title, centered(S.doc, 160, 20))) : null),
    item('Shape', 'A box of color, for bands and dividers', () => add(newShape(centered(S.doc, 120, 40)))),
    item('Person photo', person ? `Photo of ${person.displayName ?? person.name}` : 'Needs a person column', person ? () => add(newPhoto(person, centered(S.doc, 40, 40))) : null),
  ));
}

document.addEventListener('pointerdown', (e) => {
  const t = e.target as Node;
  if (pop && !pop.contains(t) && !popAnchor?.contains(t)) closePop();
});

// ─── dragging ────────────────────────────────────────────────────────────────

interface Drag {
  kind: 'move' | 'resize' | 'card';
  index: number;
  handle: Handle;
  start: Rect;
  before: Doc;
  x0: number;
  y0: number;
  lines: Lines;
  live: boolean;
}

let drag: Drag | null = null;

function hitPart(target: EventTarget | null): Target {
  const node = (target as Element | null)?.closest?.('[data-sp-path]');
  if (!node || !host.contains(node)) return 'card';
  const first = (node.getAttribute('data-sp-path') ?? '').split('.')[0];
  if (first === '') return 'card';
  const i = Number(first);
  return partIndices(S.doc).includes(i) ? i : 'card';
}

function linesFor(except: number): Lines {
  const others = partIndices(S.doc).filter((i) => i !== except).map((i) => partRect(S.doc.root.children![i])!);
  return snapLines(innerSize(S.doc), others);
}

stage.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  closePop();
  closeFlyout();
  const handle = (e.target as HTMLElement).dataset?.handle as Handle | undefined;
  let kind: Drag['kind'];
  let index = -1;
  let start: Rect;
  if (handle && S.sel === 'card') {
    const { w, h: ht } = cardSize(S.doc);
    kind = 'card';
    start = { x: 0, y: 0, w, h: ht };
  } else if (handle && typeof S.sel === 'number') {
    kind = 'resize';
    index = S.sel;
    start = partRect(S.doc.root.children![index])!;
  } else {
    const t = hitPart(e.target);
    select(t);
    if (t === 'card') { stage.focus({ preventScroll: true }); return; }
    kind = 'move';
    index = t;
    start = partRect(S.doc.root.children![index])!;
  }
  e.preventDefault();
  stage.focus({ preventScroll: true });
  stage.setPointerCapture(e.pointerId);
  drag = { kind, index, handle: handle ?? 'se', start, before: S.doc, x0: e.clientX, y0: e.clientY, lines: linesFor(index), live: kind !== 'move' };
});

stage.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const sx = e.clientX - drag.x0, sy = e.clientY - drag.y0;
  if (!drag.live) {
    if (Math.hypot(sx, sy) < DRAG_START_PX) return;
    drag.live = true;
  }
  stage.classList.add('is-dragging');
  const dx = sx / S.zoom, dy = sy / S.zoom;
  const reach = SNAP_PX / S.zoom;
  const free = e.altKey;
  if (drag.kind === 'card') {
    const w = drag.start.w + (drag.handle.includes('e') ? dx : 0);
    const ht = drag.start.h + (drag.handle.includes('s') ? dy : 0);
    S.doc = setCardSize(drag.before, w, ht);
    const size = cardSize(S.doc);
    S.chip = `${size.w} × ${size.h}`;
    S.guides = [];
  } else if (drag.kind === 'move') {
    const raw = { ...drag.start, x: drag.start.x + dx, y: drag.start.y + dy };
    const out = free ? { rect: raw, guides: [] } : snapMove(raw, drag.lines, reach);
    S.doc = setPartRect(drag.before, drag.index, out.rect);
    S.guides = out.guides;
    const r = partRect(S.doc.root.children![drag.index])!;
    S.chip = `${r.x}, ${r.y}`;
  } else {
    const raw = resizeRect(drag.start, drag.handle, dx, dy);
    const out = free ? { rect: raw, guides: [] } : snapResize(raw, drag.handle, drag.lines, reach);
    S.doc = setPartRect(drag.before, drag.index, out.rect);
    S.guides = out.guides;
    const r = partRect(S.doc.root.children![drag.index])!;
    S.chip = `${r.w} × ${r.h}`;
  }
  scheduleLive();
});

let frame = 0;
function scheduleLive(): void {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    renderEditor();
    renderStrip();
  });
}

function endDrag(): void {
  if (!drag) return;
  const d = drag;
  drag = null;
  stage.classList.remove('is-dragging');
  S.guides = [];
  S.chip = null;
  if (frame) { cancelAnimationFrame(frame); frame = 0; }
  if (d.live && S.doc !== d.before) {
    const next = S.doc;
    S.doc = d.before;
    commit(next, d.before);
  } else {
    renderOverlay();
  }
}

stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);
stage.addEventListener('lostpointercapture', endDrag);
// card content can carry hover-card flyouts and links: in the editor a click selects, nothing else
stage.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); }, true);

// ─── keyboard ────────────────────────────────────────────────────────────────

stage.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey) return;
  const parts = partIndices(S.doc);
  const at = typeof S.sel === 'number' ? parts.indexOf(S.sel) : -1;
  const next = e.shiftKey ? at - 1 : at + 1;
  if (next < 0 || next >= parts.length) return; // let focus leave the editor
  e.preventDefault();
  select(parts[next]);
});

document.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement;
  if (target.closest('input, select, textarea, dialog')) return;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (mod && key === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (mod && key === 'y') { e.preventDefault(); redo(); return; }
  if (e.key === 'Escape') { if (pop) closePop(); else select(null); return; }
  if (typeof S.sel !== 'number') return;
  const i = S.sel;
  if (mod && key === 'd') {
    e.preventDefault();
    const r = duplicatePart(S.doc, i);
    S.sel = r.index;
    commit(r.doc);
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); return; }
  const r = partRect(S.doc.root.children![i]);
  const moved = r && nudge(r, e.key, e.shiftKey);
  if (!moved) return;
  e.preventDefault();
  const next = setPartRect(S.doc, i, moved);
  const now = performance.now();
  const merge = S.lastNudge.index === i && now - S.lastNudge.at < NUDGE_MERGE_MS && S.past.length > 0;
  S.lastNudge = { index: i, at: now };
  if (merge) { S.doc = next; S.future = []; changed(); } else commit(next);
});

// ─── paste and copy ──────────────────────────────────────────────────────────

const dialog = h('dialog', { class: 'lt-dialog', 'aria-labelledby': 'lt-dialog-title' });

function openDialog(mode: 'paste' | 'copy', json = ''): void {
  closePop();
  const area = h('textarea', { spellcheck: 'false', 'aria-label': mode === 'paste' ? 'Card JSON' : 'Card JSON to copy', readonly: mode === 'copy' });
  area.value = json;
  const error = h('p', { class: 'lt-dialog-error', role: 'alert' });
  const close = button(mode === 'paste' ? 'Cancel' : 'Done', () => dialog.close());
  const actions = h('div', { class: 'lt-dialog-actions' }, close);
  if (mode === 'paste') {
    actions.append(button('Open card', () => {
      const problem = openJson(area.value);
      if (problem) error.textContent = problem; else dialog.close();
    }, { cls: 'lt-primary' }));
  }
  dialog.replaceChildren(
    h('h2', { id: 'lt-dialog-title', text: mode === 'paste' ? 'Open a card from JSON' : 'Copy this JSON' }),
    h('p', {
      text: mode === 'paste'
        ? 'Paste a gallery card from Copilot, a sample, or SharePoint (Format current view, then Advanced mode). Lite measures it and opens each part where it really appears.'
        : 'The browser did not allow Lite to copy. Select all of this text and copy it, then paste it in SharePoint.',
    }),
    area, error, actions);
  dialog.showModal();
  area.focus();
  if (mode === 'copy') area.select();
}

/** Open pasted JSON as the card. Returns a one-line reason when it can't. */
function openJson(text: string): string | null {
  if (!text.trim()) return 'Paste some JSON first.';
  let doc: Doc;
  try {
    doc = importJson(text);
  } catch (e) {
    return (e as Error).message;
  }
  if (doc.kind === 'row' || doc.kind === 'grid') {
    return 'This is a list-row layout. Lite only edits gallery cards. Open it in the full editor at formatfx.dev.';
  }
  if (doc.kind === 'column') doc = { kind: 'tile', root: doc.root, tileWidth: DEFAULT_W, tileHeight: DEFAULT_H };
  const fields = sampleFields();
  const rows = sampleRows();
  withExtraFields(fields, rows, referencedFields(text));
  const { measure, dispose } = domMeasure(doc, fields, rows);
  let result: ReturnType<typeof flattenCard>;
  try {
    result = flattenCard(doc, measure);
  } finally {
    dispose();
  }
  S.fields = fields;
  S.rows = rows;
  S.row = 0;
  S.sel = null;
  commit(result.doc);
  if (result.notes.length) toast(result.notes.join(' '));
  return null;
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

async function copyJson(): Promise<void> {
  const out = exportCard(S.doc, S.fields);
  if (out.errors.length) {
    toast(`Not copied. ${out.errors[0].message}`, true);
    return;
  }
  if (!(await writeClipboard(out.json))) {
    openDialog('copy', out.json);
    return;
  }
  const first = out.warnings[0]?.message.split(' — ')[0];
  toast(first
    ? `Copied, with a warning: ${first}.`
    : 'Copied. In SharePoint, open Format current view, choose Gallery, select Advanced mode, then paste.');
}

let toastTimer = 0;
function toast(text: string, error = false): void {
  toastEl.textContent = text;
  toastEl.classList.toggle('is-error', error);
  toastEl.classList.add('is-on');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('is-on'), error ? 7000 : 5000);
}

// ─── start ───────────────────────────────────────────────────────────────────

applyTheme('light'); // SharePoint's class emulation (sp-card-*, ms-bgColor-*, …)
buildShell();
document.body.append(dialog);
load();
renderAll();
// The card zooms to fit the canvas. The canvas size depends on the strip
// (rendered just above) and the window, so refit whenever the canvas resizes.
new ResizeObserver(() => {
  if (drag) return; // never rescale under the pointer
  const zoom = S.zoom, strip = S.stripScale;
  fit();
  if (S.zoom !== zoom) renderEditor();
  if (S.stripScale !== strip) renderStrip();
}).observe(canvas);
