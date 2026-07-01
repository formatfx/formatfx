## 2025-02-14 - [Format Cells XSS via Element Name]
**Vulnerability:** XSS vulnerability in `src/editor/formatCells.ts` where `nameOf(node)` was interpolated directly into `innerHTML`.
**Learning:** `node._elmName` can be user-defined (e.g. imported from JSON), meaning ANY place where it is displayed using `innerHTML` is a potential XSS vector.
**Prevention:** Avoid `innerHTML` when rendering user-derived element names or custom labels. Use safe DOM manipulation APIs like `document.createElement`, `append()`, and `textContent`.
## 2026-07-01 - [Playground XSS via Element Name]
**Vulnerability:** XSS vulnerability in `src/editor/playground.ts` where `nameOf(targetNode)` was interpolated directly into `innerHTML`.
**Learning:** Similar to the previous finding in `formatCells.ts`, `nameOf` can return user-defined element names (e.g., from imported JSON), making it an XSS vector when used with `innerHTML`.
**Prevention:** Avoid `innerHTML` when rendering user-derived element names. Use secure DOM manipulation APIs like `document.createElement`, `append()`, and `textContent`.
