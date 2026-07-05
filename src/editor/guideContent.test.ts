/**
 * guideContent — the field guide's progressive-technicality contract.
 *
 * The guide is a gradient: reading order descends basic → complex, and the
 * nav tree nests — a page's parent chain is its technicality. These tests pin
 * the tree invariants that keep GUIDE_DEPTH's parent-chain walk safe and the
 * nav honest, plus the intra-article link integrity the reader relies on.
 */
import { describe, it, expect } from 'vitest';
import { GUIDE_PAGES, GUIDE_CHAPTERS, GUIDE_DEPTH } from './guideContent';

describe('guideContent — tree invariants', () => {
  const ids = GUIDE_PAGES.map((p) => p.id);
  const byId = new Map(GUIDE_PAGES.map((p) => [p.id, p]));

  it('page ids are unique', () => {
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every parent exists, appears earlier in reading order, and shares the chapter', () => {
    for (const page of GUIDE_PAGES) {
      if (!page.parent) continue;
      const parent = byId.get(page.parent);
      expect(parent, `${page.id} → missing parent ${page.parent}`).toBeDefined();
      expect(ids.indexOf(page.parent)).toBeLessThan(ids.indexOf(page.id));
      expect(parent!.chapter).toBe(page.chapter);
    }
  });

  it('depth is finite, starts at the chapter floor, and never jumps a level', () => {
    for (const { pages } of GUIDE_CHAPTERS) {
      expect(GUIDE_DEPTH.get(pages[0].id)).toBe(0);
    }
    for (const page of GUIDE_PAGES) {
      const d = GUIDE_DEPTH.get(page.id)!;
      expect(d).toBeLessThanOrEqual(2);
      const parentDepth = page.parent ? GUIDE_DEPTH.get(page.parent)! : -1;
      expect(d).toBe(parentDepth + 1);
    }
  });

  it('the technicality gradient has real depth: the basics floor is level 0, the engine pages nest under it', () => {
    expect(GUIDE_PAGES[0].id).toBe('basics');
    expect(GUIDE_DEPTH.get('basics')).toBe(0);
    expect(GUIDE_DEPTH.get('overview')).toBe(1);
    expect(GUIDE_DEPTH.get('limits')).toBe(2);
    expect(GUIDE_DEPTH.get('single-vs-multi')).toBe(1);
  });

  it('every data-guide-page cross-link resolves to a real page', () => {
    const idSet = new Set(ids);
    for (const page of GUIDE_PAGES) {
      for (const m of page.body.matchAll(/data-guide-page="([^"]+)"/g)) {
        expect(idSet.has(m[1]), `${page.id} links to unknown page ${m[1]}`).toBe(true);
      }
    }
  });

  it('h2 ids are present and unique per page (they feed the article rail)', () => {
    for (const page of GUIDE_PAGES) {
      const h2Ids = [...page.body.matchAll(/<h2 id="([^"]+)">/g)].map((m) => m[1]);
      const bare = page.body.match(/<h2(?![^>]*id=)/);
      expect(bare, `${page.id} has an h2 without an id`).toBeNull();
      expect(new Set(h2Ids).size).toBe(h2Ids.length);
    }
  });
});
