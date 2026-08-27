/**
 * The side pane's doc switcher — a compact "which doc is this pane showing"
 * button in the side-pane head that lists every open canvas tab and NAVIGATES
 * on pick (the same chokepoints the canvas strip uses — lockstep, never a
 * second source of truth). Dirty component tabs wear the same unsaved marker
 * as the strip, read from the shared state registry.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mountSideDocSwitcher } from './sideDocSwitcher';
import { state } from './state';

afterEach(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  document.querySelectorAll<HTMLElement>('body > *').forEach((el) => {
    (el as unknown as { _unsub?: () => void })._unsub?.();
    el.remove();
  });
  state.resetAll();
});

beforeEach(() => {
  state.resetAll();
});

function mount(): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  mountSideDocSwitcher(host, () => {});
  return host;
}

const nameOf = (host: HTMLElement): string =>
  host.querySelector('.wb-side-doc-name')!.textContent ?? '';
const markOf = (host: HTMLElement): string =>
  host.querySelector('.wb-side-doc-mark')!.textContent ?? '';
const openTheMenu = (host: HTMLElement): HTMLElement => {
  host.querySelector<HTMLButtonElement>('.wb-side-doc-btn')!.click();
  return document.querySelector('.wb-grid-menu') as HTMLElement;
};
const menuRows = (menu: HTMLElement): HTMLButtonElement[] =>
  [...menu.querySelectorAll<HTMLButtonElement>('.wb-menu-main')];

describe('the side doc switcher', () => {
  it('shows the active tab — the standing Grid by default', () => {
    const host = mount();
    expect(nameOf(host)).toBe('Grid');
    expect(markOf(host)).toBe('▦');
    // the label claims the active TAB, not what every pane displays —
    // Explain keeps describing the surface under a workshop (Copilot review)
    const btn = host.querySelector('.wb-side-doc-btn')!;
    expect(btn.getAttribute('aria-label')).toContain('is active');
    expect(btn.getAttribute('title')).toContain('Active canvas tab');
  });

  it('follows navigation lockstep: opening a view relabels, minimizing goes back to Grid', () => {
    const host = mount();
    const sheet = state.createView({ kind: 'row', root: { elmType: 'div' } })!;
    expect(nameOf(host)).toBe(sheet.name);
    expect(markOf(host)).toBe('☰');
    state.minimizeView();
    expect(nameOf(host)).toBe('Grid');
  });

  it('lists every open tab, marks the current one, and picking one navigates', () => {
    const host = mount();
    const sheet = state.createView({ kind: 'row', root: { elmType: 'div' } })!;
    const menu = openTheMenu(host);
    const rows = menuRows(menu);
    expect(rows.map((r) => r.textContent)).toEqual(expect.arrayContaining([
      expect.stringContaining('Grid'), expect.stringContaining(sheet.name),
    ]));
    // the active view's row is marked current
    const current = rows.find((r) => r.getAttribute('aria-current') === 'true');
    expect(current?.textContent).toContain(sheet.name);
    // picking Grid navigates back — pure lockstep, no second tab state
    rows.find((r) => r.textContent?.includes('Grid'))!.click();
    expect(state.activeTabKey).toBe('grid');
    expect(nameOf(host)).toBe('Grid');
  });

  it('component workshop tabs list too, and picking one activates the workshop tab', () => {
    const host = mount();
    state.openComponentTab('builtin-deadline-chip');
    expect(nameOf(host)).toBe('Deadline chip');
    expect(markOf(host)).toBe('⬡');
    state.minimizeView(); // back to the surface; the tab stays open
    const menu = openTheMenu(host);
    menuRows(menu).find((r) => r.textContent?.includes('Deadline chip'))!.click();
    expect(state.activeTabKey).toBe('component:builtin-deadline-chip');
  });

  it('a dirty component tab wears the unsaved marker (the shared registry, not strip-local state)', () => {
    const host = mount();
    state.openComponentTab('builtin-deadline-chip');
    state.setWorkshopDirty('builtin-deadline-chip', true);
    const menu = openTheMenu(host);
    const row = menuRows(menu).find((r) => r.textContent?.includes('Deadline chip'))!;
    expect(row.textContent).toContain('unsaved');
  });
});
