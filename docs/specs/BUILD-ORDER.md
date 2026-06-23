# BUILD ORDER — Custom Column Subtypes

Single source of truth for "are we done?". The autonomous run ticks each box
(`[ ]` → `[x]`) as it lands, in order. **The goal is met when every box below —
including the Definition of Done — is `[x]`.** Full requirements live in
`docs/specs/custom-column-subtypes.md`; this file is the executable checklist.

Rules that apply to every story (from `CLAUDE.md`):
- **Test-first** — test files are contracts; change/add the test before the code.
- Zero runtime deps · one gesture = one undoable mutation · click-only safety ·
  schema-valid + refuse-don't-guess (never a standalone `!`).
- Only the new `wb-subtypes` localStorage key; the `wb-` prefix and all existing
  keys/classes are frozen.
- Verify a story with `npm run build` && `npm test` (+ Playwright where a browser
  is available — `HANDOFF.md` §7 has the no-CDN container recipe). Commit when green.

---

## Phase 1 — Foundation

- [x] **US-1 — Subtype data model + `wb-subtypes` store**
  - Files: `src/core/types.ts` (add `Subtype`, `Knob`, `KnobType`; `MockField.subtype?`, `MockField.subtypeArgs?`), new `src/editor/subtypes.ts` (store + helpers), `src/editor/subtypes.test.ts`.
  - Gate: store does list/get/save/delete against `wb-subtypes` (`{version:1,subtypes:[]}`); `try/catch` guarded; corrupt/missing key → empty catalog, never throws. Unit tests cover round-trip, version guard, private-mode fallback.
  - Verify: `npm run build` && `npm test`.

- [x] **US-2 — Seed catalog (existing presets re-expressed + Money)**
  - Files: `src/editor/subtypes.ts` (built-in seed registry), `src/editor/columnPresets.ts` (source), `src/editor/subtypes.test.ts`.
  - Gate: every existing `columnPresets` entry exposed as a builtin subtype with correct `baseTypes`; new **Money** seed with `symbol` (text, "$") + `decimals` (number, 2) knobs, `baseTypes` ⊇ {number, currency}, hand-authored `vocab`. Tests assert all seeds validate, ≥1 baseType each, Money exposes both knobs.
  - Verify: `npm run build` && `npm test`.

## Phase 2 — Apply core

- [ ] **US-3 — Catalog menu + zero-knob apply**
  - Files: `src/editor/gridView.ts` (`openFormatColumnMenu`, `applyColumnFormatter`), `src/style.css` (badges), e2e spec.
  - Gate: menu lists type-matching seeds + customs with Built-in/Yours badges + "format manually"; non-matching `baseTypes` never appear; zero-knob apply writes formatter + sets `field.subtype`/`subtypeArgs={}` as ONE undoable mutation. e2e: pick a seed renders; Ctrl+Z restores.
  - Verify: `npm run build` && `npm test` && Playwright apply spec.

- [ ] **US-4 — Apply-time knob form**
  - Files: `src/editor/gridView.ts` (+ form), `src/style.css`, e2e spec.
  - Gate: ≥1-knob subtype opens a dialog of typed widgets (text/number/bool/color/choice) pre-filled with defaults; invalid input refused-and-taught, nothing baked until valid; Apply bakes literals + one undoable mutation; answers stored in `field.subtypeArgs`. e2e: Money symbol="€", decimals=0 renders.
  - Verify: `npm run build` && `npm test` && Playwright knob-form spec.

## Phase 3 — Authoring

- [ ] **US-5 — Save-as birth**
  - Files: `src/editor/cfr.ts` (basis), `src/editor/subtypes.ts` (vocab derivation), `src/editor/gridView.ts` (action), tests + e2e.
  - Gate: "Save as reusable subtype…" prompts for a name → custom subtype; `baseTypes` defaults to source type; `formatter` = current; `vocab` auto-derived (refs used + literal values set); persists to `wb-subtypes`, shows as "Yours"; saving from a builtin sets `forkedFrom`.
  - Verify: `npm run build` && `npm test` && Playwright birth spec.

- [ ] **US-6 — Refine modal + full parameter editor**
  - Files: `src/editor/subtypes.ts` (literal extraction, promote/demote), `src/editor/gridView.ts` (modal), `src/style.css`, tests + e2e.
  - Gate: "⋯" on a custom entry → inline modal (rename, edit `baseTypes`, edit `vocab`, delete, fork); extracted-literals checklist; checking promotes a literal to a typed knob {label,type,default}, unchecking demotes; promotion BY VALUE (one value = one knob, all occurrences); no raw-JSON editing; edits persist and do NOT alter columns already using the subtype.
  - Verify: `npm run build` && `npm test` && Playwright refine spec.

- [ ] **US-7 — Push-update**
  - Files: `src/editor/gridView.ts` (push action), `src/editor/subtypes.ts` (re-bake), tests + e2e.
  - Gate: after a refine, opt-in "Update the N columns using this" (N = matching `field.subtype`); re-bakes each from stored `field.subtypeArgs`, overwrites formatter (hand-edits included); whole push is ONE batched undoable mutation (single Ctrl+Z reverts all).
  - Verify: `npm run build` && `npm test` && Playwright push spec.

## Phase 4 — Bar rewiring (strict vocab)

- [ ] **US-8 — fxSuggest reads subtype vocab**
  - Files: `src/editor/fxSuggest.ts`, `src/editor/fxSuggest.test.ts` (contract — change FIRST), `src/editor/fxBar.ts` if needed, e2e.
  - Gate: column with a subtype + non-empty `vocab` → bar offers ONLY that vocab; `...refs`/`...values` padding suppressed. Empty `vocab` → FALL BACK to today's padding. No subtype → behaves exactly as today (prove this in the contract tests). e2e: tagged column shows vocab, hides unrelated refs.
  - Verify: `npm run build` && `npm test` && Playwright bar spec.

---

## Definition of Done (final boxes — goal is met only when ALL are `[x]`)

- [ ] All 8 user-story boxes above are `[x]`.
- [ ] `npm run build` succeeds; typecheck/lint clean.
- [ ] `npm test` green (unit).
- [ ] Playwright suite green where a browser is available.
- [ ] No existing localStorage key or `wb-` class renamed; only `wb-subtypes` added.
- [ ] Nothing from the spec's Out-of-Scope list was built.
- [ ] A pull request to `main` is open (what changed + why + test counts); not merged.

> Out of scope (do NOT build): Elapsed/Until relative-time seeds, sharing/tenant
> storage, composition/layering, cascade/auto-reflow, override/shadow semantics,
> fragment-swap knobs, modified-since-apply tracking.
