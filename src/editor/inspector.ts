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
import { focusFxSlot } from './fxBar';
import { openPlayground } from './playground';
import { openCondFormat } from './condFormat';
import { governedProperties } from './classPrecedence';
import { styleAcross } from './multiSelect';

/** Common-but-unlisted style properties offered as one-click "quick adds" in the
 *  Pro lens, each with a sensible starter value. Filtered to the SP allow-list at
 *  use so we never offer a property SharePoint would silently drop. */
const QUICK_ADD: Array<[string, string]> = [
  ['min-width', '0'],
  ['max-width', '100%'],
  ['box-shadow', '0 1px 3px rgba(0,0,0,.2)'],
  ['cursor', 'pointer'],
  ['white-space', 'nowrap'],
  ['transition', 'all .15s ease'],
];

/** True when 2+ nodes are selected and they disagree on this style property. */
function propIsMixed(prop: string): boolean {
  const nodes = state.selectedNodes;
  return nodes.length > 1 && !styleAcross(nodes, prop).uniform;
}

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
    // Multi-edit: a targeted property patch applies to EVERY selected node as one
    // undo step (spec — editing a divergent property writes it to all). Used by
    // the dedicated visual controls; whole-object editors (kvEditor) and identity
    // fields (name/elmType/txtContent) keep `commit` (primary only).
    const commitAll = (fn: (n: SPElement) => void) => {
      selfCommit = true;
      state.mutateDocument(() => state.selectedNodes.forEach(fn));
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

    // forEach: a code-driven element is rendered once per item, so edits here
    // apply to every repeated copy. Flag it (amber, not an error) so that's
    // never a surprise — counting across the selection for multi-edit.
    const codeDriven = state.selectedNodes.filter((n) => n.forEach !== undefined);
    if (codeDriven.length) {
      const warn = document.createElement('div');
      warn.className = 'wb-inspector-warn';
      const icon = document.createElement('span');
      icon.className = 'wb-warn-icon';
      icon.textContent = '⟳';
      const msg = document.createElement('span');
      msg.textContent = codeDriven.length === 1
        ? 'Code-driven: this element renders once per item (forEach). Edits apply to every copy.'
        : `Code-driven: ${codeDriven.length} of these elements render once per item (forEach). Edits apply to every copy.`;
      warn.append(icon, msg);
      host.appendChild(warn);
    }

    // Lens gating: Simple shows the visual essentials (Text / Alignment / Box
    // model / Style); Pro adds structure, attributes, and the superpower
    // sections. (The Code lens replaces this inspector with the declarations box.)
    const pro = state.activeLens === 'pro';

    // section-level Reset + active-dot: a section is "active" when any property
    // it governs is set; Reset clears them all in one undoable mutation (writes
    // to every selected node, matching the dedicated controls' commitAll).
    const sectionReset = (props: string[]): SectionReset => ({
      // active when ANY selected node has one of these props set — Reset (commitAll)
      // writes to every selected node, so the dot/button must reflect all of them.
      active: state.selectedNodes.some((n) => props.some((p) => styleOf(n, p) !== '')),
      onReset: () => commitAll((n) => {
        if (!n.style) return;
        for (const p of props) delete n.style[p];
        if (Object.keys(n.style).length === 0) delete n.style;
      }),
    });
    const TYPO_PROPS = ['font-size', 'color', 'font-weight', 'text-align', 'line-height', 'text-transform'];
    const APPEARANCE_PROPS = ['background-color', 'border-radius', 'opacity', 'overflow'];
    const BORDER_PROPS = ['border-width', 'border-style', 'border-color'];

    // document-level wrapper settings when the root is selected (Pro only)
    if (pro && state.selection && state.selection.length === 0) {
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

    // ✨ conditional formatting — click-only; the builder generates the
    // formulas itself, so a misclick can't corrupt the formatter. A FormatFX
    // superpower → Pro lens. (The playground button is dropped: the Left Edit
    // Pane IS the playground.)
    if (pro) {
      const condBtn = document.createElement('button');
      condBtn.className = 'wb-inspector-cond';
      condBtn.textContent = '✨ Conditional formatting…';
      condBtn.title = 'Paint this element by a field\'s value — Excel-style rules, built by clicking, previewed on your rows';
      condBtn.addEventListener('click', () => {
        if (state.selection) openCondFormat({ kind: 'element', path: state.selection });
      });
      host.appendChild(condBtn);
    }

    // Text content — the headline control in both lenses (Simple calls it "Text").
    const txtContentField = (): HTMLElement => labeled('txtContent', textarea(
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
      }), "Literal, '=expression', '[$Field]', '@currentField' or AST {\"operator\":…}"));

    // ── Simple: the visual essentials (dedicated, targeted-property fields) ──
    if (!pro) {
      host.appendChild(section('Text', [txtContentField()]));
      host.appendChild(section('Typography', typographySection(node, commitAll), false, sectionReset(TYPO_PROPS)));
      // the click-only flex-arrangement chip is retained as a Simple convenience;
      // Pro replaces the old 3×3 grid with the flex alignment presets (spec §2.B).
      host.appendChild(section('Arrange children', [alignmentEditor(node, commit)]));
      host.appendChild(section('Appearance', appearanceSection(node, commitAll), false, sectionReset(APPEARANCE_PROPS)));
      host.appendChild(section('Border', borderSection(node, commitAll), false, sectionReset(BORDER_PROPS)));
    }

    // ── Pro: the mechanical layout engine + full control ──
    if (pro) {
      host.appendChild(section('Element', [
        labeled('name (_elmName)', input(node._elmName ?? '', (v) => commit((n) => {
          const t = v.trim();
          if (t === '') delete n._elmName; else n._elmName = t;
        }), 'Label shown in the Structure pane — stripped from shipped JSON')),
        labeled('elmType', select(ELM_TYPES, node.elmType, (v) => commit((n) => { n.elmType = v as SPElement['elmType']; }))),
        txtContentField(),
        labeled('forEach', input(node.forEach ?? '', (v) => commit((n) => {
          if (v === '') delete n.forEach; else n.forEach = v;
        }), '_item in [$MultiField]  or  _t in split([$Tags],\';\')', 'wb-dl-foreach')),
      ], true));
      host.appendChild(section('Sizing', [sizingControls(node, commitAll)]));
      host.appendChild(section('Position', [positionControls(node, commitAll)]));
      host.appendChild(section('Contents layout', [contentsLayout(node, commitAll)]));
      host.appendChild(section('Padding', [spacingControls(node, commitAll, 'padding')]));
      host.appendChild(section('Margin', [spacingControls(node, commitAll, 'margin')]));
      host.appendChild(section('Appearance', appearanceSection(node, commitAll), false, sectionReset(APPEARANCE_PROPS)));
      host.appendChild(section('Border', borderSection(node, commitAll), false, sectionReset(BORDER_PROPS)));
    }

    // Box model (DevTools-style): Simple's intuitive padding/margin editor; Pro
    // uses the parameter-count selectors above instead (spec §7).
    if (!pro) host.appendChild(section('Box model', [boxModelEditor(node, commit)], true));

    if (pro) {
      host.appendChild(section('Style (all properties)', [
        kvEditor(node.style ?? {}, [...ALLOWED_STYLES], STYLE_VALUE_SUGGESTIONS, STYLE_PROP_DOCS, styleFamilyOf, (obj) => {
          const oldStyle = node.style ?? {};
          commitAll((n) => {
            n.style = n.style ?? {};
            for (const k of Object.keys(oldStyle)) {
              if (!(k in obj)) delete n.style[k];
            }
            for (const [k, v] of Object.entries(obj)) {
              n.style[k] = v;
            }
            if (Object.keys(n.style).length === 0) delete n.style;
          });
        }, governedProperties(node.attributes?.class)),
      ], true));

      // quick-add: one-click links for common-but-unlisted properties, each with
      // a sensible starter value. Only offers what the element doesn't already
      // carry; clicking adds it (one undoable mutation) so it lands in the Style
      // editor above, ready to tune.
      const present = new Set(Object.keys(node.style ?? {}));
      const addable = QUICK_ADD.filter(([p]) => !present.has(p) && ALLOWED_STYLES.has(p));
      if (addable.length) {
        const wrap = document.createElement('div');
        wrap.className = 'wb-quickadd';
        const lab = document.createElement('span');
        lab.className = 'wb-quickadd-lab';
        lab.textContent = 'Add:';
        wrap.appendChild(lab);
        for (const [p, dflt] of addable) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'wb-quickadd-link';
          b.textContent = p;
          b.title = `Add ${p}: ${dflt}`;
          b.addEventListener('click', () => state.mutateDocument(() => state.selectedNodes.forEach((n) => {
            n.style = n.style ?? {};
            if (n.style[p] === undefined) n.style[p] = dflt;
          })));
          wrap.appendChild(b);
        }
        host.appendChild(wrap);
      }
    }

    // ── Pro-only: attributes + the superpower sections ──────────────────────
    if (pro) {
    host.appendChild(section('Attributes', [
      kvEditor(node.attributes ?? {}, [...ALLOWED_ATTRIBUTES], ATTRIBUTE_VALUE_SUGGESTIONS, ATTRIBUTE_DOCS, null, (obj) => {
        const oldAttrs = node.attributes ?? {};
        commitAll((n) => {
          n.attributes = n.attributes ?? {};
          for (const k of Object.keys(oldAttrs)) {
            if (!(k in obj)) delete n.attributes[k];
          }
          for (const [k, v] of Object.entries(obj)) {
            n.attributes[k] = v;
          }
          if (Object.keys(n.attributes).length === 0) delete n.attributes;
        });
      }),
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
    } // end Pro-only sections
  };

  if ((host as any)._unsub) {
    (host as any)._unsub();
  }
  const unsub = state.subscribe((reason) => {
    // skip rebuilding for our own commits — keeps focus in the input being
    // edited (arrow-stepping, rapid toggles) while canvas/tree still update
    if (reason === 'document' && selfCommit) return;
    if (reason === 'selection' || reason === 'load' || reason === 'document' || reason === 'lens') render();
  });
  (host as any)._unsub = unsub;
  render();
}

let selfCommit = false;

// ─── tiny form helpers ───────────────────────────────────────────────────────

/**
 * `adv` sections are hidden in basic mode. Basic deliberately keeps ONLY
 * click-driven controls (the Alignment section) — no free-text property
 * editing — so a misclick can't corrupt the formatter.
 */
interface SectionReset { active: boolean; onReset: () => void; }

function section(title: string, children: HTMLElement[], adv = false, reset?: SectionReset): HTMLElement {
  const s = document.createElement('details');
  s.className = 'wb-inspector-section' + (adv ? ' wb-adv' : '');
  s.open = true;
  const h = document.createElement('summary');
  const t = document.createElement('span');
  t.className = 'wb-sec-title';
  t.textContent = title;
  h.appendChild(t);
  // a blue dot when any property this section governs is set, and a Reset link
  // that clears them all in one undoable step (spec — section-level aggregation).
  if (reset) {
    if (reset.active) {
      const dot = document.createElement('span');
      dot.className = 'wb-active-dot wb-sec-dot';
      dot.title = 'Some properties in this section are set';
      h.appendChild(dot);
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wb-sec-reset';
    btn.textContent = 'Reset';
    btn.title = `Clear every property in ${title}`;
    btn.disabled = !reset.active;
    btn.addEventListener('click', (e) => {
      e.preventDefault();  // don't toggle the <details> open/closed
      e.stopPropagation();
      reset.onReset();
    });
    h.appendChild(btn);
  }
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

// ─── Pro controls: segmented selector + Sizing + Contents layout ─────────────
// Spec §2.B — the mechanical layout engine, honoring the Schema-Fidelity
// Exclusion Principle (no align-self, no grid display, no fixed/sticky).

/** A horizontal segmented control (Hug/Fixed/Fill, display modes, …). */
function segmented(
  options: Array<{ value: string; label: string; title?: string }>,
  active: string,
  onChange: (v: string) => void,
): HTMLElement {
  const seg = document.createElement('div');
  seg.className = 'wb-segmented';
  for (const o of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wb-seg' + (o.value === active ? ' active' : '');
    b.textContent = o.label;
    if (o.title) b.title = o.title;
    b.addEventListener('click', () => onChange(o.value));
    seg.appendChild(b);
  }
  return seg;
}

const styleOf = (node: SPElement, prop: string): string =>
  (typeof node.style?.[prop] === 'string' ? node.style![prop] as string : '');

const SIZE_FILL = '100%';
type SizeMode = 'hug' | 'fixed' | 'fill';
function sizeMode(v: string): SizeMode {
  if (v === '' || v === 'auto' || v === 'fit-content') return 'hug';
  if (v === SIZE_FILL) return 'fill';
  return 'fixed';
}

/** Width/Height with Hug (auto) / Fixed (literal) / Fill (100%). */
function sizingControls(node: SPElement, commit: (fn: (n: SPElement) => void) => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'wb-sizing';
  const setProp = (prop: string, v: string | undefined) => {
    commit((n) => {
      n.style = n.style ?? {};
      if (v === undefined || v === '') delete n.style[prop];
      else n.style[prop] = /^-?\d+(\.\d+)?$/.test(v) ? `${v}px` : v;
      if (Object.keys(n.style).length === 0) delete n.style;
    });
    render();
  };
  const render = () => {
    wrap.innerHTML = '';
    for (const prop of ['width', 'height'] as const) {
      const cur = styleOf(node, prop);
      const mode = sizeMode(cur);
      const row = document.createElement('div');
      row.className = 'wb-field-row';
      const label = document.createElement('span');
      label.className = 'wb-field-label';
      label.textContent = prop === 'width' ? 'Width' : 'Height';
      const inp = document.createElement('input');
      inp.className = 'wb-field-input';
      inp.value = mode === 'fixed' ? cur : '';
      inp.placeholder = mode === 'hug' ? 'auto' : mode === 'fill' ? '100%' : 'e.g. 120px';
      inp.disabled = mode !== 'fixed';
      inp.addEventListener('change', () => setProp(prop, inp.value.trim()));
      const seg = segmented(
        [{ value: 'hug', label: 'Hug', title: 'Shrink to fit the content (auto)' },
          { value: 'fixed', label: 'Fixed', title: 'A literal size you type' },
          { value: 'fill', label: 'Fill', title: 'Fill the available space (100%)' }],
        mode,
        (m) => setProp(prop, m === 'hug' ? '' : m === 'fill' ? SIZE_FILL : (mode === 'fixed' ? cur : '120px')),
      );
      row.append(label, inp, seg);
      wrap.appendChild(row);
    }
  };
  render();
  return wrap;
}

// display: Grid is omitted (unsupported by the SP renderer).
const DISPLAY_MODES = [
  { value: 'block', label: 'Block' },
  { value: 'flex', label: 'Flex' },
  { value: 'inline-flex', label: 'Inline-Flex' },
  { value: 'inline-block', label: 'Inline-Block' },
  { value: 'inline', label: 'Inline' },
  { value: 'none', label: 'None' },
];
const JUSTIFY_PRESETS: Array<[string, string]> = [
  ['flex-start', 'Start'], ['center', 'Center'], ['flex-end', 'End'],
  ['space-between', 'Between'], ['space-around', 'Around'], ['space-evenly', 'Evenly'],
];
const ALIGN_PRESETS: Array<[string, string]> = [
  ['flex-start', 'Start'], ['center', 'Center'], ['flex-end', 'End'],
  ['stretch', 'Stretch'], ['baseline', 'Baseline'],
];

/** Container layout: display segmented; when Flex, direction + the two rows of
 *  alignment presets (justify-content / align-items) + gap. */
function contentsLayout(node: SPElement, commit: (fn: (n: SPElement) => void) => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'wb-contents';
  const setProp = (prop: string, v: string) => {
    commit((n) => {
      n.style = n.style ?? {};
      if (v === '') delete n.style[prop]; else n.style[prop] = v;
      if (Object.keys(n.style).length === 0) delete n.style;
    });
    render();
  };
  const presetRow = (label: string, presets: Array<[string, string]>, active: string, onPick: (v: string) => void): HTMLElement => {
    const row = document.createElement('div');
    row.className = 'wb-preset-row';
    const lab = document.createElement('span');
    lab.className = 'wb-field-label';
    lab.textContent = label;
    row.appendChild(lab);
    const group = document.createElement('div');
    group.className = 'wb-presets';
    for (const [val, title] of presets) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'wb-preset' + (val === active ? ' active' : '');
      b.title = `${label}: ${title}`;
      b.textContent = title;
      b.dataset.preset = val;
      b.addEventListener('click', () => onPick(val));
      group.appendChild(b);
    }
    row.appendChild(group);
    return row;
  };
  const render = () => {
    wrap.innerHTML = '';
    const display = styleOf(node, 'display');
    wrap.appendChild(segmented(DISPLAY_MODES, display || 'block', (v) => setProp('display', v === 'block' ? '' : v)));
    const isFlex = display === 'flex' || display === 'inline-flex';
    if (isFlex) {
      const dir = styleOf(node, 'flex-direction') || 'row';
      wrap.appendChild(presetRow('Direction',
        [['row', 'Row →'], ['column', 'Column ↓'], ['row-reverse', 'Row ←'], ['column-reverse', 'Column ↑']],
        dir, (v) => setProp('flex-direction', v === 'row' ? '' : v)));
      wrap.appendChild(presetRow('Distribute', JUSTIFY_PRESETS, styleOf(node, 'justify-content') || 'flex-start',
        (v) => setProp('justify-content', v === 'flex-start' ? '' : v)));
      wrap.appendChild(presetRow('Align', ALIGN_PRESETS, styleOf(node, 'align-items') || 'stretch',
        (v) => setProp('align-items', v === 'stretch' ? '' : v)));
      const gapRow = document.createElement('div');
      gapRow.className = 'wb-field-row';
      const gl = document.createElement('span');
      gl.className = 'wb-field-label';
      gl.textContent = 'Gap';
      const gi = document.createElement('input');
      gi.className = 'wb-field-input';
      gi.value = styleOf(node, 'gap');
      gi.placeholder = '0px';
      gi.addEventListener('change', () => {
        const v = gi.value.trim();
        setProp('gap', v && /^-?\d+(\.\d+)?$/.test(v) ? `${v}px` : v);
      });
      gapRow.append(gl, gi);
      wrap.appendChild(gapRow);
    }
  };
  render();
  return wrap;
}

/** Positioning (Pro): Inline (static/relative) vs Absolute, with offsets.
 *  Fixed / sticky are omitted — unsupported by the SP renderer (spec §2.B). */
function positionControls(node: SPElement, commit: (fn: (n: SPElement) => void) => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'wb-position';
  const setProp = (prop: string, v: string) => {
    commit((n) => {
      n.style = n.style ?? {};
      if (v === '') delete n.style[prop]; else n.style[prop] = v;
      if (Object.keys(n.style).length === 0) delete n.style;
    });
    render();
  };
  const offsetRow = (prop: string, label: string): HTMLElement => {
    const row = document.createElement('div');
    row.className = 'wb-field-row';
    const lab = document.createElement('span');
    lab.className = 'wb-field-label';
    lab.textContent = label;
    const inp = document.createElement('input');
    inp.className = 'wb-field-input';
    inp.value = styleOf(node, prop);
    inp.placeholder = 'auto';
    inp.addEventListener('change', () => {
      const v = inp.value.trim();
      setProp(prop, v && /^-?\d+(\.\d+)?$/.test(v) ? `${v}px` : v);
    });
    row.append(lab, inp);
    return row;
  };
  const appendOffsets = () => {
    for (const [prop, label] of [['top', 'Top'], ['left', 'Left'], ['bottom', 'Bottom'], ['right', 'Right']]) {
      wrap.appendChild(offsetRow(prop, label));
    }
  };
  const render = () => {
    wrap.innerHTML = '';
    const pos = styleOf(node, 'position');
    const mode = pos === 'absolute' ? 'absolute' : 'inline';
    wrap.appendChild(segmented(
      [{ value: 'inline', label: 'Inline', title: 'Flows with the layout (static / relative)' },
        { value: 'absolute', label: 'Absolute', title: 'Positioned against the nearest positioned ancestor' }],
      mode,
      (m) => setProp('position', m === 'absolute' ? 'absolute' : ''),
    ));
    if (mode === 'absolute') {
      appendOffsets();
    } else {
      const offRow = document.createElement('div');
      offRow.className = 'wb-field-row';
      const lab = document.createElement('span');
      lab.className = 'wb-field-label';
      lab.textContent = 'Offset';
      offRow.append(lab, checkbox(pos === 'relative', (on) => setProp('position', on ? 'relative' : '')));
      wrap.appendChild(offRow);
      if (pos === 'relative') appendOffsets();
    }
  };
  render();
  return wrap;
}

/** Padding / Margin with the `– 1x 2x 4x` parameter-count selector (spec §2.B).
 *  Writes the CSS shorthand and clears any per-side longhands to avoid conflicts. */
function spacingControls(node: SPElement, commit: (fn: (n: SPElement) => void) => void, prop: 'padding' | 'margin'): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'wb-spacing';
  const px = (v: string): string => (v && /^-?\d+(\.\d+)?$/.test(v) ? `${v}px` : v);
  const parts = (): string[] => { const v = styleOf(node, prop).trim(); return v ? v.split(/\s+/) : []; };
  const setShort = (v: string) => {
    commit((n) => {
      n.style = n.style ?? {};
      if (!v.trim()) delete n.style[prop]; else n.style[prop] = v.trim();
      for (const s of ['top', 'right', 'bottom', 'left']) delete n.style[`${prop}-${s}`];
      if (Object.keys(n.style).length === 0) delete n.style;
    });
    render();
  };
  const render = () => {
    wrap.innerHTML = '';
    const p = parts();
    const mode = p.length === 0 ? '-' : p.length === 1 ? '1x' : p.length === 2 ? '2x' : '4x';
    const head = document.createElement('div');
    head.className = 'wb-spacing-head';
    head.appendChild(segmented(
      [{ value: '-', label: '–' }, { value: '1x', label: '1x' }, { value: '2x', label: '2x' }, { value: '4x', label: '4x' }],
      mode,
      (m) => {
        const a = p[0] ?? '0px', b = p[1] ?? a, c = p[2] ?? a, d = p[3] ?? b;
        setShort(m === '-' ? '' : m === '1x' ? a : m === '2x' ? `${a} ${b}` : `${a} ${b} ${c} ${d}`);
      },
    ));
    wrap.appendChild(head);
    const slot = (label: string, idx: number, len: number) => {
      const row = document.createElement('div');
      row.className = 'wb-field-row';
      const lab = document.createElement('span');
      lab.className = 'wb-field-label';
      lab.textContent = label;
      const inp = document.createElement('input');
      inp.className = 'wb-field-input';
      inp.value = parts()[idx] ?? '';
      inp.placeholder = '0px';
      inp.addEventListener('change', () => {
        const cur = parts();
        const arr = Array.from({ length: len }, (_, i) => cur[i] ?? cur[0] ?? '0px');
        arr[idx] = px(inp.value.trim()) || '0px';
        setShort(arr.join(' '));
      });
      row.append(lab, inp);
      wrap.appendChild(row);
    };
    if (mode === '1x') slot('All', 0, 1);
    else if (mode === '2x') { slot('Vertical', 0, 2); slot('Horizontal', 1, 2); }
    else if (mode === '4x') { slot('Top', 0, 4); slot('Right', 1, 4); slot('Bottom', 2, 4); slot('Left', 3, 4); }
  };
  render();
  return wrap;
}

// ─── Simple lens: dedicated visual property fields ───────────────────────────
// Targeted single-property patches (safe under multi-select, unlike a whole-
// object replace) with a blue "active" dot when the property is set.

const PX_PROPS = new Set(['font-size', 'border-radius', 'border-width', 'letter-spacing']);
function coerceForProp(prop: string, v: string): string {
  return v && PX_PROPS.has(prop) && /^-?\d+(\.\d+)?$/.test(v) ? `${v}px` : v;
}
function setStyleProp(commit: (fn: (n: SPElement) => void) => void, prop: string, v: string): void {
  commit((n) => {
    n.style = n.style ?? {};
    if (v === '') delete n.style[prop]; else n.style[prop] = v;
    if (Object.keys(n.style).length === 0) delete n.style;
  });
}
function visualRow(node: SPElement, label: string, prop: string, control: HTMLElement): HTMLElement {
  const row = document.createElement('div');
  row.className = 'wb-field-row';
  const lab = document.createElement('span');
  lab.className = 'wb-field-label';
  if (styleOf(node, prop) !== '') {
    const dot = document.createElement('span');
    dot.className = 'wb-active-dot';
    dot.title = 'This property is set (overriding the default)';
    lab.appendChild(dot);
  }
  lab.append(label);
  row.append(lab, control);
  // ⓘ doc card: the family diagram, plain-language story and clickable example
  // chips for this property — the same teaching card the Style editor uses.
  if (STYLE_PROP_DOCS[prop]) {
    const info = document.createElement('button');
    info.type = 'button';
    info.className = 'wb-kv-info wb-kv-info-known wb-field-info';
    info.textContent = 'ⓘ';
    info.title = `What does ${prop} do?`;
    const card = document.createElement('div');
    card.className = 'wb-doccard';
    card.hidden = true;
    buildDocCard(card, prop, STYLE_PROP_DOCS, styleFamilyOf, (exProp, exValue) => {
      if (exValue === null || exProp !== prop) return; // variant switches just re-read
      // apply to every selected node as a normal (re-rendering) mutation so the
      // field visibly updates to the value the maker just clicked.
      state.mutateDocument(() => state.selectedNodes.forEach((n) => {
        n.style = n.style ?? {};
        if (exValue === '') delete n.style[prop]; else n.style[prop] = exValue;
        if (Object.keys(n.style).length === 0) delete n.style;
      }));
    });
    info.addEventListener('click', (e) => {
      e.stopPropagation();
      const willShow = card.hidden;
      closeDocCards();
      if (!willShow) return;
      card.hidden = false;
      openCardAnchor = { card, anchor: info };
      positionDocCard();
    });
    row.append(info, card);
  }
  return row;
}
function propInput(node: SPElement, commit: (fn: (n: SPElement) => void) => void, prop: string, placeholder: string): HTMLInputElement {
  const inp = document.createElement('input');
  inp.className = 'wb-field-input';
  const mixed = propIsMixed(prop);
  inp.value = mixed ? '' : styleOf(node, prop);
  inp.placeholder = mixed ? 'Mixed' : placeholder;
  if (mixed) inp.classList.add('wb-mixed');
  inp.addEventListener('change', () => setStyleProp(commit, prop, coerceForProp(prop, inp.value.trim())));
  return inp;
}
function colorControl(node: SPElement, commit: (fn: (n: SPElement) => void) => void, prop: string, placeholder: string): HTMLElement {
  const box = document.createElement('div');
  box.className = 'wb-color-control';
  const inp = propInput(node, commit, prop, placeholder);
  const sw = document.createElement('span');
  sw.className = 'wb-swatch';
  const cur = styleOf(node, prop);
  // layer the color over the CSS checker so an empty/expression/mixed value reads as "none"
  sw.style.backgroundColor = !propIsMixed(prop) && cur && !cur.startsWith('=') ? cur : 'transparent';
  box.append(inp, sw);
  return box;
}
function propSelect(node: SPElement, commit: (fn: (n: SPElement) => void) => void, prop: string, options: Array<[string, string]>): HTMLSelectElement {
  const sel = document.createElement('select');
  sel.className = 'wb-field-input';
  const mixed = propIsMixed(prop);
  const cur = styleOf(node, prop);
  if (mixed) {
    const o = document.createElement('option');
    o.textContent = 'Mixed'; o.value = ''; o.disabled = true; o.selected = true;
    sel.appendChild(o);
  }
  for (const [val, label] of options) {
    const o = document.createElement('option');
    o.value = val; o.textContent = label;
    if (!mixed && val === cur) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => setStyleProp(commit, prop, sel.value));
  return sel;
}

/**
 * Wrap a literal control with the `=` expression toggle (spec §4.A). In literal
 * mode the supplied control shows; the `=` button flips to a formula text input
 * (its value is the stored `=…` expression). Toggling back to literal clears the
 * formula. Self-contained local re-render — no Function Bar dependency required.
 */
function exprField(
  node: SPElement,
  commit: (fn: (n: SPElement) => void) => void,
  prop: string,
  buildControl: () => HTMLElement,
  formulaPlaceholder: string,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'wb-expr-field';
  let exprMode = styleOf(node, prop).startsWith('=');
  const render = (focusInput = false) => {
    wrap.innerHTML = '';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'wb-expr-toggle' + (exprMode ? ' active' : '');
    toggle.textContent = '=';
    toggle.title = exprMode ? 'Use a literal value' : 'Drive this with a formula';
    if (exprMode) {
      const inp = document.createElement('input');
      inp.className = 'wb-field-input wb-expr-input';
      inp.value = styleOf(node, prop);
      inp.placeholder = formulaPlaceholder;
      inp.spellcheck = false;
      inp.addEventListener('change', () => setStyleProp(commit, prop, inp.value.trim()));
      wrap.append(inp);
      // dock the Function Bar onto this property — edit the same formula there,
      // with column/context/function autocomplete and the value menu.
      const dock = document.createElement('button');
      dock.type = 'button';
      dock.className = 'wb-expr-fx';
      dock.textContent = 'ƒx';
      dock.title = 'Edit this formula in the Function Bar — with column and function autocomplete';
      dock.addEventListener('click', () => { focusFxSlot(prop); });
      wrap.append(dock);
      if (focusInput) requestAnimationFrame(() => inp.focus());
    } else {
      wrap.append(buildControl());
    }
    wrap.append(toggle);
    toggle.addEventListener('click', () => {
      if (exprMode && styleOf(node, prop).startsWith('=')) setStyleProp(commit, prop, '');
      exprMode = !exprMode;
      render(exprMode);
    });
  };
  render();
  return wrap;
}

/** A labeled property row whose control carries the `=` expression toggle. */
function exprRow(
  node: SPElement,
  commit: (fn: (n: SPElement) => void) => void,
  label: string,
  prop: string,
  buildControl: () => HTMLElement,
  formulaPlaceholder = "=if([$Field]=='x','a','b')",
): HTMLElement {
  return visualRow(node, label, prop, exprField(node, commit, prop, buildControl, formulaPlaceholder));
}

const WEIGHTS: Array<[string, string]> = [
  ['', 'Regular'], ['500', 'Medium'], ['600', 'Semibold'], ['700', 'Bold'], ['400', '400'],
];
const CASES: Array<[string, string]> = [
  ['', 'none'], ['uppercase', 'UPPERCASE'], ['lowercase', 'lowercase'], ['capitalize', 'Capitalize'],
];
const OVERFLOWS: Array<[string, string]> = [
  ['', 'visible'], ['hidden', 'hidden'], ['auto', 'auto'], ['scroll', 'scroll'],
];

/** Typography section (Simple) — each control carries the `=` expression toggle. */
function typographySection(node: SPElement, commit: (fn: (n: SPElement) => void) => void): HTMLElement[] {
  return [
    exprRow(node, commit, 'Size', 'font-size', () => propInput(node, commit, 'font-size', 'e.g. 13px')),
    exprRow(node, commit, 'Color', 'color', () => colorControl(node, commit, 'color', '#605e5c')),
    exprRow(node, commit, 'Weight', 'font-weight', () => propSelect(node, commit, 'font-weight', WEIGHTS)),
    exprRow(node, commit, 'Align', 'text-align', () => segmented(
      [{ value: '', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }, { value: 'justify', label: 'Justify' }],
      styleOf(node, 'text-align'), (v) => setStyleProp(commit, 'text-align', v))),
    exprRow(node, commit, 'Leading', 'line-height', () => propInput(node, commit, 'line-height', '1.20')),
    exprRow(node, commit, 'Case', 'text-transform', () => propSelect(node, commit, 'text-transform', CASES)),
  ];
}

/** Appearance section (Simple + Pro share this primitive). */
function appearanceSection(node: SPElement, commit: (fn: (n: SPElement) => void) => void): HTMLElement[] {
  return [
    exprRow(node, commit, 'Background', 'background-color', () => colorControl(node, commit, 'background-color', 'None')),
    exprRow(node, commit, 'Radius', 'border-radius', () => propInput(node, commit, 'border-radius', '0px')),
    exprRow(node, commit, 'Opacity', 'opacity', () => propInput(node, commit, 'opacity', '1.00')),
    exprRow(node, commit, 'Overflow', 'overflow', () => propSelect(node, commit, 'overflow', OVERFLOWS)),
  ];
}

/** Border section (Simple). */
function borderSection(node: SPElement, commit: (fn: (n: SPElement) => void) => void): HTMLElement[] {
  return [
    exprRow(node, commit, 'Width', 'border-width', () => propInput(node, commit, 'border-width', '0px')),
    exprRow(node, commit, 'Style', 'border-style', () => propSelect(node, commit, 'border-style',
      [['', 'none'], ['solid', 'solid'], ['dashed', 'dashed'], ['dotted', 'dotted']])),
    exprRow(node, commit, 'Color', 'border-color', () => colorControl(node, commit, 'border-color', '#e1dfdd')),
  ];
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

let openCardAnchor: { card: HTMLElement; anchor: HTMLElement } | null = null;

const closeDocCards = () => {
  document.querySelectorAll<HTMLElement>('.wb-doccard').forEach((c) => { c.hidden = true; });
  openCardAnchor = null;
};

/** The card is position:fixed (it escapes the pane's clip and opens leftwards
 *  over the canvas) — keep it glued to its ⓘ anchor while the world scrolls,
 *  and close it only when the anchor itself scrolls out of sight. */
const positionDocCard = () => {
  if (!openCardAnchor) return;
  const { card, anchor } = openCardAnchor;
  const r = anchor.getBoundingClientRect();
  if (r.bottom < 0 || r.top > window.innerHeight) { closeDocCards(); return; }
  const lp = document.getElementById('wb-leftpane');
  const lpRight = lp ? lp.getBoundingClientRect().right : 360;
  card.style.left = `${lpRight + 8}px`;
  card.style.top = `${Math.min(r.bottom + 6, Math.max(8, window.innerHeight - card.offsetHeight - 10))}px`;
};
document.addEventListener('pointerdown', (e) => {
  const t = e.target as HTMLElement;
  if (!t.closest('.wb-doccard') && !t.closest('.wb-kv-info')) closeDocCards();
});
document.addEventListener('scroll', (e) => {
  if (e.target instanceof Element && e.target.closest('.wb-doccard')) return;
  positionDocCard();
}, true);
window.addEventListener('resize', positionDocCard);
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
    if (familyOf) {
      const play = document.createElement('button');
      play.type = 'button';
      play.className = 'wb-doccard-play';
      play.textContent = '⚗ try it in the playground';
      play.title = 'Open the consequence-free playground with this property selected';
      play.addEventListener('click', () => { closeDocCards(); openPlayground(prop); });
      hint.appendChild(play);
    }
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
  // class-precedence: prop → governing class. A row whose prop is governed but
  // present (an inline value) is an OVERRIDE of that class — flag it (spec §5).
  governed?: Map<string, string>,
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
      card.hidden = false;
      openCardAnchor = { card, anchor: info };
      positionDocCard();
    });
    const del = document.createElement('button');
    del.innerHTML = '<i class="ms-Icon ms-Icon--Cancel"></i>';
    del.title = 'Remove';
    del.addEventListener('click', () => { row.remove(); commitRows(); });
    // class-precedence override badge: a class would paint this property, but
    // this inline value wins. Clearing the value hands control back to the class.
    const badge = document.createElement('span');
    badge.className = 'wb-governed-badge';
    const refreshGoverned = () => {
      const cls = governed?.get(key.value.trim());
      if (cls) {
        badge.hidden = false;
        badge.textContent = '[Class Overridden]';
        badge.title = `This inline value overrides class "${cls}". Clear it to let the class control this property.`;
        row.classList.add('wb-row-override');
      } else {
        badge.hidden = true;
        row.classList.remove('wb-row-override');
      }
    };
    refreshGoverned();
    key.addEventListener('input', () => { refreshValueOptions(); refreshGoverned(); });
    key.addEventListener('change', commitRows);
    val.addEventListener('change', commitRows);
    row.append(key, val, badge, valList, info, del, card);
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
