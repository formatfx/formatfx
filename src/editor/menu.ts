/**
 * editor/menu.ts — the one anchored action menu (extracted from gridView so
 * the grid header menu, "+ column" and the preview right-click menu share a
 * single implementation). One menu at a time; Esc or an outside pointerdown
 * closes it. The `wb-grid-menu` class is load-bearing (e2e + CSS) — it now
 * just means "the app menu", wherever it's anchored.
 */

export interface MenuItem {
  icon: string;
  label: string;
  title?: string;
  /** Optional trailing chip, e.g. "Built-in" / "Yours" on the subtype catalog. */
  badge?: string;
  /** Optional trailing affordance (e.g. ⋯ "Refine") — its own click, distinct
   *  from the row's primary `fn`. */
  action?: { icon: string; title: string; fn: () => void };
  fn: () => void;
}

/** Anchor under an element (header click) or at a point (right-click). */
export type MenuAnchor = HTMLElement | { x: number; y: number };

let menuEl: HTMLElement | null = null;
let menuCloser: ((e: Event) => void) | null = null;

export function closeMenu(): void {
  menuEl?.remove();
  menuEl = null;
  if (menuCloser) {
    document.removeEventListener('pointerdown', menuCloser);
    document.removeEventListener('keydown', menuCloser);
    menuCloser = null;
  }
}

/**
 * A small styled in-place rename popover — replaces bare browser prompt()
 * for element renaming. Anchored at the pointer position; Enter or losing
 * focus commits, Escape cancels. One undoable mutation (caller's concern).
 */
export function openRenamePopover(
  anchor: { x: number; y: number },
  heading: string,
  initial: string,
  onCommit: (value: string) => void,
): void {
  closeMenu();
  const pop = document.createElement('div');
  // wb-esc-owner: this popover closes itself on Escape (onGlobalKey below) —
  // see the convention comment in editor/overlay.ts.
  pop.className = 'wb-grid-menu wb-rename-pop wb-esc-owner';
  const head = document.createElement('div');
  head.className = 'wb-grid-menu-title';
  head.textContent = heading;
  const body = document.createElement('div');
  body.className = 'wb-rename-body';
  const inp = document.createElement('input');
  inp.className = 'wb-rename-input';
  inp.value = initial;
  inp.placeholder = 'name this element…';
  inp.setAttribute('aria-label', heading);
  body.appendChild(inp);
  pop.append(head, body);
  document.body.appendChild(pop);

  const pr = pop.getBoundingClientRect();
  pop.style.top = `${Math.max(4, Math.min(anchor.y, window.innerHeight - pr.height - 8))}px`;
  pop.style.left = `${Math.max(4, Math.min(anchor.x, window.innerWidth - pr.width - 8))}px`;

  inp.focus();
  inp.select();

  let done = false;
  const cleanup = () => {
    document.removeEventListener('pointerdown', onOutside);
    document.removeEventListener('contextmenu', onOutsideCtx);
    document.removeEventListener('keydown', onGlobalKey);
  };
  const commit = () => {
    if (done) return;
    done = true;
    cleanup();
    const val = inp.value;
    pop.remove();
    onCommit(val);
  };
  const cancel = () => {
    if (done) return;
    done = true;
    cleanup();
    pop.remove();
  };
  const onOutside = (e: Event) => { if (!pop.contains(e.target as Node)) commit(); };
  const onOutsideCtx = (e: Event) => { if (!pop.contains(e.target as Node)) cancel(); };
  const onGlobalKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cancel(); };
  inp.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
  inp.addEventListener('blur', commit);
  window.setTimeout(() => {
    document.addEventListener('pointerdown', onOutside);
    document.addEventListener('contextmenu', onOutsideCtx);
    document.addEventListener('keydown', onGlobalKey);
  }, 0);
}

export function openMenu(anchor: MenuAnchor, title: string | HTMLElement, items: MenuItem[]): void {
  closeMenu();
  const menu = document.createElement('div');
  // wb-esc-owner: this menu closes itself on Escape (menuCloser below) —
  // see the convention comment in editor/overlay.ts.
  menu.className = 'wb-grid-menu wb-esc-owner';
  const head = document.createElement('div');
  head.className = 'wb-grid-menu-title';
  // A plain field/column title is single-line text; an element menu passes a
  // rich node (its tree-style reference + a clickable parent crumb) — that
  // wants room to wrap, so it opts out of the ellipsis rule.
  if (typeof title === 'string') {
    head.textContent = title;
  } else {
    head.classList.add('wb-grid-menu-title-el');
    head.appendChild(title);
  }
  menu.appendChild(head);
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'wb-menu-row';
    const b = document.createElement('button');
    b.className = 'wb-menu-main';
    b.innerHTML = `<i class="ms-Icon ms-Icon--${item.icon}" aria-hidden="true"></i><span></span>`;
    (b.lastChild as HTMLElement).textContent = item.label;
    if (item.badge) {
      const chip = document.createElement('span');
      chip.className = 'wb-menu-badge';
      chip.textContent = item.badge;
      b.appendChild(chip);
    }
    if (item.title) b.title = item.title;
    b.addEventListener('click', () => {
      closeMenu();
      item.fn();
    });
    row.appendChild(b);
    if (item.action) {
      const a = document.createElement('button');
      a.className = 'wb-menu-action';
      a.innerHTML = `<i class="ms-Icon ms-Icon--${item.action.icon}" aria-hidden="true"></i>`;
      a.title = item.action.title;
      a.setAttribute('aria-label', item.action.title);
      a.addEventListener('click', (e) => {
        e.stopPropagation();
        closeMenu();
        item.action!.fn();
      });
      row.appendChild(a);
    }
    menu.appendChild(row);
  }
  document.body.appendChild(menu);
  const mr = menu.getBoundingClientRect();
  const at = anchor instanceof HTMLElement
    ? (() => { const r = anchor.getBoundingClientRect(); return { x: r.left, y: r.bottom + 4 }; })()
    : { x: anchor.x, y: anchor.y };
  menu.style.top = `${Math.max(4, Math.min(at.y, window.innerHeight - mr.height - 8))}px`;
  menu.style.left = `${Math.max(4, Math.min(at.x, window.innerWidth - mr.width - 8))}px`;
  menuEl = menu;
  menuCloser = (e: Event) => {
    if (e instanceof KeyboardEvent) {
      if (e.key === 'Escape') closeMenu();
      return;
    }
    if (!menu.contains(e.target as Node)) closeMenu();
  };
  // Esc may close immediately — a keyboard event can't be the gesture that
  // opened the menu. Only the pointerdown closer waits a tick, so the
  // opening click/right-click doesn't close the menu it just opened.
  document.addEventListener('keydown', menuCloser);
  window.setTimeout(() => {
    if (menuCloser) document.addEventListener('pointerdown', menuCloser);
  }, 0);
}
