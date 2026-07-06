/**
 * chromeIcons.css is generated (tools/gen-chrome-icons.mjs) and self-hosts the
 * app's own chrome glyphs so they render with NO network. These contracts pin
 * that guarantee: every element-type icon the Structure tree shows must have a
 * bundled, currentColor-recolourable, inline-SVG mask — and it must stay a
 * zero-dependency CSS file (no @import, no CDN host).
 */
/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { ELM_ICONS } from './elmRef';

// read the generated stylesheet from disk (vitest runs from the repo root).
// A ?raw import is intercepted by Vite's CSS plugin and comes back empty here.
const css = readFileSync(resolve(process.cwd(), 'src/chromeIcons.css'), 'utf8');

describe('chromeIcons.css (self-hosted chrome glyphs)', () => {
  it('draws every element-type icon the tree/badge use', () => {
    for (const glyph of new Set(Object.values(ELM_ICONS))) {
      // doubled .ms-Icon class = the specificity guard that beats the CDN font
      expect(css).toContain(`.ms-Icon.ms-Icon--${glyph}::before`);
    }
  });

  it('draws the high-traffic toolbar / menu icons', () => {
    for (const glyph of ['Undo', 'Redo', 'Save', 'Share', 'Copy', 'Delete', 'Rename', 'Code', 'Info']) {
      expect(css).toContain(`.ms-Icon.ms-Icon--${glyph}::before`);
    }
  });

  it('paints each glyph as an inline-SVG mask in currentColor at 1em', () => {
    expect(css).toContain('background-color: currentColor');
    expect(css).toContain('width: 1em');
    expect(css).toMatch(/mask-image:\s*url\("data:image\/svg\+xml,/);
    // both prefixed and standard properties, for broad browser support
    expect(css).toContain('-webkit-mask-image:');
  });

  it('draws every glyph the chrome source names literally (drift guard)', () => {
    // The 2026-07-05 Sheet-chrome stages added menu glyphs (ViewList, Tiles,
    // Clear) without regenerating this file, so those buttons quietly fell
    // back to the CDN font. This sweep pins the real contract: any glyph a
    // chrome source file names as a LITERAL must have a bundled mask.
    // Dynamic names (renderer/iconPicker/fxBar previews over iconData's 2k
    // set) are intentionally CDN-backed and never appear as literals.
    const srcDir = resolve(process.cwd(), 'src');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.endsWith('iconData.ts')) files.push(p);
      }
    };
    walk(srcDir);
    const used = new Set<string>();
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      // literal ms-Icon--Name in markup strings
      for (const m of text.matchAll(/ms-Icon--([A-Za-z0-9]+)/g)) used.add(m[1]);
      // icon-name properties in chrome menu/palette/theme definitions
      for (const m of text.matchAll(/\bicon:\s*'([A-Za-z0-9]+)'/g)) used.add(m[1]);
      // treeView's row-action helper: mk('<Glyph>', title, fn). Scoped to that
      // file — canvas.ts has an unrelated mk() whose first arg is a mode name.
      if (f.endsWith('treeView.ts')) {
        for (const m of text.matchAll(/\bmk\('([A-Za-z0-9]+)'/g)) used.add(m[1]);
      }
    }
    expect(used.size).toBeGreaterThan(20); // the sweep found real usages
    const unbundled = [...used].filter((g) => !css.includes(`.ms-Icon.ms-Icon--${g}::before`)).sort();
    expect(unbundled, 'chrome glyphs missing a self-hosted mask — add them to tools/gen-chrome-icons.mjs MAP and regenerate').toEqual([]);
  });

  it('stays self-contained — no CDN host, no @import, no external url()', () => {
    expect(css).not.toContain('res-1.cdn.office.net');
    expect(css).not.toContain('@import');
    // every url() must be an inline data: URI, never a network fetch
    for (const m of css.matchAll(/url\(("?)([^)]*?)\1\)/g)) {
      expect(m[2].startsWith('data:')).toBe(true);
    }
  });
});
