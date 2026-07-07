/**
 * editor/guide.ts — the field guide reader (☰ menu → 📖 Field guide).
 *
 * A full-screen, Microsoft-Learn-shaped documentation surface: library tree
 * on the left (chapters → nested pages whose indent encodes technicality,
 * plus a filter box), the article in the middle, an
 * "In this article" rail on the right built from the page's h2s
 * (scroll-spied), prev/next footer. Content lives in guideContent.ts.
 * Esc or ✕ closes; the last-read page is remembered for the session.
 */

import { GUIDE_PAGES, GUIDE_CHAPTERS, GUIDE_DEPTH, type GuidePage } from './guideContent';
import { renderIconGrid } from './iconPicker';
import { createOverlay, type OverlayHandle } from './overlay';
import { themePalette } from '../core/theme';
import { SEVERITY_LEVELS } from './themeClasses';

let handle: OverlayHandle | null = null;
/** Session memory: reopening the guide resumes where you left off. */
let lastPageId = GUIDE_PAGES[0].id;

export function closeGuide(): void {
  handle?.close();
  handle = null;
}

/** The live color-class gallery mounted into the field guide's #wb-guide-colorwall.
 *  One cell per emulated palette token (background / text / border class), plus the
 *  semantic status fills. Swatches paint via the document-global emulated theme CSS,
 *  so they show real colors and re-tint with dark mode / a tenant palette. Click a
 *  swatch to copy its class name. */
function renderColorWall(host: HTMLElement): void {
  host.innerHTML = '';
  const note = document.createElement('div');
  note.className = 'wb-guide-iconwall-note';
  const copy = (cls: string): void => {
    void navigator.clipboard?.writeText(cls)?.catch(() => { /* clipboard blocked */ });
    note.textContent = `Copied “${cls}” — paste it into attributes.class.`;
  };
  const swatch = (cls: string, kind: 'bg' | 'fg' | 'bd', text = ''): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `wb-colorwall-sw wb-colorwall-${kind} ${cls}`;
    if (text) b.textContent = text;
    b.title = `${cls} — click to copy`;
    b.setAttribute('aria-label', `Copy ${cls}`);
    b.addEventListener('click', () => copy(cls));
    return b;
  };

  const grid = document.createElement('div');
  grid.className = 'wb-colorwall-grid';
  for (const token of Object.keys(themePalette('light'))) {
    const cell = document.createElement('div');
    cell.className = 'wb-colorwall-cell';
    const swatches = document.createElement('div');
    swatches.className = 'wb-colorwall-swatches';
    swatches.append(
      swatch(`ms-bgColor-${token}`, 'bg'),
      swatch(`ms-fontColor-${token}`, 'fg', 'Aa'),
      swatch(`sp-css-borderColor-${token}`, 'bd'),
    );
    const name = document.createElement('code');
    name.className = 'wb-colorwall-name';
    name.textContent = token;
    cell.append(swatches, name);
    grid.appendChild(cell);
  }
  host.appendChild(grid);

  const sevHead = document.createElement('div');
  sevHead.className = 'wb-colorwall-subhead';
  sevHead.textContent = 'Status fills (sp-field-severity--*)';
  host.appendChild(sevHead);
  const sev = document.createElement('div');
  sev.className = 'wb-colorwall-sev';
  for (const s of SEVERITY_LEVELS) {
    const cls = `sp-field-severity--${s.level}`;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `wb-colorwall-sevchip ${cls}`;
    chip.textContent = s.label;
    chip.title = `${cls} — click to copy`;
    chip.setAttribute('aria-label', `Copy ${cls}`);
    chip.addEventListener('click', () => copy(cls));
    sev.appendChild(chip);
  }
  host.appendChild(sev);
  host.appendChild(note);
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
    <span class="wb-guide-sub">SharePoint lists &amp; libraries — plain basics down to engine internals</span>`;
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

    // the tree's one reading rule, kept visible: nesting = technicality
    const hint = document.createElement('div');
    hint.className = 'wb-guide-navhint';
    hint.textContent = 'Deeper pages are more technical.';
    nav.appendChild(hint);

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
        const depth = GUIDE_DEPTH.get(p.id) ?? 0;
        b.className =
          'wb-guide-navitem' +
          (depth ? ` wb-guide-navd${depth}` : '') +
          (p.id === current.id ? ' active' : '');
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

    // the live color-class gallery — every emulated theme token (bg/font/border)
    // plus the semantic status fills. The emulated theme CSS is document-global,
    // so each swatch paints its real color and re-tints with dark mode / a tenant
    // palette. Click any swatch to copy its class name.
    const colorWall = article.querySelector<HTMLElement>('#wb-guide-colorwall');
    if (colorWall) renderColorWall(colorWall);

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
