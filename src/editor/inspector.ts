/**
 * editor/inspector.ts — Property editor for the selected node: elmType,
 * txtContent, forEach, attributes, style (with the SP allow-list as
 * suggestions), row actions, hover cards, inline edit and CFRs.
 *
 * Edits commit on change/blur and go through the state store (undoable).
 */

import type { SPElement, SPExpr, CustomRowAction } from '../core/types';
import {
  ELM_TYPES, ALLOWED_STYLES, ALLOWED_ATTRIBUTES, ROW_ACTIONS, DIRECTIONAL_HINTS,
  STYLE_VALUE_SUGGESTIONS, ATTRIBUTE_VALUE_SUGGESTIONS,
  STYLE_PROP_DOCS, ATTRIBUTE_DOCS,
  STYLE_FAMILY_EXPLAINS, styleFamilyOf, styleGroupOf, type StyleFamily,
} from '../core/schema';
import { state, CARD_SEGMENT } from './state';

export function mountInspector(host: HTMLElement): void {
  const render = () => {
    host.innerHTML = '';
    const node = state.selectedNode;
    if (!node) {
      host.innerHTML = '<div class="wb-inspector-empty">Select an element on the canvas or in the tree.</div>';
      return;
    }
    const commit = (fn: (n: SPElement) => void) => {
      selfCommit = true;
      state.mutateDocument(() => fn(node));
      selfCommit = false;
    };

    // schema-driven suggestions for field-reference inputs
    const fieldList = document.createElement('datalist');
    fieldList.id = 'wb-dl-fieldrefs';
    for (const f of state.fields) {
      const o = document.createElement('option');
      o.value = `[$${f.name}]`;
      fieldList.appendChild(o);
    }
    const forEachList = document.createElement('datalist');
    forEachList.id = 'wb-dl-foreach';
    for (const f of state.fields) {
      const o = document.createElement('option');
      o.value = (f.type === 'personMulti' || f.type === 'lookupMulti')
        ? `_item in [$${f.name}]`
        : `_item in split([$${f.name}],';')`;
      forEachList.appendChild(o);
    }
    host.append(fieldList, forEachList);

    // document-level wrapper settings when the root is selected
    if (state.selection && state.selection.length === 0) {
      const kids: HTMLElement[] = [];
      const doc = state.doc;
      if (doc.kind === 'column') {
        const note = document.createElement('div');
        note.className = 'wb-inspector-empty';
        note.textContent = 'Column formatters have no wrapper options — the root element is the formatter.';
        kids.push(note);
      } else {
        kids.push(labeled('hideSelection', checkbox(doc.hideSelection ?? false, (v) => {
          state.mutateDocument(() => { state.doc.hideSelection = v; });
        })));
      }
      if (doc.kind === 'row') {
        kids.push(labeled('hideColumnHeader', checkbox(doc.hideColumnHeader ?? false, (v) => {
          state.mutateDocument(() => { state.doc.hideColumnHeader = v; });
        })));
      }
      if (doc.kind === 'tile') {
        kids.push(
          labeled('tile width (px)', inputNumber(doc.tileWidth ?? 254, (v) => {
            state.mutateDocument(() => { state.doc.tileWidth = v; });
          })),
          labeled('tile height (px)', inputNumber(doc.tileHeight ?? 220, (v) => {
            state.mutateDocument(() => { state.doc.tileHeight = v; });
          })),
          labeled('fillHorizontally', checkbox(doc.fillHorizontally ?? false, (v) => {
            state.mutateDocument(() => { state.doc.fillHorizontally = v; });
          })),
        );
      }
      host.appendChild(section(`Document — ${doc.kind} formatter`, kids, true));
    }

    host.appendChild(section('Alignment', [alignmentEditor(node, commit)]));

    host.appendChild(section('Element', [
      labeled('name (_elmName)', input(node._elmName ?? '', (v) => commit((n) => {
        const t = v.trim();
        if (t === '') delete n._elmName; else n._elmName = t;
      }), 'Label shown in the Structure pane — stripped from shipped JSON')),
      labeled('elmType', select(ELM_TYPES, node.elmType, (v) => commit((n) => { n.elmType = v as SPElement['elmType']; }))),
      labeled('txtContent', textarea(
        node.txtContent === undefined ? ''
          : typeof node.txtContent === 'string' ? node.txtContent
          : JSON.stringify(node.txtContent, null, 2),
        (v) => commit((n) => {
          const t = v.trim();
          if (t === '') { delete n.txtContent; return; }
          if (t.startsWith('{')) {
            try { n.txtContent = JSON.parse(t); return; } catch { /* keep as string */ }
          }
          n.txtContent = v;
        }), "Literal, '=expression', '[$Field]', '@currentField' or AST {\"operator\":…}")),
      labeled('forEach', input(node.forEach ?? '', (v) => commit((n) => {
        if (v === '') delete n.forEach; else n.forEach = v;
      }), '_item in [$MultiField]  or  _t in split([$Tags],\';\')', 'wb-dl-foreach')),
    ], true));

    host.appendChild(section('Box model', [boxModelEditor(node, commit)], true));

    host.appendChild(section('Style', [
      kvEditor(node.style ?? {}, [...ALLOWED_STYLES], STYLE_VALUE_SUGGESTIONS, STYLE_PROP_DOCS, styleFamilyOf, (obj) => commit((n) => {
        if (Object.keys(obj).length === 0) delete n.style; else n.style = obj;
      })),
    ], true));

    host.appendChild(section('Attributes', [
      kvEditor(node.attributes ?? {}, [...ALLOWED_ATTRIBUTES], ATTRIBUTE_VALUE_SUGGESTIONS, ATTRIBUTE_DOCS, null, (obj) => commit((n) => {
        if (Object.keys(obj).length === 0) delete n.attributes; else n.attributes = obj;
      })),
    ], true));

    // customRowAction
    const cra = node.customRowAction;
    host.appendChild(section('Row action (customRowAction)', [
      labeled('action', select(['(none)', ...ROW_ACTIONS.filter((a) => a !== '')], cra?.action ?? '(none)', (v) => commit((n) => {
        if (v === '(none)') delete n.customRowAction;
        else n.customRowAction = { ...(n.customRowAction ?? {}), action: v as CustomRowAction['action'] };
      }))),
      ...(cra ? [
        labeled('actionInput (JSON)', textarea(
          cra.actionInput ? JSON.stringify(cra.actionInput, null, 2) : '',
          (v) => commit((n) => {
            if (!n.customRowAction) return;
            if (v.trim() === '') { delete n.customRowAction.actionInput; return; }
            try { n.customRowAction.actionInput = JSON.parse(v); } catch { n.customRowAction.actionInput = v; }
          }), 'setValue: {"Status":"Done"}')),
        labeled('actionParams', input(cra.actionParams ?? '', (v) => commit((n) => {
          if (!n.customRowAction) return;
          if (v === '') delete n.customRowAction.actionParams; else n.customRowAction.actionParams = v;
        }), 'executeFlow: {"id":"flow-guid"}')),
      ] : []),
    ], true));

    // customCardProps
    const card = node.customCardProps;
    const cardKids: HTMLElement[] = [
      labeled('enabled', checkbox(!!card, (on) => commit((n) => {
        if (on) {
          n.customCardProps = n.customCardProps ?? {
            openOnEvent: 'click',
            directionalHint: 'bottomCenter',
            isBeakVisible: true,
            formatter: { elmType: 'div', style: { padding: '12px' }, children: [{ elmType: 'span', txtContent: '[$Title]' }] },
          };
        } else {
          delete n.customCardProps;
        }
      }))),
    ];
    if (card) {
      const selectCardBtn = document.createElement('button');
      selectCardBtn.className = 'wb-kv-add';
      selectCardBtn.textContent = '▣ Edit card content (select card root)';
      selectCardBtn.title = 'Selects the card formatter root — edit it like any element via the tree, palette and this inspector. It also appears nested in the Structure tree.';
      selectCardBtn.addEventListener('click', () => {
        if (state.selection) state.select([...state.selection, CARD_SEGMENT]);
      });
      cardKids.push(
        selectCardBtn,
        labeled('openOnEvent', select(['click', 'hover'], card.openOnEvent, (v) => commit((n) => {
          n.customCardProps!.openOnEvent = v as 'click' | 'hover';
        }))),
        labeled('directionalHint', select([...DIRECTIONAL_HINTS], card.directionalHint ?? 'bottomCenter', (v) => commit((n) => {
          n.customCardProps!.directionalHint = v;
        }))),
        labeled('card formatter (JSON)', textarea(JSON.stringify(card.formatter, null, 2), (v) => {
          try {
            const parsed = JSON.parse(v);
            commit((n) => { n.customCardProps!.formatter = parsed; });
          } catch (e) {
            alert(`Card formatter JSON invalid: ${(e as Error).message}`);
          }
        }, undefined, 10)),
      );
    }
    host.appendChild(section('Hover/click card (customCardProps)', cardKids, true));

    host.appendChild(section('Advanced', [
      labeled('inlineEditField', input(node.inlineEditField ?? '', (v) => commit((n) => {
        if (v === '') delete n.inlineEditField; else n.inlineEditField = v;
      }), '[$Title] — Text & Person fields only', 'wb-dl-fieldrefs')),
      labeled('columnFormatterReference', input(node.columnFormatterReference ?? '', (v) => commit((n) => {
        if (v === '') delete n.columnFormatterReference; else n.columnFormatterReference = v;
      }), '[$StatusUI] — referenced column must be in the view', 'wb-dl-fieldrefs')),
      labeled('defaultHoverField', input(node.defaultHoverField ?? '', (v) => commit((n) => {
        if (v === '') delete n.defaultHoverField; else n.defaultHoverField = v;
      }), '[$Owner] — shows the OOTB hover card', 'wb-dl-fieldrefs')),
    ], true));
  };

  state.subscribe((reason) => {
    // skip rebuilding for our own commits — keeps focus in the input being
    // edited (arrow-stepping, rapid toggles) while canvas/tree still update
    if (reason === 'document' && selfCommit) return;
    if (reason === 'selection' || reason === 'load' || reason === 'document') render();
  });
  render();
}

