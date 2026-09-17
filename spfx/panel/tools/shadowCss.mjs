/**
 * cssForShadow — rewrite the app stylesheet for a shadow root. Inside a
 * shadow tree `:root` and `body` never match: the panel's host element plays
 * :root (custom properties are declared on it) and `.ffx-app` plays body.
 * `#app` is the web shell's flex column and is dropped. Every other rule
 * (`.wb-*`, `#wb-*`) is left alone — ids are scoped to the shadow tree.
 *
 * `body.<class>` selectors are generalized, not just `wb-dark`: the real
 * stylesheet also has state classes like `body.wb-json-editing`, so any
 * `body.<class>` at the start of a line becomes `:host(.<class>)`.
 */
export function cssForShadow(css) {
  return css
    .replace(/^:root\s*\{/gm, ':host {')
    .replace(/^body\.([\w-]+)\b/gm, ':host(.$1)')
    .replace(/^body\s*\{/gm, '.ffx-app {')
    .replace(/^#app\s*\{[^}]*\}[ \t]*$/gm, '');
}
