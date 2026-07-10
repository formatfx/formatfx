# Quick Steps & Rules — the SharePoint API, and how FormatFX should relate to it

> Written 2026-07-07 during the inline-edit / actions research thread
> (issue #214). **Status: VERIFIED on a live tenant (2026-07-07).** §2–§5 are
> now settled *reference* — the shapes below were captured on a throwaway list
> in the owner's tenant (devtools + read/write REST), not just from a
> third-party post. Most of the former §6 open items are closed and folded in;
> what remains genuinely unverified is listed in §6 with a why. Do not
> re-derive §2–§5 from scratch (that's the point of writing it down — cf.
> HANDOFF §3, CONNECTIVITY §1). **Never paste real tenant URLs, GUIDs, names, or
> emails** — everything here is redacted/placeholder.

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
future-aligned, not a dead end.) The "alert" vocabulary still leaks through in
error messages — see the delete quirk in §5.6.

Sources: **Breakdown of the SharePoint API for List Rules & Quick Steps** —
365Automate, Jonathan Cardy, `https://www.365automate.com/posts/sharepoint-rules-quicksteps-api/`;
plus our own live-tenant capture (2026-07-07, §8).

## 3. Reading Quick Steps (verified)

One endpoint returns both Rules and Quick Steps:

```
POST /_api/web/lists(guid'{list.Id}')/GetAllRules()
Accept: application/json;odata=nometadata      (or ;odata=verbose)
Content-Type: application/json
X-RequestDigest: {form digest}                 ← REQUIRED (see §3.3)
Body: { "includeQuicksteps": true, "includeAutomaticRules": true }
```

This is a normal SharePoint REST call our Tier-0/Tier-1 bridge already speaks
(raw REST over ~6 endpoints, `src/bridge/spClient.ts`). It is **read-only** (it
mutates nothing), so it belongs in `captureSnapshot` as an additive, versioned
capture target on the List Snapshot format (CONNECTIVITY §3.1). **The identifier
is therefore NOT dev-tools-only** — the "scrape it from the DOM" limitation is
an authoring-UX gap in the native product, not a data gap for us.

