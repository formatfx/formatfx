/**
 * jsonFold.dom.test.ts — folding wiring contracts (spec 2026-07-09 §3):
 * folds show the sentinel and gap the gutter, Apply always reads the FULL
 * text, caret-in-sentinel unfolds, edit intent expands everything (WYSIWYG
 * across sentinels), folds survive canvas-driven regenerates, and the
 * overlay stays lossless on folded text. Teardown per jsonPanel.sync.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mountJsonPanel } from './jsonPanel';
import { state } from './state';
import { exportJson, importJson } from '../core/serializer';
import { exportJsonWithMap } from '../core/jsonMap';
import { cutForRange, FOLD_SENTINEL } from './jsonFold';

afterEach(() => {
  document.querySelectorAll<HTMLElement>('body > *').forEach((el) => {
    (el as unknown as { _unsub?: () => void })._unsub?.();
    el.remove();
  });
  state.resetAll();
});

beforeEach(() => {
  state.resetAll();
});

function mountPanel() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  mountJsonPanel(host, () => {});
  const textEl = host.querySelector('#wb-json-text') as HTMLTextAreaElement;
  return { host, textEl };
}

/** The panel's own full text + the first foldable node (its range + cut). */
function firstFoldable() {
  const { text, ranges } = exportJsonWithMap(state.doc, { sanitizeWhitespace: true, keepMeta: true });
  for (const r of ranges) {
    if (r.path.length === 0) continue;
    const cut = cutForRange(text, r);
    if (cut) return { fullText: text, range: r, cut };
  }
  throw new Error('fixture has no foldable node');
}

/** Fold the node at the caret via the keyboard command. */
function foldAtCaret(textEl: HTMLTextAreaElement, offset: number) {
  textEl.setSelectionRange(offset, offset);
  textEl.dispatchEvent(new KeyboardEvent('keydown', {
    key: '{', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true,
  }));
}

