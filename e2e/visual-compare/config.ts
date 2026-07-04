import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Everything tenant-specific arrives via the environment — never the repo. */
export const SP_SITE_URL = (process.env.SP_SITE_URL ?? '').replace(/\/+$/, '');
export const SP_LIST = process.env.SP_LIST ?? 'FormatFX Visual Compare';

/**
 * The workspace to compare: a FormatFX share link ("the URL IS the
 * workspace"). Paste the link the app's Share button mints — include data —
 * to compare YOUR design. Left unset, the harness mints one from the app's
 * default workspace, so every run exercises the share codec too.
 */
export const SP_SHARE_URL = process.env.SP_SHARE_URL ?? '';

/** Your signed-in session, bottled by `npm run visual:auth`. Git-ignored. */
export const STATE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)), '.auth', 'sp-state.json');

export function hasAuthState(): boolean {
  return fs.existsSync(STATE_PATH);
}
