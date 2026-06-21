# Extending Available Icons in Fluent UI (with SPFx) — Chris Kent

- **Date:** 2026-03-19
- **Presenter:** Chris Kent (Takeda) — Microsoft MVP
- **Source video:** Microsoft 365 & Power Platform community call — 19th of March 2026 — https://www.youtube.com/watch?v=x9A5g2Y9OiE
- **Segment:** 40:18 – 58:10
- **Source note:** Walkthrough reconstructed from the video's auto-generated captions. On-screen code is described rather than transcribed verbatim.

## Summary
Chris demonstrates how to add **your own icons** to the Fluent UI icon set inside an SPFx React web part — so custom SVGs and whole third-party icon fonts (e.g. Font Awesome) can be referenced **by name** in any Fluent control — using Fluent UI's `registerIcons` API. He builds up from a single hand-pasted SVG, to a CDN font face, to an automated script that registers thousands of font glyphs.

## Walkthrough
Demo context: a "Mockingbirds" SPFx React web part that renders a chosen icon across many Fluent UI controls (buttons, etc.). The built-in set has cat and dog but **no bird** icon, and searching flaticon for "bird" only surfaces the old Twitter logo — not acceptable.

### 1. Register a single custom SVG icon
1. Find a simple SVG (he searched "tree bird SVG" — a single `<path>`).
2. Create a new util file **`customIcons.tsx`** (`.tsx` because it works with JSX elements directly).
3. Write a `registerCustomIcons(): void` function that calls Fluent UI's **`registerIcons`**. Each icon is registered by **name** (`"Mockingbird"`) with a value that's either a string or a **JSX element**.
4. `import React` so the pasted SVG markup works as JSX, then paste the SVG element in.
5. In the web part there's a "custom" section that renders added icons by name (`"Mockingbird"`). Call `registerCustomIcons()` from the web part's `onInit`.
6. First result: the icon shows up but is **huge** because the SVG kept its hard-coded `height`/`width`.

### 2. Make the SVG behave like a font/text glyph
- Set the SVG sizing to **`1em`** so it matches the surrounding font size.
- Set `fill`/color to **`currentColor`** so the icon is **theme-aware** (e.g. a primary button flips the icon color automatically; by default an unspecified SVG renders black).
- For accessibility, add **`aria-hidden="true"`** and **`focusable="false"`** — matching how the built-in icons behave and keeping screen readers happy.

### 3. Register an icon **font** (Font Awesome via CDN)
1. New file **`fontAwesomeIcons.ts`** (plain `.ts`, no JSX needed).
2. `export const registerFontAwesomeIcons` again calls `registerIcons`, but this time supplies a **`fontFace`** (the CDN `src` URL for the Font Awesome font, plus the metadata from the Font Awesome site).
3. Register individual icons by giving each a name (e.g. `FaMagnify`) and its **Unicode glyph value** (copied via Font Awesome's "copy Unicode" button, e.g. ``).
4. Call `registerFontAwesomeIcons()` in the web part. Watch for gotchas: a wrong name / forgetting to save / needing an **alias** (many icons have legacy names — e.g. "house" is also "home"); Fluent lets you register **aliases** so `FaSearch$` maps to the same glyph.

### 4. Automate registering a whole font
1. Add Font Awesome as a **dev dependency** (kept out of the bundle; a regular dependency also works if you want to ship the font locally instead of via CDN).
2. A local npm script (`update-fa-icons`) reads the package's huge metadata file and emits a clean **JSON** file into the project containing each icon's **name, style, and Unicode value** (the raw source is ~75,000 lines of mostly-irrelevant data).
3. The registration code imports that JSON, loops it, auto-adds prefixes, registers every icon, and also registers all the **aliases**.
4. Result: thousands of icons usable by name across every Fluent control (he gleefully shows "Poop Storm" and "Flying Spaghetti Monster"). Caveat: some font icons have **different widths** than Fluent's, so you may need to account for sizing.

## Key takeaways
- **`registerIcons`** (from Fluent UI) is the single entry point: register by **name** with either a **JSX element** (SVG) or a **font glyph** (`fontFace` + Unicode value).
- For pasted SVGs: size to **`1em`**, color with **`currentColor`** (theme-aware), and add **`aria-hidden`** + **`focusable={false}`**.
- For fonts: define a **`fontFace`** (CDN or locally bundled) and map names to **Unicode glyph values**; use **aliases** for legacy/alternate names.
- For large sets, generate a **clean JSON manifest** from the package (dev dependency) and register programmatically rather than copying thousands of SVGs by hand.
- Once registered, custom icons "just work" everywhere Fluent UI renders icons — no per-control wiring needed.
