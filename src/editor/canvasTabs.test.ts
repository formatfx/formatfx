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
    expect(items).toContain('New rowview…');
    expect(items).toContain('New tileview…');
    expect(items).toContain('New component…');
  });

  it('clicking "New rowview…" opens the template modal with Row layouts first', () => {
    mountCanvasTabs(stripHost, workshopHost, onToast);
    const addBtn = stripHost.querySelector('.wb-canvastabs-add') as HTMLButtonElement;
    addBtn.dispatchEvent(new Event('click'));

    const menu = document.querySelector('.wb-grid-menu') as HTMLElement;
    const rowBtn = [...menu.querySelectorAll('.wb-menu-main')].find(b => b.textContent?.includes('New rowview…')) as HTMLElement;
    rowBtn.dispatchEvent(new Event('click'));

    // Check menu is closed
    expect(document.querySelector('.wb-grid-menu')).toBeNull();

    // Check template modal is open with row target first
    const modal = document.querySelector('.wb-template-modal') as HTMLElement;
    expect(modal).not.toBeNull();
    const firstHead = modal.querySelector('.wb-template-gallery-head');
    expect(firstHead?.textContent).toBe('Row layouts');
  });

  it('clicking "New tileview…" opens the template modal with Tile layouts first', () => {
    mountCanvasTabs(stripHost, workshopHost, onToast);
    const addBtn = stripHost.querySelector('.wb-canvastabs-add') as HTMLButtonElement;
    addBtn.dispatchEvent(new Event('click'));

    const menu = document.querySelector('.wb-grid-menu') as HTMLElement;
    const tileBtn = [...menu.querySelectorAll('.wb-menu-main')].find(b => b.textContent?.includes('New tileview…')) as HTMLElement;
    tileBtn.dispatchEvent(new Event('click'));

    // Check template modal is open with tile target first
    const modal = document.querySelector('.wb-template-modal') as HTMLElement;
    expect(modal).not.toBeNull();
    const firstHead = modal.querySelector('.wb-template-gallery-head');
    expect(firstHead?.textContent).toBe('Tile layouts');
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
