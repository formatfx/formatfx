// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Sam Yost

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mountCanvasTabs } from './canvasTabs';
import { state } from './state';
import { customComponents } from './componentLibrary';

describe('canvasTabs add new button and dropdown', () => {
  let stripHost: HTMLElement;
  let workshopHost: HTMLElement;
  let toasts: string[] = [];
  const onToast = (m: string) => { toasts.push(m); };

  beforeEach(() => {
    document.body.innerHTML = '';
    state.resetAll();
    toasts = [];

    // Clear custom components from local storage
    localStorage.removeItem('wb-components.v1');
    stripHost = document.createElement('div');
    workshopHost = document.createElement('div');
    document.body.appendChild(stripHost);
    document.body.appendChild(workshopHost);
  });

  afterEach(() => {
    // Clean up DOM and listeners
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    document.querySelectorAll<HTMLElement>('body > *').forEach((el) => {
      (el as unknown as { _unsub?: () => void })._unsub?.();
      el.remove();
    });
  });

  it('the dirty dot reads the SHARED registry — strip and side switcher can never disagree', () => {
    mountCanvasTabs(stripHost, workshopHost, onToast);
    state.openComponentTab('builtin-deadline-chip');
    expect(stripHost.querySelector('.wb-canvastab-dot')).toBeNull();
    state.setWorkshopDirty('builtin-deadline-chip', true);
    expect(stripHost.querySelector('.wb-canvastab-dot')).not.toBeNull();
    state.setWorkshopDirty('builtin-deadline-chip', false);
    expect(stripHost.querySelector('.wb-canvastab-dot')).toBeNull();
  });

  it('remounting a workshop re-seeds the registry from keep-alive staging — drift heals', () => {
    mountCanvasTabs(stripHost, workshopHost, onToast);
    state.openComponentTab('builtin-deadline-chip');
    const ctx = state.workshopCtx!;
    ctx.commit(() => { ctx.root().txtContent = 'edited'; });
    expect(state.workshopDirty('builtin-deadline-chip')).toBe(true);
    state.minimizeView(); // stash to keep-alive
    // the registry drifts (a workspace swap cleared it; the staged edits survive)
    state.setWorkshopDirty('builtin-deadline-chip', false);
    state.openComponentTab('builtin-deadline-chip'); // resume from staging
    expect(state.workshopDirty('builtin-deadline-chip')).toBe(true);
  });

  it('renders the subtle add button at the end of the tabs', () => {
    mountCanvasTabs(stripHost, workshopHost, onToast);
    const addBtn = stripHost.querySelector('.wb-canvastabs-add') as HTMLButtonElement;
    expect(addBtn).not.toBeNull();
    expect(addBtn.textContent).toBe('＋');
  });

  it('clicking the add button opens the dropdown menu with options', () => {
    mountCanvasTabs(stripHost, workshopHost, onToast);
    const addBtn = stripHost.querySelector('.wb-canvastabs-add') as HTMLButtonElement;
    addBtn.dispatchEvent(new Event('click'));

    const menu = document.querySelector('.wb-grid-menu') as HTMLElement;
    expect(menu).not.toBeNull();

    const items = [...menu.querySelectorAll('.wb-menu-main')].map(b => b.textContent?.trim());
    expect(items).toContain('New view…');
    expect(items).toContain('New component…');
    expect(items).toHaveLength(2); // ONE view door — row and tile share the selector
  });

  it('clicking "New view…" opens the layout selector with both groups', () => {
    mountCanvasTabs(stripHost, workshopHost, onToast);
    const addBtn = stripHost.querySelector('.wb-canvastabs-add') as HTMLButtonElement;
    addBtn.dispatchEvent(new Event('click'));

    const menu = document.querySelector('.wb-grid-menu') as HTMLElement;
    const viewBtn = [...menu.querySelectorAll('.wb-menu-main')].find(b => b.textContent?.includes('New view…')) as HTMLElement;
    viewBtn.dispatchEvent(new Event('click'));

    // Check menu is closed
    expect(document.querySelector('.wb-grid-menu')).toBeNull();

    // Check the selector is open with row layouts leading and tiles right behind
    const modal = document.querySelector('.wb-template-modal') as HTMLElement;
    expect(modal).not.toBeNull();
    const heads = [...modal.querySelectorAll('.wb-template-gallery-head')].map((h) => h.textContent);
    expect(heads).toEqual(['Row layouts', 'Tile layouts']);
  });

  it('clicking "New component…" creates a new blank component, opens its workshop tab, and toasts', () => {
    mountCanvasTabs(stripHost, workshopHost, onToast);
    const addBtn = stripHost.querySelector('.wb-canvastabs-add') as HTMLButtonElement;
    addBtn.dispatchEvent(new Event('click'));

    const menu = document.querySelector('.wb-grid-menu') as HTMLElement;
    const compBtn = [...menu.querySelectorAll('.wb-menu-main')].find(b => b.textContent?.includes('New component…')) as HTMLElement;
    compBtn.dispatchEvent(new Event('click'));

    // Check state has new component tab open
    expect(state.activeComponentTab).not.toBeNull();
    const activeCompId = state.activeComponentTab!;

    // Check the component exists in customComponents
    const customs = customComponents();
    expect(customs.some(c => c.id === activeCompId)).toBe(true);

    // Check toast notification
    expect(toasts.length).toBeGreaterThan(0);
    expect(toasts[0]).toContain('Started');
  });
});
