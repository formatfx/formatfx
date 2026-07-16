/**
 * jsonFold.dom.test.ts — folding wiring contracts (spec 2026-07-09 §3):
 * folds show the sentinel and gap the gutter, Apply always reads the FULL
 * text, caret-in-sentinel unfolds, edit intent expands everything (WYSIWYG
 * across sentinels), folds survive canvas-driven regenerates, and the
 * overlay stays lossless on folded text. Teardown per jsonPanel.sync.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mountJsonPanel } from './jsonPanel';
import { mountTree } from './treeView';
import { state } from './state';
import { foldState, childrenFoldKey } from './foldState';
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

describe('children:[ folding (owner ask 2026-07-16)', () => {
  it('a children array gets its own labelled chevron; folding elides the list but keeps the parent\'s properties', () => {
    const { host, textEl } = mountPanel();
    const chev = [...host.querySelectorAll<HTMLButtonElement>('.wb-json-foldcol .wb-json-chev')]
      .find((b) => (b.getAttribute('aria-label') ?? '') === 'Fold children of the root');
    expect(chev).toBeDefined();
    chev!.click();
    expect(textEl.value).toContain(`"children": [${FOLD_SENTINEL}]`); // the list collapsed in place
    expect(textEl.value).toContain('"elmType"'); // the parent's own properties stay visible
    // Apply still reads the FULL text — nothing hidden is lost
    const before = exportJson(state.doc, { sanitizeWhitespace: true, keepMeta: true });
    (host.querySelector('#wb-json-apply') as HTMLButtonElement).click();
    expect((host.querySelector('#wb-json-import-error') as HTMLElement).hidden).toBe(true);
    expect(exportJson(state.doc, { sanitizeWhitespace: true, keepMeta: true })).toBe(before);
  });

  it('unfolding via the chevron restores the list', () => {
    const { host, textEl } = mountPanel();
    [...host.querySelectorAll<HTMLButtonElement>('.wb-json-foldcol .wb-json-chev')]
      .find((b) => b.getAttribute('aria-label') === 'Fold children of the root')!.click();
    const folded = [...host.querySelectorAll<HTMLButtonElement>('.wb-json-foldcol .wb-json-chev')]
      .find((b) => b.getAttribute('aria-label') === 'Unfold children of the root');
    expect(folded).toBeDefined();
    folded!.click();
    expect(textEl.value).not.toContain('⋯');
  });
});

describe('fold sync with the Structure tree (shared foldState)', () => {
  /** Panel + tree over the SAME row doc (set directly, the treeView.test
   *  idiom — loadDocument would route a row formatter onto the grid floor). */
  function mountPanelAndTree(root?: import('../core/types').SPElement) {
    state.doc = {
      kind: 'row',
      root: root ?? { elmType: 'div', children: [{ elmType: 'span', txtContent: '[$Title]' }] },
    };
    const { host, textEl } = mountPanel();
    const treeHost = document.createElement('div');
    document.body.appendChild(treeHost);
    mountTree(treeHost);
    return { host, textEl, treeHost };
  }

  it('a tree chevron click folds the children:[ level in the JSON pane, and the JSON chevron expands the tree back', () => {
    const { host, textEl, treeHost } = mountPanelAndTree();
    expect(treeHost.querySelector('.wb-tree-row[data-path="0"]')).not.toBeNull();

    // tree → JSON: collapse the root row
    treeHost.querySelector<HTMLButtonElement>('.wb-tree-row[data-path=""] button.wb-tree-fold')!.click();
    expect(textEl.value).toContain(`"children": [${FOLD_SENTINEL}]`);
    expect(treeHost.querySelector('.wb-tree-row[data-path="0"]')).toBeNull();

    // JSON → tree: unfold from the pane's chevron column
    const chev = [...host.querySelectorAll<HTMLButtonElement>('.wb-json-foldcol .wb-json-chev')]
      .find((b) => b.getAttribute('aria-label') === 'Unfold children of the root');
    expect(chev).toBeDefined();
    chev!.click();
    expect(textEl.value).not.toContain('⋯');
    expect(treeHost.querySelector('.wb-tree-row[data-path="0"]')).not.toBeNull();
  });

  it('"Expand all" in the JSON pane un-collapses the tree too', () => {
    const { host, textEl, treeHost } = mountPanelAndTree();
    treeHost.querySelector<HTMLButtonElement>('.wb-tree-row[data-path=""] button.wb-tree-fold')!.click();
    expect(treeHost.querySelector('.wb-tree-row[data-path="0"]')).toBeNull();
    (host.querySelector('#wb-json-expand-all') as HTMLButtonElement).click();
    expect(textEl.value).not.toContain('⋯');
    expect(treeHost.querySelector('.wb-tree-row[data-path="0"]')).not.toBeNull();
  });

  it('deleting a tree-folded node prunes its key from the shared set (the tree un-collapses with it)', () => {
    mountPanelAndTree({
      elmType: 'div',
      children: [
        { elmType: 'div', children: [{ elmType: 'span', txtContent: 'a' }] },
        { elmType: 'span', txtContent: 'b' },
      ],
    });
    foldState.update('tree', (set) => set.add(childrenFoldKey([0])));
    expect(foldState.has(childrenFoldKey([0]))).toBe(true);
    state.removeNode([0]); // the folded container goes away
    expect(foldState.has(childrenFoldKey([0]))).toBe(false); // pruned on regenerate
  });
});
