# Licensing

FormatFX is **dual-licensed**. You may use it under **either**:

1. the **GNU Affero General Public License v3.0 (AGPL-3.0-only)** — the open-source
   terms in [`LICENSE`](./LICENSE); **or**
2. a **commercial license** purchased from the author, for teams that cannot or do
   not want to comply with the AGPL.

Copyright © 2026 Sam Yost. All rights reserved except as granted by the license you choose.

---

## Which one applies to me?

### Just using formatfx.dev
Nothing to do. Visiting the hosted app, laying out formatters, and copying the
generated SharePoint JSON out imposes **no obligations on you**. The JSON you
export is your own work product — it is not covered by this license, and you can
use it anywhere, including in closed/commercial projects.

### Self-hosting, forking, or modifying the code (AGPL track)
The AGPL is a strong **copyleft** license. In plain terms, if you run a **modified**
version of FormatFX and let anyone interact with it **over a network** (an intranet
counts), AGPL **§13** requires you to offer those users the **complete corresponding
source** of your modified version, under the AGPL. Redistribution triggers the same
obligation. You are free to do all of this — the only condition is that your changes
stay open under the same terms.

### Embedding FormatFX in a proprietary product or SaaS (commercial track)
If you want to build FormatFX (in whole or part — including its rendering/serializer
engine) into a **closed-source** product or a hosted service **without** the AGPL
source-disclosure obligations, you need a **commercial license**. This is the intended
path for ISVs, consultancies shipping white-labeled tooling, and enterprises whose
policy prohibits AGPL in their stack.

A commercial license can also bundle:

- **Self-hosted / private-cloud deployment** — run FormatFX entirely inside your own
  tenant so **list data never leaves your network** (built for regulated M365 shops).
- **Priority support** with a named contact and an agreed response window.
- **SSO** and deployment assistance.

**To purchase or ask which track fits:** open a GitHub issue on
[`formatfx/formatfx`](https://github.com/formatfx/formatfx) or contact the author.

---

## Contributors

Contributions are accepted under an inbound=outbound model **plus** a grant that lets
the author offer the commercial license above — this is what keeps the dual-license
model (and therefore the sustainably-funded open track) intact. See
[`CONTRIBUTING.md`](./CONTRIBUTING.md), or open a discussion before your first
substantial PR if the contributor terms there are still being finalized.

---

## Source availability (AGPL §13)

The hosted instance at **formatfx.dev** links to its exact source revision from the
app's About/footer, satisfying the AGPL §13 obligation to offer source to network
users. Any fork that is served over a network must do the same.

> This document explains the licensing in plain language for convenience. If it ever
> conflicts with [`LICENSE`](./LICENSE) or a signed commercial agreement, those
> controlling documents govern. This is not legal advice.
