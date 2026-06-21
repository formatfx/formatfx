# Handoff — maker-first redesign

_Continuation note for the maker-first redesign. Architecture, invariants,
and verified SharePoint semantics live in `HANDOFF.md`; locked product
direction in `SHEET-MODE.md`. This file tracks only the redesign's
stage-by-stage progress and what remains._

## The shape of it

A five-stage redesign that makes the default surface serve the maker who
needs the system to think for them, folding the developer-studio furniture
away behind one door.

Locked decisions:

- **Grid-first landing.** Click a column to format it. The studio panes
  hide by default behind a Studio toggle (`#wb-layout.wb-maker`).
- **Emergent formatter type.** No upfront Type dropdown. Type emerges from
  what's built — one column → column formatter, multiple → view formatter.
  A read-only destination chip (`#wb-dest-chip`) tells the maker where the
  active formatter saves; the manual kind control lives in the Studio side
  pane for the cases structure can't express.
- **Areas (row-view builder).** Select grid columns → "make a row view";
  columns become areas. Sizing = independent normalized weights
  (Normal/Wide/Widest, conflict-free like CSS `fr`). Density = a separate
  row-level knob (Roomy/Compact). Tile is an explicit layout pick here —
  it can't emerge from structure (unique export wrapper).
- **CFR = Figma linked-instance model.** A grid box is local/yours; a teal
  link badge marks a `columnFormatterReference`. Clicking selects the box;
  drilling in shows blast radius + "change everywhere" / "override here".
  Plain (unformatted) columns promote via "Save as the column's format".
  Default is fork-local.
- **No Advanced mode.** Keep a validated-JSON escape hatch (relocated, not
  deleted — nothing stranded).
- **Deploy clobber guard** before overwriting a foreign view formatter.
- Theme toggle uses monochrome icons. "Drag column into column" is cut
  (net negative).

## Status

| Stage | What | State |
|-------|------|-------|
| 1 | Maker shell declutter — grid-first default, Studio toggle, theme icon | **Merged** (PR #40) |
| 2 | Emergent formatter type — destination chip, Type dropdown → Studio | **Merged** (PR #41) |
| 3 | Areas / row-view builder | Not started |
| 4 | CFR linked-instance UX | Not started |
| 5 | Safety + escape hatch | Not started |

Stages 1 and 2 are on `main`. `main` is green: build clean, 246 unit,
62 e2e.

## Remaining work

- **Stage 3 — Areas / row-view builder.** The big net-new stage: select
  columns → "make a row view," areas with weighted sizing
  (Normal/Wide/Widest) + density (Roomy/Compact), and tile as an explicit
  layout choice. Candidate to escalate to an ultracode workflow once the
  plan is locked.
- **Stage 4 — CFR linked-instance UX.** Link badge, blast radius,
  change-everywhere / override-here, promote-to-column.
- **Stage 5 — Safety + escape hatch.** Deploy clobber guard, validated
  JSON as the single Advanced door, retire the old panes.

## Working method

- Subagent-driven-development per stage: fresh implementer per task, task
  reviewer, final whole-branch review, then PR to `main`. Never merge or
  push to `main` — owner's call.
- Test files are contracts: change the test first, then the code.
- Reserve ultracode for Stage 3.

## Loose ends

- Uncommitted in the working tree: `icon-options.html` (six SVG favicon
  designs for formatfx.dev — B = solid tile and D = bold blocks read best
  at 16–32px), `icon-preview.png`, and `docs/superpowers/` (the stage
  plans). Decide whether the plans get committed.