describe('folding', () => {
  it('folds to the sentinel, gaps the gutter, keeps a chevron exposed, and Apply reads the full text', () => {
    const { host, textEl } = mountPanel();
    const { fullText, range } = firstFoldable();
    const before = exportJson(state.doc, { sanitizeWhitespace: true, keepMeta: true });

    foldAtCaret(textEl, range.start + 1);
    expect(textEl.value).toContain(FOLD_SENTINEL);
    expect(textEl.value.length).toBeLessThan(fullText.length);

    // gutter numbers gap across the fold
    const nums = [...host.querySelectorAll('.wb-json-ln')].map((el) => Number(el.textContent));
    expect(nums.some((n, i) => i > 0 && n - nums[i - 1] > 1)).toBe(true);

    // an interactive, labelled chevron exists outside the aria-hidden gutter
    const chev = host.querySelector('.wb-json-foldcol .wb-json-chev[aria-expanded="false"]');
    expect(chev).not.toBeNull();

    // applying while folded imports the FULL text — nothing hidden is lost
    (host.querySelector('#wb-json-apply') as HTMLButtonElement).click();
    const errEl = host.querySelector('#wb-json-import-error') as HTMLDivElement;
    expect(errEl.hidden).toBe(true);
    expect(exportJson(state.doc, { sanitizeWhitespace: true, keepMeta: true })).toBe(before);
  });

  it('a caret click inside the sentinel unfolds just that region', () => {
    const { textEl } = mountPanel();
    const { range } = firstFoldable();
    foldAtCaret(textEl, range.start + 1);
    const idx = textEl.value.indexOf('⋯');
    expect(idx).toBeGreaterThan(-1);
    textEl.setSelectionRange(idx, idx);
    textEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(textEl.value).not.toContain('⋯');
  });

  it('typing while folded expands everything and lands the edit at the remapped caret', () => {
    const { textEl } = mountPanel();
    const { fullText, range } = firstFoldable();
    foldAtCaret(textEl, range.start + 1);
    textEl.setSelectionRange(1, 1); // right after the opening brace, before any fold
    textEl.dispatchEvent(new InputEvent('beforeinput', {
      inputType: 'insertText', data: 'x', bubbles: true, cancelable: true,
    }));
    expect(textEl.value).not.toContain('⋯');
    expect(textEl.value).toBe(fullText.slice(0, 1) + 'x' + fullText.slice(1));
    expect(textEl.selectionStart).toBe(2);
    expect(textEl.classList.contains('wb-json-dirty')).toBe(true);
  });

  it('deleting a selection that spans the sentinel removes the hidden interior too (WYSIWYG)', () => {
    const { textEl } = mountPanel();
    const { fullText, range, cut } = firstFoldable();
    foldAtCaret(textEl, range.start + 1);
    const idx = textEl.value.indexOf(FOLD_SENTINEL);
    textEl.setSelectionRange(idx, idx + FOLD_SENTINEL.length);
    textEl.dispatchEvent(new InputEvent('beforeinput', {
      inputType: 'deleteContentBackward', bubbles: true, cancelable: true,
    }));
    expect(textEl.value).not.toContain('⋯');
    // the selection spanned the sentinel → the delete covered the whole cut
    expect(textEl.value).toBe(fullText.slice(0, cut.start) + fullText.slice(cut.end));
    expect(textEl.classList.contains('wb-json-dirty')).toBe(true);
  });

  it('folds survive canvas-driven regenerates of OTHER nodes, path-keyed', () => {
    const { textEl } = mountPanel();
    const { range } = firstFoldable();
    foldAtCaret(textEl, range.start + 1);
    expect(textEl.value).toContain('⋯');
    state.mutateDocument(() => {
      const other = state.nodeAt([1]) ?? state.nodeAt([0]);
      if (other) other.style = { ...(other.style ?? {}), 'margin-top': '1px' };
    });
    expect(textEl.value).toContain('⋯'); // the fold re-applied after regenerate
    expect(textEl.value).toContain('margin-top'); // …over the UPDATED text, unless folded away
  });

  it('Fold others keeps the selection chain open; Expand all clears', () => {
    const { host, textEl } = mountPanel();
    state.select([1]);
    (host.querySelector('#wb-json-fold-others') as HTMLButtonElement).click();
    expect(textEl.value).toContain('⋯');
    // the selected element's own text stays visible
    const { text, ranges } = exportJsonWithMap(state.doc, { sanitizeWhitespace: true, keepMeta: true });
    const selRange = ranges.find((r) => r.path.length === 1 && r.path[0] === 1)!;
    const probe = text.slice(selRange.start, selRange.start + 14);
    expect(textEl.value).toContain(probe);
    (host.querySelector('#wb-json-expand-all') as HTMLButtonElement).click();
    expect(textEl.value).not.toContain('⋯');
  });

  it('the overlay stays lossless over folded text', () => {
    const { host, textEl } = mountPanel();
    const { range } = firstFoldable();
    foldAtCaret(textEl, range.start + 1);
    const code = host.querySelector('.wb-json-hl code') as HTMLElement;
    const flat = code.innerHTML
      .replace(/<[^>]*>/g, '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    expect(flat === textEl.value || flat === `${textEl.value} `).toBe(true); // trailing pad allowed
  });
});

describe('wrapper-section folding (groupProps / commandBarProps / footerFormatter)', () => {
  /** A view formatter whose wrapper carries the big unmodeled blobs. */
  const richViewJson = (): string => JSON.stringify({
    $schema: 'https://developer.microsoft.com/json-schemas/sp/v2/view-formatting.schema.json',
    groupProps: {
      hideFooter: true,
      headerFormatter: {
        elmType: 'div',
        children: [{ elmType: 'span', txtContent: '@group' }],
      },
    },
    commandBarProps: {
      commands: [
        { key: 'new', hide: true },
        { key: 'share', text: 'Send' },
      ],
    },
    footerFormatter: { elmType: 'div', txtContent: 'total' },
    rowFormatter: { elmType: 'div', children: [{ elmType: 'span', txtContent: '[$Title]' }] },
  });

  function mountWithRichView() {
    const mounted = mountPanel();
    state.loadDocument(importJson(richViewJson()));
    return mounted;
  }

  it('wrapper sections get their own labelled chevrons', () => {
    const { host, textEl } = mountWithRichView();
    expect(textEl.value).toContain('"groupProps"'); // extras survive into the buffer
    const labels = [...host.querySelectorAll('.wb-json-foldcol .wb-json-chev')]
      .map((b) => b.getAttribute('aria-label') ?? '');
    expect(labels.some((l) => l.includes('section groupProps'))).toBe(true);
    expect(labels.some((l) => l.includes('section groupProps.headerFormatter'))).toBe(true);
    expect(labels.some((l) => l.includes('section commandBarProps'))).toBe(true);
    expect(labels.some((l) => l.includes('section footerFormatter'))).toBe(true);
  });

  it('Ctrl+Shift+[ inside a wrapper section folds it to the sentinel', () => {
    const { textEl } = mountWithRichView();
    const inGroupProps = textEl.value.indexOf('"hideFooter"');
    expect(inGroupProps).toBeGreaterThan(0);
    foldAtCaret(textEl, inGroupProps);
    expect(textEl.value).toContain(FOLD_SENTINEL);
    expect(textEl.value).not.toContain('"hideFooter"'); // interior elided
    expect(textEl.value).toContain('"groupProps"');     // opener line stays
    expect(textEl.value).toContain('"rowFormatter"');   // the rest untouched
  });

  it('the innermost section at the caret folds first (commands entry, not the whole bar)', () => {
    const { textEl } = mountWithRichView();
    const inFirstCommand = textEl.value.indexOf('"key": "new"');
    foldAtCaret(textEl, inFirstCommand);
    expect(textEl.value).not.toContain('"key": "new"');  // entry 0 folded away
    expect(textEl.value).toContain('"key": "share"');    // sibling entry visible
    expect(textEl.value).toContain('"commands"');        // the array itself open
  });

  it("a section chevron toggles its fold and the chevron flips state", () => {
    const { host, textEl } = mountWithRichView();
    const chev = [...host.querySelectorAll<HTMLButtonElement>('.wb-json-foldcol .wb-json-chev')]
      .find((b) => (b.getAttribute('aria-label') ?? '') === 'Fold section commandBarProps')!;
    expect(chev).toBeDefined();
    chev.click();
    expect(textEl.value).not.toContain('"commands"'); // the bar's interior elided
    const folded = [...host.querySelectorAll<HTMLButtonElement>('.wb-json-foldcol .wb-json-chev')]
      .find((b) => (b.getAttribute('aria-label') ?? '') === 'Unfold section commandBarProps');
    expect(folded).toBeDefined();
    folded!.click();
    expect(textEl.value).toContain('"commands"');
  });

  it('"Fold others" folds wrapper sections alongside off-chain elements', () => {
    const { host, textEl } = mountWithRichView();
    state.select([0]); // keep the row's span chain open
    (document.getElementById('wb-json-fold-others') as HTMLButtonElement).click();
    expect(textEl.value).not.toContain('"hideFooter"');   // groupProps folded
    expect(textEl.value).not.toContain('"key": "new"');   // commandBarProps folded
    expect(textEl.value).toContain('"groupProps"');       // openers stay visible
    expect(textEl.value).toContain('[$Title]');           // the selection chain stays open
    void host;
  });
});
