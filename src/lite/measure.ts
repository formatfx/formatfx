// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Sam Yost

/**
 * lite/measure.ts — the browser half of flatten: render the pasted card on
 * every sample item (off screen, through the same SharePoint-emulating
 * renderer the preview uses) and report where each element landed.
 *
 * Across items the box is merged: the left edge and top come from the first
 * item that shows the element, the width grows to cover the widest item,
 * the height to the tallest. So a pill sized on "Done" still fits
 * "In Progress".
 */

import type { FormatterDocument, MockField, MockRow } from '../core/types';
import { renderElement } from '../core/renderer';
import { cardSize, type Rect } from './model';
import { ctxFor } from './sample';
import { INHERITED, type Measure } from './flatten';

function paints(cs: CSSStyleDeclaration): boolean {
  const clear = cs.backgroundColor === 'transparent' || /^rgba\(.*,\s*0\)$/.test(cs.backgroundColor);
  const sides = ['Top', 'Right', 'Bottom', 'Left'] as const;
  const border = sides.some((s) =>
    parseFloat(cs.getPropertyValue(`border-${s.toLowerCase()}-width`)) > 0
    && cs.getPropertyValue(`border-${s.toLowerCase()}-style`) !== 'none');
  return !clear || cs.backgroundImage !== 'none' || border || cs.boxShadow !== 'none';
}

export function domMeasure(doc: FormatterDocument, fields: MockField[], rows: MockRow[]): { measure: Measure; dispose: () => void } {
  const { w, h } = cardSize(doc);
  const host = document.createElement('div');
  host.className = 'lite-measure';
  host.setAttribute('aria-hidden', 'true');
  document.body.appendChild(host);

  let roots: HTMLElement[];
  try {
    roots = rows.map((_, i) => {
      const tile = document.createElement('div');
      tile.style.cssText = `position:relative;width:${w}px;height:${h}px;`;
      const el = renderElement(doc.root, ctxFor(fields, rows, i), { tagPaths: true, interactive: false }) as HTMLElement;
      tile.appendChild(el);
      host.appendChild(tile);
      return el;
    });
  } catch (e) {
    host.remove(); // never leave the off-screen host behind
    throw e;
  }

  const measure: Measure = (path) => {
    const key = path.join('.');
    let rect: Rect | null = null;
    let painted = false;
    const own = new Set<string>();
    for (const root of roots) {
      const node = key === '' ? root : root.querySelector<HTMLElement>(`[data-sp-path="${key}"]`);
      if (!node) continue;
      const b = node.getBoundingClientRect();
      if (b.width < 0.5 && b.height < 0.5) continue;
      const rb = root.getBoundingClientRect();
      const x = b.left - rb.left - root.clientLeft;
      const y = b.top - rb.top - root.clientTop;
      if (!rect) {
        rect = { x, y, w: b.width, h: b.height };
      } else {
        const right = Math.max(rect.x + rect.w, x + b.width);
        rect = { x: Math.min(rect.x, x), y: rect.y, w: 0, h: Math.max(rect.h, b.height) };
        rect.w = right - rect.x;
      }
      const cs = getComputedStyle(node);
      painted ||= paints(cs);
      // a text style that differs from the parent's is the element's own
      // (its class or inline style set it), so a dissolved ancestor's value
      // must not be copied over it
      const parent = node.parentElement;
      if (parent) {
        const ps = getComputedStyle(parent);
        for (const p of INHERITED) if (cs.getPropertyValue(p) !== ps.getPropertyValue(p)) own.add(p);
      }
    }
    if (!rect) return null;
    return {
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.ceil(rect.w), h: Math.ceil(rect.h) },
      paints: painted,
      own: [...own],
    };
  };

  return { measure, dispose: () => host.remove() };
}
