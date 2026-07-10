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

- Verify first: `npm run build` and `npm test` must pass locally.
  **Do NOT run the full Playwright suite as a local pre-PR gate** — the
  PR's required `e2e` check runs the identical suite and is the arbiter;
  duplicating it in-session wastes minutes per PR (owner call 2026-07-09).
  Local browser use is for targeted verification only: the few specs
  touching the changed surface, or an ad-hoc smoke/screenshot of the
  feature itself. Open the PR and let CI report — you're subscribed to it
  anyway (next bullet). HANDOFF §7 keeps the no-CDN container recipe for
  when a local browser run IS wanted.
- PR body: what changed and why, in plain language, plus test counts.
- Docs ride the code commit: fold HANDOFF/README/CLAUDE.md updates into
  the same commit (or at least the same push) as the code they describe —
  never trail an open PR with a docs-only push, because every push
  restarts the full required CI (owner call 2026-07-09). ci.yml
  short-circuits its heavy jobs for docs-only PR diffs, so a stray docs
  push now costs seconds, not minutes — but don't lean on that.
- Auto-fix is part of opening a PR, not a follow-up: the moment the PR is
  open, switch it on in this same session — call `subscribe_pr_activity`
  for the new PR so the session keeps watching its CI runs and review
  comments and pushes fixes under the usual rules (clear fix → commit and
  push; anything ambiguous or architectural → ask the owner first; never
  force a merge). The owner should never have to flip the **Auto-fix**
  toggle by hand. Stay subscribed until the PR is merged or closed.
- Never merge it yourself and never push to `main` — it's protected, and
  merging is the owner's call.
- **Clean up when done**: Once the PR is open and there are no further fixes to push in this
  session, check out `main` and pull (`git checkout main && git pull origin main`) to leave
  the local workspace clean and ready for the next session. **Do not delete the session
  branch** — it must stay intact on the remote until the PR is merged or closed by the
  owner. `git checkout main` only moves HEAD locally; the branch and its PR are unaffected.

## Start-of-session contract (branch hygiene)

At the start of every session:
1. Check out `main` and pull the latest changes (`git checkout main && git pull origin main`)
   to align the local repository.
2. Create a fresh session-specific branch before making any code modifications
   (e.g. `git checkout -b feature/issue-N-description` or `session/xxx`). Never code on a
   completed session's branch or a shared branch.

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
- Click-only safety advice: in basic/Sheet mode, try to design interactions
  so a misclick is unlikely to corrupt a formatter, but treat this as helpful
  guidance rather than a strict constraint that overrides intentional user
  actions.
- localStorage keys and the `wb-` CSS prefix are frozen — renames must
  never wipe anyone's autosaved work.
- Connectivity snippets (`src/bridge/`) stay self-contained, commented and
  auditable — a maker's IT must be able to read every line. `src/bridge`
  stays dependency-free; extraction stays **read-only** (no mutation —
  read-POSTs like `GetAllRules()` are fine; the retired "GET-only" phrasing
  was only a proxy for "never silently changes the user's data" — owner
  decision 2026-07-07, docs/CONNECTIVITY.md §8, landed via #214: the snippet
  + spClient tests enforce "no mutating request"); deploys confirm first and are
  lint-gated. The auth constraint behind all of this is closed:
  docs/CONNECTIVITY.md §1.

## Live-tenant / devtools probe notes (browser is the only auth path, CONNECTIVITY §1)

- The chrome-devtools MCP browser is its **own signed-in Chrome profile**
  (`~/.cache/chrome-devtools-mcp/`), separate from your normal one, on a
  `--remote-debugging-pipe` (no pollable port). A stale instance blocks
  `list_pages` — kill the `chrome-devtools-mcp` chrome process, then retry.
- **Synthetic clicks don't drive SharePoint's React UI** — `el.click()` and
  dispatched events silently fail to open column-header flyouts / command
  menus. Use the MCP `click` tool by uid; for deep multi-step panels (e.g.
  Quick Steps editor) hand the click to the owner.
- SharePoint REST from the page: read-**POSTs** (e.g. `GetAllRules()`) need
  `X-RequestDigest` from `POST /_api/contextinfo` (403 "security validation"
  without). Deletes often need params in the **query string**, not a JSON body.
- PowerShell has here-strings (`@'...'@`) but **not bash `<<EOF` heredoc
  redirection** (parse error) — write multi-line git commit / PR bodies to a
  temp file and use `git commit -F file` / `gh pr create --body-file file`.
