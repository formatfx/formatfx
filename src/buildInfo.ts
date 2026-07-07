// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0 (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * buildInfo.ts — the runtime view of the build-time constants injected by
 * vite.config.ts (`define`). The About modal reads `BUILD_INFO`; nothing else
 * touches the raw globals. In `npm run dev` the rev is the working HEAD; if git
 * is unavailable the rev is "dev" and the optional fields fall away.
 */
import { PRODUCT_NAME } from './branding';

// Injected by vite.config.ts `define` (textually replaced at build time).
declare const __APP_VERSION__: string;
declare const __BUILD_REV__: string;
declare const __BUILD_DATE__: string;
declare const __REPO_URL__: string | null;
declare const __LAST_PR__: { number: number; title: string; url: string } | null;

export interface BuildInfo {
  name: string;
  version: string;
  rev: string;
  date: string;
  repoUrl: string | null;
  commitUrl: string | null;
  pr: { number: number; title: string; url: string } | null;
}

export const BUILD_INFO: BuildInfo = {
  name: PRODUCT_NAME,
  version: __APP_VERSION__,
  rev: __BUILD_REV__,
  date: __BUILD_DATE__,
  repoUrl: __REPO_URL__,
  commitUrl: __REPO_URL__ && __BUILD_REV__ !== 'dev' ? `${__REPO_URL__}/commit/${__BUILD_REV__}` : null,
  pr: __LAST_PR__,
};
