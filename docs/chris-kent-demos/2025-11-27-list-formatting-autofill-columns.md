# List Formatting Tips & Tricks — Autofill Columns — Chris Kent

- **Date:** 2025-11-27
- **Presenter:** Chris Kent (Takeda) — Microsoft MVP
- **Source video:** Microsoft 365 & Power Platform community call — 27th of November 2025 — https://www.youtube.com/watch?v=Khr1ERjRyR4
- **Segment:** 31:23 – 51:37
- **Source note:** Walkthrough reconstructed from the video's auto-generated captions. On-screen JSON is described rather than transcribed verbatim.

## Summary
Chris combines SharePoint's AI **Autofill Columns** (pay-as-you-go) with list formatting: an Autofill column generates text from each uploaded document via a prompt, and a column format then turns that text into a loading state plus an **AI-generated image** (using the free `pollinations.ai` URL API), wired up so SharePoint's image-hotlinking restrictions are handled correctly.

## Walkthrough
Demo context (Thanksgiving): a "gobble" turkey site; he creates a fresh document library `gobbly`.

### 1. Enable & create an Autofill column
1. Autofill is a **pay-as-you-go** AI feature. Enable it in the **admin center → Setup → Billing/licenses**: activate pay-as-you-go services, then under **Org settings → Pay-as-you-go services** link an **Azure subscription**. **Autofill columns** can be on tenant-wide or scoped to **selected sites** (how he enabled his).
2. Add a **text** column; the create dialog now shows an **Autofill** option.
3. How it works: you upload a document → the AI reads it → your **prompt** answers against it → the result fills the column.

### 2. Prompt engineering the column
1. Name the column (`turkey`); the **column name is automatically used as context**, so it pre-suggests "Extract information about turkey mentioned in the document."
2. He overrides it with a deliberately silly prompt: *"What is a fun occupation of someone who would like to read this document."* Testing against an uploaded manual returns e.g. "military technology enthusiast."
3. To control output shape he prepends **"only respond with…"** (vs. "respond with…", which answers the first question too), landing on: *"only respond with an image generation prompt of a turkey dressed as this occupation."* Saving makes the column start autofilling.
4. Uploads are queued; **autofill can take a while** (queue + processing). You can check **Autofill columns → View recent activity**, or trigger **Autofill** manually.

### 3. A loading-state column format
Once it's "just a text column," you can format it and reference it elsewhere.
1. Build a `div` 128×128px box (turn on the **SP Formatter** extension's enhanced/auto-preview, free for Edge/Chrome / works in VS Code).
2. Nest children: a loading indicator using `iconName` **`ProgressRingDots`** (icon name found by searching a site like **Fluent UI's icon list** for "load"), sized up with class `ms-fontSize-XXL`, plus a `div` with text `Gobble`.
3. Apply flexbox styles (`display:flex`, `flexDirection:column`, centered) so it reads as a tidy loading card while the AI value is empty.

### 4. Overlay an AI-generated image
1. Add an `img` child with a `src` and a `title` of `@currentField` (so the generated prompt shows as the tooltip). A broken image confirms the title wiring.
2. **Image hotlinking is blocked by default** — pasting a `dummyimage.com` URL doesn't render; inspecting (F12) shows it's blocked as an *untrusted source*.
3. Use **`pollinations.ai`** — free, no API key — which generates an image from a URL: `https://image.pollinations.ai/prompt/<prompt>` plus query params `width=128&height=128&enhance=true` and (with a free GitHub-linked account) `nologo=true&private=true`.
4. **Fix hotlinking:** go to **Site Settings → HTML Field Security** (under Site Collection Administration) and add the `image.pollinations.ai` domain (the same setting that governs external iframes also governs image hotlinking in formats). He explicitly cautions: only trust domains you vet — this is a dev tenant.
5. In the final format, the top element gets `overflow:hidden`, a border radius, and `position:relative`; the image is `position:absolute` and shown only when the `turkey` value exists (loading card otherwise).
6. **Stable images via seed:** append `&seed=<number>` bound to the item's **Modified date**, so the same image is returned until the item changes (rather than regenerating each load).

## Key takeaways
- **Autofill Columns** is AI, **pay-as-you-go** — enable via admin pay-as-you-go + an Azure subscription; scope tenant-wide or to selected sites.
- The **column name seeds the prompt context**; steer output with phrasing like **"only respond with…"**.
- An Autofill column is "just text" afterward — **format it and reference it** like any column.
- Show a **loading state** while the queued AI value is pending (it can be slow).
- Generate images on the fly with **`pollinations.ai`** (free, no key); pass `width`/`height`/`enhance`, and a **`seed`** (e.g. tied to Modified date) for stability.
- External images are blocked until you allow the domain in **Site Settings → HTML Field Security** — vet domains carefully.
- Tooling: **SP Formatter** extension; Fluent UI icon search for `iconName` values.
