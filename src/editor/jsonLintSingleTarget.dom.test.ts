/**
 * jsonLintSingleTarget.dom.test.ts — the Problems row inside the SPFx Format
 * panel (single-target mode, `state.openTargetDocument`). There is no preview
 * there: the formatter is edited against the real list, so the sandbox-only
 * teaching note about columnFormatterReference ("the preview here renders a
 * placeholder") is noise. In the web app it stays — the preview really is a
 * placeholder.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mountJsonPanel } from './jsonPanel';
import { state } from './state';
import type { FormatterDocument } from '../core/types';

const cfrDoc = (): FormatterDocument => ({
  kind: 'column',
  root: { elmType: 'div', children: [{ elmType: 'div', columnFormatterReference: '[$Status]' }] },
});

afterEach(() => {
  document.body.innerHTML = '';
  state.resetAll();
});
beforeEach(() => { state.resetAll(); });

function mountAndLint(): string[] {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const api = mountJsonPanel(host, () => {});
  api.refreshLint([]);
  return [...host.querySelectorAll<HTMLElement>('#wb-lint .wb-lint-msg')].map((m) => m.textContent ?? '');
}

describe('the cfr-not-emulated note', () => {
  it('shows in the web app, where the preview is a placeholder', () => {
    state.loadDocument(cfrDoc());
    expect(mountAndLint().some((t) => t.includes('columnFormatterReference embeds'))).toBe(true);
  });

  it('is dropped in single-target mode — the SPFx panel has no preview to caveat', () => {
    state.openTargetDocument(cfrDoc(), 'Status');
    const msgs = mountAndLint();
    expect(msgs.some((t) => t.includes('columnFormatterReference embeds'))).toBe(false);
    // only that note goes: every other rule still reports
    state.mutateDocument(() => { delete (state.doc.root as { elmType?: string }).elmType; });
    expect(mountAndLint().some((t) => t.includes('missing elmType'))).toBe(true);
  });
});
