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
import { exportJsonWithMap, rangeForPath } from '../core/jsonMap';
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

describe('the breadcrumb in single-target mode', () => {
  // In the web app a crumb click selects the element ON THE CANVAS and the
  // pane deliberately does not flash itself (the echo guard). The panel has
  // no canvas, so the same click looked like a no-op (owner smoke
  // 2026-09-17): here the pane is the only surface, so it reveals the range.
  it('reveals the clicked element in the pane, since there is no canvas', () => {
    state.openTargetDocument({
      kind: 'column',
      root: { elmType: 'div', children: [{ elmType: 'span', txtContent: 'hi' }] },
    }, 'Status');
    const host = document.createElement('div');
    document.body.appendChild(host);
    mountJsonPanel(host, () => {});
    const textEl = host.querySelector('#wb-json-text') as HTMLTextAreaElement;
    const crumbs = host.querySelector('#wb-json-crumbs') as HTMLElement;
    const { ranges } = exportJsonWithMap(state.doc, { sanitizeWhitespace: true, keepMeta: true });
    const r = rangeForPath(ranges, [0])!;
    textEl.setSelectionRange(r.start + 1, r.start + 1);
    textEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const parts = [...crumbs.querySelectorAll<HTMLButtonElement>('.wb-crumb')];
    expect(parts.length).toBe(2);
    parts[0].click(); // the root crumb
    expect(state.selection).toEqual([]);
    expect(host.querySelector('.wb-code-flashbar')).not.toBeNull();
  });
});

describe('the pane API for a host without a canvas (the SPFx panel footer Apply)', () => {
  it('reports dirtiness and commits the buffer into the document, or returns the parse error', () => {
    state.openTargetDocument({ kind: 'column', root: { elmType: 'div', txtContent: 'a' } }, 'Status');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const api = mountJsonPanel(host, () => {});
    const ta = host.querySelector('#wb-json-text') as HTMLTextAreaElement;
    expect(api.isDirty()).toBe(false);
    ta.value = '{"elmType":"span","txtContent":"b"}';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    expect(api.isDirty()).toBe(true);
    expect(api.commitBuffer()).toEqual({ ok: true });
    expect(api.isDirty()).toBe(false);
    expect(state.doc.root.elmType).toBe('span');
    ta.value = '{"elmType": ';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    const r = api.commitBuffer();
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain('Import failed');
    expect(api.isDirty()).toBe(true);
    expect(state.doc.root.elmType).toBe('span'); // untouched
  });
});

describe('Problems severity chips toggle their rows (issue #321)', () => {
  it('a chip click hides that severity, persists the choice and shows again on the next click', () => {
    localStorage.removeItem('wb-lint-prefs.v1');
    // web-app mode: the cfr note is an info row, and a bogus elmType an error row
    state.loadDocument({ kind: 'column', root: { elmType: 'bogus' as 'div', children: [{ elmType: 'div', columnFormatterReference: '[$Status]' }] } });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const api = mountJsonPanel(host, () => {});
    api.refreshLint([]);
    const rows = () => [...host.querySelectorAll<HTMLElement>('#wb-lint .wb-lint-item')].map((r) => r.className);
    expect(rows().some((c) => c.includes('wb-lint-info'))).toBe(true);
    expect(rows().some((c) => c.includes('wb-lint-error'))).toBe(true);
    const chip = host.querySelector('#wb-lint .wb-lint-chip-info') as HTMLButtonElement;
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    chip.click();
    expect(rows().some((c) => c.includes('wb-lint-info'))).toBe(false);
    expect(rows().some((c) => c.includes('wb-lint-error'))).toBe(true); // only info went
    const chipOff = host.querySelector('#wb-lint .wb-lint-chip-info') as HTMLButtonElement;
    expect(chipOff.getAttribute('aria-pressed')).toBe('false');
    expect(chipOff.textContent).toContain('info'); // the count stays on the chip
    expect(JSON.parse(localStorage.getItem('wb-lint-prefs.v1')!).hideSeverity.info).toBe(true);
    chipOff.click();
    expect(rows().some((c) => c.includes('wb-lint-info'))).toBe(true);
    localStorage.removeItem('wb-lint-prefs.v1');
  });
});
