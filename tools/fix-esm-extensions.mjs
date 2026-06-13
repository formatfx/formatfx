// Appends ".js" to extensionless RELATIVE import/export specifiers in the
// tsc output (dist-lib/**/*.{js,d.ts}) — Node's ESM resolver requires
// explicit extensions, and the sources are written extensionless for the
// bundler. Dependency-free on purpose (it ships in a zero-dep repo).
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.argv[2] ?? 'dist-lib';
const SPECIFIER = /(\bfrom\s+|\bimport\s*\(\s*|^import\s+)(['"])(\.{1,2}\/[^'"]+?)\2/gm;

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (/\.(js|d\.ts)$/.test(entry.name)) yield path;
  }
}

let touched = 0;
for await (const file of walk(root)) {
  const before = await readFile(file, 'utf8');
  const after = before.replace(SPECIFIER, (m, lead, q, spec) =>
    /\.[a-z]+$/i.test(spec) ? m : `${lead}${q}${spec}.js${q}`);
  if (after !== before) {
    await writeFile(file, after);
    touched++;
  }
}
console.log(`fix-esm-extensions: ${touched} file(s) updated under ${root}`);
