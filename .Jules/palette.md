## 2024-03-24 - Accessibility Audit
**Learning:** Found multiple icon-only buttons in the UI (like cancel/delete/close buttons) that use `.innerHTML` with `ms-Icon` classes but are missing `aria-label` attributes, making them inaccessible to screen readers.
**Action:** Add `aria-label` to all icon-only buttons created via DOM APIs. Avoid `innerHTML` where possible and instead use `aria-label` matching the `title` attribute.