> **Implementation note — `GetAllRules()` is a read-POST, and that's fine.**
> Unlike the field/view/item captures, `GetAllRules()` is a **POST** (a POST
> that *reads*). Per the **2026-07-07 owner decision** (CONNECTIVITY §8), the
> old "extraction stays GET-only" constraint is retired in favor of "extraction
> stays **read-only** (no mutation)" — so a read-POST like this is explicitly
> allowed in the capture path. **LANDED (#214):** `spClient.captureSnapshot`
> and the extract snippet both read rules (best-effort — a failure records
> `rulesError`/warns and never kills the capture), and the snippet/spClient
> tests now enforce no-*mutating*-request instead of literal GET-only.

### 3.1 Response shape (verified — read side)

**A. Response format (verified).** nometadata puts the rules under **`.value`**;
verbose puts them under **`.d.GetAllRules.results`** (with a
`__metadata.type: "Collection(SP.SPListRule)"`). Field names are **PascalCase in
both** modes. This drives the `spClient` parser: read `body.value` for
nometadata, `body.d.GetAllRules.results` for verbose.

Each entry (verbatim field names, all confirmed present):

| field | meaning |
|---|---|
| `ID` | GUID of the rule/quick step |
| `RuleTemplateId` | GUID; **equal to `ID` in every case observed** (UI-created ×3, API-created ×1). This is the value the direct-trigger `customRowAction` references (§4). |
| `Title` | human sentence ("Show a command that will, for a selected item, if its Status is Not started, set the value…") |
| `Condition` | expression (§3.4) — mostly our dialect, with two divergences |
| `TriggerType` | enum (§3.2) — `5` = QuickStepCommand for Quick Steps |
| `ActionType` | enum (§3.2) — `10002`/`10003`/`10004` for Quick Steps; `10002` also usable on automatic rules |
| `ActionParams` | **flat escaped-JSON STRING** (read side) — differs from the create side (§5.2) |
| `Outcome` | rules only; `null` for Quick Steps |
| `IsActive`, `Owner`, `CreateDate`, `LastModifiedDate`, `LastModifiedBy` | metadata (`LastModifiedBy` may be `null`) |

Observed Quick Step (set-field-value, two fields, redacted):

```jsonc
{
  "ID": "00000000-1111-2222-3333-444444444444",
  "RuleTemplateId": "00000000-1111-2222-3333-444444444444",   // == ID
  "Title": "Show a command that will, for each selected item, if its Status is Not started, set the value in 2 fields: Status, Progress",
  "Condition": "[$Status] == 'Not started'",
  "TriggerType": 5,        // QuickStepCommand
  "ActionType": 10002,     // SetItemFieldValue
  "ActionParams": "{\"QuickstepTitle\":\"Start Work\",\"ItemData\":\"{\\\"Status\\\":{\\\"values\\\":[\\\"In Progress\\\"],\\\"valueType\\\":33},\\\"Progress\\\":{\\\"values\\\":[\\\"50\\\"],\\\"valueType\\\":8}}\"}",
  "Outcome": null,
  "IsActive": true,
  "Owner": "Redacted, Owner"
}
```

### 3.2 Enumerations (verified against live data)

```
TriggerType:
  ItemCreated          = 0
  ItemDeleted          = 1
  Unknown              = 2   // not present in the UX
  ItemModified         = 3   // ← confirmed: our API-created automatic rule
  ItemDateDeltaReached = 4
  QuickStepCommand     = 5   // ← confirmed: all three UI Quick Steps

ActionType:
  None               = 0       // all classic Rules use 0
  ExecuteItemFlow    = 10001   // FlowId in ActionParams  (NOT captured — §6)
  SetItemFieldValue  = 10002   // ItemData in ActionParams (confirmed)
  DraftEmail         = 10003   // email props in ActionParams (confirmed)
  StartTeamsChat     = 10004   // TeamsRecipients etc (confirmed)
  Unknown            = 10005   // not present in the UX
  ExecuteListFlow    = 10006   // FlowId in ActionParams  (NOT captured — §6)
```

### 3.3 Read permission & digest (verified — answers D & F)

- **The read-POST REQUIRES `X-RequestDigest`.** Without a valid form digest it
  returns **403** with `"The security validation for this page is invalid…"`.
  With a digest from `POST /_api/contextinfo` it returns 200. This confirms
  **F**: the read rides the page's form digest exactly like our other bridge
  POSTs — no extra auth beyond what `captureSnapshot` already holds. Route the
  Rules/Quick Steps read wherever is cleanest (`spClient`/the extension).
- **D (read permission level):** verified working as **site owner / site
  collection admin**. Member-level read is *unverified* (we only had one account
  on the tenant) — expected to work since it is a pure read, but do not claim it
  as tested (§6).

### 3.4 Condition fidelity (verified — answers B)

Real captured `Condition` strings, one per action, and how they relate to our
`dialect.ts`:

| what the UI expressed | captured `Condition` | dialect fit |
|---|---|---|
| Choice **equals** | `[$Status] == 'Not started'` | ✅ exact match to our `[$Field] == 'x'` |
| Text **not empty** (API rule) | `[$Project] != ''` | ✅ **`!=` comparison, NOT a logical NOT** — confirms HANDOFF §3 (SharePoint has no NOT) |
| Date **is before now** | `Date([$DueDate]) < Date('@now')` | ⚠️ wraps fields in `Date(...)` and uses the `@now` token — **diverges** from our plain `[$Field]` form; round-tripping dates needs a `Date()`/`@now` adapter |
| Person-multi **contains** | `indexOf([$AssignedTo.title], 'Yost, Sam D.') >= 0` | ⚠️ uses `indexOf(...) >= 0` and the `.title` sub-property — **diverges**; reproduction must emit the `indexOf` idiom, not `==` |

Takeaway for **B**: equals/not-empty round-trip cleanly through our dialect;
**date and person-contains conditions use SharePoint-specific idioms**
(`Date()`/`@now`, `indexOf(...).title`) that `dialect.ts` must recognize or
normalize before it can claim a faithful round-trip. Negation is always a
comparison (`!=`, `>= 0`), never a NOT operator — spec confirmed on live data.

### 3.5 Button visuals & ordering (verified — answers C)

Per-step **color, label, and order are NOT on the rule** — they live in the
**column mapping**, stored two places (both captured):

1. The list **RootFolder property bag**, key **`QuickstepsProperties`** — a JSON
   string with three top-level keys: `Quicksteps` (array of rule snapshots),
   `QuickstepsOrdering`, and `ColumnMapping`.
2. Written via the **`SetColumnMapping()`** endpoint (§5.4).

The `ColumnMapping` entry per step (redacted):

```jsonc
{
  "QuickSteps": [{
    "RuleTemplateId": "00000000-1111-2222-3333-444444444444",
    "BackgroundColor": "sp-css-backgroundColor-BgCornflowerBlue",
    "FontColor": "sp-css-color-CornflowerBlueFont"
  }]
}
```

- **Color:** the `sp-css-backgroundColor-*` / `sp-css-color-*` class-name pair
  (the same SP theme-color token family FormatFX already emits).
- **Label / title:** `QuickstepTitle` inside the rule's `ActionParams` (e.g.
  `"Start Work"`), NOT in the mapping.
