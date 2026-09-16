// Bundles the spike panel from the PARENT repo's src/ into one ESM file the
// SPFx webpack build can consume as a plain dependency. Throwaway.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/entry.ts'],
  outfile: 'panel.js',
  bundle: true,
  format: 'esm',
  target: 'es2022',
  legalComments: 'none',
});
console.log('formatfx-panel → panel.js');
