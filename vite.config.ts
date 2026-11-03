/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseMergePR, repoHttpUrl } from './src/buildMeta';

/** Run a git command without a shell (robust across win32/Linux). "" on failure. */
function git(args: string[]): string {
  try {
    return execFileSync('git', args, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

/** Compute the build-time "About" constants from package.json + git. */
function buildDefines(): Record<string, string> {
  let version = '0.0.0';
  try {
    version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version ?? version;
  } catch { /* keep default */ }

  const rev = git(['rev-parse', '--short', 'HEAD']) || 'dev';
  const date = git(['log', '-1', '--format=%cs']);
  const repoUrl = repoHttpUrl(git(['config', '--get', 'remote.origin.url']));

  const subject = git(['log', '-1', '--grep=^Merge pull request', '--format=%s']);
  const body = git(['log', '-1', '--grep=^Merge pull request', '--format=%b']);
  const pr = parseMergePR(subject, body);
  const lastPr = pr && repoUrl ? { ...pr, url: `${repoUrl}/pull/${pr.number}` } : null;

  return {
    __APP_VERSION__: JSON.stringify(version),
    __BUILD_REV__: JSON.stringify(rev),
    __BUILD_DATE__: JSON.stringify(date),
    __REPO_URL__: JSON.stringify(repoUrl),
    __LAST_PR__: JSON.stringify(lastPr),
  };
}

/** The pages: the app (index.html) and FormatFX Lite (lite.html, the
 *  cards-only test page — docs/LITE.md). */
const page = (file: string): string => fileURLToPath(new URL(file, import.meta.url));

function buildFor(mode: string) {
  if (mode === 'single') return { outDir: 'dist-single' };
  // `npm run build:lite` — Lite as one self-contained file, to hand around
  if (mode === 'lite-single') return { outDir: 'dist-lite-single', rollupOptions: { input: page('./lite.html') } };
  return { rollupOptions: { input: { main: page('./index.html'), lite: page('./lite.html') } } };
}

export default defineConfig(({ mode }) => ({
  // relative base so the bundle works from GitHub Pages subpaths and file://
  base: './',
  plugins: mode === 'single' || mode === 'lite-single' ? [viteSingleFile()] : [],
  build: buildFor(mode),
  define: buildDefines(),
  test: {
    environment: 'happy-dom',
    exclude: ['e2e/**', 'node_modules/**', 'dist/**', 'dist-single/**', 'dist-lite-single/**', 'tools/**',
      'extension/node_modules/**', 'extension/dist/**',
      'spfx/formatfx-spfx/**', 'spfx/panel/node_modules/**', 'spfx/panel/dist/**'],
    testTimeout: 15000,
  },
}));
