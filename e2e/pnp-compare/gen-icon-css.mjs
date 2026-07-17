/**
 * e2e/pnp-compare/gen-icon-css.mjs — build a self-contained ms-Icon CSS from
 * @fluentui/font-icons-mdl2's base64-embedded font subsets, so captures in a
 * CDN-blocked container still paint iconName glyphs (same MDL2 codepoints
 * real SP uses). Output is runtime-only test scaffolding — the fonts stay
 * under the Fluent assets license and are never committed or shipped.
 *
 * Usage: node gen-icon-css.mjs <path-to-@fluentui/font-icons-mdl2/lib> <out.css>
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const libDir = process.argv[2];
const outFile = process.argv[3];
if (!libDir || !outFile) {
  console.error('usage: gen-icon-css.mjs <font-icons-mdl2/lib> <out.css>');
  process.exit(1);
}

const css = [
  '.ms-Icon{display:inline-block;font-style:normal;font-weight:normal;speak:none;-webkit-font-smoothing:antialiased}',
];
let iconCount = 0;
for (const file of fs.readdirSync(libDir).filter((f) => /^fabric-icons(-\d+)?\.js$/.test(f))) {
  const src = fs.readFileSync(path.join(libDir, file), 'utf8');
  const family = src.match(/fontFamily:\s*"\\"([^"\\]+)\\""/)?.[1];
  const woffName = src.match(/concat\(baseUrl,\s*"([^"']+\.woff)/)?.[1];
  if (!family || !woffName) {
    // a silently-skipped subset means missing glyphs that would read as
    // renderer divergences — fail loudly instead (pin the package version)
    console.error(`${file}: fontFace not found — the package's generated-file format changed; pin/downgrade @fluentui/font-icons-mdl2.`);
    process.exitCode = 1;
    continue;
  }
  const woff = fs.readFileSync(path.join(libDir, '..', 'fonts', woffName));
  const data = `data:application/octet-stream;base64,${woff.toString('base64')}`;
  css.push(`@font-face{font-family:"${family}";src:url('${data}') format('woff')}`);
  const iconsBlock = src.match(/icons:\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? '';
  for (const m of iconsBlock.matchAll(/(?:'([^']+)'|([A-Za-z0-9_]+)):\s*'((?:\\u[0-9a-fA-F]{4}|[^'])+)'/g)) {
    const name = m[1] ?? m[2];
    const chars = m[3].replace(/\\u([0-9a-fA-F]{4})/g, (_x, h) => `\\${h} `).trim();
    css.push(`.ms-Icon--${name}:before{font-family:"${family}";content:"${chars}"}`);
    iconCount++;
  }
}
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, css.join('\n'));
console.log(`${iconCount} icons → ${outFile}`);
