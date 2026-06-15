/**
 * build.mjs — bundles the companion extension into dist/ with esbuild, then
 * copies the static manifest and popup HTML alongside the two bundles. Load
 * dist/ as an unpacked extension (chrome://extensions → Developer mode →
 * Load unpacked). Two entry points:
 *   - popup.ts  → popup.js   (the toolbar UI, runs in the extension context)
 *   - inject.ts → inject.js  (the page MAIN-world worker, src/bridge runtime)
 */
import { build } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';

const outdir = 'dist';
await mkdir(outdir, { recursive: true });

await build({
  entryPoints: ['src/popup.ts', 'src/inject.ts'],
  outdir,
  bundle: true,
  format: 'esm',
  target: 'es2022',
  legalComments: 'none',
});

await cp('manifest.json', `${outdir}/manifest.json`);
await cp('popup.html', `${outdir}/popup.html`);

console.log(`FormatFX companion → ${outdir}/ (load unpacked)`);
