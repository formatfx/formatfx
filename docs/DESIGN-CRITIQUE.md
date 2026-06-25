# FormatFX — Design critique (formatfx.dev)

> Reviewed 2026-06-23. Scope: the public surface at **formatfx.dev**, which
> serves this Vite build verbatim (GitHub Pages canonical, Firebase mirror).
> The site *is* the app — `index.html` mounts the editor straight into `#app`;
> there is no separate marketing/landing layer (still open as roadmap §6).

## Method

The live site was reviewed by building the repo and rendering the real app in
a headless browser across light/dark, the maker landing and the Advanced
studio, the field guide, the style playground, and two narrow widths
(768 px, 390 px), plus a read of the front-end source (`index.html`,
`src/style.css`, `src/main.ts`, theming and branding). Findings reference
`file:line` where useful so they're actionable.

A caveat on the captures used during review: the Fluent icon **glyphs** load
from `res-1.cdn.office.net`, which was unreachable from the review sandbox, so
icon-only controls rendered blank there. They render normally on the live
site — but that blank-state *is itself* finding #2 below (what happens when the
CDN is unavailable).

---

## What's strong

- **A coherent, disciplined design system.** One token set (`--wb-*`,
  `style.css:3`), a Fluent-faithful palette (Segoe UI, accent `#0078d4`, the
  SharePoint neutrals), consistent 3–4 px radii and restrained shadows. It
  reads as a credible Microsoft-adjacent tool — exactly right for the audience.
- **Theming done properly.** Light/dark via variables *and* `color-scheme`
  (`style.css:14,28`) so native scrollbars and form controls flip too — a
  detail most apps skip. Dark mode holds together.
- **Progressive disclosure is the backbone.** The maker grid is the default;
  the full developer IDE folds behind one **Advanced** door
  (`main.ts:251`). Both the simple view and the dense 4-pane studio stay
  legible because they're separated rather than crammed together.
- **The field guide is the best-realised surface** — a true Microsoft
  Learn-style three-column reader (nav · article · scroll-spy rail,
  `style.css:899`+) with larger, more readable type than the editor. A good
  template for the rest of the product to borrow from.
- **Domain fidelity sells the pitch.** Status pills, data bars, facepile, and
  the `𝑓x` formula bar with Excel-style draft text make the preview look like
  real SharePoint — which is the whole value proposition.
- **The writing teaches.** "consequence-free — nothing touches your formatter
  unless you apply it," "→ Saves to the view." Microcopy is doing real work.

---

## Issues, by priority

### 1. Responsive breakage on a public URL — High
The shell is a fixed-px grid
(`220 5 250 5 1fr 5 360`, `style.css:122`) and the only `@media` query in the
app is for the guide (`style.css:922`).

- **The topbar collides and clips at ≤768 px:** the tagline wraps so its last
  word runs straight into the next control with no gap (the tagline's
  "SharePoint" ends up directly against the "Editing" control), and the
  **"Advanced" button and ☰ menu get cut off the right edge**. At 390 px the entire right control cluster (JSON, undo/redo,
  Advanced, menu) is off-screen and unreachable.
- Even if mobile *editing* is out of scope, a maker who opens the link on a
  phone sees a broken-looking header. Minimum fix: let `.wb-brand-sub`
  truncate/hide and let `.wb-topbar-controls` wrap or scroll below ~900 px,
  plus a "best on desktop" hint. The text collision is a pure polish bug
  regardless of mobile support.

### 2. Icons are a single point of failure — High
The Fluent icon glyphs come from a render-blocking stylesheet `<link>` to the
Fluent icon CSS on `res-1.cdn.office.net` (`index.html:10`), and the only
fallback is an empty `1em` box (`style.css:793`). When that CDN is slow or blocked, **icon-only buttons
(undo, redo, the brand mark) go completely blank.** Text-labelled buttons
(JSON, Advanced) degrade fine; the icon-only ones don't. Self-hosting the ~20
glyphs actually used (or inlining them as SVG) removes a third-party runtime
dependency — also a privacy and performance win — and makes the toolbar robust.

### 3. Brand colour incoherence — Medium
The favicon's signature is **amber `#d97706`** (a list crossed by an "fx"
mark) — a nice mark — but amber appears **nowhere in the product**; the UI is
entirely SharePoint blue. Either thread amber in as a secondary accent (the
`𝑓x` badge is the obvious home) or align the mark to the blue. Today the brand
and the app look like two different projects. *(Owner design call.)*

### 4. Dark-by-default may wrong-foot the audience — Medium
`themeMode` is hardcoded to `'dark'` (`state.ts:150`), so first paint is dark.
SharePoint/Office makers overwhelmingly work in light Office chrome, and the
previews are most convincing on white. Defaulting to `prefers-color-scheme`
(the saved choice is already respected) would make the first impression match
the tool they're formatting *for*. *(Owner design call.)*

### 5. Accessibility gaps — Medium
- **Type runs very small:** body 13 px with ~43 instances of 9–10 px labels.
  Legible on hi-dpi, cramped on a 1080p monitor. Nudge the floor toward 11 px.
- **An infinite animation with no escape hatch:** the selection outline pulses
  forever (`wb-sel-pulse … infinite`, `style.css:456`) and there is **no
  `prefers-reduced-motion`** anywhere in the sheet. Guard the pulses/flashes.
- **Focus is thin:** a single `:focus-visible` rule in the whole stylesheet
  (`style.css:364`), plus a few `outline:none` on editors. Several custom
  controls (palette chips are `cursor:grab` divs, tree rows, the chip walls)
  appear mouse-only; drag-to-canvas has no keyboard path.
- **Status/lint lean on colour alone** (pill fills, lint left-border
  severities) — add a shape or text cue for colour-blind users.

### 6. The canvas reads empty — Medium/Low
Three rows float at the top of a tall, blank canvas. Vertically centring the
preview, capping its width, or adding a faint "this is your live preview"
affordance would make the default screen feel composed rather than unfinished.

### 7. Shareability metadata is missing — Low (easy win)
`index.html` has a good title and dual-mode favicons but **no
`meta description`, no Open Graph / Twitter card, no `theme-color`.** With
pnp-community outreach on the roadmap, every shared link currently previews as
a bare URL. ~6 lines of `<meta>` fixes it.

---

## Fastest wins (in order)
1. Add `<meta>` description + OG/Twitter tags — pure upside for sharing.
2. Fix the topbar: truncate the tagline, let controls wrap/scroll under ~900 px.
3. Self-host the Fluent glyph subset so icon-only buttons never blank out.
4. `prefers-reduced-motion` guard around the pulse/flash animations.
5. Resolve the amber-vs-blue brand split.

## Bottom line
A well-built, opinionated power-tool with an unusually strong design system and
teaching voice. The gaps are mostly at the edges — responsive resilience, brand
coherence, accessibility polish, and first-impression metadata — rather than in
the core, which is solid.
