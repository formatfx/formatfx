/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig(({ mode }) => ({
  // relative base so the bundle works from GitHub Pages subpaths and file://
  base: './',
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  build: mode === 'single' ? { outDir: 'dist-single' } : {},
  test: {
    environment: 'happy-dom',
    exclude: ['e2e/**', 'node_modules/**', 'dist/**', 'dist-single/**'],
  },
}));
