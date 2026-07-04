import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Everything tenant-specific arrives via the environment — never the repo. */
export const SP_SITE_URL = (process.env.SP_SITE_URL ?? '').replace(/\/+$/, '');
export const SP_LIST = process.env.SP_LIST ?? 'FormatFX Visual Compare';

/** Your signed-in session, bottled by `npm run visual:auth`. Git-ignored. */
export const STATE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)), '.auth', 'sp-state.json');

export function hasAuthState(): boolean {
  return fs.existsSync(STATE_PATH);
}

/**
 * The rows both surfaces render — mirrors the sandbox's default mock data so
 * [$Status]-driven fixtures light up the same branches on both sides.
 */
export const ROWS = [
  { Title: 'Ship the sandbox', Status: 'In Progress' },
  { Title: 'Fix the blocker', Status: 'Blocked' },
  { Title: 'Write the docs', Status: 'Done' },
] as const;
