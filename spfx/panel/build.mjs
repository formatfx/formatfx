// Bundles the Format panel from the PARENT repo's src/ into one ESM file the
// SPFx webpack build consumes as a plain dependency (spike answer 2, variant
// A). Step 1 bakes the app stylesheet in as a string so the panel can inject
// it into its shadow root — that step is tools/genAppCss.mjs, because the
// root `npm test` needs it too (root pretest) and must not build the panel.
// Rebuilt by the SPFx project's prebuild/prestart.
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { genAppCss } from './tools/genAppCss.mjs';

await genAppCss();

await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['src/panel.ts'],
  outfile: 'dist/panel.js',
  bundle: true,
  format: 'esm',
  target: 'es2022',
  sourcemap: true,
  legalComments: 'none',
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
    __BUILD_REV__: '"spfx"', __BUILD_DATE__: '""', __REPO_URL__: '""', __LAST_PR__: '""',
  },
});
console.log('formatfx-panel → dist/panel.js');
