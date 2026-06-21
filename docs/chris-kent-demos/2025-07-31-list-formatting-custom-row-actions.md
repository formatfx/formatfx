# List Formatting Tips & Tricks — Custom Row Actions — Chris Kent

- **Date:** 2025-07-31
- **Presenter:** Chris Kent (Takeda) — Microsoft MVP
- **Source video:** Microsoft 365 & Power Platform community call — 31st of July 2025 — https://www.youtube.com/watch?v=wAPHJhh0eyE
- **Segment:** 37:40 – 59:40
- **Source note:** Walkthrough reconstructed from the video's auto-generated captions. On-screen JSON is described rather than transcribed verbatim.

## Summary
A tour of **custom row actions** in list formatting — the `customRowAction` property (usable inside buttons, spans, or divs) that lets a click invoke a named built-in action. Chris runs through the long-standing actions and the **newer** ones, including several **document-library-specific** actions, and contrasts `actionParams` (escaped JSON) with the friendlier `actionInput`.

## Walkthrough
He works from a list pre-built with one column format per action (each kept as a code snippet for quick loading), all from the **list formatting repo** "generic row actions" samples.

### Core actions (specify `action` by name)
- **`defaultClick`** — opens the item (same as double-clicking), but lets you control styling and show it conditionally. The rest of each format is just styling.
- **`editProps`** — opens the edit form (as if hitting "Edit all").
- **`share`** — opens the share dialog.
- **`copyLink`** — copies the item link. (Note: VS Code / the web editor may **underline** newer actions because the **schema hasn't been updated** yet — they still work.)
- **`comment`** — opens the edit form **auto-focused in comments** (expands it if collapsed) so users can type right away.
- **`delete`** — deletes the item.

### Execute flow — `actionParams` (escaped JSON)
- **`executeFlow`** introduces **`actionParams`**, which is always **escaped JSON within your JSON** ("JSON-ception" — every double quote must be escaped).
- The only required value is the **flow ID** (found in the flow's details URL in Power Automate).
- You can customize the panel **header** and the **run-flow button text**; the title, description, and connections summary still come from the **flow itself**, not the format.
- Very common because you can switch which flow runs based on status, show progress, etc.

### Approvals
- **`openApprovalDialog`** (shows up as "Request approval" when approvals are enabled) opens the approvals dialog. You **can't customize that dialog** from the format — only whether to show the action. (A separate prior demo covered customizing the approval *display*/status.)

### More actions
- **`openContextMenu`** — lets a **left-click** open the row's context menu (no right-click needed) — handy for Mac users.
- **`embed`** — first use of **`actionInput`** (un-escaped, nicer than `actionParams`). Embeds content from an **approved domain** (YouTube is allowed out of the box; add more under site/tenant settings). Specify `height`, `width`, and the embed link (from YouTube's Share → Embed `src`). Can be built dynamically with an expression (e.g. concatenating a field's video ID + start time).
- **`setValue`** — also uses `actionInput`; sets **one or more column values** at once. Put the **internal column name** and the value (expressions allowed, e.g. take current value `+ 1` / `- 1` for plus/minus buttons; works even when the current value is null). Has a **Quick Steps** analog (*Set value* quick step) that can update **multiple selected items / multiple columns** at once.

### Document-library-specific actions
- **`previewFile`** — opens the file **preview** dialog (renders in-place rather than opening directly, e.g. in Excel). Different from a thumbnail column — use it when you want the full preview interface.
- **`copyFile`** — uses `actionParams`; copies the file to a **predefined `destinationUrl`** (note exact casing: lowercase `d`, uppercase `U`, then `rl`). Lets you hard-set/standardize the copy target (people forget where to copy manually), and can be **dynamic** (e.g. by status) and written as an expression using **`@currentWeb`** so it isn't hard-coded to one site. Has a **Copy** quick step analog (select file(s), even multiple). Pro tip: inspect how quick steps are stored via **SP Editor** (F12 → SharePoint tab → List properties) — they're saved on the **list properties** (e.g. `targetLibraryUrl`), though not a 1:1 match to the format.
- **`moveFile`** — like copy but removes the original from the source.

### Composition & wrap-up
- Each action is shown as an individual column format, but they can be combined in a **larger view format** or a **toolbar** (e.g. a gallery view with a little button toolbar — more intuitive than select-item-then-find-the-command).
- **Column-level** actions apply across **all views**; **command bar** customizations are **per view**.
- Most actions work in the **list/library web part** on a page (he notes `executeFlow` was, at one point, not working there).
- The idea: build little guided "applications" — **hide** the noisy top command-bar buttons and only show the right action at the right time (e.g. a big red copy/move button or starting an approval when status is set).
- He closes pointing to the **list formatting repo** (300+ samples across forms/columns/views) and the formatting browser extensions seen in the background — plus, of course, the extension that just "adds little horses."

## Key takeaways
- **`customRowAction`** turns a button/span/div into a click that fires a **named action**; the rest of the format is normal styling, shown conditionally as needed.
- Built-ins covered: `defaultClick`, `editProps`, `share`, `copyLink`, `comment`, `delete`, `executeFlow`, `openApprovalDialog`, `openContextMenu`, `embed`, `setValue`, and the doc-library-only `previewFile`, `copyFile`, `moveFile`.
- **`actionParams` = escaped JSON-in-JSON** (execute flow, copy/move file); **`actionInput` = nicer un-escaped input** (embed, set value) — prefer it where available.
- `executeFlow` needs only the **flow ID**; header/button text are customizable, but title/description/connections come from the flow.
- Several actions have **Quick Steps analogs** that can act on **multiple selected items**; inspect quick-step storage with **SP Editor** (list properties).
- Newer actions may be **underlined by the editor** (schema lag) but still work; combine actions into **toolbars/view formats**, and remember **column-level = all views** vs **command bar = per view**.
- Use `@currentWeb` to keep `copyFile`/`moveFile` destinations site-portable; allow embed domains in site/tenant settings.
- Reference: the **list formatting repo** "generic row actions" samples (300+).