let selfCommit = false;

// ─── tiny form helpers ───────────────────────────────────────────────────────

/**
 * `adv` sections are hidden in basic mode. Basic deliberately keeps ONLY
 * click-driven controls (the Alignment section) — no free-text property
 * editing — so a misclick can't corrupt the formatter.
 */
function section(title: string, children: HTMLElement[], adv = false): HTMLElement {
  const s = document.createElement('details');
  s.className = 'wb-inspector-section' + (adv ? ' wb-adv' : '');
  s.open = true;
  const h = document.createElement('summary');
  h.textContent = title;
  s.appendChild(h);
  children.forEach((c) => s.appendChild(c));
  return s;
}

function labeled(label: string, control: HTMLElement): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'wb-field';
  const span = document.createElement('span');
  span.textContent = label;
  wrap.append(span, control);
  return wrap;
}

function input(value: string, onChange: (v: string) => void, placeholder?: string, listId?: string): HTMLInputElement {
  const el = document.createElement('input');
  el.type = 'text';
  el.value = value;
  if (placeholder) el.placeholder = placeholder;
  if (listId) el.setAttribute('list', listId);
  el.addEventListener('change', () => onChange(el.value));
  return el;
}

function inputNumber(value: number, onChange: (v: number) => void): HTMLInputElement {
  const el = document.createElement('input');
  el.type = 'number';
  el.value = String(value);
  el.addEventListener('change', () => {
    const n = Number(el.value);
    if (!Number.isNaN(n)) onChange(n);
  });
  return el;
}

function textarea(value: string, onChange: (v: string) => void, placeholder?: string, rows = 2): HTMLTextAreaElement {
  const el = document.createElement('textarea');
  el.value = value;
  el.rows = rows;
  if (placeholder) el.placeholder = placeholder;
  el.addEventListener('change', () => onChange(el.value));
  return el;
}

