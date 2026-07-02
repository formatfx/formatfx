/**
 * editor/playground.ts — the consequence-free style playground.
 *
 * Two modes, one overlay:
 *  - SAMPLE mode (☰ menu, doc-card links): a synthetic flex "shelf" with
 *    three chips — pure concept learning.
 *  - ELEMENT mode (inspector "⚗ Restyle in playground"): the stage renders
 *    the REAL selected element via the real renderer — its parent for
 *    context (siblings dimmed), its children masked with name overlays so
 *    you can watch them move without restyling below this level. A mini
 *    structure tree beside the stage shows where you are (ancestors above,
 *    children below) — click any row to restyle THAT element; your picks
 *    stash per element and resume when you come back. Nothing touches the
 *    formatter until "Apply" (undoable via the state store).
 *
 * The controls read top to bottom as labeled steps: Quick looks (one-click
 * style bundles), Family, Property (with a formatted "what does this do"
 * card whose examples apply themselves), Values, what the element already
 * wears, and your unapplied picks.
 */

import {
  ALLOWED_STYLES, STYLE_PROP_DOCS, STYLE_FAMILY_EXPLAINS, STYLE_VALUE_SUGGESTIONS,
  styleFamilyOf, type StyleFamily,
} from '../core/schema';
import { renderElement } from '../core/renderer';
import { cfrFieldName } from '../core/refs';
import type { SPElement, SPExpr, NodePath } from '../core/types';
import { state, CARD_SEGMENT } from './state';
import { createOverlay, type OverlayHandle } from './overlay';

const FAMILY_ORDER: StyleFamily[] = [
  'box', 'flex-container', 'flex-child', 'paint', 'type', 'place', 'fit', 'svg', 'table', 'misc',
];

/** Candidate values to click through: suggestions ∪ doc examples ∪ a sensible scale. */
function valueOptions(prop: string): string[] {
  const out: string[] = [];
  const add = (v: string) => { if (v && !out.includes(v)) out.push(v); };
  for (const v of STYLE_VALUE_SUGGESTIONS[prop] ?? []) add(v);
  for (const m of (STYLE_PROP_DOCS[prop] ?? '').matchAll(/'([^']*)'/g)) {
    const v = m[1];
    if (v && !v.startsWith('=') && !v.includes('…') && v.length <= 40) add(v);
  }
  // category scales merge in (not just as fallback) — clicking through a
  // scale is the whole point of a playground
  if (/(padding|margin|gap|radius|spacing|indent)/.test(prop) || /^(top|left|right|bottom)$/.test(prop)) {
    ['0', '2px', '4px', '8px', '16px', '32px'].forEach(add);
  } else if (/(width|height|basis)/.test(prop)) {
    ['24px', '64px', '50%', '100%', 'auto'].forEach(add);
  } else if (/color|^fill$|^stroke$/.test(prop)) {
    ['#0078d4', '#107c10', '#d13438', '#ffb900', '#5c2d91', 'transparent'].forEach(add);
  } else if (prop === 'opacity') {
    ['0.25', '0.5', '0.75', '1'].forEach(add);
  } else if (prop === 'z-index') {
    ['1', '10'].forEach(add);
  } else if (/^(font-size|line-height)$/.test(prop)) {
    ['11px', '13px', '16px', '24px'].forEach(add);
  }
  return out.slice(0, 14);
}

/** Props worth listing per family — the per-side longhand noise collapses. */
function familyProps(family: StyleFamily): string[] {
  const noisy = /-(top|right|bottom|left)(-|$)/;
  return [...ALLOWED_STYLES].filter((p) =>
    styleFamilyOf(p) === family && !p.startsWith('--')
    && (!noisy.test(p) || family === 'place'));
}

const nameOf = (el: SPElement): string => el._elmName ?? `<${el.elmType}>`;

/**
 * Quick looks — the style bundles people actually reach for, distilled from
 * the community samples the palette presets came from. One click applies
 * the whole combination as picks (click again to take it off).
 */
