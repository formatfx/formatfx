// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Sam Yost

/**
 * editor/about.ts — the ☰-menu "About" modal: "what build am I running?"
 *
 * Shows the product + version, the build revision (short SHA + date, linked to
 * the commit when known), the last merged PR (linked to GitHub), and a repo
 * link. Every value is baked at build time (see buildInfo.ts / vite.config.ts);
 * there is no runtime fetch and no new dependency.
 */
import { createOverlay } from './overlay';
import { BUILD_INFO } from '../buildInfo';
import { PRODUCT_TAGLINE } from '../branding';

function extLink(text: string, href: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.className = 'wb-about-link';
  a.textContent = text;
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

export function openAbout(): void {
  const handle = createOverlay('wb-about-overlay', () => handle.close());

  const panel = document.createElement('div');
  panel.className = 'wb-about';

  const head = document.createElement('div');
  head.className = 'wb-about-head';
  const title = document.createElement('span');
  title.className = 'wb-about-title';
  title.textContent = `${BUILD_INFO.name} v${BUILD_INFO.version}`;
  const sub = document.createElement('span');
  sub.className = 'wb-about-sub';
  sub.textContent = PRODUCT_TAGLINE;
  head.append(title, sub);

  const rows = document.createElement('dl');
  rows.className = 'wb-about-rows';
  const addRow = (label: string, value: Node): void => {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.appendChild(value);
    rows.append(dt, dd);
  };

  const revText = BUILD_INFO.date ? `${BUILD_INFO.rev} · ${BUILD_INFO.date}` : BUILD_INFO.rev;
  addRow('Build', BUILD_INFO.commitUrl ? extLink(revText, BUILD_INFO.commitUrl) : document.createTextNode(revText));
  if (BUILD_INFO.pr) {
    addRow('Last merged PR', extLink(`#${BUILD_INFO.pr.number} — ${BUILD_INFO.pr.title}`, BUILD_INFO.pr.url));
  }
  if (BUILD_INFO.repoUrl) {
    addRow('Source', extLink('Repository on GitHub', BUILD_INFO.repoUrl));
  }

  const foot = document.createElement('div');
  foot.className = 'wb-about-foot';
  const close = document.createElement('button');
  close.className = 'wb-about-close';
  close.textContent = 'Close';
  close.addEventListener('click', () => handle.close());
  foot.appendChild(close);

  panel.append(head, rows, foot);
  handle.overlay.appendChild(panel);
  document.body.appendChild(handle.overlay);
}
