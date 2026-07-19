#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Sam Yost

/**
 * cli.ts — `npx formatfx lint|validate <file…>`: the teaching linter,
 * headless. Lints never evaluate expressions (parse-only), so no DOM and
 * no tokens resolve — exactly the silent-failure checks SharePoint won't
 * give you. Zero dependencies; ANSI colors hand-rolled, off when piped.
 *
 * Exit codes: 0 clean (or warnings without --strict) · 1 lint errors,
 * warnings under --strict, or an unrecognized formatter shape · 2 usage
 * or unreadable file.
 */

import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { importJson } from './core/serializer';
import { lintDocument, type LintIssue } from './core/linter';

const tty = !!process.stdout.isTTY;
const paint = (code: string, s: string): string => (tty ? `[${code}m${s}[0m` : s);
const red = (s: string): string => paint('31', s);
const yellow = (s: string): string => paint('33', s);
const cyan = (s: string): string => paint('36', s);
const green = (s: string): string => paint('32', s);
const bold = (s: string): string => paint('1', s);

const USAGE = `formatfx — SharePoint list-formatting toolkit (https://formatfx.dev)

Usage:
  formatfx lint <file.json> [more files…] [--json] [--strict]
  formatfx validate <file.json>

  lint      parse the formatter (column / view / tile wrapper auto-detected)
            and run the teaching linter: the silent-failure quirks SharePoint
            never warns you about, each explained in plain language.
  validate  shape check only — is this JSON one of the three formatter kinds?

  --json    machine-readable output (one report object per file)
  --strict  warnings also fail (exit 1)
`;

interface FileReport {
  file: string;
  kind?: string;
  error?: string;
  issues: LintIssue[];
}

async function reportFor(file: string, lint: boolean): Promise<FileReport | null> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (e) {
    process.stderr.write(`${red('✖')} ${file}: cannot read — ${(e as Error).message}\n`);
    return null; // exit 2 — not the formatter's fault
  }
  try {
    const doc = importJson(text);
    return { file, kind: doc.kind, issues: lint ? lintDocument(doc) : [] };
  } catch (e) {
    return { file, error: (e as Error).message, issues: [] };
  }
}

function printPretty(r: FileReport): void {
  if (r.error) {
    process.stdout.write(`${red('✖')} ${bold(r.file)} — ${r.error}\n`);
    return;
  }
  const errors = r.issues.filter((i) => i.severity === 'error');
  const warnings = r.issues.filter((i) => i.severity === 'warning');
  const infos = r.issues.filter((i) => i.severity === 'info');
  const headline = r.issues.length === 0
    ? `${green('✓')} ${bold(r.file)} (${r.kind} formatter) — schema-clean and expression-safe`
    : `${errors.length ? red('✖') : yellow('▲')} ${bold(r.file)} (${r.kind} formatter) — ${errors.length} error(s), ${warnings.length} warning(s), ${infos.length} note(s)`;
  process.stdout.write(headline + '\n');
  for (const issue of r.issues) {
    const tag = issue.severity === 'error' ? red('error')
      : issue.severity === 'warning' ? yellow('warn ') : cyan('note ');
    process.stdout.write(`  ${tag} ${issue.rule} [${issue.path.join('›') || 'root'}]\n`);
    process.stdout.write(`        ${issue.message}\n`);
  }
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const rest = args.filter((a) => !a.startsWith('--'));
  const [command, ...files] = rest;

  if (!command || (command !== 'lint' && command !== 'validate') || files.length === 0) {
    process.stderr.write(USAGE);
    return 2;
  }

  const reports: FileReport[] = [];
  let unreadable = false;
  for (const file of files) {
    const r = await reportFor(file, command === 'lint');
    if (r === null) unreadable = true;
    else reports.push(r);
  }

  if (flags.has('--json')) {
    process.stdout.write(JSON.stringify(reports, null, 2) + '\n');
  } else {
    for (const r of reports) printPretty(r);
  }

  if (unreadable) return 2;
  const hasErrors = reports.some((r) => r.error || r.issues.some((i) => i.severity === 'error'));
  const hasWarnings = reports.some((r) => r.issues.some((i) => i.severity === 'warning'));
  if (hasErrors) return 1;
  if (flags.has('--strict') && hasWarnings) return 1;
  return 0;
}

main().then((code) => { process.exitCode = code; });
