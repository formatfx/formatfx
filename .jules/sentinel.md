## 2025-02-14 - [Format Cells XSS via Element Name]
**Vulnerability:** XSS vulnerability in `src/editor/formatCells.ts` where `nameOf(node)` was interpolated directly into `innerHTML`.
**Learning:** `node._elmName` can be user-defined (e.g. imported from JSON), meaning ANY place where it is displayed using `innerHTML` is a potential XSS vector.
**Prevention:** Avoid `innerHTML` when rendering user-derived element names or custom labels. Use safe DOM manipulation APIs like `document.createElement`, `append()`, and `textContent`.

## 2025-02-14 - [Widespread XSS via innerHTML Interpolation]
**Vulnerability:** XSS vulnerability found in multiple places (`fxBar.ts`, `iconPicker.ts`, `palette.ts`) where dynamic values (like `name`, `glyph`, `item.label`) were injected into `innerHTML`.
**Learning:** Even internal or seemingly safe dynamic values (like predefined labels or icon names) shouldn't be interpolated via `innerHTML` because it establishes a widespread insecure pattern that can easily leak into handling unsafe user data.
**Prevention:** Always use safe programmatic DOM creation methods (`document.createElement`, `setAttribute`, `textContent`, `append`) for injecting dynamic content, eliminating the `innerHTML` vector entirely.
