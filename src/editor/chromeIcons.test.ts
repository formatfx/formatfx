/**
 * chromeIcons.css is generated (tools/gen-chrome-icons.mjs) and self-hosts the
 * app's own chrome glyphs so they render with NO network. These contracts pin
 * that guarantee: every element-type icon the Structure tree shows must have a
 * bundled, currentColor-recolourable, inline-SVG mask — and it must stay a
 * zero-dependency CSS file (no @import, no CDN host).
 */
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

  it('stays self-contained — no CDN host, no @import, no external url()', () => {
    expect(css).not.toContain('res-1.cdn.office.net');
    expect(css).not.toContain('@import');
    // every url() must be an inline data: URI, never a network fetch
    for (const m of css.matchAll(/url\(("?)([^)]*?)\1\)/g)) {
      expect(m[2].startsWith('data:')).toBe(true);
    }
  });
});
