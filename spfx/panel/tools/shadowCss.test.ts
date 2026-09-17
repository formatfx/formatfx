import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { cssForShadow } from './shadowCss.mjs';

describe('cssForShadow', () => {
  it('re-homes :root and body onto the shadow host and the app root', () => {
    const out = cssForShadow(':root {\n  --wb-bg: #fff;\n}\nbody {\n  margin: 0;\n}\nbody.wb-dark .x { color: red; }\n#app { display: flex; height: 100vh; }\n.wb-json { color: var(--wb-bg); }\n');
    expect(out).toContain(':host {\n  --wb-bg: #fff;');
    expect(out).toContain('.ffx-app {\n  margin: 0;');
    expect(out).toContain(':host(.wb-dark) .x { color: red; }');
    expect(out).not.toContain('#app');
    expect(out).toContain('.wb-json { color: var(--wb-bg); }');
  });

  it('leaves no document-level selector in the real stylesheet', () => {
    // NB: import.meta.url is passed via a local first (not inline) — inline
    // `new URL('...', import.meta.url)` is specially rewritten by Vite's
    // asset-URL analysis into a dev-server http: URL even in vitest's node
    // environment, which readFileSync then rejects ("must be of scheme file").
    const here = import.meta.url;
    const out = cssForShadow(readFileSync(new URL('../../../src/style.css', here), 'utf8'));
    expect(out).not.toMatch(/^:root\b/m);
    expect(out).not.toMatch(/^body\b/m);
    expect(out).not.toMatch(/^#app\b/m);
    expect(out).toMatch(/^:host \{/m);
  });
});
