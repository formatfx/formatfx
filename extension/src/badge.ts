/**
 * badge.ts — the toolbar badge as one pure mapping table. The background
 * service worker computes a BadgeInput per tab event and this decides what
 * the badge shows; keeping the decision here (not in background.ts) makes
 * every state combination unit-testable from the root suite.
 *
 * Precedence: a staged apply waiting for a click beats everything (it is the
 * one state where the user has an action pending); then connected-list
 * presence; then the formatfx.dev marker.
 */
import type { PageKind } from './pageKind';

export interface BadgeInput {
  kind: PageKind;
  /** The tab's origin is a connected (permission-granted) SharePoint site. */
  connected: boolean;
  /** Number of formatters in the staged apply, 0 when nothing is staged. */
  stagedCount: number;
}

export interface BadgeState {
  text: string;
  /** CSS color for setBadgeBackgroundColor; '' when text is empty. */
  color: string;
  title: string;
}

const TITLE = 'FormatFX companion';

export function badgeFor(input: BadgeInput): BadgeState {
  const onList = input.kind === 'sharepoint';
  // A staged apply is actionable exactly where Apply staged works: a list page.
  if (onList && input.stagedCount > 0) {
    return {
      text: String(Math.min(input.stagedCount, 99)),
      color: '#c2410c', // orange: action waiting behind your click
      title: `${TITLE} — ${input.stagedCount} staged formatter${input.stagedCount === 1 ? '' : 's'} ready to apply`,
    };
  }
  if (onList && input.connected) {
    return { text: '●', color: '#15803d', title: `${TITLE} — connected to this site` };
  }
  if (input.kind === 'formatfx') {
    return { text: 'FX', color: '#4f46e5', title: `${TITLE} — FormatFX tab` };
  }
  // Site pages on a connected tenant, unconnected SP pages, everything else:
  // no badge. The default posture is silence.
  return { text: '', color: '', title: TITLE };
}