function select(options: string[], value: string, onChange: (v: string) => void): HTMLSelectElement {
  const el = document.createElement('select');
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt;
    o.textContent = opt === '' ? '(empty — no-op)' : opt;
    if (opt === value) o.selected = true;
    el.appendChild(o);
  }
  el.addEventListener('change', () => onChange(el.value));
  return el;
}

function checkbox(value: boolean, onChange: (v: boolean) => void): HTMLInputElement {
  const el = document.createElement('input');
  el.type = 'checkbox';
  el.checked = value;
  el.addEventListener('change', () => onChange(el.checked));
  return el;
}

// ─── alignment editor ────────────────────────────────────────────────────────
// One summary chip describing the current arrangement in plain language;
// clicking it opens a picker whose buttons sit WHERE their result puts the
// content (a 3×3 position grid). Click-only — nothing to type, nothing to
// break — so it is the one inspector section basic mode keeps.

let alignOpen = false; // picker stays open across self-commits within a selection

function alignmentEditor(node: SPElement, commit: (fn: (n: SPElement) => void) => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'wb-align';

  const get = (k: string, dflt: string): string => {
    const v = node.style?.[k];
    return typeof v === 'string' ? v : dflt;
  };
  const setProps = (props: Record<string, string>) => {
    commit((n) => {
      n.style = n.style ?? {};
      const d = n.style['display'];
      if (typeof d !== 'string' || !d.includes('flex')) n.style['display'] = 'flex';
      for (const [k, v] of Object.entries(props)) {
        if (v === '') delete n.style[k]; else n.style[k] = v;
      }
    });
    render(); // re-read node.style for active states (inspector skips self-commits)
  };

  /** A tiny live flex container of 3 bars demonstrating the given props. */
  const mini = (props: Record<string, string>): HTMLElement => {
    const m = document.createElement('span');
    m.className = 'wb-flexmini';
    Object.assign(m.style, { display: 'flex', gap: '1px', ...props });
    for (const h of ['60%', '100%', '45%']) {
      const bar = document.createElement('i');
      bar.style.height = props['flex-direction'] === 'column' ? '3px' : h;
      bar.style.width = props['flex-direction'] === 'column' ? h : '3px';
      m.appendChild(bar);
    }
    return m;
  };

  const render = () => {
    wrap.innerHTML = '';
    const dir = get('flex-direction', 'row') === 'column' ? 'column' : 'row';
    const justify = get('justify-content', 'flex-start');
    const align = get('align-items', 'stretch');
    const gap = get('gap', '');
    const wrapping = get('flex-wrap', 'nowrap') === 'wrap';

    // plain-language readout, phrased by what the user SEES (left/right vs top/bottom)
    const horiz = dir === 'row' ? justify : align;
    const vert = dir === 'row' ? align : justify;
    const H: Record<string, string> = {
      'flex-start': 'packed left', 'center': 'centered', 'flex-end': 'packed right',
      'space-between': 'spread to the edges', 'space-around': 'evenly spaced', 'stretch': 'stretched wide',
    };
    const V: Record<string, string> = {
      'flex-start': 'at the top', 'center': 'middle', 'flex-end': 'at the bottom',
      'space-between': 'spread to the edges', 'space-around': 'evenly spaced', 'stretch': 'stretched tall',
    };
    const phrase = [
      dir === 'row' ? 'Side by side' : 'Stacked',
      H[horiz] ?? horiz,
      V[vert] ?? vert,
      ...(wrapping ? ['wrapping'] : []),
      ...(gap ? [`gap ${gap}`] : []),
    ].join(' · ');

    // ── the summary chip: current state at a glance, click to change ──
    const summary = document.createElement('button');
    summary.className = 'wb-align-summary' + (alignOpen ? ' open' : '');
    summary.title = 'How items inside this element are arranged — click to change';
    const preview = mini({
      'flex-direction': dir, 'justify-content': justify, 'align-items': align,
      ...(wrapping ? { 'flex-wrap': 'wrap' } : {}),
    });
    const text = document.createElement('span');
    text.className = 'wb-align-phrase';
    text.textContent = phrase;
    const caret = document.createElement('span');
    caret.className = 'wb-align-caret';
    caret.textContent = alignOpen ? '▴' : '▾';
    summary.append(preview, text, caret);
    summary.addEventListener('click', () => { alignOpen = !alignOpen; render(); });
    wrap.appendChild(summary);
    if (!alignOpen) return;

    const panel = document.createElement('div');
    panel.className = 'wb-align-panel';

    const chipRow = (label: string): HTMLElement => {
      const row = document.createElement('div');
      row.className = 'wb-align-row';
      const lab = document.createElement('span');
      lab.className = 'wb-align-label';
      lab.textContent = label;
      row.appendChild(lab);
      return row;
    };
    const chip = (row: HTMLElement, label: string, title: string, active: boolean, props: Record<string, string>, demo?: HTMLElement) => {
      const b = document.createElement('button');
      b.className = 'wb-align-chip' + (active ? ' active' : '');
      b.title = title;
      if (demo) b.appendChild(demo);
      const t = document.createElement('span');
      t.textContent = label;
      b.appendChild(t);
      b.addEventListener('click', () => setProps(props));
      row.appendChild(b);
    };

    // direction
    const dirRow = chipRow('Direction');
    chip(dirRow, 'Side by side', 'Items flow left → right (flex-direction: row)', dir === 'row',
      { 'flex-direction': 'row' }, mini({ 'flex-direction': 'row', 'align-items': 'center' }));
    chip(dirRow, 'Stacked', 'Items flow top → bottom (flex-direction: column)', dir === 'column',
      { 'flex-direction': 'column' }, mini({ 'flex-direction': 'column' }));
    panel.appendChild(dirRow);

    // ── 3×3 position grid: each button sits where it puts the content ──
    const gridWrap = chipRow('Position');
    const grid = document.createElement('div');
    grid.className = 'wb-align-grid';
    const POS = ['flex-start', 'center', 'flex-end'] as const;
    const PLAIN: Record<string, [h: string, v: string]> = {
      'flex-start': ['left', 'top'], 'center': ['center', 'middle'], 'flex-end': ['right', 'bottom'],
    };
    for (const v of POS) {
      for (const h of POS) {
        // grid position == visual result; CSS props depend on direction
        const props = dir === 'row'
          ? { 'justify-content': h, 'align-items': v }
          : { 'justify-content': v, 'align-items': h };
        const cell = document.createElement('button');
        cell.className = 'wb-align-cell'
          + (justify === props['justify-content'] && align === props['align-items'] ? ' active' : '');
        cell.title = `${PLAIN[h][0]} · ${PLAIN[v][1]}`;
        cell.style.justifyContent = h;
        cell.style.alignItems = v;
        const dots = document.createElement('span');
        dots.className = 'wb-align-dots';
        dots.style.flexDirection = dir;
        for (let i = 0; i < 3; i++) dots.appendChild(document.createElement('i'));
        cell.appendChild(dots);
        cell.addEventListener('click', () => setProps(props));
        grid.appendChild(cell);
      }
    }
    gridWrap.appendChild(grid);
    panel.appendChild(gridWrap);

    // spreading along the main axis + stretching across
    const spreadRow = chipRow('Spread');
    chip(spreadRow, 'To the edges', 'First item at one edge, last at the other (space-between)',
      justify === 'space-between', { 'justify-content': 'space-between' },
      mini({ 'flex-direction': dir, 'justify-content': 'space-between', 'align-items': 'center' }));
    chip(spreadRow, 'Evenly', 'Equal breathing room around every item (space-around)',
      justify === 'space-around', { 'justify-content': 'space-around' },
      mini({ 'flex-direction': dir, 'justify-content': 'space-around', 'align-items': 'center' }));
    chip(spreadRow, dir === 'row' ? 'Fill height' : 'Fill width', 'Items stretch to fill the other direction (align-items: stretch)',
      align === 'stretch', { 'align-items': 'stretch' },
      mini({ 'flex-direction': dir, 'align-items': 'stretch' }));
    panel.appendChild(spreadRow);

    // spacing & wrapping — click-only, no typing
    const gapRow = chipRow('Spacing');
    chip(gapRow, 'none', 'No gap between items', gap === '', { gap: '' });
    for (const px of ['4px', '8px', '12px']) {
      chip(gapRow, px, `${px} between items (gap)`, gap === px, { gap: px });
    }
    chip(gapRow, wrapping ? 'wrap ✓' : 'wrap', 'Let items flow onto new lines (flex-wrap) — pills, tags, chips',
      wrapping, { 'flex-wrap': wrapping ? 'nowrap' : 'wrap' });
    panel.appendChild(gapRow);

    wrap.appendChild(panel);
  };
  render();
  return wrap;
}

