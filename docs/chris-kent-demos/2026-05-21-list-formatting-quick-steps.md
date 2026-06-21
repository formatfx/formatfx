# List Formatting Tips and Tricks — Using Quick Steps to Increase Productivity — Chris Kent

- **Date:** 2026-05-21
- **Presenter:** Chris Kent (Takeda) — Microsoft MVP
- **Source video:** Microsoft 365 & Power Platform community call — 21st of May 2026 — https://www.youtube.com/watch?v=MLHHzzOtQpI
- **Segment:** 36:57 – 51:55
- **Source note:** Walkthrough reconstructed from the video's auto-generated captions. On-screen JSON/configuration is described rather than transcribed verbatim.

## Summary
Chris shows how SharePoint's **Quick Steps** feature lets you build reusable, button-style item actions (set value, copy/move, execute flow, approvals) through a UI instead of hand-writing list-formatting JSON — and then how to surface those Quick Steps inside a column format with the `executeQuickStep` custom row action so makers keep control of the look while end users own the underlying logic.

## Walkthrough
Demo context: a "warrior horses" **War Parties** list tracking which battle herd members belong to and the planned attack type (ambush vs. direct assault).

1. **What Quick Steps are.** Under the list's command bar there's a **Quick Steps** option. Chris has pre-defined several. Example: a **Volunteer** quick step does a *Set value* on the `Warriors` column to **append the current user**; it can also overwrite/remove. Quick steps support **conditional display** — e.g. hide *Volunteer* when the user is already in the list, and show *Abandon* only when they are.
2. **Creating quick steps.** *New quick step* offers Set value plus, on document libraries, **Move to** / **Copy to**, and (if approvals are on) an approvals step. He notes the list "will grow — hint hint." All of these could be done by hand in list formatting, "but why do this formatting if you don't have to?"
3. **The Quick Steps column type.** Rather than make users select an item and hunt through the *Integrate* menu (whose buttons move around and are hard to document), you can add a dedicated **Quick Steps** column. He adds a `Volunteer` column and an `Abandon` column, each bound to its quick step, with limited color choices (green for volunteer, red for abandon) — and laments that you **can't pick a theme color** here. Conditions defined on the quick step carry through automatically.
4. **Why go further — the `executeQuickStep` action.** Two side-by-side buttons per quick step gets wide fast. So he adds a **hidden `Action` column** with a list format. Using the **SP Formatter** browser extension (free for Edge/Chrome — bigger editor window, auto-preview), the format uses a `customRowAction` whose action is **`executeQuickStep`**, identified by a **`ruleTemplateId`** GUID.
5. **Finding the `ruleTemplateId`.** Open DevTools → the **SharePoint** tab provided by the **SP Editor** extension → **List properties** → select the list. The Quick Steps properties (which is what makes them travel with the list) include the **rule template IDs**. Copy the GUID. (Alternatives: query via PowerShell/PnPjs, or read the list-properties XML through the API. There's no easier built-in way yet.) You can also override the class set for colors here to get theme colors.
6. **Payoff in the format.** With the `ruleTemplateId` wired in, a single compact icon column replaces the two big columns: Volunteer / Abandon, a *Discussion* action (a `mailto:` link), and **Execute flow** quick steps. Because there are multiple flows (direct assault vs. ambush), the format conditionally shows the correct flow button per row status — instead of forcing users into *Integrate → Flows* and seeing every flow.
7. **Disable vs. hide.** Rather than hiding a button until prerequisites are met (which generates "where's that button?" support calls), keep it **always present but disabled** until valid — so the right action is always in the same place.
8. **Separation of concerns.** Because the format only references the `ruleTemplateId`, an admin can later **edit the quick step** (e.g. change the flow's button text from "direct assault" to "murder my enemies", or repoint a Move action to a different library) through the visual Quick Steps editor **without touching the JSON**. "You can be the JSON editor and let your users be the controllers of the actual actions."
9. **Conditional display pattern.** The format simply uses a `displayExpression` on the whole object: if the current user (`@me`) is in the warriors email list, hide one icon and show the other. Doing it at the object level (vs. per-icon) keeps each action editable separately.

## Key takeaways
- **Quick Steps** give makers a no-JSON UI for Set value, Copy/Move, Execute flow, and Approvals actions, and they travel with the list.
- Use a **Quick Steps column** to avoid the select-item-then-hunt-the-menu pattern; conditions defined on the step carry through.
- The **`executeQuickStep` custom row action** (keyed by a `ruleTemplateId` GUID) lets you embed quick steps inside a polished column format. Get the GUID from **SP Editor → SharePoint tab → List properties**.
- This decouples presentation (your JSON) from logic (the user-editable quick step) — far easier than hand-escaping `actionParams` JSON for execute-flow actions.
- Prefer **disabling** a contextual button over hiding it, so its position stays predictable.
- Tools referenced: **SP Formatter** (editing) and **SP Editor** (inspecting list properties), both free for Edge/Chrome.
