/**
 * Field guide (happy-dom) — the live color-class gallery hydrated into
 * #wb-guide-colorwall. One cell per emulated palette token (bg/font/border
 * class) plus the five status-fill chips, each click-to-copy. Driven off the
 * live palette so it stays in sync with the theme emulation.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { openGuide, closeGuide } from './guide';
import { GUIDE_PAGES } from './guideContent';
import { themePalette } from '../core/theme';

const galleryPage = GUIDE_PAGES.find((p) => p.body.includes('id="wb-guide-colorwall"'))!;

afterEach(() => { closeGuide(); document.body.innerHTML = ''; });

describe('field guide — live color-class gallery', () => {
  it('mounts one cell per emulated palette token, plus the five severity chips', () => {
    expect(galleryPage).toBeTruthy();
    openGuide(galleryPage.id);
    const wall = document.querySelector('#wb-guide-colorwall')!;
    expect(wall.querySelectorAll('.wb-colorwall-cell').length)
      .toBe(Object.keys(themePalette('light')).length);
    expect(wall.querySelectorAll('.wb-colorwall-sevchip').length).toBe(5);
    // each family class is offered — bg/font/border for a token
    expect(wall.querySelector('.wb-colorwall-sw.ms-bgColor-green')).toBeTruthy();
    expect(wall.querySelector('.wb-colorwall-sw.ms-fontColor-green')).toBeTruthy();
    expect(wall.querySelector('.wb-colorwall-sw.sp-css-borderColor-green')).toBeTruthy();
  });

  it('clicking a swatch copies its class name into the note', () => {
    openGuide(galleryPage.id);
    document.querySelector<HTMLButtonElement>('.wb-colorwall-sw.ms-bgColor-themePrimary')!.click();
    expect(document.querySelector('#wb-guide-colorwall .wb-guide-iconwall-note')?.textContent)
      .toContain('ms-bgColor-themePrimary');
  });
});
