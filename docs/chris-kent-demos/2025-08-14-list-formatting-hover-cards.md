# List Formatting Tips and Tricks — Hover Cards & Custom Card Props — Chris Kent

- **Date:** 2025-08-14
- **Presenter:** Chris Kent (Takeda) — Microsoft MVP
- **Source video:** Microsoft 365 & Power Platform community call — 14th of August 2025 — https://www.youtube.com/watch?v=YpJ77QNudPk
- **Segment:** 26:45 – 42:47
- **Source note:** Walkthrough reconstructed from the video's auto-generated captions. On-screen JSON is described rather than transcribed verbatim. (Live hover cards misbehaved during the demo, so several points were shown "trust me" / via pre-built samples.)

## Summary
Chris does a deep dive on **hover cards** in list formatting: keeping the built-in **people/profile card** when you apply a custom person-column format (via `defaultHoverField`), and building **custom hover cards** with `customCardProps` — including nested menus, the `openOnEvent` (hover vs. click), `directionalHint`, and `beakStyle` options.

## Walkthrough
Demo context: a "warrior horses" **autopsies** list tracking which horse chunk was affected and what happened (eaten / lost / exploded), with a person column for who did the slicing.

### 1. The problem: custom formats lose the people card
1. Person/multi-person columns get the rich **people (profile) card** on hover out of the box.
2. Apply a simple custom person format (two `div`s: name + department) — useful for showing more detail inline — and you **lose** that people card, one of the nicest contextual features in M365.

### 2. Restore it with `defaultHoverField`
- Add **`defaultHoverField`** to the root element, set to the column's **internal name** (he mentions `@currentField` *should* work to avoid hard-coding, but it wasn't cooperating that day). This re-attaches the native hover card to your custom format.
- This also works on **document libraries** if you put it on the file name field (`FileLeafRef`).
- Restriction history: it used to only apply to **child** elements (not the root) — that restriction is **gone**, you can now put it on the root.
- People fields and `FileLeafRef` are the realistic targets; `customCardProps` **overrides** `defaultHoverField` if both are present.

### 3. Custom hover cards with `customCardProps`
1. On a choice column (50+ "horse chunk" values), attach **`customCardProps`** at the bottom of an element.
2. Required-ish pieces inside each `customCardProps`:
   - **`openOnEvent`** — `"click"` or `"hover"`. For menu-style cards, **click** is usually better (and set the cursor to a pointer).
   - **`directionalHint`** — *a hint, not a guarantee*; placement adapts to window/content size. **Default is `rightCenter`**, aligning to the **right edge of the element you put it on** (which may surprise you if that element is full-width). A full list of hints exists (mostly edge-based: bottom-left edge, etc.).
   - **`isBeakVisible`** — toggles the little triangle "beak" (on by default; `false` removes it).
   - **`beakStyle`** — styles applied directly to the beak. **Only styles, not classes** — because the card is a separate floating object it **can't inherit** parent styles or theme classes, so a hard-coded color (e.g. black) won't theme-flip; leaving the default keeps it white/theme-matching in dark mode.
   - **`formatter`** — the card body, authored exactly like any other column format.
3. **Nesting / "inception":** `customCardProps` can be **nested within each other** to build cascading sub-menus (he demos a "horse chunk cascade" with reproductive organs in their own sub-menu).
4. Inside the card's children, **`customRowAction` + `setValue`** lets a click set the column value — e.g. clicking "pole" sets the horse-chunk column to "pole." Caveat: hand-building this per value is **labor-intensive**, and once you replace the choice-column pill rendering you **lose the live-updating pills** (true of any customized choice format). He kept pills by appending his `customCardProps` to the bottom of the existing children list.
5. Bonus tip shown repeatedly: the **inline edit field** trick — `@currentField` followed by a **colon** (not a comma) enables inline editing.

### 4. Summary slides
- `defaultHoverField` + `@currentField` gives the default hover card for the current field, but it's only meaningful for **person fields** and **`FileLeafRef`**.
- `customCardProps` **overrides** `defaultHoverField`; the old children-only restriction is lifted.
- Lots of `customCardProps` uses beyond cascades: light boxes, image previews, embedded edit forms, even a Visio chart showing a full flow. Works in Microsoft Lists and the list view web parts.

## Key takeaways
- Applying a custom person format **drops the native people card** — re-add it with **`defaultHoverField`** (set to the internal name / `@currentField`); also works on `FileLeafRef` in libraries.
- **`customCardProps`** builds fully custom hover cards; key options: **`openOnEvent`** (hover/click), **`directionalHint`** (default `rightCenter`, aligns to the element's edge), **`isBeakVisible`**, **`beakStyle`** (styles only — no class/theme inheritance), and **`formatter`**.
- `customCardProps` can be **nested** for cascading sub-menus, and combined with **`setValue`** custom row actions to update items from the card.
- `customCardProps` **overrides** `defaultHoverField`; the previous root-element restriction no longer applies.
- Handy trick: inline edit field via **`@currentField:`** (colon, not comma).
