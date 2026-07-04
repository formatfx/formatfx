/**
 * The verdict policy: given what the sandbox rendered and what SharePoint
 * rendered, decide pass or fail. This is the one real design decision in
 * the harness, and it's deliberately isolated here.
 *
 * The scaffold default below is the strictest thing that can honestly pass:
 * texts must match exactly; backgrounds must match exactly WHEN both sides
 * painted one. A side that painted nothing ('none') doesn't fail the run —
 * it lands in `notes` for human review instead, because a missing probe is
 * usually a probe-selector problem (SharePoint's list DOM shifts), not an
 * engine divergence.
 *
 * TODO(owner): calibrate this after the first real tenant run. Knobs worth
 * considering once you've seen live data:
 *   - Color tolerance: SharePoint themes can nudge hex values (e.g. section
 *     backgrounds re-tinted by theme slots). Exact rgb() equality may be too
 *     strict — a small per-channel delta (±2?) may be right. Too loose and
 *     the harness stops catching real engine drift; that's the trade-off.
 *   - Should a 'none' background on ONE side fail instead of note? Once the
 *     SP probe selectors are proven stable, flipping that to a failure makes
 *     the harness strictly stronger.
 *   - Whitespace/casing in text: Excel-style formatters sometimes differ in
 *     locale rendering (dates, numbers). Exact match is right for the
 *     status-pill fixture; date fixtures will need a looser rule.
 */
import type { CellProbe } from './probes';

export interface Verdict {
  pass: boolean;
  /** Human-readable line per finding — failures AND soft observations. */
  notes: string[];
}

export function verdict(sandbox: CellProbe[], sharepoint: CellProbe[]): Verdict {
  const notes: string[] = [];
  let pass = true;

  if (sandbox.length !== sharepoint.length) {
    return { pass: false, notes: [`row count differs: sandbox ${sandbox.length}, SharePoint ${sharepoint.length}`] };
  }

  sandbox.forEach((sb, i) => {
    const sp = sharepoint[i];
    if (sb.text !== sp.text) {
      pass = false;
      notes.push(`row ${i}: text differs — sandbox "${sb.text}" vs SharePoint "${sp.text}"`);
    }
    if (sb.background === 'none' || sp.background === 'none') {
      const sides = [sb.background === 'none' ? 'sandbox' : '', sp.background === 'none' ? 'SharePoint' : '']
        .filter(Boolean).join(' and ');
      notes.push(`row ${i}: background unprobed on the ${sides} side — check probe selectors before trusting color results`);
    } else if (sb.background !== sp.background) {
      pass = false;
      notes.push(`row ${i}: background differs — sandbox ${sb.background} vs SharePoint ${sp.background}`);
    }
  });

  if (notes.length === 0) notes.push('all probes match exactly');
  return { pass, notes };
}