// ─── box model editor (devtools-style margin/padding rectangles) ────────────

type BoxSides = { top: string; right: string; bottom: string; left: string };
const SIDES = ['top', 'right', 'bottom', 'left'] as const;

/** Resolve the four sides of margin/padding from longhands + shorthand. */
function readSides(style: Record<string, SPExpr | undefined> | undefined, prop: 'margin' | 'padding'): BoxSides {
  const out: BoxSides = { top: '', right: '', bottom: '', left: '' };
  const short = style?.[prop];
  if (typeof short === 'string' && !short.startsWith('=')) {
    const v = short.trim().split(/\s+/);
    out.top = v[0] ?? '';
    out.right = v[1] ?? v[0] ?? '';
    out.bottom = v[2] ?? v[0] ?? '';
    out.left = v[3] ?? v[1] ?? v[0] ?? '';
  } else if (short !== undefined) {
    out.top = out.right = out.bottom = out.left = '𝑓x';
  }
  for (const side of SIDES) {
    const v = style?.[`${prop}-${side}`];
    if (typeof v === 'string' && !v.startsWith('=')) out[side] = v;
    else if (v !== undefined) out[side] = '𝑓x';
  }
  return out;
}

function boxModelEditor(node: SPElement, commit: (fn: (n: SPElement) => void) => void): HTMLElement {
  const layer = (prop: 'margin' | 'padding', inner: HTMLElement): HTMLElement => {
    const sides = readSides(node.style, prop);
    const box = document.createElement('div');
    box.className = `wb-box wb-box-${prop}`;
    const tag = document.createElement('span');
    tag.className = 'wb-box-tag';
    tag.textContent = prop;
    box.appendChild(tag);

    const sideInput = (side: typeof SIDES[number]): HTMLInputElement => {
      const inp = document.createElement('input');
      inp.className = `wb-box-side wb-box-${side}`;
      inp.value = sides[side];
      inp.placeholder = '–';
      inp.title = `${prop}-${side} — type a value, or step with ↑/↓ (Shift = ±10)`;
      if (sides[side] === '𝑓x') {
        inp.readOnly = true;
        inp.title = `${prop}-${side} is set by an expression — edit it in the Style section below`;
      }
      const commitVal = () => {
        const value = inp.value.trim();
        commit((n) => {
          n.style = n.style ?? {};
          // expand any shorthand into longhands once, then set this side
          const cur = readSides(n.style, prop);
          delete n.style[prop];
          for (const s of SIDES) {
            const v = s === side ? value : cur[s];
            if (v && v !== '𝑓x') n.style[`${prop}-${s}`] = /^-?\d+(\.\d+)?$/.test(v) ? `${v}px` : v;
            else if (s === side) delete n.style[`${prop}-${s}`];
          }
          if (Object.keys(n.style).length === 0) delete n.style;
        });
      };
      inp.addEventListener('change', commitVal);
      // ↑/↓ stepping with live canvas updates (inspector keeps focus on self-commits)
      inp.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        if (inp.readOnly) return;
        e.preventDefault();
        const m = inp.value.trim().match(/^(-?\d+(?:\.\d+)?)([a-z%]*)$/);
        const num = m ? parseFloat(m[1]) : 0;
        const unit = m?.[2] || 'px';
        const delta = (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
        inp.value = `${Math.round((num + delta) * 100) / 100}${unit}`;
        commitVal();
      });
      return inp;
    };

    const mid = document.createElement('div');
    mid.className = 'wb-box-mid';
    mid.append(sideInput('left'), inner, sideInput('right'));
    box.append(sideInput('top'), mid, sideInput('bottom'));
    // scale the diagram a little with the actual values
    const avg = SIDES
      .map((s) => parseFloat(sides[s]) || 0)
      .reduce((a, b) => a + b, 0) / 4;
    box.style.padding = `${Math.min(26, 14 + avg / 2)}px ${Math.min(20, 6 + avg / 2)}px ${Math.min(20, 6 + avg / 2)}px`;
    return box;
  };

  const content = document.createElement('div');
  content.className = 'wb-box-content';
  content.textContent = `<${node.elmType}>`;
  content.title = 'The element itself — width/height live in the Style section';

  const wrap = document.createElement('div');
  wrap.className = 'wb-boxmodel';
  wrap.appendChild(layer('margin', layer('padding', content)));
  const hint = document.createElement('div');
  hint.className = 'wb-box-hint';
  hint.textContent = 'margin = space OUTSIDE the element · padding = space INSIDE, around its content. Bare numbers become px.';
  wrap.appendChild(hint);
  return wrap;
}

