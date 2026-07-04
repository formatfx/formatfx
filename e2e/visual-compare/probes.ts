/**
 * Semantic probes — the comparison currency of this harness.
 *
 * Pixel-diffing a sandbox screenshot against a SharePoint screenshot can
 * never pass strictly: different chrome, fonts, DPI, cell padding. So the
 * primary signal is semantic: for each rendered row we capture what the
 * formatter actually SAID (text) and PAINTED (the effective background
 * color), and compare those. Screenshots still get attached to the report,
 * but for human eyes, not for the verdict.
 */
import type { ElementHandle, Locator } from '@playwright/test';

export interface CellProbe {
  /** Visible text of the painted element (the formatter's own output), not
   *  the whole cell — cells carry surface chrome (the sandbox's style
   *  name-tags, SharePoint's a11y spans) that the other side never has. */
  text: string;
  /** Effective background: the deepest non-transparent background-color inside the cell, normalized rgb(). */
  background: string;
}

export async function probeCell(cell: Locator): Promise<CellProbe> {
  return cell.evaluate((el) => {
    const transparent = (c: string): boolean => c === 'rgba(0, 0, 0, 0)' || c === 'transparent';
    // the most specific painted surface (the pill, not the cell): the DEEPEST
    // non-transparent background; first in document order wins a depth tie
    let painted: Element | null = null;
    let bestDepth = -1;
    const walk = (node: Element, depth: number): void => {
      if (!transparent(getComputedStyle(node).backgroundColor) && depth > bestDepth) { painted = node; bestDepth = depth; }
      for (const child of node.children) walk(child, depth + 1);
    };
    walk(el, 0);
    // innerText (not textContent) so hidden overlays don't leak into the probe;
    // a text-less painted element (a beak, a bare bar) falls back to the root's
    // text so cards and decorated cells still probe their words
    const subject = (painted ?? el) as HTMLElement;
    const text = subject.innerText.trim() || (el as HTMLElement).innerText.trim();
    return { text, background: painted ? getComputedStyle(painted).backgroundColor : 'none' };
  });
}

export async function probeCells(cells: Locator[]): Promise<CellProbe[]> {
  const probes: CellProbe[] = [];
  for (const cell of cells) probes.push(await probeCell(cell));
  return probes;
}

/**
 * The element to CROP for pixel comparison: the deepest painted node (the
 * pill), or the cell itself when nothing inside paints. Cropping the painted
 * element instead of the cell strips each surface's own padding and row
 * chrome out of the diff — it's what makes cross-surface pixel comparison
 * meaningful at all.
 */
export async function paintedElement(cell: Locator): Promise<ElementHandle<HTMLElement>> {
  const handle = await cell.evaluateHandle((el) => {
    const transparent = (c: string): boolean => c === 'rgba(0, 0, 0, 0)' || c === 'transparent';
    let best: Element = el;
    let bestDepth = -1;
    const walk = (node: Element, depth: number): void => {
      if (!transparent(getComputedStyle(node).backgroundColor) && depth > bestDepth) { best = node; bestDepth = depth; }
      for (const child of node.children) walk(child, depth + 1);
    };
    walk(el, 0);
    return best as HTMLElement;
  });
  return handle.asElement() as ElementHandle<HTMLElement>;
}
