## 2024-07-25 - Fix XSS in Format Cells Header
**Vulnerability:** A potential Cross-Site Scripting (XSS) vulnerability was found in `src/editor/formatCells.ts` where the `innerHTML` property was used to insert an unescaped, potentially user-controlled node name (`nameOf(node)`).
**Learning:** The application extensively uses `innerHTML` to construct UI elements dynamically. When dealing with user-derived content, this pattern opens up vectors for XSS.
**Prevention:** Avoid `innerHTML` and always use secure DOM manipulation APIs like `document.createElement`, `appendChild`, and `textContent` to inject user-provided data into the DOM.