let datalistSeq = 0;

// ─── property doc cards ──────────────────────────────────────────────────────
// A formatted, readable replacement for the native tooltip: monospace
// property header, the explanation with every 'example' rendered as a
// clickable chip that applies itself as the value, and a live demo chip
// actually wearing the property where that reads visually.

const closeDocCards = () => {
  document.querySelectorAll<HTMLElement>('.wb-doccard').forEach((c) => { c.hidden = true; });
};
document.addEventListener('pointerdown', (e) => {
  const t = e.target as HTMLElement;
  if (!t.closest('.wb-doccard') && !t.closest('.wb-kv-info')) closeDocCards();
});
// the card is position:fixed (so it can escape the pane) — close it when the
// world scrolls under it, but let the card's own content scroll freely
document.addEventListener('scroll', (e) => {
  if (e.target instanceof Element && e.target.closest('.wb-doccard')) return;
  closeDocCards();
}, true);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDocCards();
});

/** Properties whose first example value makes a sensible visual demo on a text chip. */
/** Properties whose first example value makes a sensible visual demo on a text chip. */
const DEMOABLE = new Set([
  'background-color', 'background-image', 'color', 'opacity', 'box-shadow',
  'border', 'border-color', 'border-style', 'border-width', 'border-radius',
  'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius',
  'outline', 'font-family', 'font-size', 'font-style', 'font-weight',
  'letter-spacing', 'text-decoration', 'text-transform', 'text-shadow',
  'transform', 'padding', 'cursor',
]);

// ─── family diagrams ─────────────────────────────────────────────────────────
// Small inline SVGs that build the mental model; the part the current
// property controls is spotlighted in accent where that's meaningful.

const ACC = 'var(--wb-accent)';
const DIM = 'var(--wb-text-2)';
const BRD = 'var(--wb-border)';

