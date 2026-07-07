# Quick Steps & Rules — the SharePoint API, and how FormatFX should relate to it

> Written 2026-07-07 during the inline-edit / actions research thread
> (issue #214). **Status: PARTIALLY closed.** The API mechanics in §2–§4
> are verified against a live tenant by a third party (365Automate) and
> line up with our own action model, so treat them as settled *reference*.
> The items in **§6 (Open / unverified)** are NOT closed — they need a run
> on a real tenant with a Quick Steps column before anything ships. Do not
> promote §6 to "closed" without that verification, and do not re-derive
> §2–§4 from scratch (that's the whole point of writing it down — cf.
> HANDOFF §3, CONNECTIVITY §1).

## 1. Why this doc exists

Microsoft shipped **Quick Steps** to SharePoint Lists & Libraries (Targeted
Release mid-Feb 2026, GA early March 2026; roadmap MC1234549): a column type
that renders one-click, colored per-row action buttons, each with its own
conditional display rule and action (draft email, Teams chat, request
approval, run a flow, set a column value). This overlaps FormatFX's own
`customRowAction` vocabulary (#204) and the inline-edit / `setValue` work
(#212), so we need a settled position on how to relate to it.

The owner's original instinct — "you can only get the identifier from dev
tools, but our extension runs in the authenticated session so it could read
the keys and let a generated formatter trigger the user's Quick Steps" — is
partly superseded by a better finding: **the identifier is available from a
normal authenticated REST call, and the actions map onto primitives we
already emit, so the robust path is read-and-reproduce, not
trigger-by-scraped-id.**

## 2. The central fact — a Quick Step IS a Rule

Rules and Quick Steps share one backend (`SP.SPListRule`). A Quick Step is
simply a Rule whose trigger is a button press (`TriggerType = 5`), rather
than a list-item event. (Rules are Microsoft's replacement for **Alerts,
retiring July 2026** — a growing, invested-in area, so this is
future-aligned, not a dead end.)

Source (verified on a live tenant): **Breakdown of the SharePoint API for
List Rules & Quick Steps** — 365Automate, Jonathan Cardy,
`https://www.365automate.com/posts/sharepoint-rules-quicksteps-api/`.

## 3. Reading Quick Steps (the endpoint the bridge should call)

One endpoint returns both Rules and Quick Steps:

```
POST /_api/web/lists(guid'{list.Id}')/GetAllRules()
Content-Type: application/json
Body: { "includeQuicksteps": true, "includeAutomaticRules": true }
```

This is a normal SharePoint REST call our Tier-0/Tier-1 bridge already speaks
(raw REST over ~6 endpoints, `src/bridge/spClient.ts`). It is **read-only** (it
mutates nothing), so it belongs in `captureSnapshot` as an additive, versioned
capture target on the List Snapshot format (CONNECTIVITY §3.1). **The identifier
is therefore NOT dev-tools-only** — the "scrape it from the DOM" limitation is
an authoring-UX gap in the native product, not a data gap for us.

> **Implementation note — `GetAllRules()` is a read-POST, and that's fine now.**
> Unlike the field/view/item captures, `GetAllRules()` is a **POST** (a POST
> that *reads*). Per the **2026-07-07 owner decision** (CONNECTIVITY §8), the
> old "extraction stays GET-only" constraint is retired in favor of "extraction
> stays **read-only** (no mutation)" — so a read-POST like this is explicitly
> allowed in the capture path; no verb gymnastics needed. The snippet's
> no-write-verbs test *will become* a no-*mutation*-verbs test (a read-POST
> passes; a data-changing MERGE/POST does not — those stay the confirm-first
> deploy path) **in the read-side implementation PR** — **today the snippet and
> its tests still enforce literal GET-only**, so this note describes the policy
> the implementation will realize, not current behavior. Route the Rules/Quick
> Steps read wherever is cleanest (`spClient`/the extension is the natural home).

### 3.1 Response shape (the fields that matter)

Each entry (verbatim field names):

| field | meaning |
|---|---|
| `ID` | GUID of the rule/quick step |
| `RuleTemplateId` | GUID; **equal to `ID`** in the observed sample (confirm on a multi-step list — see §6) |
| `Title` | human sentence ("…set the value in field Status to In Progress") |
| `Condition` | a `[$Field] == 'x'` expression — **our dialect** (`dialect.ts` territory) |
| `TriggerType` | enum (§3.2) — `5` = QuickStepCommand for Quick Steps |
| `ActionType` | enum (§3.2) — `0` for Rules, a 5-digit code for Quick Steps |
| `ActionParams` | escaped JSON string; the action's payload (§4) |
| `Outcome` | rules only; `null` for Quick Steps |
| `IsActive`, `Owner`, `CreateDate`, `LastModifiedDate` | metadata |

Observed Quick Step (a set-field-value step named "Start Work"):

```jsonc
{
  "ID": "f92c6088-7265-4ee6-9960-3fada450050e",
  "RuleTemplateId": "f92c6088-7265-4ee6-9960-3fada450050e",
  "Title": "…set the value in field Status to In Progress",
  "Condition": "[$Status] == 'New'",
  "TriggerType": 5,     // QuickStepCommand
  "ActionType": 10002,  // SetItemFieldValue
  "ActionParams": "{\"QuickstepTitle\":\"Start Work\",\"ItemData\":\"{\\\"Status\\\":{\\\"values\\\":[\\\"In Progress\\\"],\\\"valueType\\\":0}}\"}",
  "Outcome": null
}
```

### 3.2 Enumerations (verbatim from the source)

```
TriggerType:
  ItemCreated          = 0
  ItemDeleted          = 1
  Unknown              = 2   // not present in the UX
  ItemModified         = 3
  ItemDateDeltaReached = 4
  QuickStepCommand     = 5   // <-- Quick Steps

ActionType:
  None               = 0       // all Rules use 0
  ExecuteItemFlow    = 10001   // FlowId in ActionParams
  SetItemFieldValue  = 10002   // ItemData in ActionParams
  DraftEmail         = 10003   // email props in ActionParams
  StartTeamsChat     = 10004   // TeamsRecipients etc in ActionParams
  Unknown            = 10005   // not present in the UX
  ExecuteListFlow    = 10006   // FlowId in ActionParams
```

## 4. FormatFX's position — read-and-reproduce (primary), trigger-by-id (secondary)

The decisive finding: **every Quick Step action maps onto a `customRowAction`
primitive FormatFX already emits.** So rather than baking an undocumented id
into a shipped formatter, we read the Quick Step and **regenerate an
equivalent native action**, carrying its `Condition` over to the button's
visibility expression.

| Quick Step `ActionType` | ActionParams payload | FormatFX reproduction |
|---|---|---|
| `10001` ExecuteItemFlow | `FlowId` | `executeFlow` — see the FlowId mapping below |
| `10002` SetItemFieldValue | `ItemData` (per-field values) | `setValue` — `ItemData` → our `actionInput` (the #212 multi-field form) |
| `10003` DraftEmail | email props | `link` → `mailto:` (best-effort; some fidelity lost) |
| `10004` StartTeamsChat | `TeamsRecipients`… | `link` → `https://teams.microsoft.com/l/chat/…` deep link |
| `10006` ExecuteListFlow | `FlowId` | `executeFlow`-style, same FlowId mapping (list-scoped; verify semantics) |

**Exact `FlowId` → `executeFlow` mapping (don't get this wrong — it's
lint-gated).** FormatFX's `executeFlow` does NOT take a bare flow id. Our
`actionParams` is a **JSON *string*** shaped `{"id":"<FlowId>"}`, and the
`flow-missing-id` linter rule (`src/core/linter.ts`) rejects anything without a
`"id":"…"` — so a copy/paste of the raw Quick Step `FlowId` would fail the
linter and the deploy gate. Concretely, a Quick Step's `ActionParams.FlowId`
becomes:

```jsonc
"customRowAction": {
  "action": "executeFlow",
  "actionParams": "{\"id\":\"<the FlowId value from the Quick Step>\"}"
}
```

(This is what `applyTriggerAt` already emits via `JSON.stringify({ id })` —
`src/editor/triggerBind.ts`. The reproduction must reuse that, not hand-build
the string.)

Why reproduce beats reference:
- **Refuse-don't-guess / definitely-works.** The reproduction depends only on
  documented `customRowAction` primitives, not on an unversioned id scraped
  from the DOM or an undocumented REST field. Nothing fragile ships.
- **It reinforces #212.** A Quick Step's `Condition` + `ItemData` is exactly a
  condition-gated, multi-field `setValue` — the machinery #212 already
  proposes building. The two efforts share the emitter.
- **Portability.** A reproduced action works on any tenant; a Quick Step id is
  list-specific and non-transferable.

The **direct-trigger-by-id** path (a `customRowAction` that invokes an
existing Quick Step by its `ID`/`RuleTemplateId`, Chris Kent's demo) stays a
*secondary, opt-in, explicitly-warned* option, reserved for actions we cannot
cleanly reproduce (DraftEmail / StartTeamsChat, if the deep-link reproduction
is judged too lossy). It carries the §6 stability risk and must never be the
default.

## 5. Authoring / deploy (stretch — Q6)

Creation is a sibling endpoint (note: **different** `ActionParams` shape from
the read — a `results` array of `{Key, Value, ValueType}`):

```
POST /_api/web/lists(guid'{list.Id}')/CreateRuleEx()
```

So FormatFX could eventually surface **Rules & Quick Steps in the Data tab**
alongside views and fields — read via `GetAllRules()`, tweak color / condition
/ action, deploy via `CreateRuleEx()` — reusing the confirm-first, lint-gated
deploy discipline (CONNECTIVITY §3.3). Out of scope until the read/reproduce
path ships; recorded so the write endpoint isn't re-discovered later.

## 5.1 Auth — restates the closed CONNECTIVITY §1 reality

From the source, verbatim in effect:

> "A SharePoint bearer access token is required. It must use an **end-user
> identity**… It will **not** work if you use an application-identity token.
> The rule will be created — but it won't do anything!!"

This is our closed auth constraint confirmed by a third party: only code in
the user's own authenticated browser session works — no app registration, no
tenant admin. The bridge / companion extension is the right (and only)
vehicle. Do not burn a session re-deriving this (CONNECTIVITY §1).

## 6. Open / unverified — needs a live tenant with a Quick Steps column

These are NOT closed. The CI-unverifiable slice (same class as the
CONNECTIVITY §3.6 one-time on-tenant checklist):

1. **`ID` vs `RuleTemplateId`.** They're equal in the single observed sample.
   Confirm whether they diverge on a list with several Quick Steps, and which
   one the (secondary) direct-trigger path must reference.
2. **`ItemData` encoding for non-text fields.** The sample shows a Choice-ish
   `{"Status":{"values":["In Progress"],"valueType":0}}`. Capture real
   examples for **choice, person, date, number, boolean, lookup, and
   multi-value** fields so the `setValue` reproduction is faithful — record
   each field type's `valueType` code and value shape. (Cross-check against
   our field-type union in `src/core/types.ts`.)
3. **Chris Kent's exact `customRowAction` JSON** to invoke a Quick Step by id
   — the action name and `actionParams`/`actionInput` shape. Only needed if we
   pursue the secondary direct-trigger path. His community-call demo was never
   posted; search the PnP Microsoft 365 & Power Platform Community Call
   archives by date, and his `customrowaction` / `actionparams` tag pages.
4. **`GetAllRules()` through the extension.** Confirm it rides the page's form
   digest / `activeTab` context like our other bridge calls (expected yes; the
   deploy path already POSTs with `X-RequestDigest`).
5. **`DraftEmail` / `StartTeamsChat` ActionParams shapes** — the exact keys
   (subject/body/recipients, item-link token) so the `mailto:` / Teams
   deep-link reproduction is faithful, or so we know it's too lossy and must
   fall back to trigger-by-id.
6. **The native Quick Steps column formatter itself.** When a list has a Quick
   Steps column, what does its `CustomFormatter` (if any) look like, and does
   our extractor already capture it as a field? Determines whether "mirror the
   whole column" is even needed or whether we only ever reproduce individual
   actions.

## 7. House-rule fit

- **Reads mutate nothing.** `GetAllRules()` is a read-only call (a read-POST,
  explicitly allowed since the 2026-07-07 GET-only→read-only decision —
  CONNECTIVITY §8); any `CreateRuleEx()` write is a separate, later,
  confirm-first + lint-gated motion (§5).
- **No new auth surface.** Everything inside the closed CONNECTIVITY §1 model:
  the user's authenticated session, the extension under `activeTab`.
- **Zero runtime deps; `src/bridge` stays dependency-free, commented,
  auditable.** The new capture is a few more lines of raw REST, node-tested
  like the rest of the bridge.
- **Versioned protocol.** Quick Steps/Rules capture rides a List Snapshot
  `version` bump; older builds ignore the new key.
- **Refuse-don't-guess.** Ship the reproduce path (documented primitives);
  gate trigger-by-id behind a clear "uses an undocumented identifier" warning.

## 8. Tenant verification checklist (read **and** creation)

The runnable probe that closes §6 and proves the write path. **Run on a
throwaway list you own — not production, not real data.** Reads are read-only;
creation/edit/delete are writes on the scratch list and must be cleaned up
(step L). Writes here exercise the **deploy/write tier**, which was always
allowed to mutate — they do not contradict the read-only *extraction* decision
(§7 / CONNECTIVITY §8); they stay confirm-first + lint-gated when they become a
FormatFX feature. Same CI-unverifiable discipline as CONNECTIVITY §3.6.

### 8.1 Setup
Add a Quick Steps column and create 5–6 steps spanning action types
(SetItemFieldValue, ExecuteItemFlow, DraftEmail, StartTeamsChat) and field
types (Choice, Person, Date, Number, Yes/No, Lookup, and a multi-value one),
plus a multi-field set step and ≥2 display conditions (equals, not-empty,
date). Also create one automatic **Rule** so `GetAllRules()` returns both.

### 8.2 Read probe (read-only)
Run `GetAllRules()` (§3) with **both** `odata=nometadata` and `odata=verbose`;
save both full responses (redact names/emails). Then answer:

- **A. Response format** — nometadata shape: are results under `.value` vs the
  verbose `.d.GetAllRules.results`? Field casing preserved? (Drives the
  `spClient` parser.)
- **B. Condition fidelity** — exact `Condition` string per rule; does it match
  our `[$Field] == 'x'` dialect and round-trip through `dialect.ts`? How does
  "not empty"/negation serialize — confirm `!=`/comparisons, **not** a NOT
  operator (SharePoint has no logical NOT — HANDOFF §3).
- **C. Button visuals** — where are per-step color, label/title, icon, order
  stored (ActionParams? a column-schema blob? `QuickstepTitle`)?
- **D. Read permission** — member vs owner to read `GetAllRules()`.
- **E. Absence/edge** — response on a list with no quick steps; a document
  library; a list where the feature isn't enabled (so the bridge degrades with
  a teaching message, not a crash).
- **F. Extension context** — the read-POST works from the extension's
  page-context content script with the page form digest (no extra auth beyond
  `captureSnapshot`). Validates the 2026-07-07 read-only decision end-to-end.
- Plus the §6 items: **6.1** ID vs RuleTemplateId (and what RuleTemplateId
  points at); **6.2** ItemData shape + `valueType` per field type; **6.3** Chris
  Kent's trigger-by-id `customRowAction` JSON; **6.5** DraftEmail/StartTeamsChat
  ActionParams + item-link tokenization; **6.6** whether the Quick Steps column
  carries a CustomFormatter the extractor already captures.

### 8.3 Creation / write tests (throwaway list only)
- **H. Create a Rule** — `POST …/CreateRuleEx()` with the `results`-array
  `ActionParams` (Key/Value/ValueType, §5), e.g. an ItemModified rule that sets
  a field. Capture the exact request body + response. Then `GetAllRules()` and
  confirm the round-trip. **Document BOTH shapes** — the create-side
  (`results` array) and the read-side (flat escaped-JSON string) differ.
- **I. Create a Quick Step** — same endpoint, `triggerType 5` +
  `SetItemFieldValue (10002)` carrying `ItemData`. Confirm the button appears in
  the view and, when clicked, actually writes the field. Proves the full
  author→fire loop (Q6 / §5).
- **J. Create each action type** — repeat for `ExecuteItemFlow (10001)` (needs a
  FlowId), `DraftEmail (10003)`, `StartTeamsChat (10004)`; capture each one's
  create-side `ActionParams` key set so we can *generate* them, not just read.
- **K. Discover delete + update endpoints** — in devtools Network, delete and
  edit a step via the UI and capture the endpoints (likely `RemoveRule`/
  `DeleteRule` + an update call) and their bodies. Needed for cleanup and for
  the read→edit→deploy story.
- **L. Clean up** — delete every rule/quick step created here (via K's
  endpoint); confirm `GetAllRules()` returns to its pre-probe state. Leave the
  tenant as you found it.
- **M. Write permission** — permission level `CreateRuleEx()` needs (member vs
  owner); pairs with D → CONNECTIVITY §3.4 table.

### 8.4 Deliverable
Move each verified item from §6 into §3/§4 as settled reference (with the real
captured shapes) and mark it closed; fold A–M findings into the relevant
sections; document the create-side AND read-side `ActionParams` shapes for every
action type (we need both to read AND author). Leave anything unverified in §6
with a why. Commit on a branch off `main`, open a PR referencing #214. **Never**
paste real tenant URLs, GUIDs, names, or emails — redacted/placeholder values
only.

## 9. Related

- #214 — the research spike this doc answers (findings in its comments).
- #212 — inline-edit / multi-field `setValue`; shares the emitter with the
  Quick Step reproduce path.
- #204 — the `customRowAction` trigger/action vocabulary this extends.
- CONNECTIVITY §1 (auth), §3 (the bridge), §3.6 (the on-tenant checklist
  discipline §8 mirrors), §8 (the read-only decision).
