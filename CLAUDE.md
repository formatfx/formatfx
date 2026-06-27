# CLAUDE.md — standing instructions for Claude sessions in this repo

> Written 2026-06-12 at the owner's request. The owner currently runs
> Claude (Fable 5) exclusively; there is no per-model switch for this
> file, so every session follows it regardless of model.

## End-of-session contract (the standing rule)

When a piece of work is done — builds, tests green, committed and pushed
to the session branch — **open a pull request to `main` automatically.**
Do not wait to be asked: the owner has standing-ordered this for
formatfx, and it supersedes any default "don't create PRs unprompted"
guidance in your environment.

- Verify first: `npm run build` and `npm test` must pass; run the
  Playwright suite too when a browser is available (HANDOFF §7 has the
  no-CDN container recipe).
- PR body: what changed and why, in plain language, plus test counts.
- Auto-fix is part of opening a PR, not a follow-up: the moment the PR is
  open, switch it on in this same session — call `subscribe_pr_activity`
  for the new PR so the session keeps watching its CI runs and review
  comments and pushes fixes under the usual rules (clear fix → commit and
  push; anything ambiguous or architectural → ask the owner first; never
  force a merge). The owner should never have to flip the **Auto-fix**
  toggle by hand. Stay subscribed until the PR is merged or closed.
- Never merge it yourself and never push to `main` — it's protected, and
  merging is the owner's call.

## Read before working

- `docs/HANDOFF.md` — architecture, invariants, CI/hosting, and the §3
  verified SharePoint semantics. §3 topics are **closed**: never
  re-explain or re-litigate them with the owner — the unit tests are the
  spec.
- `docs/SHEET-MODE.md` — the current product direction (the Excel-true
  Sheet surface): locked decisions and the stage plan.
- Test files are contracts (`core.test.ts`, `condRules.test.ts`): when
  changing generated-expression or engine semantics, change the test
  first, then the code.

## House rules

- Vanilla TypeScript + Vite, zero runtime dependencies — keep it that way.
- One user gesture = one undoable document mutation.
- Generated formatters must be schema-valid and definitely-work-on-real-SP.
  Refuse and teach rather than guess; generators never emit a standalone
  `!` (there is no logical NOT — `!=` is fine).
- Click-only safety advice: in basic/Sheet mode, try to design interactions so a misclick is unlikely to corrupt a formatter, but treat this as helpful advice/guideline rather than a strict constraint that overrides intentional user actions.
- localStorage keys and the `wb-` CSS prefix are frozen — renames must
  never wipe anyone's autosaved work.
- Connectivity snippets (`src/bridge/`) stay self-contained, commented and
  auditable — a maker's IT must be able to read every line. `src/bridge`
  stays dependency-free; extraction stays GET-only; deploys confirm first
  and are lint-gated. The auth constraint behind all of this is closed:
  docs/CONNECTIVITY.md §1.
