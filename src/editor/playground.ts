/**
 * editor/playground.ts — the consequence-free style playground.
 *
 * Two modes, one overlay:
 *  - SAMPLE mode (☰ menu, doc-card links): a synthetic flex "shelf" with
 *    three chips — pure concept learning.
 *  - ELEMENT mode (inspector "⚗ Restyle in playground"): the stage renders
 *    the REAL selected element via the real renderer — its parent for
 *    context (siblings dimmed), its children masked with name overlays so
 *    you can watch them move without restyling below this level. Click a
 *    child (overlay or nav chip) to descend; your picks stash per element
 *    and resume when you come back. Nothing touches the formatter until
 *    "Apply" (undoable via the state store).
 */

import {
  ALLOWED_STYLES, STYLE_PROP_DOCS, STYLE_FAMILY_EXPLAINS, STYLE_VALUE_SUGGESTIONS,
  styleFamilyOf, type StyleFamily,
} from '../core/schema';
import { renderElement } from '../core/renderer';
import type { SPElement, NodePath } from '../core/types';
import { state, CARD_SEGMENT } from './state';

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

/** Unapplied picks, per real document node — survive close/reopen ("stash"). */
const stashes = new WeakMap<SPElement, Record<string, string>>();

let overlay: HTMLElement | null = null;
let escHandler: ((e: KeyboardEvent) => void) | null = null;

export function closePlayground(): void {
  overlay?.remove();
  overlay = null;
  if (escHandler) { document.removeEventListener('keydown', escHandler); escHandler = null; }
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

  overlay = document.createElement('div');
  overlay.className = 'wb-pg-overlay';
  overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) closePlayground(); });
  escHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') closePlayground(); };
  document.addEventListener('keydown', escHandler);

  const panel = document.createElement('div');
  panel.className = 'wb-pg';
  overlay.appendChild(panel);

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
          const n = ref.replace(/^\[\$?/, '').replace(/\]$/, '').replace(/^\$/, '');
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
        el.setAttribute('data-pgx-name', nameOf(child));
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
      : '') + 'rendered with row 1 of your data';
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

  const render = () => {
    panel.innerHTML = '';
    const targetNode = opts.mode === 'element' ? state.nodeAt(targetPath) : null;

    // ── header ──
    const head = document.createElement('div');
    head.className = 'wb-pg-head';
    head.innerHTML = `<span class="wb-pg-title">⚗ Style playground</span>
      <span class="wb-pg-sub">${opts.mode === 'element' && targetNode
        ? `restyling <b>${nameOf(targetNode)}</b> — nothing is saved until you apply`
        : 'consequence-free — nothing touches your formatter unless you apply it'}</span>`;
    const close = document.createElement('button');
    close.className = 'wb-pg-close';
    close.textContent = '✕';
    close.title = 'Close (Esc) — unapplied picks on this element are kept for next time';
    close.addEventListener('click', () => { stashCurrent(); closePlayground(); });
    head.appendChild(close);
    panel.appendChild(head);

    // ── element-mode navigation: up to the parent, down into children ──
    if (opts.mode === 'element' && targetNode) {
      const nav = document.createElement('div');
      nav.className = 'wb-pg-row wb-pg-nav';
      if (targetPath.length) {
        const parent = state.nodeAt(targetPath.slice(0, -1));
        if (parent) {
          const up = document.createElement('button');
          up.className = 'wb-pg-navbtn';
          up.textContent = `▲ ${nameOf(parent)}`;
          up.title = 'Restyle the parent instead (your picks here are stashed)';
          up.addEventListener('click', () => switchTarget(targetPath.slice(0, -1)));
          nav.appendChild(up);
        }
      }
      const here = document.createElement('span');
      here.className = 'wb-pg-navhere';
      here.textContent = nameOf(targetNode);
      nav.appendChild(here);
      (targetNode.children ?? []).forEach((child, i) => {
        const down = document.createElement('button');
        down.className = 'wb-pg-navbtn';
        down.textContent = `▼ ${nameOf(child)}`;
        down.title = 'Restyle this child instead (your picks here are stashed)';
        down.addEventListener('click', () => switchTarget([...targetPath, i]));
        if (stashes.has(child)) down.classList.add('wb-pg-navstash');
        nav.appendChild(down);
      });
      panel.appendChild(nav);
    }

    panel.appendChild(opts.mode === 'element' ? elementStage() : sampleStage());

    // ── family chips ──
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
    panel.appendChild(famRow);

    // family story (the short version)
    const story = document.createElement('div');
    story.className = 'wb-pg-story';
    story.textContent = STYLE_FAMILY_EXPLAINS[family].plain;
    panel.appendChild(story);

    // ── property chips for the family ──
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
    panel.appendChild(propRow);

    // ── value chips: click to see it happen ──
    const styleMap = opts.mode === 'element' ? pending
      : family === 'flex-container' ? shelfStyle : chipStyle;
    const valRow = document.createElement('div');
    valRow.className = 'wb-pg-row wb-pg-vals';
    const current = styleMap[prop];
    for (const v of valueOptions(prop)) {
      const b = document.createElement('button');
      b.className = 'wb-pg-val' + (current === v ? ' active' : '');
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
    panel.appendChild(valRow);

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
        rowEl.innerHTML = `<span class="wb-pg-out-where">${where}</span><code>${k}: ${v}</code>`;
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
    panel.appendChild(out);

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
        window.setTimeout(() => { if (overlay) apply.textContent = 'Apply to selected element'; }, 1600);
      });
      foot.appendChild(apply);
    }
    panel.appendChild(foot);
  };

  render();
  document.body.appendChild(overlay);
}
