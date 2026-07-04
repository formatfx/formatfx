/**
 * The verdict policy: given what the sandbox rendered and what SharePoint
 * rendered, decide pass or fail. This is the one real design decision in
 * the harness, and it's deliberately isolated here.
 *
 * Owner-set posture (2026-07-04): LENIENT ON SHADE, STRICT ON SUBSTANCE.
 * Text must match exactly; colors only fail when they're a different color
 * FAMILY (per-channel delta beyond COLOR_DELTA_LIMIT); pixel mismatch only
 * fails past PIXEL_MISMATCH_LIMIT of the crop. Everything softer than a
 * failure still lands in `notes`, and the triptychs are always attached —
 * the report is built for human eyes first.
 *
 * TODO(owner): calibrate the two limits after the first real tenant run —
 * tighten until a run you'd call "wrong" fails and a run you'd call "fine"
 * passes. Date/number fixtures may also need a looser TEXT rule (locale
 * rendering differs); that's a third knob to add when it bites.
 */
import type { CellProbe } from './probes';
import type { LabeledNote } from './labels';

/** Max per-channel rgb delta that still counts as "the same color, whatever". */
export const COLOR_DELTA_LIMIT = 80;
/** Max fraction of mismatched pixels in a crop pair before it's a failure. */
export const PIXEL_MISMATCH_LIMIT = 0.25;

export interface CellComparison {
  /** Field internal name + 0-based row, e.g. "Status[1]". */
  label: string;
  sandbox: CellProbe;
  sharepoint: CellProbe;
  /** From imageDiff.diffCrops, when both crops exist. */
  pixel?: { mismatchRatio: number; widthDelta: number; heightDelta: number };
}

export interface Verdict {
  pass: boolean;
  /** One labeled line per finding — failures AND soft observations. The
   *  label is the stable taxonomy findings.jsonl accumulates over months
   *  (labels.ts); the message is for humans. */
  notes: LabeledNote[];
}

/** Per-channel distance between two computed rgb()/rgba() strings; null when unparsable. */
function colorDelta(a: string, b: string): number | null {
  const parse = (c: string): number[] | null => {
    const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(c);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const pa = parse(a); const pb = parse(b);
  if (!pa || !pb) return null;
  return Math.max(Math.abs(pa[0] - pb[0]), Math.abs(pa[1] - pb[1]), Math.abs(pa[2] - pb[2]));
}

export function verdict(cells: CellComparison[]): Verdict {
  const notes: LabeledNote[] = [];
  let pass = true;

  for (const c of cells) {
    if (c.sandbox.text !== c.sharepoint.text) {
      pass = false;
      notes.push({ label: 'text-content', message: `${c.label}: text differs — sandbox "${c.sandbox.text}" vs SharePoint "${c.sharepoint.text}"` });
    }

    const sb = c.sandbox.background; const sp = c.sharepoint.background;
    if (sb === 'none' || sp === 'none') {
      const sides = [sb === 'none' ? 'sandbox' : '', sp === 'none' ? 'SharePoint' : ''].filter(Boolean).join(' and ');
      notes.push({ label: 'probe-unprobed', message: `${c.label}: background unprobed on the ${sides} side — check probe selectors before trusting color results` });
    } else if (sb !== sp) {
      const delta = colorDelta(sb, sp);
      if (delta === null || delta > COLOR_DELTA_LIMIT) {
        pass = false;
        notes.push({ label: 'color-family', message: `${c.label}: different color family — sandbox ${sb} vs SharePoint ${sp}${delta === null ? '' : ` (Δ${delta})`}` });
      } else {
        notes.push({ label: 'shade-drift', message: `${c.label}: shade drift within tolerance — ${sb} vs ${sp} (Δ${delta} ≤ ${COLOR_DELTA_LIMIT})` });
      }
    }

    if (c.pixel) {
      const pct = (c.pixel.mismatchRatio * 100).toFixed(1);
      if (c.pixel.mismatchRatio > PIXEL_MISMATCH_LIMIT) {
        pass = false;
        notes.push({ label: 'pixel-mismatch', message: `${c.label}: crops disagree on ${pct}% of pixels (limit ${PIXEL_MISMATCH_LIMIT * 100}%) — see the triptych` });
      } else if (c.pixel.mismatchRatio > 0) {
        notes.push({ label: 'pixel-drift', message: `${c.label}: pixel drift ${pct}% within tolerance (size Δ ${c.pixel.widthDelta}×${c.pixel.heightDelta}px)` });
      }
    }
  }

  if (notes.length === 0) notes.push({ label: 'pixel-drift', message: 'all probes and crops match' });
  return { pass, notes };
}