const QUICK_LOOKS: Array<{
  label: string; hint: string; props: Record<string, string>;
  /** Extra styles for the preview chip only (e.g. a width so … shows). */
  demo?: Record<string, string>;
}> = [
  {
    label: 'Pill', hint: 'Rounded ends, snug padding, semibold — the classic status look',
    props: {
      'display': 'inline-flex', 'align-items': 'center', 'border-radius': '12px',
      'padding': '2px 10px', 'font-size': '12px', 'font-weight': '600',
    },
  },
  {
    label: 'Soft badge', hint: 'Pastel fill with matching ink — quieter than a pill',
    props: {
      'background-color': '#deecf9', 'color': '#0078d4',
      'border-radius': '4px', 'padding': '2px 8px', 'font-size': '12px',
    },
  },
  {
    label: 'Card', hint: 'White surface, hairline border, gentle shadow, breathing room',
    props: {
      'background-color': '#ffffff', 'border': '1px solid #e1dfdd',
      'border-radius': '6px', 'padding': '12px', 'box-shadow': '0 1.6px 3.6px rgba(0,0,0,.13)',
    },
  },
  {
    label: 'Lifted', hint: 'A deeper shadow that floats the element off the page',
    props: { 'box-shadow': '0 6.4px 14.4px rgba(0,0,0,.13)', 'border-radius': '6px' },
  },
  {
    label: 'Accent edge', hint: 'A colored stripe down the left side — row emphasis',
    props: { 'border-left': '3px solid #0078d4', 'padding-left': '8px' },
  },
  {
    label: 'One line + …', hint: 'Never wraps; ends with an ellipsis when the box runs out',
    props: { 'white-space': 'nowrap', 'overflow': 'hidden', 'text-overflow': 'ellipsis' },
    demo: { 'max-width': '64px', 'display': 'inline-block' },
  },
  {
    label: 'Compact', hint: 'Tighter padding and smaller type — dense grids',
    props: { 'padding': '1px 6px', 'font-size': '11px', 'line-height': '16px' },
  },
  {
    label: 'Quiet caption', hint: 'Smaller, dimmer — secondary information',
    props: { 'color': '#605e5c', 'font-size': '11px' },
  },
  {
    label: 'Strike out', hint: 'Crossed off and faded — done or cancelled items',
    props: { 'text-decoration': 'line-through', 'opacity': '0.6' },
  },
];

/** Unapplied picks, per real document node — survive close/reopen ("stash"). */
const stashes = new WeakMap<SPElement, Record<string, string>>();

let handle: OverlayHandle | null = null;

export function closePlayground(): void {
  handle?.close();
  handle = null;
}

export function openPlayground(initialProp = 'padding'): void {
  mount({ mode: 'sample', prop: initialProp });
}

export function openElementPlayground(path: NodePath): void {
  mount({ mode: 'element', prop: 'padding', path: [...path] });
}

interface Opts { mode: 'sample' | 'element'; prop: string; path?: NodePath }

