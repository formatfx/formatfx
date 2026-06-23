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

export function openMenu(anchor: MenuAnchor, title: string, items: MenuItem[]): void {
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'wb-grid-menu';
  const head = document.createElement('div');
  head.className = 'wb-grid-menu-title';
  head.textContent = title;
  menu.appendChild(head);
  for (const item of items) {
    const b = document.createElement('button');
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
    menu.appendChild(b);
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
