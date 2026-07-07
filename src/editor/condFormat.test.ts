/**
 * Conditional formatting (happy-dom) — the theme-class look mode added for theme
 * style classes. A fresh dialog opens in the familiar hex/style look mode (all
 * five looks); the ✨ mode toggle flips to emitting a theme-class =if() chain onto
 * attributes.class (survives dark mode + tenant themes). Generated class chains
 * reopen into editable rules in theme mode.
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
const modeBtn = () => panel().querySelector<HTMLButtonElement>('.wb-cf-mode')!;
const addBtn = () => panel().querySelector<HTMLButtonElement>('.wb-cf-addbtn')!;
const applyBtn = () => panel().querySelector<HTMLButtonElement>('.wb-cf-apply')!;
const open = () => openCondFormat({ kind: 'element', path: [0] }, () => {});

beforeEach(() => { document.body.innerHTML = ''; localStorage.clear(); state.resetAll(); });
afterEach(() => { closeCondFormat(); document.body.innerHTML = ''; });

describe('conditional formatting — hex by default, theme classes as a toggle', () => {
  it('the ✨ mode toggle emits a severity-class chain to attributes.class', () => {
    setup();
    open();
    modeBtn().click();              // hex → theme-aware classes
    cond('is Done').click();        // choice eq → suggests green
    look('Soft fill').click();      // fill look → severity for a status color
    addBtn().click();
    applyBtn().click();
    expect(node0().attributes?.class).toBe("=if([$Status] == 'Done', 'sp-field-severity--good', '')");
    expect(node0().style).toBeUndefined();
  });

  it('a text look emits ms-fontColor and reopens back into editable theme rules', () => {
    setup();
    open();
    modeBtn().click();
    cond('is Blocked').click();     // suggests red
    look('Color the text').click(); // text look → ms-fontColor-redDark
    addBtn().click();
    applyBtn().click();
    expect(node0().attributes?.class).toBe("=if([$Status] == 'Blocked', 'ms-fontColor-redDark', '')");
    // reopen: the generated class chain parses back into one rule, theme mode
    open();
    expect(panel().querySelectorAll('.wb-cf-rule').length).toBe(1);
    expect(modeBtn().textContent).toContain('Theme-aware');
  });

  it('defaults to hex/style mode: a rule writes style, not a class', () => {
    setup();
    open();
    cond('is Done').click();
    look('Solid pill').click();     // pill exists only in hex mode
    addBtn().click();
    applyBtn().click();
    expect(node0().attributes?.class).toBeUndefined();
    expect(typeof node0().style?.['background-color']).toBe('string');
  });
});
