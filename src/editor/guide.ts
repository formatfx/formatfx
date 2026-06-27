/**
 * editor/guide.ts — the field guide reader (☰ menu → 📖 Field guide).
 *
 * A full-screen, Microsoft-Learn-shaped documentation surface: library tree
 * on the left (chapters → pages, with a filter box), the article in the
 * middle, an "In this article" rail on the right built from the page's h2s
 * (scroll-spied), prev/next footer. Content lives in guideContent.ts.
 * Esc or ✕ closes; the last-read page is remembered for the session.
 */

import { GUIDE_PAGES, GUIDE_CHAPTERS, type GuidePage } from './guideContent';
import { renderIconGrid } from './iconPicker';
import { createOverlay, type OverlayHandle } from './overlay';

let handle: OverlayHandle | null = null;
/** Session memory: reopening the guide resumes where you left off. */
let lastPageId = GUIDE_PAGES[0].id;

export function closeGuide(): void {
  handle?.close();
  handle = null;
}

export function openGuide(pageId?: string): void {
  closeGuide();

  let current: GuidePage =
    GUIDE_PAGES.find((p) => p.id === (pageId ?? lastPageId)) ?? GUIDE_PAGES[0];
  let filter = '';

  handle = createOverlay('wb-guide-overlay', closeGuide);
  const overlay = handle.overlay;

  // ── chrome: header bar ──
  const head = document.createElement('div');
  head.className = 'wb-guide-head';
  head.innerHTML = `
    <span class="wb-guide-title">📖 Field guide</span>
    <span class="wb-guide-sub">SharePoint lists for people who build on them</span>`;
  const close = document.createElement('button');
  close.className = 'wb-guide-close';
  close.textContent = '✕';
  close.title = 'Close (Esc)';
  close.setAttribute('aria-label', 'Close');
  close.addEventListener('click', () => closeGuide());
  head.appendChild(close);
  overlay.appendChild(head);

  // ── body: nav | article | rail ──
  const body = document.createElement('div');
  body.className = 'wb-guide-body';
  const nav = document.createElement('nav');
  nav.className = 'wb-guide-nav';
  const main = document.createElement('div');
  main.className = 'wb-guide-main';
  const article = document.createElement('article');
  article.className = 'wb-guide-article';
  main.appendChild(article);
  const rail = document.createElement('aside');
  rail.className = 'wb-guide-rail';
  body.append(nav, main, rail);
  overlay.appendChild(body);

  // searchable text per page (tags stripped), built once
  const searchText = new Map<string, string>();
  const stripper = document.createElement('div');
  for (const p of GUIDE_PAGES) {
    stripper.innerHTML = p.body;
    searchText.set(p.id, `${p.title} ${stripper.textContent ?? ''}`.toLowerCase());
  }

  const renderNav = () => {
    nav.innerHTML = '';
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'wb-guide-search';
    search.placeholder = 'Filter pages…';
    search.value = filter;
    search.addEventListener('input', () => {
      filter = search.value;
      renderNav();
      nav.querySelector<HTMLInputElement>('.wb-guide-search')?.focus();
    });
    nav.appendChild(search);

    const q = filter.trim().toLowerCase();
    for (const { chapter, pages } of GUIDE_CHAPTERS) {
      const visible = q ? pages.filter((p) => searchText.get(p.id)!.includes(q)) : pages;
      if (!visible.length) continue;
      const group = document.createElement('div');
      group.className = 'wb-guide-chapter';
      group.textContent = chapter;
      nav.appendChild(group);
      for (const p of visible) {
        const b = document.createElement('button');
        b.className = 'wb-guide-navitem' + (p.id === current.id ? ' active' : '');
        b.textContent = p.title;
        b.addEventListener('click', () => openPage(p.id));
        nav.appendChild(b);
      }
    }
    if (q && !nav.querySelector('.wb-guide-navitem')) {
      const none = document.createElement('div');
      none.className = 'wb-guide-none';
      none.textContent = 'No pages match.';
      nav.appendChild(none);
    }
  };

  const renderRail = () => {
    rail.innerHTML = '';
    const headings = [...article.querySelectorAll<HTMLHeadingElement>('h2[id]')];
    if (!headings.length) return;
    const label = document.createElement('div');
    label.className = 'wb-guide-rail-label';
    label.textContent = 'In this article';
    rail.appendChild(label);
    for (const h of headings) {
      const b = document.createElement('button');
      b.className = 'wb-guide-railitem';
      b.dataset.target = h.id;
      b.textContent = h.textContent ?? '';
      b.addEventListener('click', () => {
        article.querySelector(`#${h.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      rail.appendChild(b);
    }
  };

  // scroll spy: highlight the rail entry for the last heading above the fold
  const spy = () => {
    const headings = [...article.querySelectorAll<HTMLHeadingElement>('h2[id]')];
    if (!headings.length) return;
    let activeId = headings[0].id;
    for (const h of headings) {
      if (h.getBoundingClientRect().top - main.getBoundingClientRect().top <= 90) activeId = h.id;
    }
    // a short final section can never reach the top — at the end of the
    // scroll, the last heading is what you're reading
    if (main.scrollTop + main.clientHeight >= main.scrollHeight - 4) {
      activeId = headings[headings.length - 1].id;
    }
    for (const b of rail.querySelectorAll<HTMLButtonElement>('.wb-guide-railitem')) {
      b.classList.toggle('active', b.dataset.target === activeId);
    }
  };
  main.addEventListener('scroll', spy, { passive: true });

  const renderPage = () => {
    const idx = GUIDE_PAGES.indexOf(current);
    article.innerHTML = current.body;

    // prev/next reading-order footer
    const foot = document.createElement('div');
    foot.className = 'wb-guide-pager';
    const prev = GUIDE_PAGES[idx - 1];
    const next = GUIDE_PAGES[idx + 1];
    if (prev) {
      const b = document.createElement('button');
      b.innerHTML = `← <span>${prev.title}</span>`;
      b.addEventListener('click', () => openPage(prev.id));
      foot.appendChild(b);
    }
    foot.appendChild(document.createElement('span')); // spacer keeps next right-aligned
    if (next) {
      const b = document.createElement('button');
      b.className = 'wb-guide-next';
      b.innerHTML = `<span>${next.title}</span> →`;
      b.addEventListener('click', () => openPage(next.id));
      foot.appendChild(b);
    }
    article.appendChild(foot);

    // pages can embed live widgets via a known mount point — the icon gallery
    const iconWall = article.querySelector<HTMLElement>('#wb-guide-iconwall');
    if (iconWall) {
      const note = document.createElement('div');
      note.className = 'wb-guide-iconwall-note';
      renderIconGrid(iconWall, {
        verb: 'Copy',
        onPick: (name) => {
          void navigator.clipboard?.writeText(name).catch(() => { /* clipboard blocked */ });
          note.textContent = `Copied “${name}” — paste it into an iconName.`;
        },
      });
      iconWall.appendChild(note);
    }

    renderNav();
    renderRail();
    main.scrollTop = 0;
    spy();
  };

  const openPage = (id: string) => {
    const page = GUIDE_PAGES.find((p) => p.id === id);
    if (!page) return;
    current = page;
    lastPageId = id;
    renderPage();
  };

  // cross-page links inside articles: <a data-guide-page="…">
  article.addEventListener('click', (e) => {
    const link = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[data-guide-page]');
    if (!link) return;
    e.preventDefault();
    openPage(link.dataset.guidePage!);
  });

  renderPage();
  document.body.appendChild(overlay);
}