function familyDiagram(family: StyleFamily, prop: string): string | null {
  switch (family) {
    case 'box': {
      const hl = prop.startsWith('margin') ? 'margin' : prop.startsWith('padding') ? 'padding'
        : prop.startsWith('border') || prop.startsWith('outline') ? 'border' : 'content';
      const on = (k: string, yes: string, no: string) => (hl === k ? yes : no);
      return `<svg viewBox="0 0 210 110" width="210" height="110" aria-hidden="true">
        <rect x="4" y="4" width="202" height="102" rx="4" fill="rgba(249,174,88,${on('margin', '.4', '.14')})" stroke="${on('margin', ACC, BRD)}" stroke-dasharray="4 3"/>
        <text x="12" y="16" font-size="8" fill="${on('margin', ACC, DIM)}">margin — outside the wall</text>
        <rect x="30" y="24" width="150" height="62" rx="3" fill="var(--wb-surface)" stroke="${on('border', ACC, DIM)}" stroke-width="${on('border', '3', '2')}"/>
        <text x="38" y="35.5" font-size="8" fill="${on('border', ACC, DIM)}">border — the wall</text>
        <rect x="44" y="41" width="122" height="36" rx="2" fill="rgba(123,197,138,${on('padding', '.45', '.18')})" stroke="${on('padding', ACC, 'none')}" stroke-dasharray="4 3"/>
        <text x="50" y="51" font-size="8" fill="${on('padding', ACC, DIM)}">padding</text>
        <rect x="72" y="55" width="66" height="16" rx="2" fill="${on('content', ACC, BRD)}"/>
        <text x="105" y="66.5" text-anchor="middle" font-size="8.5" fill="${on('content', '#fff', DIM)}">content</text>
      </svg>`;
    }
    case 'flex-container': {
      const main = ['justify-content', 'gap', 'column-gap', 'flex-direction', 'flex-flow', 'display', 'flex-wrap'].includes(prop);
      const cross = ['align-items', 'row-gap'].includes(prop);
      return `<svg viewBox="0 0 210 110" width="210" height="110" aria-hidden="true">
        <rect x="24" y="10" width="172" height="74" rx="4" fill="none" stroke="${DIM}" stroke-width="1.5"/>
        <rect x="38" y="26" width="30" height="42" rx="2" fill="${ACC}"/>
        <rect x="78" y="26" width="30" height="30" rx="2" fill="${ACC}" opacity=".7"/>
        <rect x="118" y="26" width="30" height="48" rx="2" fill="${ACC}" opacity=".45"/>
        <path d="M 30 98 H 186 l -7 -4 m 7 4 l -7 4" fill="none" stroke="${main ? ACC : DIM}" stroke-width="${main ? '2.5' : '1.5'}"/>
        <text x="100" y="94" text-anchor="middle" font-size="8.5" fill="${main ? ACC : DIM}">along the shelf — justify, gap</text>
        <path d="M 10 16 V 78 l -4 -7 m 4 7 l 4 -7" fill="none" stroke="${cross ? ACC : DIM}" stroke-width="${cross ? '2.5' : '1.5'}"/>
        <text x="6" y="55" font-size="8.5" fill="${cross ? ACC : DIM}" transform="rotate(-90 6 55)">across — align</text>
      </svg>`;
    }
    case 'flex-child':
      return `<svg viewBox="0 0 210 110" width="210" height="110" aria-hidden="true">
        <rect x="14" y="22" width="182" height="66" rx="4" fill="none" stroke="${DIM}" stroke-width="1.5"/>
        <rect x="24" y="34" width="34" height="42" rx="2" fill="${BRD}"/>
        <rect x="66" y="34" width="92" height="42" rx="2" fill="${ACC}"/>
        <path d="M 72 55 H 60 m 12 0 l -5 -4 m 5 4 l -5 4 M 152 55 h 12 m -12 0 l 5 -4 m -5 4 l 5 4" fill="none" stroke="#fff" stroke-width="2"/>
        <text x="112" y="59" text-anchor="middle" font-size="9" fill="#fff">this child grows</text>
        <rect x="166" y="34" width="22" height="42" rx="2" fill="${BRD}"/>
      </svg>`;
    case 'type': {
      const lineH = prop === 'line-height';
      const spacing = prop === 'letter-spacing' || prop === 'word-spacing';
      return `<svg viewBox="0 0 210 110" width="210" height="110" aria-hidden="true">
        <text x="56" y="62" font-size="44" font-weight="600" fill="${spacing || lineH ? DIM : ACC}" letter-spacing="${spacing ? '14' : '2'}">Ag</text>
        <line x1="50" y1="68" x2="160" y2="68" stroke="${DIM}" stroke-width="1"/>
        <line x1="50" y1="22" x2="160" y2="22" stroke="${DIM}" stroke-width="1" stroke-dasharray="3 3"/>
        <path d="M 176 22 V 68 l -4 -7 m 4 7 l 4 -7 M 176 22 l -4 7 m 4 -7 l 4 7" fill="none" stroke="${lineH ? ACC : DIM}" stroke-width="${lineH ? '2.5' : '1.5'}"/>
        <text x="184" y="49" font-size="8.5" fill="${lineH ? ACC : DIM}">line-height</text>
        ${spacing ? `<path d="M 86 84 h 28 m -28 0 l 5 -4 m -5 4 l 5 4 m 18 -4 l -5 -4 m 5 4 l -5 4" fill="none" stroke="${ACC}" stroke-width="2"/><text x="100" y="100" text-anchor="middle" font-size="8.5" fill="${ACC}">spacing</text>` : ''}
      </svg>`;
    }
    case 'paint': {
      const hl = prop === 'color' ? 'text' : prop === 'box-shadow' ? 'shadow' : prop === 'opacity' ? 'all' : 'box';
      return `<svg viewBox="0 0 210 110" width="210" height="110" aria-hidden="true" ${hl === 'all' ? 'opacity=".5"' : ''}>
        <rect x="58" y="34" width="104" height="44" rx="6" fill="rgba(0,0,0,.45)" stroke="${hl === 'shadow' ? ACC : 'none'}" stroke-dasharray="3 3"/>
        <text x="172" y="84" font-size="8.5" fill="${hl === 'shadow' ? ACC : DIM}">shadow</text>
        <rect x="50" y="26" width="104" height="44" rx="6" fill="${hl === 'box' ? ACC : BRD}"/>
        <text x="44" y="20" font-size="8.5" fill="${hl === 'box' ? ACC : DIM}">background — the box</text>
        <text x="102" y="55" text-anchor="middle" font-size="17" font-weight="600" fill="${hl === 'text' ? ACC : (hl === 'box' ? '#fff' : DIM)}">Aa</text>
        <text x="102" y="98" text-anchor="middle" font-size="8.5" fill="${hl === 'text' ? ACC : DIM}">color — the ink</text>
      </svg>`;
    }
    case 'place': {
      const z = prop === 'z-index';
      return `<svg viewBox="0 0 210 110" width="210" height="110" aria-hidden="true">
        <rect x="14" y="14" width="120" height="82" rx="4" fill="none" stroke="${DIM}" stroke-dasharray="4 3"/>
        <text x="22" y="28" font-size="8.5" fill="${DIM}">the anchor parent</text>
        <rect x="92" y="40" width="76" height="44" rx="4" fill="${BRD}"/>
        <rect x="112" y="54" width="76" height="44" rx="4" fill="${ACC}" opacity=".92"/>
        <text x="150" y="80" text-anchor="middle" font-size="9" fill="#fff">${z ? 'z-index wins' : 'pinned box'}</text>
        <path d="M 134 14 v 20 m 0 -20 l -4 7 m 4 -7 l 4 7" fill="none" stroke="${z ? DIM : ACC}" stroke-width="2"/>
        <text x="140" y="24" font-size="8.5" fill="${z ? DIM : ACC}">top</text>
      </svg>`;
    }
    case 'fit':
      return `<svg viewBox="0 0 210 110" width="210" height="110" aria-hidden="true">
        <rect x="14" y="20" width="130" height="70" rx="4" fill="none" stroke="${DIM}" stroke-width="1.5"/>
        <line x1="26" y1="38" x2="120" y2="38" stroke="${ACC}" stroke-width="6" stroke-linecap="round"/>
        <line x1="26" y1="55" x2="132" y2="55" stroke="${ACC}" stroke-width="6" stroke-linecap="round"/>
        <line x1="26" y1="72" x2="144" y2="72" stroke="${ACC}" stroke-width="6" stroke-linecap="round"/>
        <line x1="148" y1="72" x2="196" y2="72" stroke="${BRD}" stroke-width="6" stroke-linecap="round" stroke-dasharray="2 6"/>
        <text x="158" y="60" font-size="13" fill="${DIM}">…</text>
        <text x="150" y="96" font-size="8.5" fill="${DIM}">too long — clip, scroll or …</text>
      </svg>`;
    case 'table':
      return `<svg viewBox="0 0 210 110" width="210" height="110" aria-hidden="true">
        <rect x="30" y="20" width="150" height="70" rx="2" fill="none" stroke="${DIM}" stroke-width="1.5"/>
        <line x1="80" y1="20" x2="80" y2="90" stroke="${DIM}"/>
        <line x1="130" y1="20" x2="130" y2="90" stroke="${DIM}"/>
        <line x1="30" y1="44" x2="180" y2="44" stroke="${ACC}" stroke-width="2"/>
        <line x1="30" y1="67" x2="180" y2="67" stroke="${DIM}"/>
        <text x="55" y="36" text-anchor="middle" font-size="8.5" fill="${DIM}">cells</text>
      </svg>`;
    case 'svg':
      return `<svg viewBox="0 0 210 110" width="210" height="110" aria-hidden="true">
        <circle cx="105" cy="55" r="34" fill="${BRD}"/>
        <circle cx="105" cy="55" r="34" fill="none" stroke="${ACC}" stroke-width="7" stroke-dasharray="120 94" stroke-linecap="round" transform="rotate(-90 105 55)"/>
        <text x="105" y="59" text-anchor="middle" font-size="11" fill="${DIM}">56%</text>
        <text x="156" y="30" font-size="8.5" fill="${ACC}">stroke (dashed)</text>
        <text x="156" y="86" font-size="8.5" fill="${DIM}">fill (inside)</text>
      </svg>`;
    default:
      return null;
  }
}

