/**
 * editor/contextMenu.ts — the right-click element menu is headed like the row
 * the user clicked: the element drawn as its Structure-tree reference (the
 * shared elmRef chip — same icon + name + dim type), preceded by a clickable
 * parent crumb that walks the selection up a level. This pins both the
 * tree-matching header and the parent-navigation, so a refactor can't quietly
 * drop back to the old bare-text title.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { openElementMenu } from './contextMenu';
import { closeMenu } from './menu';
import { state } from './state';

afterEach(() => {
  closeMenu();
  document.body.innerHTML = '';
});

/** A row doc: Row › Group › Title (span), so paths have a real ancestor chain. */
const nestedDoc = () => {
  state.doc = {
    kind: 'row',
    root: {
      elmType: 'div',
      _elmName: 'Row',
      children: [
        {
          elmType: 'div',
          _elmName: 'Group',
          children: [{ elmType: 'span', _elmName: 'Title', txtContent: '[$Title]' }],
        },
      ],
    },
  };
  state.fields = [];
};

const menuTitle = () => document.body.querySelector('.wb-grid-menu-title')!;

describe('element menu header — tree-style name', () => {
  it('titles the menu like the element\'s tree row (icon + name + dim type)', () => {
    nestedDoc();
    state.select([0, 0]);
    openElementMenu([0, 0], { x: 10, y: 10 }, () => {});

    const title = menuTitle();
    // the rich header opts out of the single-line field-name styling
    expect(title.classList.contains('wb-grid-menu-title-el')).toBe(true);

    // the subject is the LAST chip (a parent crumb precedes it)
    const chips = title.querySelectorAll('.wb-elmref');
    expect(chips.length).toBe(2);
    const current = chips[chips.length - 1];
    expect(current.querySelector('.wb-elmref-name')?.textContent).toBe('Title');
    expect(current.querySelector('.wb-elmref-type')?.textContent).toBe('span');
    // …beside the very glyph the Structure tree shows for a <span>
    expect(current.querySelector('i')?.className).toContain('ms-Icon--PlainText');
  });

  it('a nameless element shows its <type> — same text the tree/nameOf print', () => {
    state.doc = { kind: 'column', root: { elmType: 'div', children: [{ elmType: 'a', txtContent: 'x' }] } };
    state.fields = [];
    state.select([0]);
    openElementMenu([0], { x: 0, y: 0 }, () => {});

    const current = [...menuTitle().querySelectorAll('.wb-elmref')].pop()!;
    expect(current.querySelector('.wb-elmref-name')?.textContent).toBe('<a>');
  });

  it('a CFR host borrows the referenced column\'s name, exactly like the tree', () => {
    state.doc = {
      kind: 'row',
      root: {
        elmType: 'div',
        _elmName: 'Row',
        children: [{ elmType: 'div', columnFormatterReference: '[$Status]' }],
      },
    };
    state.fields = [];
    state.select([0]);
    openElementMenu([0], { x: 0, y: 0 }, () => {});

    const current = [...menuTitle().querySelectorAll('.wb-elmref')].pop()!;
    expect(current.querySelector('.wb-elmref-name')?.textContent).toBe('Status');
  });
});

describe('element menu header — clickable parent crumb', () => {
  it('shows the parent as a labelled button; the root menu has none', () => {
    nestedDoc();

    state.select([0, 0]);
    openElementMenu([0, 0], { x: 0, y: 0 }, () => {});
    const crumb = menuTitle().querySelector<HTMLButtonElement>('.wb-elmmenu-parent');
    expect(crumb).not.toBeNull();
    expect(crumb!.querySelector('.wb-elmref-name')?.textContent).toBe('Group');
    // the button carries an accessible name pointing at the parent
    expect(crumb!.getAttribute('aria-label')).toContain('Group');

    // the root element is the top — nothing above it to climb to
    closeMenu();
    state.select([]);
    openElementMenu([], { x: 0, y: 0 }, () => {});
    expect(menuTitle().querySelector('.wb-elmmenu-parent')).toBeNull();
    expect(menuTitle().querySelector('.wb-elmref-name')?.textContent).toBe('Row');
  });

  it('clicking the crumb selects the parent and re-titles the menu on it', () => {
    nestedDoc();
    state.select([0, 0]);
    openElementMenu([0, 0], { x: 0, y: 0 }, () => {});

    menuTitle().querySelector<HTMLButtonElement>('.wb-elmmenu-parent')!.click();

    // the parent is now the selection…
    expect(state.isSelected([0])).toBe(true);
    // …and the reopened menu names the parent (Group), with ITS parent (Row) as the crumb
    const title = menuTitle();
    expect([...title.querySelectorAll('.wb-elmref')].pop()!.querySelector('.wb-elmref-name')?.textContent)
      .toBe('Group');
    expect(title.querySelector('.wb-elmmenu-parent .wb-elmref-name')?.textContent).toBe('Row');
  });
});
