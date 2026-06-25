/**
 * editor/formatCells.ts — the "Format cells" dialog: Excel's 30-year-old
 * muscle memory (Font / Border / Fill / Alignment tabs, a live preview box,
 * OK applies everything at once) rebuilt over the SP style allow-list.
 * Click-only, so a misclick can't corrupt the formatter; everything stages
 * into one patch and OK is ONE undoable document mutation. Reached from a
 * grid header's menu or any element's right-click — and because formatters
 * run per row, the dialog says so out loud: these choices land on every row.
 *
 * Managed properties only — anything else on the element is untouched. A
 * managed property currently driven by a formula is flagged before OK
 * replaces it (same contract as the conditional formatting builder).
 */

import type { NodePath, SPElement, SPExpr } from '../core/types';
import { state } from './state';
import { COND_COLORS } from './condRules';
import { createOverlay, type OverlayHandle } from './overlay';

const nameOf = (el: SPElement): string => el._elmName ?? `<${el.elmType}>`;

type Tab = 'font' | 'border' | 'fill' | 'alignment';
type Side = 'top' | 'right' | 'bottom' | 'left';
const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];

const FONT_SIZES = ['10px', '11px', '12px', '13px', '14px', '16px', '20px'];
const RADII = ['2px', '4px', '6px', '12px', '50%'];
const BORDER_STYLES = ['solid', 'dashed', 'dotted'];
const BORDER_WIDTHS = ['1px', '2px', '3px'];
const INK_SWATCHES = [
  '#323130', '#605e5c', '#ffffff', '#0078d4', '#107c10',
  '#d13438', '#ca5010', '#5c2d91', '#038387',
];
const HAIRLINE = '#e1dfdd';

/** Properties this dialog owns, per tab — used for the formula warning. */
const MANAGED = [
  'font-size', 'font-weight', 'font-style', 'text-decoration', 'color',
  'border', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-radius',
  'background-color',
  'text-align', 'white-space', 'overflow', 'text-overflow', 'padding-left',
];

let handle: OverlayHandle | null = null;
let enterHandler: ((e: KeyboardEvent) => void) | null = null;

export function closeFormatCells(): void {
  if (enterHandler) { document.removeEventListener('keydown', enterHandler); enterHandler = null; }
  handle?.close();
  handle = null;
}

/** The element's committed plain value for a prop ('' = none/formula). */
function plainOf(style: Record<string, SPExpr | undefined> | undefined, prop: string): string {
  const v = style?.[prop];
  return typeof v === 'string' && !v.startsWith('=') ? v : '';
}

function isFormula(style: Record<string, SPExpr | undefined> | undefined, prop: string): boolean {
  const v = style?.[prop];
  return v !== undefined && (typeof v !== 'string' || v.startsWith('='));
}

/** Parse "1px solid #x" tolerantly into its three parts. */
function parseBorder(value: string): { width: string; style: string; color: string } | null {
  if (!value || value === 'none') return null;
  const toks = value.trim().split(/\s+/);
  const width = toks.find((t) => /^[\d.]+px$/.test(t)) ?? '1px';
  const style = toks.find((t) => BORDER_STYLES.includes(t)) ?? 'solid';
  const color = toks.filter((t) => t !== width && t !== style).join(' ') || HAIRLINE;
  return { width, style, color };
}

