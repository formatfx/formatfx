/**
 * lens.ts — the Modern lens content script. Registered dynamically by the
 * background worker for CONNECTED SharePoint origins only (the same
 * permission grant that powers the badge — revoke the site and this never
 * runs again). On the two classic settings hubs (site settings.aspx and
 * list/library listedit.aspx) it classifies every link via the pure
 * modernLens.ts ruleset and de-emphasizes the classic-only ones.
 *
 * Read-only by design: it adds classes, a <style> tag, tooltips and a small
 * mode pill. It never navigates, never calls REST, and never blocks a click —
 * in Dim mode a hover restores full opacity, so intentionally using a classic
 * setting stays one click away. Modes: Dim (default) / Hide / Off, remembered
 * per tenant in localStorage.
 */

import { classifySettingsLink, parseLensMode, settingsPageKind, LENS_MODE_KEY, type LensMode } from './modernLens';

const kind = settingsPageKind(location.href);

if (kind && !document.getElementById('fxlens-style')) {
  const dimmed: HTMLAnchorElement[] = [];

  // ── classify every content link (skip chrome: suite bar, side nav) ──────
  // Tooltips are stashed on the element, not applied here — Off mode must
  // leave the page truly untouched, original titles included (setMode swaps).
  const root = document.getElementById('contentBox') ?? document.body;
  for (const a of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const c = classifySettingsLink(a.getAttribute('href') ?? '', location.href);
    if (!c || c.verdict !== 'dim') continue;
    a.classList.add('fxlens-dim');
    if (a.title) a.dataset.fxlensOrig = a.title;
    a.dataset.fxlensWhy = (a.title ? a.title + ' — ' : '') + 'Classic-only: ' + (c.reason ?? '');
    dimmed.push(a);
  }

  // ── hide-mode wrappers: take the row/bullet out, not just the text ──────
  // A wrapper (nearest li, else tr) is only used when every link inside it
  // was dim-classified — a mixed row must never vanish with a keeper inside.
  for (const a of dimmed) {
    const wrap = a.closest('li') ?? a.closest('tr');
    const target =
      wrap && [...wrap.querySelectorAll<HTMLAnchorElement>('a[href]')].every((x) => x.classList.contains('fxlens-dim'))
        ? wrap
        : a;
    target.classList.add('fxlens-dimitem');
  }

  if (dimmed.length) {
    // ── styles (injected, so the console-paste fallback works too) ────────
    const style = document.createElement('style');
    style.id = 'fxlens-style';
    style.textContent = `
      body.fxlens-mode-dim a.fxlens-dim { opacity: .38; transition: opacity .15s; }
      body.fxlens-mode-dim a.fxlens-dim:hover, body.fxlens-mode-dim a.fxlens-dim:focus { opacity: 1; }
      body.fxlens-mode-hide .fxlens-dimitem { display: none !important; }
      #fxlens-pill {
        position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
        display: flex; align-items: center; gap: 8px; padding: 5px 6px 5px 12px;
        background: #fff; color: #323130; border: 1px solid #c8c6c4; border-radius: 999px;
        box-shadow: 0 1.6px 3.6px rgba(0,0,0,.13), 0 .3px .9px rgba(0,0,0,.11);
        font: 12px 'Segoe UI', system-ui, sans-serif; white-space: nowrap;
      }
      #fxlens-pill .fxlens-seg { display: flex; border: 1px solid #c8c6c4; border-radius: 999px; overflow: hidden; }
      #fxlens-pill button { all: unset; cursor: pointer; padding: 3px 10px; font: inherit; color: inherit; }
      #fxlens-pill button:hover { background: #f3f2f1; }
      #fxlens-pill button:focus-visible { outline: 2px solid #0078d4; outline-offset: -2px; }
      #fxlens-pill button[aria-pressed="true"] { background: #0078d4; color: #fff; }
      #fxlens-pill button[aria-pressed="true"]:focus-visible { outline-color: #fff; }
      @media print { #fxlens-pill { display: none; } }
    `;
    document.head.appendChild(style);

    // ── the mode pill ──────────────────────────────────────────────────────
    const pill = document.createElement('div');
    pill.id = 'fxlens-pill';
    pill.title =
      'FormatFX companion — Modern lens. Dims settings that only affect the classic experience ' +
      '(hover any dimmed link to see why). Hide removes them; Off leaves the page untouched.';
    const label = document.createElement('span');
    label.textContent = `Modern lens · ${dimmed.length} classic-only`;
    const seg = document.createElement('span');
    seg.className = 'fxlens-seg';
    pill.append(label, seg);

    const setMode = (mode: LensMode): void => {
      document.body.classList.toggle('fxlens-mode-dim', mode === 'dim');
      document.body.classList.toggle('fxlens-mode-hide', mode === 'hide');
      for (const a of dimmed) {
        if (mode === 'off') {
          const orig = a.dataset.fxlensOrig;
          if (orig) a.title = orig;
          else a.removeAttribute('title');
        } else {
          a.title = a.dataset.fxlensWhy ?? '';
        }
      }
      for (const b of seg.querySelectorAll('button')) {
        b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
      }
      try {
        localStorage.setItem(LENS_MODE_KEY, mode);
      } catch { /* storage blocked — mode just won't persist */ }
    };

    for (const [mode, text] of [['dim', 'Dim'], ['hide', 'Hide'], ['off', 'Off']] as const) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.mode = mode;
      b.textContent = text;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => setMode(mode));
      seg.appendChild(b);
    }
    document.body.appendChild(pill);

    let stored: string | null = null;
    try {
      stored = localStorage.getItem(LENS_MODE_KEY);
    } catch { /* storage blocked — fall through to the default */ }
    setMode(parseLensMode(stored));
  }
}
