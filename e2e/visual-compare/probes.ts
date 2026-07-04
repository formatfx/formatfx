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
import type { Locator } from '@playwright/test';

export interface CellProbe {
  text: string;
  /** Effective background: the deepest non-transparent background-color inside the cell, normalized rgb(). */
  background: string;
}

export async function probeCell(cell: Locator): Promise<CellProbe> {
  return cell.evaluate((el) => {
    const transparent = (c: string): boolean => c === 'rgba(0, 0, 0, 0)' || c === 'transparent';
    // the most specific painted surface (the pill, not the cell): the DEEPEST
    // non-transparent background; first in document order wins a depth tie
    let background = 'none';
    let bestDepth = -1;
    const walk = (node: Element, depth: number): void => {
      const bg = getComputedStyle(node).backgroundColor;
      if (!transparent(bg) && depth > bestDepth) { background = bg; bestDepth = depth; }
      for (const child of node.children) walk(child, depth + 1);
    };
    walk(el, 0);
    return { text: (el.textContent ?? '').trim(), background };
  });
}

export async function probeCells(cells: Locator[]): Promise<CellProbe[]> {
  const probes: CellProbe[] = [];
  for (const cell of cells) probes.push(await probeCell(cell));
  return probes;
}