export function openFormatCells(path: NodePath, onToast: (m: string) => void): void {
  closeFormatCells();
  const node = state.nodeAt(path);
  if (!node) return;
  const base = node.style;

  // ── staged state, initialized from the element's plain values ──
  let tab: Tab = 'font';
  const patch: Record<string, string | null> = {};

  const staged = (prop: string): string => {
    const p = patch[prop];
    if (p !== undefined) return p ?? '';
    return plainOf(base, prop);
  };
  const set = (prop: string, value: string | null): void => {
    const current = plainOf(base, prop);
    if (value === null ? current === '' && !isFormula(base, prop) : value === current) {
      delete patch[prop]; // back to where the element already was
    } else {
      patch[prop] = value;
    }
    render();
  };

  // border model: which sides are on + one shared line look
  const initialLine = SIDES.map((s) => parseBorder(plainOf(base, `border-${s}`)))
    .find((b) => b) ?? parseBorder(plainOf(base, 'border'));
  const line = initialLine ?? { width: '1px', style: 'solid', color: HAIRLINE };
  const sidesOn = new Set<Side>(SIDES.filter((s) =>
    parseBorder(plainOf(base, `border-${s}`)) ?? parseBorder(plainOf(base, 'border'))));

  const writeBorders = (): void => {
    const value = `${line.width} ${line.style} ${line.color}`;
    if (sidesOn.size === 0) {
      set('border', null);
      for (const s of SIDES) patch[`border-${s}`] = null;
    } else if (sidesOn.size === 4) {
      patch['border'] = value;
      for (const s of SIDES) patch[`border-${s}`] = null;
    } else {
      patch['border'] = null;
      for (const s of SIDES) patch[`border-${s}`] = sidesOn.has(s) ? value : null;
    }
    render();
  };

  // Enter confirms the dialog — mirrors Excel's Format Cells Esc/Enter contract.
  // Fires when focus is not on a button (buttons handle their own Enter via click),
  // i.e. after chip interactions leave focus on document.body, Enter still applies.
  enterHandler = (e: KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    if (document.activeElement instanceof HTMLButtonElement) return;
    const okBtn = panel.querySelector<HTMLButtonElement>('.wb-fc-ok');
    if (okBtn && !okBtn.disabled) { e.preventDefault(); okBtn.click(); }
  };
  document.addEventListener('keydown', enterHandler);

  handle = createOverlay('wb-fc-overlay', closeFormatCells);
  const overlay = handle.overlay;

  const panel = document.createElement('div');
  panel.className = 'wb-fc';
  overlay.appendChild(panel);

  // ── tiny builders, house style ──
  const row = (label: string, ...kids: HTMLElement[]): HTMLElement => {
    const r = document.createElement('div');
    r.className = 'wb-fc-row';
    const lab = document.createElement('span');
    lab.className = 'wb-fc-rowlab';
    lab.textContent = label;
    r.appendChild(lab);
    for (const k of kids) r.appendChild(k);
    return r;
  };
  const chip = (label: string, active: boolean, fn: () => void, title?: string): HTMLElement => {
    const b = document.createElement('button');
    b.className = 'wb-fc-chip' + (active ? ' active' : '');
    b.textContent = label;
    if (title) b.title = title;
    b.addEventListener('click', fn);
    return b;
  };
  const toggle = (label: string, active: boolean, fn: () => void, title?: string): HTMLElement => {
    const b = chip(label, active, fn, title);
    b.classList.add('wb-fc-toggle');
    return b;
  };
  const swatch = (color: string, active: boolean, fn: () => void, title = color): HTMLElement => {
    const s = document.createElement('button');
    s.className = 'wb-fc-swatch' + (active ? ' active' : '');
    s.title = title;
    s.style.background = color;
    s.addEventListener('click', fn);
    return s;
  };
  const swatchRow = (label: string, prop: string, colors: string[], extraTitle?: (c: string) => string): HTMLElement => {
    const wrap = document.createElement('span');
    wrap.className = 'wb-fc-swatches';
    wrap.appendChild(chip('auto', staged(prop) === '', () => set(prop, null), 'No explicit color — the theme decides'));
    for (const c of colors) {
      wrap.appendChild(swatch(c, staged(prop) === c, () => set(prop, c), extraTitle?.(c) ?? c));
    }
    return row(label, wrap);
  };

  const render = (): void => {
    panel.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'wb-fc-head';
    head.innerHTML = `<span class="wb-fc-title">Format cells — ${nameOf(node)}</span>
      <span class="wb-fc-sub">nothing changes until you Apply (then Ctrl+Z undoes)</span>`;
    const close = document.createElement('button');
    close.className = 'wb-fc-close';
    close.textContent = '✕';
    close.title = 'Close (Esc) — discards these choices';
    close.addEventListener('click', closeFormatCells);
    head.appendChild(close);
    panel.appendChild(head);

    // ── tabs ──
    const tabs = document.createElement('div');
    tabs.className = 'wb-fc-tabs';
    for (const t of ['font', 'border', 'fill', 'alignment'] as Tab[]) {
      const b = document.createElement('button');
      b.className = 'wb-fc-tab' + (t === tab ? ' active' : '');
      b.textContent = t[0].toUpperCase() + t.slice(1);
      b.addEventListener('click', () => { tab = t; render(); });
      tabs.appendChild(b);
    }
    panel.appendChild(tabs);

    // ── live preview: Excel's little proof box ──
    const previewWrap = document.createElement('div');
    previewWrap.className = 'wb-fc-previewwrap';
    const preview = document.createElement('span');
    preview.className = 'wb-fc-preview';
    preview.textContent = 'AaBbCc 123';
    for (const prop of MANAGED) {
      const v = staged(prop);
      if (v) { try { preview.style.setProperty(prop, v); } catch { /* invalid staged value */ } }
    }
    previewWrap.appendChild(preview);
    panel.appendChild(previewWrap);

    const body = document.createElement('div');
    body.className = 'wb-fc-body';
    panel.appendChild(body);

    if (tab === 'font') {
      const sizes = document.createElement('span');
      sizes.className = 'wb-fc-chips';
      sizes.appendChild(chip('auto', staged('font-size') === '', () => set('font-size', null)));
      for (const s of FONT_SIZES) {
        sizes.appendChild(chip(s.replace('px', ''), staged('font-size') === s, () => set('font-size', s), s));
      }
      body.appendChild(row('Size', sizes));

      const styleRow = document.createElement('span');
      styleRow.className = 'wb-fc-chips';
      const weight = staged('font-weight');
      const bold = weight === '600' || weight === '700' || weight === 'bold';
      styleRow.appendChild(toggle('Bold', bold, () => set('font-weight', bold ? null : '600'), 'Semibold 600 — the SP emphasis weight'));
      const italic = staged('font-style') === 'italic';
      styleRow.appendChild(toggle('Italic', italic, () => set('font-style', italic ? null : 'italic')));
      const deco = staged('text-decoration');
      const under = deco.includes('underline');
      const strike = deco.includes('line-through');
      const writeDeco = (u: boolean, s: boolean): void =>
        set('text-decoration', u || s ? [u ? 'underline' : '', s ? 'line-through' : ''].filter(Boolean).join(' ') : null);
      styleRow.appendChild(toggle('Underline', under, () => writeDeco(!under, strike)));
      styleRow.appendChild(toggle('Strikethrough', strike, () => writeDeco(under, !strike)));
      body.appendChild(row('Style', styleRow));

      body.appendChild(swatchRow('Color', 'color', INK_SWATCHES));
    }

    if (tab === 'border') {
      const presets = document.createElement('span');
      presets.className = 'wb-fc-chips';
      const preset = (label: string, on: Side[], title: string): HTMLElement => {
        const active = on.length === sidesOn.size && on.every((s) => sidesOn.has(s));
        const b = chip(label, active, () => {
          sidesOn.clear();
          for (const s of on) sidesOn.add(s);
          writeBorders();
        }, title);
        b.classList.add('wb-fc-preset');
        return b;
      };
      presets.appendChild(preset('None', [], 'No borders'));
      presets.appendChild(preset('Outline', SIDES, 'All four sides'));
      for (const s of SIDES) {
        const b = toggle(s[0].toUpperCase() + s.slice(1), sidesOn.has(s), () => {
          if (sidesOn.has(s)) sidesOn.delete(s); else sidesOn.add(s);
          writeBorders();
        }, `Border on the ${s} side`);
        presets.appendChild(b);
      }
      body.appendChild(row('Borders', presets));

      const lineRow = document.createElement('span');
      lineRow.className = 'wb-fc-chips';
      for (const s of BORDER_STYLES) {
        lineRow.appendChild(chip(s, line.style === s, () => { line.style = s; if (sidesOn.size) writeBorders(); else render(); }));
      }
      for (const w of BORDER_WIDTHS) {
        lineRow.appendChild(chip(w, line.width === w, () => { line.width = w; if (sidesOn.size) writeBorders(); else render(); }));
      }
      body.appendChild(row('Line', lineRow));

      const lineColors = document.createElement('span');
      lineColors.className = 'wb-fc-swatches';
      for (const c of [HAIRLINE, ...INK_SWATCHES]) {
        lineColors.appendChild(swatch(c, line.color === c, () => { line.color = c; if (sidesOn.size) writeBorders(); else render(); }));
      }
      body.appendChild(row('Line color', lineColors));

      const corners = document.createElement('span');
      corners.className = 'wb-fc-chips';
      corners.appendChild(chip('square', staged('border-radius') === '', () => set('border-radius', null)));
      for (const r of RADII) {
        corners.appendChild(chip(r === '50%' ? 'circle' : r, staged('border-radius') === r, () => set('border-radius', r),
          r === '12px' ? 'Pill ends' : r === '50%' ? 'Full circle (square elements)' : `Rounded ${r}`));
      }
      body.appendChild(row('Corners', corners));
    }

    if (tab === 'fill') {
      const soft = document.createElement('span');
      soft.className = 'wb-fc-swatches';
      soft.appendChild(chip('no fill', staged('background-color') === '', () => set('background-color', null)));
      for (const c of COND_COLORS) {
        soft.appendChild(swatch(c.soft, staged('background-color') === c.soft, () => set('background-color', c.soft), c.soft));
      }
      body.appendChild(row('Soft fill', soft));
      const strong = document.createElement('span');
      strong.className = 'wb-fc-swatches';
      for (const c of COND_COLORS) {
        strong.appendChild(swatch(c.strong, staged('background-color') === c.strong, () => set('background-color', c.strong), c.strong));
      }
      strong.appendChild(swatch('#ffffff', staged('background-color') === '#ffffff', () => set('background-color', '#ffffff'), '#ffffff'));
      body.appendChild(row('Solid fill', strong));
      const hint = document.createElement('div');
      hint.className = 'wb-fc-hint';
      hint.append('Solid fills usually want white text — ');
      const fontLink = document.createElement('button');
      fontLink.type = 'button';
      fontLink.className = 'wb-fc-hint-link';
      fontLink.textContent = 'set it on the Font tab';
      fontLink.addEventListener('click', () => { tab = 'font'; render(); });
      hint.append(fontLink, '. For fills that follow the value, use Conditional formatting instead.');
      body.appendChild(hint);
    }

    if (tab === 'alignment') {
      const horiz = document.createElement('span');
      horiz.className = 'wb-fc-chips';
      horiz.appendChild(chip('auto', staged('text-align') === '', () => set('text-align', null)));
      for (const a of ['left', 'center', 'right']) {
        horiz.appendChild(chip(a, staged('text-align') === a, () => set('text-align', a)));
      }
      body.appendChild(row('Horizontal', horiz));

      const oneLine = staged('white-space') === 'nowrap';
      const wrapRow = document.createElement('span');
      wrapRow.className = 'wb-fc-chips';
      wrapRow.appendChild(toggle('Keep on one line (… when clipped)', oneLine, () => {
        if (oneLine) { set('white-space', null); set('overflow', null); set('text-overflow', null); }
        else { patch['white-space'] = 'nowrap'; patch['overflow'] = 'hidden'; patch['text-overflow'] = 'ellipsis'; render(); }
      }, 'Never wraps; ends with an ellipsis when the column runs out of room'));
      body.appendChild(row('Wrapping', wrapRow));

      const indent = document.createElement('span');
      indent.className = 'wb-fc-chips';
      indent.appendChild(chip('none', staged('padding-left') === '', () => set('padding-left', null)));
      for (const i of ['8px', '16px', '24px']) {
        indent.appendChild(chip(i, staged('padding-left') === i, () => set('padding-left', i)));
      }
      body.appendChild(row('Indent', indent));
    }

    // ── footer ──
    const foot = document.createElement('div');
    foot.className = 'wb-fc-foot';
    const note = document.createElement('span');
    note.className = 'wb-fc-note';
    const replaced = Object.keys(patch).filter((k) => patch[k] !== undefined && isFormula(base, k));
    note.textContent = replaced.length
      ? `⚠ replaces the formula currently on ${replaced.join(', ')}`
      : '';
    foot.appendChild(note);
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', closeFormatCells);
    foot.appendChild(cancel);
    const ok = document.createElement('button');
    ok.className = 'wb-fc-ok';
    ok.textContent = 'Apply';
    ok.title = 'Apply everything staged here as one undoable change';
    ok.disabled = Object.keys(patch).length === 0;
    ok.addEventListener('click', () => {
      state.mutateDocument(() => {
        node.style = node.style ?? {};
        for (const [k, v] of Object.entries(patch)) {
          if (v === null) delete node.style[k];
          else node.style[k] = v;
        }
        if (Object.keys(node.style).length === 0) delete node.style;
      });
      closeFormatCells();
      onToast(`Format applied to ${nameOf(node)} (Ctrl+Z undoes)`);
    });
    foot.appendChild(ok);
    panel.appendChild(foot);
  };

  render();
  document.body.appendChild(overlay);
  // Put focus on the first tab so keyboard users land somewhere useful on open.
  panel.querySelector<HTMLElement>('.wb-fc-tab')?.focus();
}