/** Curated siblings: same family, skipping per-side/corner longhand noise. */
function relatedProps(prop: string, familyOf: (p: string) => StyleFamily): string[] {
  const family = familyOf(prop);
  const noisy = /-(top|right|bottom|left)(-|$)/;
  return [...ALLOWED_STYLES]
    .filter((p) => p !== prop && familyOf(p) === family && !noisy.test(p) && !p.startsWith('--'))
    .slice(0, 8);
}

function buildDocCard(
  card: HTMLElement,
  rowProp: string,
  docs: Record<string, string>,
  familyOf: ((p: string) => StyleFamily) | null,
  useExample: (prop: string, value: string | null) => void,
): void {
  const show = (prop: string) => {
    card.innerHTML = '';
    const doc = docs[prop];

    const head = document.createElement('div');
    head.className = 'wb-doccard-head';
    const name = document.createElement('code');
    name.className = 'wb-doccard-prop';
    name.textContent = prop || '(property)';
    head.appendChild(name);
    const family = familyOf && prop && doc ? familyOf(prop) : null;
    if (family) {
      const tag = document.createElement('span');
      tag.className = 'wb-doccard-family';
      tag.textContent = STYLE_FAMILY_EXPLAINS[family].name;
      head.appendChild(tag);
    }
    card.appendChild(head);

    if (!doc) {
      const p = document.createElement('div');
      p.className = 'wb-doccard-body';
      p.textContent = prop
        ? 'No notes for this one — it may not be on the SP allow-list, in which case SharePoint silently drops it. Try the dropdown suggestions.'
        : 'Pick a property to see what it does, with examples you can click to apply.';
      card.appendChild(p);
      return;
    }

    // the mental model: family diagram + plain-language story
    if (family) {
      const svg = familyDiagram(family, prop);
      if (svg) {
        const fig = document.createElement('div');
        fig.className = 'wb-doccard-figure';
        fig.innerHTML = svg;
        card.appendChild(fig);
      }
      const plain = document.createElement('div');
      plain.className = 'wb-doccard-plain';
      plain.textContent = STYLE_FAMILY_EXPLAINS[family].plain;
      card.appendChild(plain);
    }

    // the specific property: one-liner where «word word» renders as a syntax
    // shape and 'quoted' values render as clickable example chips
    const body = document.createElement('div');
    body.className = 'wb-doccard-body';
    let firstDemoValue: string | null = null;
    for (const seg of doc.split(/(«[^»]*»)/g)) {
      if (seg.startsWith('«')) {
        const syn = document.createElement('code');
        syn.className = 'wb-doccard-syntax';
        syn.textContent = seg.slice(1, -1);
        syn.title = 'The shape of the value — replace each word with yours';
        body.appendChild(syn);
        continue;
      }
      seg.split(/'([^']*)'/g).forEach((part, i) => {
        if (i % 2 === 0) {
          body.appendChild(document.createTextNode(part));
        } else {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'wb-doccard-ex';
          chip.textContent = part;
          chip.title = `Click to set ${prop}: ${part}`;
          chip.addEventListener('click', () => useExample(prop, part));
          body.appendChild(chip);
          if (!firstDemoValue && !part.startsWith('=') && !part.includes('…')) firstDemoValue = part;
        }
      });
    }
    card.appendChild(body);

    // live demo — a chip actually wearing the property
    if (DEMOABLE.has(prop) && firstDemoValue) {
      const demo = document.createElement('div');
      demo.className = 'wb-doccard-demo';
      const lab = document.createElement('span');
      lab.className = 'wb-doccard-demo-label';
      lab.textContent = 'live';
      const chip = document.createElement('span');
      chip.className = 'wb-doccard-demo-chip';
      chip.textContent = 'Style my style';
      try { chip.style.setProperty(prop, firstDemoValue); } catch { /* invalid demo value */ }
      demo.append(lab, chip);
      card.appendChild(demo);
    }

    // longhand variants: one card serves the whole group (padding ↔ sides);
    // clicking a variant switches which property the ROW edits
    const group = familyOf ? styleGroupOf(prop) : null;
    if (group) {
      const row = document.createElement('div');
      row.className = 'wb-doccard-related';
      const lab = document.createElement('span');
      lab.className = 'wb-doccard-demo-label';
      lab.textContent = 'variants';
      row.appendChild(lab);
      for (const v of group) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'wb-doccard-rel' + (v === prop ? ' active' : '');
        b.textContent = v;
        b.title = v === prop ? 'The one you are editing' : `${docs[v] ?? v}\n\nClick to edit ${v} instead`;
        b.addEventListener('click', () => { useExample(v, null); show(v); });
        row.appendChild(b);
      }
      card.appendChild(row);
    }

    // family glossary (the full flex-* story) or related-property chips
    const glossary = family ? STYLE_FAMILY_EXPLAINS[family].glossary : undefined;
    if (glossary) {
      const dl = document.createElement('dl');
      dl.className = 'wb-doccard-gloss';
      for (const [term, gist] of glossary) {
        const dt = document.createElement('dt');
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'wb-doccard-rel' + (term === prop ? ' active' : '');
        b.textContent = term;
        b.title = `Click to read about ${term}`;
        b.addEventListener('click', () => show(term));
        dt.appendChild(b);
        const dd = document.createElement('dd');
        dd.textContent = gist;
        dl.append(dt, dd);
      }
      card.appendChild(dl);
    } else if (familyOf && !group) {
      const rel = relatedProps(prop, familyOf);
      if (rel.length) {
        const row = document.createElement('div');
        row.className = 'wb-doccard-related';
        const lab = document.createElement('span');
        lab.className = 'wb-doccard-demo-label';
        lab.textContent = 'related';
        row.appendChild(lab);
        for (const r of rel) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'wb-doccard-rel';
          b.textContent = r;
          b.title = docs[r] ?? r;
          b.addEventListener('click', () => show(r));
          row.appendChild(b);
        }
        card.appendChild(row);
      }
    }

    const hint = document.createElement('div');
    hint.className = 'wb-doccard-hint';
    hint.textContent = 'click an example to apply it · click a property name to read about it';
    card.appendChild(hint);
  };
  show(rowProp);
}