- **Order:** array position in `ColumnMapping.QuickSteps` plus the
  `QuickstepsOrdering` array.

So to mirror a Quick Steps column faithfully we need **both** the rules
(`GetAllRules`) **and** the column mapping (property bag / `SetColumnMapping`).

### 3.6 Absence / edge behavior (verified — answers E)

- **List with no quick steps:** `{"value":[]}` (nometadata) /
  `{"d":{"GetAllRules":{"__metadata":{"type":"Collection(SP.SPListRule)"},"results":[]}}}`
  (verbose). Clean empty, no error — the bridge can treat "no rules" as an empty
  array, not an error path.
- **Document library** (BaseTemplate 101): `GetAllRules()` returns **200 with
  `{"value":[]}`** — the endpoint is valid on libraries, they just had no rules.
  So the bridge should offer the capture on libraries too.
- **Feature-not-enabled list:** *not encountered* — Quick Steps is GA on this
  tenant, so we could not observe the disabled-feature response. Still unverified
  (§6); keep the teaching-degradation path defensive.

## 4. FormatFX's position — read-and-reproduce (primary), trigger-by-id (secondary)

The decisive finding stands and is now backed by captured payloads: **every
Quick Step action maps onto a `customRowAction` primitive FormatFX already
emits.** Rather than baking an undocumented id into a shipped formatter, we read
the Quick Step and **regenerate an equivalent native action**, carrying its
`Condition` over to the button's visibility expression.

