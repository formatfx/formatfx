/**
 * The actual pixels. pixelmatch is the same comparison engine Playwright's
 * own toHaveScreenshot uses; we call it directly because we're comparing two
 * LIVE crops (sandbox vs SharePoint) rather than a live shot against a
 * stored golden file.
 *
 * These are the harness's only dependencies (dev-only, owner-approved
 * 2026-07-04): pixelmatch + pngjs. The runtime app stays at zero.
 */
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

export interface ImageDiff {
  /** Mismatched pixels / compared pixels, 0..1, over the padded common canvas. */
  mismatchRatio: number;
  /** Absolute size difference between the two crops, in px. */
  widthDelta: number;
  heightDelta: number;
  /** sandbox | SharePoint | diff, side by side — attach this for human review. */
  triptych: Buffer;
}

/** Copy an image onto a canvas at (dx, dy), on white (diff crops have transparent padding). */
function blit(canvas: PNG, img: PNG, dx: number, dy: number): void {
  PNG.bitblt(img, canvas, 0, 0, img.width, img.height, dx, dy);
}

function onWhite(width: number, height: number): PNG {
  const png = new PNG({ width, height });
  png.data.fill(255);
  return png;
}

/**
 * Compare two PNG crops. The crops are NOT resized — scaling would smear the
 * very anti-aliasing differences we're measuring. The smaller crop sits
 * top-left on a white canvas of the larger size, so a genuine size drift
 * shows up both in the deltas and as a mismatched border region.
 */
export function diffCrops(sandboxPng: Buffer, sharepointPng: Buffer): ImageDiff {
  const a = PNG.sync.read(sandboxPng);
  const b = PNG.sync.read(sharepointPng);
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);

  const ca = onWhite(width, height); blit(ca, a, 0, 0);
  const cb = onWhite(width, height); blit(cb, b, 0, 0);
  const diff = new PNG({ width, height });

  const mismatched = pixelmatch(ca.data, cb.data, diff.data, width, height, {
    threshold: 0.1, // per-pixel color sensitivity (pixelmatch default)
    includeAA: false, // different font rasterization must not count as drift
  });

  const triptych = onWhite(width * 3 + 2, height); // 1px white gutters
  blit(triptych, ca, 0, 0);
  blit(triptych, cb, width + 1, 0);
  blit(triptych, diff, width * 2 + 2, 0);

  return {
    mismatchRatio: mismatched / (width * height),
    widthDelta: Math.abs(a.width - b.width),
    heightDelta: Math.abs(a.height - b.height),
    triptych: PNG.sync.write(triptych),
  };
}
