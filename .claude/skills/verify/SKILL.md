---
name: verify
description: Build/launch/drive recipe for verifying FormatFX changes at the running app — dev server, the maker-view gotchas, and the multi-session port trap.
---

# Verifying FormatFX changes in the running app

## Launch

- `npx vite --port 5199 --strictPort` from the checkout/worktree under test.
  Do NOT use `npm run dev -- --port 5199` from PowerShell — the flag gets
  eaten and vite treats `5199` as a ROOT DIRECTORY (serves 500s).
- **Multi-session machine trap**: another session's dev server usually owns
  5173, and Playwright's `reuseExistingServer` will happily attach to it and
  test THEIR code. Always use a private port; for the e2e suite set
  `PW_PORT` (playwright.config.ts honors it).

## Getting to the surfaces

- The app lands in maker view: the JSON side pane is hidden. Click the
  topbar **JSON** button first; `#wb-json-kebab` / `#wb-kind` live in the
  side pane's head kebab.
- Fastest row view: JSON pane kebab → `#wb-kind` select → `row`.
- The View settings kebab is `.wb-viewcard-kebab` on the THIS VIEW card
  heading; its panel is `.wb-viewkebab` (body-owned, `position:fixed`).
- Mock rows carry `data-sp-path`; the JSON pane textarea `#wb-json-text`
  mirrors the document live — assert emitted JSON there.

## Gotchas

- The Playwright/chrome MCP browser profile PERSISTS localStorage per
  origin (port included) — collapse states, autosaved projects and theme
  survive across sessions. `localStorage.clear(); location.reload()` for a
  clean slate before judging default UI state.
- MCP screenshots save relative to the MCP server's cwd, not yours —
  `Get-ChildItem -Recurse -Filter <name>.png` to find them.
- Undo probes: `mutateDocument` has a no-op guard — applying the same
  preset/toggle twice must NOT add an undo step (one Ctrl+Z clears it).
