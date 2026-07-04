/**
 * The finding taxonomy — the controlled "what it looks like" vocabulary.
 *
 * Every finding gets ONE of these labels, whether it came from the
 * automated verdict (verdict.ts stamps its notes with them) or from the
 * reviewing agent's own eyes (the /visual-compare skill requires labeling).
 * Labeled findings accumulate in findings.jsonl (committed), so weeks and
 * months of runs can be assessed for recurring gotchas and baked back into
 * rules — the whole point is that the vocabulary stays STABLE and SMALL.
 * Add a label only when a finding genuinely fits nothing here, and say so
 * in the PR.
 */
export type FindingLabel =
  | 'text-content'        // the words differ (wrong branch, wrong field, engine divergence)
  | 'text-locale'         // same meaning, different rendering (dates, number formats)
  | 'color-family'        // clearly different color (blue vs red) — a real divergence
  | 'shade-drift'         // same color family, different shade (theming, tolerated)
  | 'pixel-mismatch'      // crops disagree beyond the limit for a non-color reason
  | 'pixel-drift'         // crop disagreement within tolerance (noted, tolerated)
  | 'size-drift'          // the painted element's box differs (padding, radius, bar length)
  | 'wrap-truncation'     // SP's real column widths wrap/clip what the sandbox showed whole
  | 'missing-element'     // one side rendered something the other omitted entirely
  | 'probe-unprobed'      // a probe found no painted surface — usually a selector problem
  | 'hover-card-missing'  // customCardProps card opened on one side only
  | 'hover-card-differs'  // both cards opened but render differently
  | 'click-no-effect'     // a click target (customRowAction / inlineEditField) did nothing
  | 'click-effect-differs'// both sides reacted to the click, differently
  | 'provision-skip'      // the harness couldn't fabricate part of the workspace (person/lookup…)
  | 'provision-error'     // a SharePoint write failed during setup
  | 'harness-bug';        // the difference was the harness's fault, not the surfaces'

/** One-line "what it looks like" gloss per label — the human meaning. */
export const LABEL_GLOSS: Record<FindingLabel, string> = {
  'text-content': 'the words are different',
  'text-locale': 'same value, formatted differently',
  'color-family': 'plainly a different color',
  'shade-drift': 'same color, slightly different shade',
  'pixel-mismatch': 'the crops just don\'t look alike',
  'pixel-drift': 'nearly identical, minor pixel noise',
  'size-drift': 'same content, different box',
  'wrap-truncation': 'text wraps or clips on SharePoint',
  'missing-element': 'something rendered on one side only',
  'probe-unprobed': 'the harness could not find the painted element',
  'hover-card-missing': 'the hover card only appears on one side',
  'hover-card-differs': 'both hover cards appear but look different',
  'click-no-effect': 'clicking did nothing',
  'click-effect-differs': 'clicking did different things',
  'provision-skip': 'part of the workspace could not be recreated',
  'provision-error': 'SharePoint refused a setup write',
  'harness-bug': 'the harness itself was wrong',
};

/** A labeled note — the shape verdict.ts emits and findings.jsonl stores. */
export interface LabeledNote {
  label: FindingLabel;
  message: string;
}
