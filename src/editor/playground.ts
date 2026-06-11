/**
 * editor/playground.ts — the consequence-free style playground.
 *
 * An overlay with sample elements (a flex "shelf" with three chips) where
 * every allow-listed style property is a row of clickable value chips applied
 * live — nothing touches the user's formatter unless they press "Apply to
 * selected element" (which goes through the undoable state store).
 */

import {
  ALLOWED_STYLES, STYLE_PROP_DOCS, STYLE_FAMILY_EXPLAINS, STYLE_VALUE_SUGGESTIONS,
  styleFamilyOf, type StyleFamily,
} from '../core/schema';
import { state } from './state';

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

let overlay: HTMLElement | null = null;
let escHandler: ((e: KeyboardEvent) => void) | null = null;

export function closePlayground(): void {
  overlay?.remove();
  overlay = null;
  if (escHandler) { document.removeEventListener('keydown', escHandler); escHandler = null; }
}

export function openPlayground(initialProp = 'padding'): void {
  closePlayground();

  // what the user has dialed in, per stage target
  const shelfStyle: Record<string, string> = {};
  const chipStyle: Record<string, string> = {};
  let family: StyleFamily = styleFamilyOf(initialProp);
  let prop = initialProp;

  overlay = document.createElement('div');
  overlay.className = 'wb-pg-overlay';
  overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) closePlayground(); });
  escHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') closePlayground(); };
  document.addEventListener('keydown', escHandler);

  const panel = document.createElement('div');
  panel.className = 'wb-pg';
  overlay.appendChild(panel);

  const render = () => {
    panel.innerHTML = '';

    // ── header ──
    const head = document.createElement('div');
    head.className = 'wb-pg-head';
    head.innerHTML = `<span class="wb-pg-title">⚗ Style playground</span>
      <span class="wb-pg-sub">consequence-free — nothing touches your formatter unless you apply it</span>`;
    const close = document.createElement('button');
    close.className = 'wb-pg-close';
    close.textContent = '✕';
    close.title = 'Close (Esc)';
    close.addEventListener('click', closePlayground);
    head.appendChild(close);
    panel.appendChild(head);

    // ── the stage: a flex shelf with three chips; the middle one is "yours" ──
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
    panel.appendChild(stage);

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
    const styleMap = family === 'flex-container' ? shelfStyle : chipStyle;
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
        if (family === 'flex-container' && !('display' in shelfStyle)) shelfStyle['display'] = 'flex';
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
    const picked = [...Object.entries(shelfStyle).map(([k, v]) => ['shelf', k, v]),
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
          delete (where === 'shelf' ? shelfStyle : chipStyle)[k];
          render();
        });
        rowEl.appendChild(del);
        out.appendChild(rowEl);
      }
    } else {
      out.innerHTML = '<div class="wb-pg-stagelab">click values above — they stack up here</div>';
    }
    panel.appendChild(out);

    // ── footer: reset / apply ──
    const foot = document.createElement('div');
    foot.className = 'wb-pg-foot';
    const reset = document.createElement('button');
    reset.textContent = 'Reset';
    reset.addEventListener('click', () => {
      for (const k of Object.keys(shelfStyle)) delete shelfStyle[k];
      for (const k of Object.keys(chipStyle)) delete chipStyle[k];
      render();
    });
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
    foot.append(reset, apply);
    panel.appendChild(foot);
  };

  render();
  document.body.appendChild(overlay);
}
