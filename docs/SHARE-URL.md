# The FormatFX share-URL contract

> The stable, third-party-buildable encoding behind the **Share** button.
> Written for anyone who wants to mint "open this live in FormatFX" links —
> sample galleries, blog posts, docs, bots — without asking us first.
> Stability promises are at the bottom; they are the point of this page.

## What a share link is

A share link carries an **entire FormatFX workspace inside the URL
fragment** — formatter, column schema, mock rows, theme. There is no server
component and no id lookup: the fragment *is* the payload.

```
https://formatfx.dev/#w1=7VbNbts4EH4Vgqe2sB07...
```

Because the payload rides in the fragment (`#…`), **it is never sent in any
HTTP request** — not to formatfx.dev's host, not to anyone. The workspace
travels only between the two browsers involved. For an audience whose
schemas and sample data can be sensitive, that is a feature, and the Share
dialog says so out loud.

## Fragment grammar

```
#<scheme>=<base64url payload>
```

| Scheme | Payload bytes | Notes |
| ------ | ------------- | ----- |
| `w1`   | `deflate-raw`-compressed UTF-8 JSON | The default. Compression is the browser-native `CompressionStream('deflate-raw')`. |
| `w1r`  | raw UTF-8 JSON | Fallback for engines without Compression Streams. Longer, always valid. |

- **base64url**: the URL-safe alphabet (`A–Z a–z 0–9 - _`), **no padding**.
  Decoders must tolerate padded input.
- Every FormatFX build that understands share links understands **both**
  schemes, forever. A future incompatible encoding would be `w2=…`; `w1`
  links keep working.
- Any other fragment (`#some-anchor`) is ignored — FormatFX never
  misinterprets ordinary anchors.

## Payload JSON — two accepted shapes

### 1. A project file (what the Share button sends)

Exactly the FormatFX project format (`formatfx-project.json`, the same JSON
"Save project" downloads):

```json
{
  "version": 1,
  "doc":    { "kind": "column | row | tile | grid", "root": { "elmType": "…" } },
  "fields": [ { "name": "Status", "type": "choice", "choices": ["…"] } ],
  "rows":   [ { "Status": "Done" } ],
  "currentFieldName": "Status",
  "columnRefs": { "Status": { "elmType": "…" } },
  "viewName": "View 1"
}
```

`doc`, `fields` and `rows` are required; everything else is optional and
additive. Whitespace is irrelevant — minify for shorter links.

### 2. A bare formatter JSON (the docs-runtime bridge)

Any valid SharePoint formatter JSON — a **column formatter** (element root
with `elmType`), a **view formatter** (`rowFormatter` wrapper), or a **tile
formatter** (`formatter` wrapper). Exactly what sits in a
[pnp/List-Formatting](https://github.com/pnp/List-Formatting) sample file.

FormatFX synthesizes a plausible workspace around it: default columns plus a
text stub for every `[$Field]` the formatter references, and generated
sample rows. This is what makes a repo of `.json` samples linkable as a
gallery of live editors **without transforming the files at all**.

Anything that is neither shape fails with a plain-language error on open —
links never half-load.

## Minting a link

**In the app (2 steps from any PnP sample):** paste the sample's JSON into
the Advanced pane → *Apply to canvas*, then **Share → Copy link**. Or skip
the wrapper entirely — encode the raw sample per the grammar above.

**In Node (≥18) or any modern browser, zero dependencies:**

```js
async function formatfxLink(json) {
  const bytes = new Blob([new TextEncoder().encode(json)]).stream()
    .pipeThrough(new CompressionStream('deflate-raw'));
  const packed = new Uint8Array(await new Response(bytes).arrayBuffer());
  const b64 = btoa(String.fromCharCode(...packed))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  return `https://formatfx.dev/#w1=${b64}`;
}
```

(The in-repo reference implementation is `src/core/share.ts`; its unit tests
in `src/core/share.test.ts` are the executable spec.)

## The badge

README-droppable markdown for a sample:

```markdown
[![Open live in FormatFX](https://img.shields.io/badge/FormatFX-open%20live-0078d4)](https://formatfx.dev/#w1=…)
```

or, dependency-free:

```markdown
**[▶ Open this sample live in FormatFX](https://formatfx.dev/#w1=…)** — edit it against mock data, no tenant needed.
```

## What the recipient experiences (safety contract)

Opening a share link **never overwrites the recipient's autosaved work**:

1. The shared workspace loads with autosave paused — read-until-you-act.
2. A banner offers **Save a copy** (their previous autosave is backed up to
   an additive `….bak` key first, restorable from the ☰ menu) or
   **Discard** (their own work reloads; nothing was ever written).
3. The fragment is stripped from the address bar after a successful load,
   so a refresh doesn't resurrect stale shared state.

Link builders can rely on this: it is always safe to hand someone a
FormatFX link.

## Size guidance

Compressed typical workspaces are a few hundred to a few thousand
characters. The in-app dialog warns above **8,000 characters** (chat apps
and older proxies truncate long URLs) and offers fallbacks — share without
mock rows, or share the project file. If you mint links programmatically,
apply the same judgement; a truncated link fails loudly on open, but a
too-long link is better replaced by the project file.

## Stability promises

1. **`w1` and `w1r` never change meaning.** Future encodings get new scheme
   names; old links decode forever.
2. **The payload schema only grows additively.** `loadProject` tolerates
   missing keys and ignores unknown ones — a `w1` link minted today still
   loads after future project-format additions (this is pinned by unit
   tests).
3. **Both payload shapes (project file / bare formatter) stay accepted.**
4. **Fragments stay server-invisible.** The app will never move share
   payloads into the query string or a backend.