| Quick Step `ActionType` | ActionParams (read) | FormatFX reproduction |
|---|---|---|
| `10001` ExecuteItemFlow | `FlowId` (unverified — §6) | `executeFlow` — see the FlowId mapping below |
| `10002` SetItemFieldValue | `ItemData` (per-field values) | `setValue` — `ItemData` → our `actionInput` (the #212 multi-field form) |
| `10003` DraftEmail | `EmailRecipients`, `EmailSubject`, `ItemLinkSelection` | `link` → `mailto:` (lossy — see §4.1) |
| `10004` StartTeamsChat | `TeamsRecipients`, `ItemLinkSelection` | `link` → Teams deep link (lossy — see §4.1) |
| `10006` ExecuteListFlow | `FlowId` (unverified) | `executeFlow`-style, list-scoped (verify semantics) |

**Exact `FlowId` → `executeFlow` mapping (don't get this wrong — it's
lint-gated).** FormatFX's `executeFlow` does NOT take a bare flow id. Our
`actionParams` is a **JSON *string*** shaped `{"id":"<FlowId>"}`, and the
`flow-missing-id` linter rule (`src/core/linter.ts`) rejects anything without a
`"id":"…"`. Concretely:

```jsonc
"customRowAction": {
  "action": "executeFlow",
  "actionParams": "{\"id\":\"<the FlowId value from the Quick Step>\"}"
}
```

(This is what `applyTriggerAt` already emits via `JSON.stringify({ id })` —
`src/editor/triggerBind.ts`. Reuse it, don't hand-build the string.)

### 4.1 DraftEmail / StartTeamsChat fidelity (verified — answers §6.5)

Captured create-side `ActionParams` (redacted):

```jsonc
// DraftEmail (10003)
{ "results": [
  { "Key": "QuickstepTitle",   "Value": "Email Sam", "ValueType": "String" },
  { "Key": "EmailRecipients",  "Value": "[{\"name\":\"Redacted\",\"email\":\"user@example.com\",\"userId\":\"i:0#.f|membership|user@example.com\",\"image\":\"https://…/userphoto.jpg?…\"}]", "ValueType": "String" },
  { "Key": "ItemLinkSelection","Value": "true", "ValueType": "String" },
  { "Key": "EmailSubject",     "Value": "Task needs attention", "ValueType": "String" }
]}

// StartTeamsChat (10004)
{ "results": [
  { "Key": "QuickstepTitle",   "Value": "Chat About", "ValueType": "String" },
  { "Key": "TeamsRecipients",  "Value": "[{\"name\":\"Redacted\",\"email\":\"user@example.com\",\"userId\":\"i:0#.f|membership|user@example.com\",\"image\":\"…userphoto.aspx…\"}]", "ValueType": "String" },
  { "Key": "ItemLinkSelection","Value": "true", "ValueType": "String" }
]}
```

Two fidelity facts that shape reproduction:

- **Recipients are STATIC people, not column-driven.** The authoring picker only
  accepts real directory people (it rejected a column name like "Owner" — "No
  results"). So a captured DraftEmail/Teams step targets fixed addresses, not a
  per-row `[$AssignedTo]`. A faithful reproduction is a fixed `mailto:`/deep-link
  address, and we **cannot** turn it into a per-row recipient without inventing
  behavior the native step never had.
- **The item link is a boolean toggle, not a body token.** There is **no body
  field and no `{item}` token**; `ItemLinkSelection: "true"` tells SharePoint to
  append the current item's link at send time. A `mailto:` reproduction cannot
  reproduce that server-side append cleanly → **the item-link portion is the
  lossy part.** DraftEmail has `EmailSubject` but no body; Teams has neither
  subject nor body.

Because recipients are static and the item-link is a server-side toggle, the
`mailto:` / Teams-deep-link reproduction is **acceptable for the recipient +
subject** but **loses the auto-appended item link** — this is exactly the
"some fidelity lost" the table flags. Where that loss is judged unacceptable,
fall back to the secondary trigger-by-id path.

### 4.2 The QuickSteps column has NO CustomFormatter (verified — answers §6.6)

The Quick Steps column is a **`Computed`** field
(`<Field Type="Computed" Format="Dropdown" IsModern="TRUE" …/>`) with
**`CustomFormatter": null`**. The button rendering is native to the Computed
field plus the column mapping (§3.5) — there is no formatter JSON to capture.

Consequences:
- Our extractor (`fields?$filter=Hidden eq false&$select=…,CustomFormatter,…`)
  **would** capture the field (it is not hidden), but its `CustomFormatter` is
  `null`, so **"mirror the whole column via a formatter" is not possible** — we
  can only ever reproduce individual actions as `customRowAction` buttons.
- This settles §6.6: don't try to round-trip a column formatter; there isn't one.

### 4.3 Direct-trigger-by-id (secondary — verified via community demo)

The direct-trigger path (a `customRowAction` that invokes an existing Quick Step
by id) is real. Chris Kent (Takeda) demoed it on the **PnP Microsoft 365 &
Power Platform Community Call, 2026-05-21** (recording youtu.be/MLHHzzOtQpI,
demo ~36:57; JSON visible in David Warner II's screenshot summary
warner.digital/summary20260521). Exact shape recovered from the demo:

```jsonc
{
  "elmType": "div",
  "attributes": { "iconName": "AddFriend", "title": "Volunteer" },
  "customRowAction": {
    "action": "executeQuickStep",
    "actionInput": { "ruleTemplateId": "<RuleTemplateId from GetAllRules>" }
  }
}
```

- **Action name: `executeQuickStep`** (camelCase). It is **not in the published
  v2 column-formatting schema** (Microsoft Learn lists only
  `defaultClick, share, delete, editProps, openContextMenu, setValue,
  executeFlow, embed`), so it is runtime-accepted but **unpublished** — his own
  editor shows a schema squiggle. Ship it only behind a clear "uses an
  undocumented identifier" warning.
- **The id is `ruleTemplateId`** (the REST `RuleTemplateId`, not `ID`). This
  closes the §6.1 question about *which* id the trigger path references: it is
  `RuleTemplateId`, which in every case we observed equals `ID`.
- `elmType` is `div`, not `button`.

This stays a **secondary, opt-in, explicitly-warned** option, reserved for
actions we cannot cleanly reproduce (DraftEmail / StartTeamsChat if the
deep-link reproduction is judged too lossy). It carries the §6 stability risk
(unversioned, list-specific, non-portable id) and must never be the default.

> Repo nit for the owner: `docs/HANDOFF.md` (~line 248) spells it
> `executeQuickstep` (lowercase s); the demo's canonical casing is
> `executeQuickStep`. Worth a one-char fix when HANDOFF is next touched.

## 5. Authoring / deploy (verified — create, fire, delete)

### 5.1 Create — `CreateRuleEx()` (verified)

```
POST /_api/web/GetList(@a1)/CreateRuleEx()?@a1='{server-relative list url}'
Accept: application/json;odata=verbose
Content-Type: application/json;odata=verbose
X-RequestDigest: {form digest}
```

Body (the create-side `ActionParams` is a **`results` array** of
`{Key, Value, ValueType}` — different from the read side, §5.2):

```jsonc
{
  "title": "Show a command that will, for each selected item, if its Status is Not started, set the value in 2 fields: Status, Progress",
  "condition": "[$Status] == 'Not started'",
  "triggerType": 5,                       // 5 = Quick Step; 3 = ItemModified automatic rule
  "action": {
    "ActionType": 10002,                  // SetItemFieldValue
    "ActionParams": {
      "results": [
        { "Key": "QuickstepTitle", "Value": "Start Work", "ValueType": "String" },
        { "Key": "ItemData",       "Value": "{\"Status\":{\"values\":[\"In Progress\"],\"valueType\":33},\"Progress\":{\"values\":[\"50\"],\"valueType\":8}}", "ValueType": "String" }
      ]
    }
  }
}
```

Response: `{"d":{"CreateRuleEx":"<new rule GUID>"}}` (verbose). Round-trip
confirmed — reading the new rule back via `GetAllRules()` returns it with the
create-side `results` array collapsed into the read-side flat string (§5.2).

**Create-side `ActionParams` key set per action type (so we can author, not
just read):**

| ActionType | create-side Keys (each `ValueType:"String"`) |
|---|---|
| `10002` SetItemFieldValue | `QuickstepTitle`, `ItemData` |
| `10003` DraftEmail | `QuickstepTitle`, `EmailRecipients`, `ItemLinkSelection`, `EmailSubject` |
| `10004` StartTeamsChat | `QuickstepTitle`, `TeamsRecipients`, `ItemLinkSelection` |
| `10001` ExecuteItemFlow | **unverified** — needs a real FlowId; expect `QuickstepTitle` + `FlowId` (§6) |
| automatic Rule (triggerType 3) | same envelope, `ActionType 10002`, `ItemData` |

### 5.2 Create-side vs read-side `ActionParams` (both documented)

They **differ** and both are needed:

- **Create side** (what you POST): a `results` array —
  `{"results":[{"Key":"QuickstepTitle","Value":"Start Work","ValueType":"String"}, …]}`.
- **Read side** (what `GetAllRules` returns): a **flat escaped-JSON string** with
  the array flattened to an object —
  `"{\"QuickstepTitle\":\"Start Work\",\"ItemData\":\"{…}\"}"`.

To author from a read: parse the read-side string → object, then re-emit each
key as a `{Key, Value, ValueType:"String"}` entry in a `results` array.

### 5.3 `ItemData` valueType codes (partially verified — §6.2)

`ItemData` is a nested escaped-JSON string, `{ "<Field>": {"values":[…],
"valueType": N} }`. Captured codes:

| field type | captured `valueType` | example `values` |
|---|---|---|
| Choice (single) | **33** | `["In Progress"]` |
| Number | **8** | `["50"]` |
| Yes/No (boolean) | **1** | `["1"]` |

> Note: the 365Automate sample had Choice as `valueType 0`; our live capture
> shows **33** for a single-choice field. Trust the live number.

**Not yet captured:** Person, Date, Lookup, multi-Choice/multi-Person, Currency.
The set-value UI in our probe only targeted Status (Choice), Progress (Number),
and IsUrgent (Yes/No). Capturing the rest needs another authoring pass that sets
those field types (§6.2). Cross-check against `src/core/types.ts`'s `FieldType`
union (`text|note|number|currency|choice|choiceMulti|date|person|personMulti|
boolean|hyperlink|lookup|lookupMulti`) when the remaining codes are captured.

### 5.4 Column create + mapping (verified)

Creating the Quick Steps **column** (native "Save" fires two calls):

```
POST …/Fields/CreateFieldAsXml   body: { parameters: {
  SchemaXml: "<Field DisplayName='Quick Steps' Format='Dropdown' IsModern='TRUE' Name='QuickSteps' Type='Computed'></Field>",
  Options: 12 } }
POST …/GetList(@a1)/SetColumnMapping()   body: {
  columnMapping: "{\"QuickSteps\":[{\"RuleTemplateId\":\"…\",\"BackgroundColor\":\"sp-css-backgroundColor-BgCornflowerBlue\",\"FontColor\":\"sp-css-color-CornflowerBlueFont\"}]}" }
```

`SetColumnMapping()` takes the mapping as a **stringified** JSON in a
`columnMapping` property; it returns `{"d":{"SetColumnMapping":null}}`. There is
no `GetColumnMapping()` (404) — read the mapping from the RootFolder property bag
`QuickstepsProperties` (§3.5) instead.

### 5.5 Fire the button — `$batch` → `ValidateUpdateFetchListItem` (verified — I)

Clicking a Quick Step button in the view fires:

```
POST /_api/$batch   (multipart/mixed changeset)
  → POST …/GetList(@a1)/items(@a2)/ValidateUpdateFetchListItem()
     body: { "formValues": [ {"FieldName":"Status","FieldValue":"In Progress"},
                             {"FieldName":"Progress","FieldValue":"50"} ],
             "bNewDocumentUpdate": false }
```

Confirmed end-to-end: clicking the "Start Work" button on a real item wrote
`Status = In Progress` and `Progress = 50` to that row (response
`UpdateResults` all `ErrorCode 0`). Full author→fire loop verified.

### 5.6 Delete — `DeleteRule(ruleId, triggerType)` (verified — K, and a trap)

The real delete endpoint (captured from the native "Delete quick step" button):

```
POST /_api/web/GetList(@a1)/DeleteRule(ruleId=@a2,triggerType=@a3)
     ?@a1='{list url}'&@a2='{rule GUID}'&@a3={triggerType}
X-RequestDigest: {form digest}
```

Params go in the **query string**, and **`triggerType` is required**. Returns
`200` (`{"odata.null":true}`). Verified: an API `DeleteRule(ruleId,triggerType=5)`
removed a live Quick Step and `GetAllRules()` returned to empty.

**Two traps, both learned the hard way and worth a linter/impl comment:**

1. **Wrong signature → 500 "The alert you are trying to access does not exist."**
   Passing `ruleId` in a JSON **body** without `triggerType` (the obvious first
   guess) fails with that misleading "alert" error even though `GetAllRules`
   lists the rule. Use the two-param query-string form above.
2. **Deleting the COLUMN does not delete the rules.** Removing the QuickSteps
   field (or clearing the column mapping) **orphans** the underlying `SP.SPListRule`
   objects — they keep coming back from `GetAllRules()` with no visible column.
   Delete each rule explicitly with `DeleteRule` *first*, then delete the column.
   (Cleanup order for any future probe: rules → mapping/column → fields.)

**Update endpoint: unverified.** Editing a step in the native panel + Save was
not cleanly isolated in the capture; it likely re-issues `CreateRuleEx` or an
update sibling. Capture it before building a read→edit→deploy story (§6).

### 5.7 Permissions for writes (partially verified — M)

`CreateRuleEx`, `SetColumnMapping`, `ValidateUpdateFetchListItem`, and
`DeleteRule` all succeeded as **site owner / site collection admin**. **Member-
level** write is *unverified* (single account on the tenant). Pairs with §3.3's
read-permission gap → CONNECTIVITY §3.4 table once a second account confirms it.

### 5.8 Auth — restates the closed CONNECTIVITY §1 reality

From the 365Automate source, confirmed by our capture: only an **end-user
identity** token works — an application-identity token creates the rule but it
**won't fire**. Everything above ran in the owner's own authenticated browser
session, no app registration, no tenant admin — the bridge / companion
extension is the right (and only) vehicle. Do not burn a session re-deriving
this (CONNECTIVITY §1).

## 6. Still open / unverified — needs another authoring pass

These are the genuine remainders (the CI-unverifiable slice, CONNECTIVITY §3.6
class). Everything else from the old §6 is now closed in §3–§5.

1. **`ItemData` valueType codes for Person, Date, Lookup, multi-value, Currency.**
   We have Choice = 33, Number = 8, Boolean = 1 (§5.3). Capture the rest by
   authoring set-value steps that target those field types.
2. **`ExecuteItemFlow` (10001) / `ExecuteListFlow` (10006) ActionParams.** Needs a
   real Flow on the tenant to author against; expect `QuickstepTitle` + `FlowId`
   but the exact key casing and any extra keys are unconfirmed.
3. **Update endpoint** for editing an existing rule/step (§5.6) — capture the
   native edit-Save call.
4. **Member-vs-owner permission** for both read (`GetAllRules`) and write
   (`CreateRuleEx`/`DeleteRule`) — needs a second, non-admin account (D & M).
5. **Feature-disabled list response** (§3.6 E) — could not observe on a
   GA-enabled tenant; keep the bridge's degrade-with-teaching path defensive.
6. **`SetColumnMapping` color palette** — we captured only the Cornflower Blue
   token pair; the full set of `sp-css-backgroundColor-*` / `sp-css-color-*`
   pairs the picker offers is not enumerated (nice-to-have for a faithful color
   round-trip).

## 7. House-rule fit

- **Reads mutate nothing.** `GetAllRules()` is a read-only call (a read-POST,
  explicitly allowed since the 2026-07-07 GET-only→read-only decision —
  CONNECTIVITY §8); every `CreateRuleEx`/`SetColumnMapping`/`DeleteRule` write is
  a separate, later, confirm-first + lint-gated motion (§5).
- **No new auth surface.** Everything inside the closed CONNECTIVITY §1 model:
  the user's authenticated session, the extension under `activeTab`, the page
  form digest (§3.3).
- **Zero runtime deps; `src/bridge` stays dependency-free, commented, auditable.**
  The new capture is a few more lines of raw REST, node-tested like the rest.
- **Versioned protocol.** Quick Steps/Rules capture rides the List Snapshot
  as **additive keys at v1** (`rules`, `rulesError`, `quickstepsProperties`);
  older builds ignore unknown keys, which is exactly what "additive" buys —
  a `version` bump would make older builds *refuse* the snapshot, so bumps
  stay reserved for breaking shape changes (decision recorded in #214).
- **Refuse-don't-guess.** Ship the reproduce path (documented primitives); gate
  `executeQuickStep` trigger-by-id behind a clear "undocumented identifier"
  warning (§4.3).

## 8. How this was verified (2026-07-07 live probe)

Run on a throwaway list the owner owns (redacted here), in the owner's
authenticated browser via the devtools bridge. Read probes were read-only;
create/fire/delete exercised the deploy/write tier and were **fully cleaned up**
(all probe rules `DeleteRule`'d, the Quick Steps / IsUrgent / RelatedProject
probe columns removed, the one fired item restored to its original values,
`GetAllRules()` back to `{"value":[]}`) — tenant left as found. Coverage:

- Read: `GetAllRules()` in nometadata **and** verbose; empty-list, document-
  library, and missing-digest (403) responses (§3).
- Create: three Quick Steps (SetItemFieldValue, DraftEmail, StartTeamsChat) via
  the native builder + one automatic Rule (ItemModified, not-empty condition) and
  one SetItemFieldValue rule via hand-crafted `CreateRuleEx` (§5.1).
- Fire: clicked a real button, confirmed the field write (§5.5).
- Delete: captured the native `DeleteRule(ruleId,triggerType)` call and
  reproduced it via API (§5.6).

Not covered (→ §6): ExecuteItemFlow, non-scalar `ItemData` valueTypes, the
update endpoint, member-level permissions, the feature-disabled response.

## 9. Related

- #214 — the research spike this doc answers.
- #212 — inline-edit / multi-field `setValue`; shares the emitter with the Quick
  Step reproduce path (its `ItemData`→`actionInput` mapping is §5.3's target).
- #204 — the `customRowAction` trigger/action vocabulary this extends.
- CONNECTIVITY §1 (auth), §3 (the bridge), §3.6 (the on-tenant checklist
  discipline §8 mirrors), §8 (the read-only decision).
