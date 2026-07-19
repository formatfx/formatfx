// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Sam Yost

/**
 * buildMeta.ts — pure helpers for the build-time "About" info.
 *
 * Used by vite.config.ts at build time (Node) to turn raw `git` output into the
 * constants the About modal shows. Kept dependency-free and side-effect-free so
 * it unit-tests cleanly and never reaches the runtime bundle.
 */

export interface MergePR {
  number: number;
  title: string;
}

/**
 * Parse a GitHub "Merge pull request" commit into its PR number + title.
 * GitHub's default merge commit is:
 *   subject: "Merge pull request #53 from owner/branch"
 *   body:    "<the PR title>"
 * Returns null when the subject isn't a PR merge.
 */
export function parseMergePR(subject: string, body: string): MergePR | null {
  const m = /^Merge pull request #(\d+) /.exec(subject.trim());
  if (!m) return null;
  const number = Number(m[1]);
  const title = body.trim().split('\n')[0].trim();
  return { number, title: title || `Pull request #${number}` };
}

/**
 * Normalize a git remote URL (ssh or https, with or without a trailing `.git`)
 * into its `https://host/owner/repo` browse URL. Returns null if unrecognized.
 */
export function repoHttpUrl(remote: string): string | null {
  const r = remote.trim();
  if (!r) return null;
  // ssh: git@github.com:owner/repo(.git)
  let m = /^git@([^:]+):(.+?)(?:\.git)?$/.exec(r);
  if (m) return `https://${m[1]}/${m[2]}`;
  // http(s)/git: (proto)://(user@)host/owner/repo(.git)
  m = /^(?:https?|git):\/\/(?:[^@/]+@)?([^/]+)\/(.+?)(?:\.git)?$/.exec(r);
  if (m) return `https://${m[1]}/${m[2]}`;
  return null;
}