/**
 * Key/value table editor for style & attributes objects. Values may be
 * Excel-style strings or AST operator objects — objects display as JSON and
 * are kept intact unless the user actually edits that row. `docs` feeds the
 * dropdown's secondary text and each row's ⓘ explanation.
 */
function kvEditor(
  obj: Record<string, SPExpr | undefined>,
  keySuggestions: string[],
  valueSuggestions: Record<string, string[]>,
  docs: Record<string, string>,
  familyOf: ((prop: string) => StyleFamily) | null,
  onChange: (next: Record<string, SPExpr>) => void,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'wb-kv';

  const listId = `wb-dl-${datalistSeq++}`;
  const dl = document.createElement('datalist');
  dl.id = listId;
  for (const k of keySuggestions) {
    const o = document.createElement('option');
    o.value = k;
    if (docs[k]) o.label = docs[k]; // shown as secondary text in the dropdown
    dl.appendChild(o);
  }
  wrap.appendChild(dl);

  const entries = Object.entries(obj);
  const serialize = (v: SPExpr | undefined): string =>
    v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  // original values by serialized text — untouched rows keep their AST objects
  const originals = new Map<string, SPExpr>();
  for (const [, v] of entries) {
    if (v !== undefined && typeof v !== 'string') originals.set(serialize(v), v);
  }

  const commitRows = () => {
    const next: Record<string, SPExpr> = {};
    wrap.querySelectorAll('.wb-kv-row').forEach((row) => {
      const k = (row.querySelector('.wb-kv-key') as HTMLInputElement).value.trim();
      const raw = (row.querySelector('.wb-kv-val') as HTMLInputElement).value;
      if (!k) return;
      const original = originals.get(raw);
      if (original !== undefined) { next[k] = original; return; }
      if (raw.trim().startsWith('{')) {
        try { next[k] = JSON.parse(raw); return; } catch { /* keep as string */ }
      }
      next[k] = raw;
    });
    onChange(next);
  };

  const addRow = (k: string, v: string) => {
    const row = document.createElement('div');
    row.className = 'wb-kv-row';
    const key = document.createElement('input');
    key.className = 'wb-kv-key';
    key.value = k;
    key.placeholder = 'property';
    key.setAttribute('list', listId);
    const val = document.createElement('input');
    val.className = 'wb-kv-val';
    val.value = v;
    val.placeholder = "value or '=expression'";
    // per-row value datalist, refreshed to match the property name
    const valList = document.createElement('datalist');
    valList.id = `wb-dl-${datalistSeq++}`;
    val.setAttribute('list', valList.id);
    // ⓘ — opens a styled doc card: explanation, clickable example chips,
    // and (where it reads visually) a live demo wearing the property
    const info = document.createElement('button');
    info.type = 'button';
    info.className = 'wb-kv-info';
    info.textContent = 'ⓘ';
    info.title = 'What does this property do?';
    const card = document.createElement('div');
    card.className = 'wb-doccard';
    card.hidden = true;
    const refreshValueOptions = () => {
      const k = key.value.trim();
      valList.innerHTML = '';
      for (const opt of valueSuggestions[k] ?? []) {
        const o = document.createElement('option');
        o.value = opt;
        valList.appendChild(o);
      }
      info.classList.toggle('wb-kv-info-known', !!docs[k]);
      buildDocCard(card, k, docs, familyOf, (exProp, exValue) => {
        if (key.value.trim() !== exProp) key.value = exProp;
        if (exValue !== null) val.value = exValue;
        commitRows();
        refreshValueOptions();
      });
    };
    refreshValueOptions();
    info.addEventListener('click', (e) => {
      e.stopPropagation();
      const willShow = card.hidden;
      closeDocCards();
      if (!willShow) return;
      // fixed positioning escapes the side pane's scroll clip; anchor the
      // card's RIGHT edge to the icon so it opens leftwards over the canvas
      card.hidden = false;
      const r = info.getBoundingClientRect();
      card.style.left = `${Math.max(8, r.right - card.offsetWidth)}px`;
      card.style.top = `${Math.min(r.bottom + 6, Math.max(8, window.innerHeight - card.offsetHeight - 10))}px`;
    });
    const del = document.createElement('button');
    del.innerHTML = '<i class="ms-Icon ms-Icon--Cancel"></i>';
    del.title = 'Remove';
    del.addEventListener('click', () => { row.remove(); commitRows(); });
    key.addEventListener('input', refreshValueOptions);
    key.addEventListener('change', commitRows);
    val.addEventListener('change', commitRows);
    row.append(key, val, valList, info, del, card);
    wrap.appendChild(row);
  };

  entries.forEach(([k, v]) => addRow(k, serialize(v)));

  const add = document.createElement('button');
  add.className = 'wb-kv-add';
  add.textContent = '+ add';
  add.addEventListener('click', () => addRow('', ''));
  wrap.appendChild(add);

  return wrap;
}
