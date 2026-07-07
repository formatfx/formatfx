/**
 * Conditional formatting (happy-dom) — the classes-first theme mode. A fresh
 * dialog defaults to emitting a theme-class =if() chain onto attributes.class
 * (survives dark mode + tenant re-theming); a mode toggle falls back to the
 * fixed-hex style looks. Generated class chains reopen into editable rules.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openCondFormat, closeCondFormat } from './condFormat';
import { state } from './state';

function setup(): void {
  state.createView({
    kind: 'row',
    root: { elmType: 'div', children: [{ elmType: 'div', txtContent: '[$Status]' }] },
  });
}
const node0 = () => state.doc.root.children![0];
const panel = (): HTMLElement => document.querySelector('.wb-cf')!;
function byText<T extends HTMLElement>(sel: string, text: string): T {
  return [...panel().querySelectorAll<T>(sel)].find((b) => b.textContent?.includes(text))!;
}
const cond = (t: string) => byText<HTMLButtonElement>('.wb-cf-cond', t);
const look = (t: string) => byText<HTMLButtonElement>('.wb-cf-look', t);
const addBtn = () => panel().querySelector<HTMLButtonElement>('.wb-cf-addbtn')!;
const applyBtn = () => panel().querySelector<HTMLButtonElement>('.wb-cf-apply')!;
const open = () => openCondFormat({ kind: 'element', path: [0] }, () => {});

beforeEach(() => { document.body.innerHTML = ''; localStorage.clear(); state.resetAll(); });
afterEach(() => { closeCondFormat(); document.body.innerHTML = ''; });

describe('conditional formatting — theme-aware (classes-first) mode', () => {
  it('defaults to theme mode and applies a severity-class chain to attributes.class', () => {
    setup();
    open();
    expect(byText('.wb-cf-mode', 'Theme-aware')).toBeTruthy(); // classes-first default
    cond('is Done').click();        // choice eq → suggests green
    look('Soft fill').click();      // fill look → severity for a status color
    addBtn().click();
    applyBtn().click();
    expect(node0().attributes?.class).toBe("=if([$Status] == 'Done', 'sp-field-severity--good', '')");
    expect(node0().style).toBeUndefined();
  });

  it('a text look emits ms-fontColor and reopens back into editable rules', () => {
    setup();
    open();
    cond('is Blocked').click();     // suggests red
    look('Color the text').click(); // text look → ms-fontColor-redDark
    addBtn().click();
    applyBtn().click();
    expect(node0().attributes?.class).toBe("=if([$Status] == 'Blocked', 'ms-fontColor-redDark', '')");
    // reopen: the generated class chain parses back into one rule, theme mode
    open();
    expect(panel().querySelectorAll('.wb-cf-rule').length).toBe(1);
    expect(byText('.wb-cf-mode', 'Theme-aware')).toBeTruthy();
  });

  it('toggling to fixed-hex mode writes style, not a class', () => {
    setup();
    open();
    byText<HTMLButtonElement>('.wb-cf-mode', 'Theme-aware').click(); // → fixed hex
    cond('is Done').click();
    look('Solid pill').click();     // pill exists only in hex mode
    addBtn().click();
    applyBtn().click();
    expect(node0().attributes?.class).toBeUndefined();
    expect(typeof node0().style?.['background-color']).toBe('string');
  });
});
