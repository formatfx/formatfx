# Handoff: Chris Kent demo videos → Markdown

**Goal:** For each of the 5 community-call videos below, extract **only Chris Kent's
demo section** and convert it into a standalone Markdown file.

**Source channel:** Microsoft Community Learning (YouTube), channel
`UC_mKdhw-V6CeCM7gTo_Iy7w` — the recurring "Microsoft 365 & Power Platform
Development Community Call" recordings.

**Important:** In videos #3–#5 Chris Kent's demo is a *segment within a longer
multi-presenter call*, not the whole video. The downstream agent must locate his
segment (via the YouTube chapter list / description timestamps, or the
warner.digital recap for that date) and convert **only that span**.

---

## The 5 videos (newest first)

### 1. May 21, 2026 — "List Formatting Tips & Tricks"
- Video URL: **TODO — not yet resolved** (open the channel uploads, find the
  May 21, 2026 call). warner.digital recap confirms the demo exists.
- Extract: Chris Kent's "List Formatting Tips & Tricks" segment.
- Suggested output: `2026-05-21-list-formatting-tips-and-tricks.md`

### 2. Mar 19, 2026 — "Extending Available Icons in Fluent UI with SPFx"
- Video URL: **TODO — not yet resolved** (find the Mar 19, 2026 call).
  warner.digital recap confirms the demo exists.
- Extract: Chris Kent's "Extending Available Icons in Fluent UI with SPFx" segment.
- Suggested output: `2026-03-19-extending-fluent-ui-icons-spfx.md`

### 3. Nov 27, 2025 — "List Formatting Tips & Tricks"
- Video URL: https://www.youtube.com/watch?v=Khr1ERjRyR4
- Extract: Chris Kent's "List Formatting Tips & Tricks" segment.
- Suggested output: `2025-11-27-list-formatting-tips-and-tricks.md`

### 4. Aug 14, 2025 — "List Formatting Tips & Tricks"
- Video URL: https://www.youtube.com/watch?v=YpJ77QNudPk
- Extract: Chris Kent's "List Formatting Tips & Tricks" segment.
- Suggested output: `2025-08-14-list-formatting-tips-and-tricks.md`

### 5. Jul 31, 2025 — "List Formatting Tips & Tricks"
- Video URL: https://www.youtube.com/watch?v=wAPHJhh0eyE
- Extract: Chris Kent's "List Formatting Tips & Tricks" segment.
- Suggested output: `2025-07-31-list-formatting-tips-and-tricks.md`

---

## Per-file Markdown template (suggested)

```md
# <Demo title> — Chris Kent

- **Date:** <call date>
- **Presenter:** Chris Kent (Microsoft MVP)
- **Source video:** <YouTube URL>
- **Segment:** <start–end timestamp>

## Summary
<1–2 sentence overview of what the demo covered>

## Walkthrough
<step-by-step of the demo, in order, with any JSON snippets shown>

## Key takeaways
- ...
```

---

## Open items the downstream agent must resolve
1. **Two missing watch-URLs (#1, #2):** the May 21 and Mar 19, 2026 full-call
   recordings — locate via the channel's uploads or the warner.digital recap
   pages for those dates.
2. **In-video timestamps:** Kent's segment boundaries inside each full-call
   recording (#3–#5 especially) — pull from the YouTube description/chapters or
   the warner.digital recap.
3. Fetch constraint seen during research: youtube.com, pnp.github.io, and
   warner.digital all returned **HTTP 403** to automated fetches; transcripts may
   need a different retrieval path (e.g. an authenticated/browser route or the
   YouTube transcript API).