function mount(opts: Opts): void {
  closePlayground();

  let family: StyleFamily = styleFamilyOf(opts.prop);
  let prop = opts.prop;

  // sample-mode state
  const shelfStyle: Record<string, string> = {};
  const chipStyle: Record<string, string> = {};

  // element-mode state
  let targetPath: NodePath = opts.path ?? [];
  let pending: Record<string, string> =
    opts.mode === 'element' ? { ...(stashes.get(state.nodeAt(targetPath)!) ?? {}) } : {};

  const stashCurrent = () => {
    const node = state.nodeAt(targetPath);
    if (!node) return;
    if (Object.keys(pending).length) stashes.set(node, { ...pending });
    else stashes.delete(node);
  };
  const switchTarget = (path: NodePath) => {
    stashCurrent();
    targetPath = path;
    pending = { ...(stashes.get(state.nodeAt(targetPath)!) ?? {}) };
    render();
  };

  handle = createOverlay('wb-pg-overlay', closePlayground);
  const overlay = handle.overlay;

  const panel = document.createElement('div');
  panel.className = 'wb-pg';
  overlay.appendChild(panel);

  /** A labeled section — the grouping that keeps the controls scannable. */
  const group = (label: string, ...kids: HTMLElement[]): HTMLElement => {
    const g = document.createElement('div');
    g.className = 'wb-pg-group';
    const lab = document.createElement('div');
    lab.className = 'wb-pg-grouplab';
    lab.textContent = label;
    g.appendChild(lab);
    for (const k of kids) g.appendChild(k);
    return g;
  };

  // ── element-mode stage: the real subtree, really rendered ──────────────────
  const elementStage = (): HTMLElement => {
    const stage = document.createElement('div');
    stage.className = 'wb-pg-stage';

    const targetNode = state.nodeAt(targetPath);
    if (!targetNode) {
      stage.textContent = 'The element is gone (undone or removed) — close and reselect.';
      return stage;
    }
    // render the parent for context; the root renders alone
    const renderRootPath = targetPath.slice(0, -1);
    const renderRoot = targetPath.length ? state.nodeAt(renderRootPath) : targetNode;
    const clone = structuredClone(targetPath.length ? renderRoot! : targetNode);
    const rel = targetPath.slice(renderRootPath.length);
    let t = clone;
    for (const i of rel) t = (i === CARD_SEGMENT ? t.customCardProps!.formatter : t.children![i])!;
    t.style = { ...(t.style ?? {}), ...pending };

    let dom: HTMLElement | SVGElement;
    try {
      dom = renderElement(clone, {
        row: state.rows[0] ?? {},
        rowIndex: 0,
        currentFieldName: state.currentFieldName,
        me: state.me,
        iterators: {},
        iteratorIndex: {},
        displayNames: Object.fromEntries(state.fields.map((f) => [f.name, f.displayName ?? f.name])),
        now: new Date(),
      }, {
        issues: [],
        tagPaths: true,
        resolveColumnRef: (ref: string) => {
          const n = cfrFieldName(ref);
          return state.columnRefs[n] ?? null;
        },
        onAction: () => { /* inert in the playground */ },
      });
    } catch (e) {
      stage.textContent = `⚠ ${(e as Error).message}`;
      return stage;
    }

    const relAttr = rel.join('.');
    const find = (p: string) => [...dom.querySelectorAll<HTMLElement>(`[data-sp-path="${p}"]`),
      ...(dom.getAttribute('data-sp-path') === p ? [dom] : [])];
    // spotlight the target…
    for (const el of find(relAttr)) el.classList.add('wb-pgx-target');
    // …mask its children with name overlays (click to descend & restyle THAT)…
    (targetNode.children ?? []).forEach((child, i) => {
      const childRel = rel.length ? `${relAttr}.${i}` : String(i);
      for (const el of find(childRel)) {
        el.classList.add('wb-pgx-child');
        // a CFR slot's content comes from another formatter — say so
        el.setAttribute('data-pgx-name', child.columnFormatterReference
          ? `${nameOf(child)} ⤷ ${child.columnFormatterReference}`
          : nameOf(child));
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          switchTarget([...targetPath, i]);
        });
      }
    });
    // …and dim the out-of-scope siblings
    if (rel.length) {
      (renderRoot!.children ?? []).forEach((_s, i) => {
        if (i === rel[0]) return;
        for (const el of find(String(i))) el.classList.add('wb-pgx-sibling');
      });
    }

    const frame = document.createElement('div');
    frame.className = 'wb-pgx-frame';
    frame.appendChild(dom);
    stage.appendChild(frame);

    const lab = document.createElement('div');
    lab.className = 'wb-pg-stagelab';
    lab.textContent = (targetNode.children?.length
      ? 'children are masked with their names — click one to restyle it instead · '
      : '')
      + (targetNode.columnFormatterReference
        ? `This element's content is rendered by the ${targetNode.columnFormatterReference} column formatter — you're in the view formatter now; click ⤷ in the Structure pane to switch to that column's formatter · `
        : '')
      + 'rendered with row 1 of your data';
    stage.appendChild(lab);
    return stage;
  };

  // ── sample-mode stage: the synthetic shelf ──────────────────────────────────
  const sampleStage = (): HTMLElement => {
    const stage = document.createElement('div');
    stage.className = 'wb-pg-stage';
    const shelf = document.createElement('div');
    shelf.className = 'wb-pg-shelf';
    Object.assign(shelf.style, shelfStyle);
    const mkChip = (text: string, target = false) => {
      const c = document.createElement('div');
      c.className = 'wb-pg-chip' + (target ? ' wb-pg-target' : '');
      c.textContent = text;
      return c;
    };
    const longText = family === 'fit' || family === 'type';
    const target = mkChip(longText ? 'The quick brown fox jumps over the lazy ID-0042-AB' : 'Style me', true);
    Object.assign(target.style, chipStyle);
    shelf.append(mkChip('sibling'), target, mkChip('sibling'));
    stage.appendChild(shelf);
    const stageLab = document.createElement('div');
    stageLab.className = 'wb-pg-stagelab';
    stageLab.textContent = family === 'flex-container'
      ? 'styling the SHELF (the parent container)'
      : 'styling the middle chip';
    stage.appendChild(stageLab);
    return stage;
  };

  // ── element-mode structure: a real tree, not a road ────────────────────────
  // Ancestors above, the target spotlighted, children below — click any row
  // to restyle that element instead (picks stash per element).
  const structureTree = (targetNode: SPElement): HTMLElement => {
    const tree = document.createElement('div');
    tree.className = 'wb-pg-tree';
    const lab = document.createElement('div');
    lab.className = 'wb-pg-grouplab';
    lab.textContent = 'structure';
    tree.appendChild(lab);

    const row = (el: SPElement, path: NodePath | null, depth: number, kind: 'ancestor' | 'target' | 'child'): HTMLElement => {
      const r = document.createElement('button');
      r.className = `wb-pg-tree-row wb-pg-tree-${kind}`;
      r.style.paddingLeft = `${6 + depth * 12}px`;
      const caret = document.createElement('span');
      caret.className = 'wb-pg-tree-caret';
      caret.textContent = kind === 'target' ? '●' : kind === 'ancestor' ? '▾' : '▸';
      r.appendChild(caret);
      const nm = document.createElement('span');
      nm.className = 'wb-pg-tree-name';
      nm.textContent = nameOf(el) + (el.columnFormatterReference ? ` ⤷ ${el.columnFormatterReference}` : '');
      r.appendChild(nm);
      if (stashes.has(el) && kind !== 'target') {
        const dot = document.createElement('span');
        dot.className = 'wb-pg-tree-stash';
        dot.textContent = '◌';
        dot.title = 'Has unapplied picks stashed';
        r.appendChild(dot);
      }
      if (kind === 'target') {
        r.disabled = true;
        r.title = 'You are styling this element';
      } else {
        r.title = `Restyle ${nameOf(el)} instead — your picks here are stashed`;
        r.addEventListener('click', () => switchTarget(path!));
      }
      return r;
    };

    // root … parent chain
    for (let d = 0; d < targetPath.length; d++) {
      const p = targetPath.slice(0, d);
      const n = state.nodeAt(p);
      if (n) tree.appendChild(row(n, p, d, 'ancestor'));
    }

    // the target shown AMONG ITS SIBLINGS (the parent's whole child list), with
    // its own children nested under it — so grouped elements (title ⇄ icon) stay
    // reachable from each other without climbing back up to the group first. The
    // formatter root and a card root (no sibling list) just show alone.
    const targetKids = () => (targetNode.children ?? []).forEach((child, ci) => {
      tree.appendChild(row(child, [...targetPath, ci], targetPath.length + 1, 'child'));
    });
    const parentInfo = state.parentOf(targetPath);
    if (parentInfo) {
      const parentPath = targetPath.slice(0, -1);
      parentInfo.parent.children!.forEach((sib, i) => {
        if (i === parentInfo.index) {
          tree.appendChild(row(targetNode, null, targetPath.length, 'target'));
          targetKids();
        } else {
          tree.appendChild(row(sib, [...parentPath, i], targetPath.length, 'child'));
        }
      });
    } else {
      tree.appendChild(row(targetNode, null, targetPath.length, 'target'));
      targetKids();
    }

    // CFR slot: its content comes from a registered column formatter —
    // offer to open THAT formatter in the playground (switches the
    // workspace, exactly like clicking the column in the Structure tree)
    const cfr = targetNode.columnFormatterReference;
    const cfrName = cfr ? cfrFieldName(cfr) : undefined;
    if (cfrName && state.columnRefs[cfrName]) {
      const enter = document.createElement('button');
      enter.className = 'wb-pg-tree-row wb-pg-tree-child wb-pg-navcfr';
      enter.style.paddingLeft = `${6 + (targetPath.length + 1) * 12}px`;
      enter.textContent = `⤷ switch to [$${cfrName}] column formatter`;
      enter.title = `You're editing the view formatter. This slot's content comes from the [$${cfrName}] column formatter — click to switch to that column's formatter in the playground.`;
      enter.addEventListener('click', () => {
        if (!confirm(`This slot's content comes from the [$${cfrName}] column formatter.\n\nYou're currently editing the view formatter. Switch the playground to the [$${cfrName}] column formatter instead?\n\n(Use the Structure pane or the Editing switcher in the toolbar to come back.)`)) return;
        stashCurrent();
        state.openColumnRef(cfrName);
        openElementPlayground([]);
      });
      tree.appendChild(enter);
    }
    return tree;
  };

  const render = () => {
    panel.innerHTML = '';
    const targetNode = opts.mode === 'element' ? state.nodeAt(targetPath) : null;
    const styleMap = opts.mode === 'element' ? pending
      : family === 'flex-container' ? shelfStyle : chipStyle;

    // ── header ──
    const head = document.createElement('div');
    head.className = 'wb-pg-head';
    const headTitle = document.createElement('span');
    headTitle.className = 'wb-pg-title';
    headTitle.textContent = '⚗ Style playground';
    const headSub = document.createElement('span');
    headSub.className = 'wb-pg-sub';
    if (opts.mode === 'element' && targetNode) {
      // nameOf() is _elmName — it arrives in pasted/imported JSON, so it must
      // never pass through innerHTML (XSS; and the unnamed "<div>" placeholder
      // would parse as a real tag and vanish)
      headSub.append('restyling ');
      const strong = document.createElement('b');
      strong.textContent = nameOf(targetNode);
      headSub.append(strong, ' — nothing is saved until you apply');
    } else {
      headSub.textContent = 'consequence-free — nothing touches your formatter unless you apply it';
    }
    head.append(headTitle, headSub);
    const close = document.createElement('button');
    close.className = 'wb-pg-close';
    close.textContent = '✕';
    close.title = 'Close (Esc) — unapplied picks on this element are kept for next time';
    close.addEventListener('click', () => { stashCurrent(); closePlayground(); });
    head.appendChild(close);
    panel.appendChild(head);

    // ── context: the structure tree beside the live stage ──
    if (opts.mode === 'element' && targetNode) {
      const ctx = document.createElement('div');
      ctx.className = 'wb-pg-context';
      ctx.appendChild(structureTree(targetNode));
      ctx.appendChild(elementStage());
      panel.appendChild(ctx);
    } else {
      panel.appendChild(sampleStage());
    }

    // ── quick looks: whole outfits in one click ──
    // always dress the element (or the sample chip) — never the shelf
    const macroMap = opts.mode === 'element' ? pending : chipStyle;
    const lookRow = document.createElement('div');
    lookRow.className = 'wb-pg-row';
    for (const look of QUICK_LOOKS) {
      const applied = Object.entries(look.props).every(([k, v]) => macroMap[k] === v);
      const b = document.createElement('button');
      b.className = 'wb-pg-macro' + (applied ? ' active' : '');
      b.title = `${look.hint}\n\n${Object.entries(look.props).map(([k, v]) => `${k}: ${v}`).join(' · ')}\n\nClick to ${applied ? 'take the whole look off' : 'add every property as a pick'}`;
      const demo = document.createElement('span');
      demo.className = 'wb-pg-macro-demo';
      demo.textContent = 'Aa';
      Object.assign(demo.style, look.props, look.demo ?? {});
      const t = document.createElement('span');
      t.textContent = look.label;
      b.append(demo, t);
      b.addEventListener('click', () => {
        if (applied) for (const k of Object.keys(look.props)) delete macroMap[k];
        else Object.assign(macroMap, look.props);
        render();
      });
      lookRow.appendChild(b);
    }
    panel.appendChild(group('Quick looks — full combinations, one click', lookRow));

    // ── family chips + the story, together ──
    const famRow = document.createElement('div');
    famRow.className = 'wb-pg-row';
    for (const f of FAMILY_ORDER) {
      const b = document.createElement('button');
      b.className = 'wb-pg-fam' + (f === family ? ' active' : '');
      b.textContent = STYLE_FAMILY_EXPLAINS[f].name;
      b.addEventListener('click', () => {
        family = f;
        prop = familyProps(f)[0] ?? prop;
        render();
      });
      famRow.appendChild(b);
    }
    // family story — a formatted callout, not a floating paragraph
    const story = document.createElement('div');
    story.className = 'wb-pg-story';
    const storyTag = document.createElement('span');
    storyTag.className = 'wb-pg-story-tag';
    storyTag.textContent = STYLE_FAMILY_EXPLAINS[family].name;
    const storyText = document.createElement('span');
    storyText.textContent = STYLE_FAMILY_EXPLAINS[family].plain;
    story.append(storyTag, storyText);
    panel.appendChild(group('What part of the look', famRow, story));

    // ── property chips + the formatted "what does it do" card ──
    const propRow = document.createElement('div');
    propRow.className = 'wb-pg-row';
    for (const p of familyProps(family)) {
      const b = document.createElement('button');
      b.className = 'wb-pg-prop' + (p === prop ? ' active' : '');
      b.textContent = p;
      b.title = STYLE_PROP_DOCS[p] ?? p;
      b.addEventListener('click', () => { prop = p; render(); });
      propRow.appendChild(b);
    }
    panel.appendChild(group('Property', propRow, propDoc()));

    // ── value chips: click to see it happen ──
    const valRow = document.createElement('div');
    valRow.className = 'wb-pg-row wb-pg-vals';
    const current = styleMap[prop];
    const committed = opts.mode === 'element' ? targetNode?.style?.[prop] : undefined;
    for (const v of valueOptions(prop)) {
      const b = document.createElement('button');
      b.className = 'wb-pg-val' + (current === v ? ' active' : '');
      if (typeof committed === 'string' && committed === v && current === undefined) {
        b.classList.add('wb-pg-val-current');
        b.title = 'The element already wears this value';
      }
      b.textContent = v;
      b.addEventListener('click', () => {
        if (styleMap[prop] === v) delete styleMap[prop]; // click again to remove
        else styleMap[prop] = v;
        if (opts.mode === 'sample' && family === 'flex-container' && !('display' in shelfStyle)) {
          shelfStyle['display'] = 'flex';
        }
        render();
      });
      valRow.appendChild(b);
    }
    if (!valRow.childElementCount) {
      const none = document.createElement('span');
      none.className = 'wb-pg-stagelab';
      none.textContent = 'no preset values for this one — use the Style section to type a value';
      valRow.appendChild(none);
    }
    panel.appendChild(group('Click a value to try it', valRow));

    // ── what the element already wears (element mode) ──
    if (opts.mode === 'element' && targetNode) {
      panel.appendChild(group(`Already on ${nameOf(targetNode)}`, currentStyles(targetNode)));
    }

    // ── what you've dialed in ──
    const picked = opts.mode === 'element'
      ? Object.entries(pending).map(([k, v]) => ['pick', k, v])
      : [...Object.entries(shelfStyle).map(([k, v]) => ['shelf', k, v]),
        ...Object.entries(chipStyle).map(([k, v]) => ['chip', k, v])];
    const out = document.createElement('div');
    out.className = 'wb-pg-out';
    if (picked.length) {
      for (const [where, k, v] of picked) {
        const rowEl = document.createElement('div');
        rowEl.className = 'wb-pg-out-row';
        const whereSpan = document.createElement('span');
        whereSpan.className = 'wb-pg-out-where';
        whereSpan.textContent = where;
        const codeEl = document.createElement('code');
        codeEl.textContent = `${k}: ${v}`;
        rowEl.appendChild(whereSpan);
        rowEl.appendChild(codeEl);
        const del = document.createElement('button');
        del.textContent = '✕';
        del.title = 'Remove';
        del.addEventListener('click', () => {
          if (opts.mode === 'element') delete pending[k];
          else delete (where === 'shelf' ? shelfStyle : chipStyle)[k];
          render();
        });
        rowEl.appendChild(del);
        out.appendChild(rowEl);
      }
    } else {
      out.innerHTML = '<div class="wb-pg-stagelab">click values above — they stack up here</div>';
    }
    panel.appendChild(group('Your picks (unapplied)', out));

    // ── footer: reset / stash / apply ──
    const foot = document.createElement('div');
    foot.className = 'wb-pg-foot';
    const reset = document.createElement('button');
    reset.textContent = 'Reset';
    reset.title = opts.mode === 'element' ? 'Discard the unapplied picks for this element (stash included)' : 'Start over';
    reset.addEventListener('click', () => {
      if (opts.mode === 'element') {
        pending = {};
        const node = state.nodeAt(targetPath);
        if (node) stashes.delete(node);
      } else {
        for (const k of Object.keys(shelfStyle)) delete shelfStyle[k];
        for (const k of Object.keys(chipStyle)) delete chipStyle[k];
      }
      render();
    });
    foot.appendChild(reset);

    if (opts.mode === 'element') {
      const stashBtn = document.createElement('button');
      stashBtn.textContent = 'Stash & close';
      stashBtn.title = 'Keep these picks (unapplied) — reopening the playground on this element resumes them';
      stashBtn.disabled = !picked.length;
      stashBtn.addEventListener('click', () => { stashCurrent(); closePlayground(); });
      foot.appendChild(stashBtn);

      const apply = document.createElement('button');
      apply.className = 'wb-pg-apply';
      apply.textContent = `Apply to ${targetNode ? nameOf(targetNode) : 'element'}`;
      apply.title = 'Merge the picks into this element\'s style (undoable with Ctrl+Z)';
      apply.disabled = !picked.length || !targetNode;
      apply.addEventListener('click', () => {
        const node = state.nodeAt(targetPath);
        if (!node) return;
        const picks = { ...pending };
        pending = {};
        stashes.delete(node);
        state.mutateDocument(() => { node.style = { ...(node.style ?? {}), ...picks }; });
        render();
        const fb = panel.querySelector('.wb-pg-apply') as HTMLButtonElement | null;
        if (fb) fb.textContent = 'Applied ✓ (Ctrl+Z undoes)';
      });
      foot.appendChild(apply);
    } else {
      const apply = document.createElement('button');
      apply.className = 'wb-pg-apply';
      const hasSelection = !!state.selection;
      apply.textContent = 'Apply to selected element';
      apply.title = hasSelection
        ? 'Merge everything above into the selected element\'s style (undoable with Ctrl+Z)'
        : 'Select an element on the canvas or tree first';
      apply.disabled = !hasSelection || !picked.length;
      apply.addEventListener('click', () => {
        const node = state.selectedNode;
        if (!node) return;
        state.mutateDocument(() => {
          node.style = { ...(node.style ?? {}), ...shelfStyle, ...chipStyle };
        });
        apply.textContent = 'Applied ✓ (Ctrl+Z undoes)';
        window.setTimeout(() => { if (handle) apply.textContent = 'Apply to selected element'; }, 1600);
      });
      foot.appendChild(apply);
    }
    panel.appendChild(foot);

    /** The formatted description of the selected property — the doc one-liner
     *  with «syntax shapes» rendered as shapes and 'examples' as chips that
     *  apply themselves to whatever you're styling. */
    function propDoc(): HTMLElement {
      const box = document.createElement('div');
      box.className = 'wb-pg-doc';
      const headRow = document.createElement('div');
      headRow.className = 'wb-pg-doc-head';
      const name = document.createElement('code');
      name.className = 'wb-pg-doc-prop';
      name.textContent = prop;
      headRow.appendChild(name);
      box.appendChild(headRow);

      const doc = STYLE_PROP_DOCS[prop];
      const body = document.createElement('div');
      body.className = 'wb-pg-doc-body';
      if (!doc) {
        body.textContent = 'No notes for this one — click the values below and watch the stage.';
        box.appendChild(body);
        return box;
      }
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
            return;
          }
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'wb-doccard-ex';
          chip.textContent = part;
          chip.title = `Click to try ${prop}: ${part}`;
          chip.addEventListener('click', () => {
            styleMap[prop] = part;
            if (opts.mode === 'sample' && family === 'flex-container' && !('display' in shelfStyle)) {
              shelfStyle['display'] = 'flex';
            }
            render();
          });
          body.appendChild(chip);
        });
      }
      box.appendChild(body);
      return box;
    }

    /** What the element is already wearing — click a property to jump to it. */
    function currentStyles(node: SPElement): HTMLElement {
      const wrap = document.createElement('div');
      wrap.className = 'wb-pg-cur';
      const entries = Object.entries(node.style ?? {})
        .filter((e): e is [string, SPExpr] => e[1] !== undefined);
      if (!entries.length) {
        wrap.innerHTML = '<div class="wb-pg-stagelab">no styles on this element yet — a blank canvas</div>';
        return wrap;
      }
      for (const [k, v] of entries) {
        const row = document.createElement('div');
        row.className = 'wb-pg-cur-row';
        const key = document.createElement('button');
        key.className = 'wb-pg-cur-key';
        key.textContent = k;
        if (ALLOWED_STYLES.has(k)) {
          key.title = `Jump to ${k} — its family, notes and values`;
          key.addEventListener('click', () => {
            family = styleFamilyOf(k);
            prop = k;
            render();
          });
        } else {
          key.disabled = true;
          key.title = 'Not on the SP allow-list — SharePoint silently drops it (see the linter)';
        }
        const val = document.createElement('span');
        val.className = 'wb-pg-cur-val';
        const isFormula = typeof v !== 'string' || v.startsWith('=');
        val.textContent = isFormula ? '𝑓x' : (v as string);
        if (isFormula) val.title = typeof v === 'string' ? v : JSON.stringify(v);
        row.append(key, val);
        if (pending[k] !== undefined) {
          val.classList.add('wb-pg-cur-over');
          const next = document.createElement('span');
          next.className = 'wb-pg-cur-next';
          next.textContent = `→ ${pending[k]}`;
          next.title = 'Your unapplied pick replaces this when you Apply';
          row.appendChild(next);
        }
        wrap.appendChild(row);
      }
      return wrap;
    }
  };

  render();
  document.body.appendChild(overlay);
}
