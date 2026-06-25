/**
 * fxBar DOM integration (happy-dom): the bar mounts, the slot picker drives
 * what's edited, Excel input is transpiled to SP in one undoable mutation, and
 * refuse-don't-guess input is rejected without ever touching the document.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountFxBar } from './fxBar';
import { fxSuggestions } from './fxSuggest';
import { slotsFor } from './fxSlots';
import { state } from './state';
import type { SPElement } from '../core/types';

const $ = <T extends Element>(host: HTMLElement, sel: string): T => {
  const el = host.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};

const mountWith = (root: SPElement): HTMLElement => {
  const host = document.createElement('div');
  mountFxBar(host);
  state.loadDocument({ kind: 'column', root });
  state.select([]);
  return host;
};

const setSlot = (host: HTMLElement, id: string): void => {
  const picker = $<HTMLSelectElement>(host, '.wb-fx-slot');
  picker.value = id;
  picker.dispatchEvent(new Event('change'));
};

const type = (host: HTMLElement, text: string): void => {
  const editor = $<HTMLTextAreaElement>(host, '.wb-fx-editor');
  editor.value = text;
  editor.dispatchEvent(new Event('input'));
  editor.dispatchEvent(new Event('change'));
};

/** Focus the bar to open the value menu, then return its option buttons. */
const openMenu = (host: HTMLElement): HTMLButtonElement[] => {
  $<HTMLTextAreaElement>(host, '.wb-fx-editor').dispatchEvent(new Event('focus'));
  return [...document.querySelectorAll<HTMLButtonElement>('.wb-fx-menu-opt')];
};

describe('fxBar', () => {
  beforeEach(() => {
    state.loadDocument({ kind: 'column', root: { elmType: 'div' } });
    state.select([]);
  });

  // the detached editor + the on-focus value menu live on document.body — sweep
  // any left open so one test's pop-up can't bleed into the next
  afterEach(() => {
    document.querySelectorAll('.wb-fx-float, .wb-fx-menu').forEach((p) => p.remove());
  });

  it('lists the slots for the selected element by plain label', () => {
    const host = mountWith({ elmType: 'div' });
    const labels = [...host.querySelectorAll('.wb-fx-slot option')].map((o) => o.textContent);
    expect(labels).toEqual(expect.arrayContaining(['Text shown', 'Fill color', 'Text color']));
  });

  it('marks slots with a value with a · suffix and heavy bold; unset slots stay plain', () => {
    const host = mountWith({ elmType: 'div', style: { color: '#000' } });
    const opts = [...host.querySelectorAll<HTMLOptionElement>('.wb-fx-slot option')];
    const set = opts.find((o) => o.textContent === 'Text color ·')!;
    const unset = opts.find((o) => o.textContent === 'Fill color')!;
    expect(set).toBeDefined();       // · suffix is present when a value is set
    expect(set.style.fontWeight).toBe('800');
    expect(unset).toBeDefined();     // no suffix when nothing is set
    expect(unset.style.fontWeight).toBe('');
  });

  it('transpiles Excel input to stored SP in one undoable mutation', () => {
    const host = mountWith({ elmType: 'div' });
    setSlot(host, 'fill');
    type(host, '=IF([Status] = "Done", "#107c10", "#d13438")');
    expect(state.selectedNode!.style!['background-color'])
      .toBe("=if([$Status] == 'Done', '#107c10', '#d13438')");
    // one undo reverts it
    state.undo();
    expect(state.selectedNode!.style).toBeUndefined();
  });

  it('stores a plain (non-=) value as a literal', () => {
    const host = mountWith({ elmType: 'div' });
    setSlot(host, 'ink');
    type(host, '#0078d4');
    expect(state.selectedNode!.style!['color']).toBe('#0078d4');
  });

  it('refuses bad input without mutating the document', () => {
    const host = mountWith({ elmType: 'div' });
    setSlot(host, 'fill');
    type(host, '=NOPE([Status]');
    expect(state.selectedNode!.style).toBeUndefined(); // nothing written
    expect($(host, '.wb-fx-feedback').getAttribute('data-tone')).toBe('error');
  });

  it('renders a stored SP formula back toward Excel in the editor', () => {
    const host = mountWith({
      elmType: 'div',
      style: { 'background-color': "=if([$Status] == 'Done', '#107c10', '#d13438')" },
    });
    setSlot(host, 'fill');
    expect($<HTMLTextAreaElement>(host, '.wb-fx-editor').value)
      .toBe('=IF([Status] = "Done", "#107c10", "#d13438")');
  });

  it('shows a formula outside the Excel subset read-only, pointing at Advanced', () => {
    const host = mountWith({
      elmType: 'div',
      style: { 'background-color': "=toString([$DueDate])" },
    });
    setSlot(host, 'fill');
    const editor = $<HTMLTextAreaElement>(host, '.wb-fx-editor');
    expect(editor.readOnly).toBe(true);
    expect(editor.value).toBe('=toString([$DueDate])');
    expect($(host, '.wb-fx-feedback').textContent).toMatch(/Advanced/i);
  });

  it('clearing the editor removes the slot', () => {
    const host = mountWith({ elmType: 'span', txtContent: 'hi' });
    setSlot(host, 'text');
    type(host, '');
    expect(state.selectedNode!.txtContent).toBeUndefined();
  });

  it('pre-populates the bar with the best default as an uncommitted draft', () => {
    const host = mountWith({ elmType: 'div' });
    setSlot(host, 'fill');
    const editor = $<HTMLTextAreaElement>(host, '.wb-fx-editor');
    const fill = slotsFor(state.selectedNode!).find((s) => s.id === 'fill')!;
    expect(editor.value).toBe(fxSuggestions(fill, state.fields)[0]); // the smart default
    expect(editor.classList.contains('wb-fx-draft')).toBe(true);
    expect(state.selectedNode!.style).toBeUndefined(); // a draft never writes
  });

  it('pressing Enter accepts the pre-populated draft', () => {
    const host = mountWith({ elmType: 'div' });
    setSlot(host, 'ink');
    const editor = $<HTMLTextAreaElement>(host, '.wb-fx-editor');
    expect(editor.value).not.toBe(''); // a default was typed for the user
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(state.selectedNode!.style!['color']).toBeDefined();
  });

  it('offers type-aware value choices as a styled menu on focus (no chip wall)', () => {
    const host = mountWith({ elmType: 'div' });
    setSlot(host, 'fill');
    expect(document.querySelector('.wb-fx-menu')).toBeNull(); // nothing until focus
    const opts = openMenu(host);
    expect(opts.length).toBeGreaterThan(0);
    // a literal colour is drawn with a swatch; a template reads as a ƒx formula
    expect(document.querySelectorAll('.wb-fx-menu .wb-fx-swatch').length).toBeGreaterThan(0);
    expect([...document.querySelectorAll('.wb-fx-opt-formula')]
      .some((n) => n.textContent!.startsWith('=IF('))).toBe(true);
  });

  it('the value menu opens on focus and closes on blur', () => {
    const host = mountWith({ elmType: 'div' });
    setSlot(host, 'fill');
    const editor = $<HTMLTextAreaElement>(host, '.wb-fx-editor');
    editor.dispatchEvent(new Event('focus'));
    expect(document.querySelector('.wb-fx-menu')).not.toBeNull();
    editor.dispatchEvent(new Event('blur'));
    expect(document.querySelector('.wb-fx-menu')).toBeNull();
  });

  it('clicking a menu option fills the editor and applies it', () => {
    const host = mountWith({ elmType: 'div' });
    setSlot(host, 'fill');
    const opt = openMenu(host).find((c) => c.textContent === '#107c10')!; // the literal swatch
    opt.dispatchEvent(new Event('click'));
    expect(state.selectedNode!.style!['background-color']).toBe('#107c10');
  });

  it('the placeholder is specific to the selected property', () => {
    const host = mountWith({ elmType: 'div' });
    const ph = (): string => $<HTMLTextAreaElement>(host, '.wb-fx-editor').placeholder;
    setSlot(host, 'weight');
    expect(ph()).toContain('bold'); // weight example, not a colour formula
    setSlot(host, 'align');
    expect(ph().toLowerCase()).toContain('left'); // alignment example
  });

  describe('the feedback line (quiet, transient)', () => {
    const fb = (host: HTMLElement): HTMLElement => $(host, '.wb-fx-feedback');

    it('stays silent by default — no hint, no draft nudge, no "applied"', () => {
      const host = mountWith({ elmType: 'div' });
      setSlot(host, 'fill'); // a draftable slot (pre-populates the editor)
      expect(fb(host).textContent).toBe('');
      expect(fb(host).hasAttribute('data-tone')).toBe(false);
    });

    it('says nothing on a successful apply', () => {
      const host = mountWith({ elmType: 'div' });
      setSlot(host, 'ink');
      type(host, '#0078d4');
      expect(state.selectedNode!.style!['color']).toBe('#0078d4'); // applied…
      expect(fb(host).textContent).toBe(''); // …but silent about it
    });

    it('shows a refusal in red, then clears the moment the maker types again', () => {
      const host = mountWith({ elmType: 'div' });
      setSlot(host, 'fill');
      type(host, '=NOPE([Status]');
      expect(fb(host).getAttribute('data-tone')).toBe('error');
      $<HTMLTextAreaElement>(host, '.wb-fx-editor').dispatchEvent(new Event('input'));
      expect(fb(host).textContent).toBe('');
      expect(fb(host).hasAttribute('data-tone')).toBe(false);
    });

    it('lets the maker dismiss a refusal with the ✕', () => {
      const host = mountWith({ elmType: 'div' });
      setSlot(host, 'fill');
      type(host, '=NOPE([Status]');
      $<HTMLButtonElement>(host, '.wb-fx-feedback-x').dispatchEvent(new Event('click'));
      expect(fb(host).textContent).toBe('');
      expect(fb(host).hasAttribute('data-tone')).toBe(false);
    });

    it('fades a refusal on its own after a readable beat', () => {
      vi.useFakeTimers();
      try {
        const host = mountWith({ elmType: 'div' });
        setSlot(host, 'fill');
        type(host, '=NOPE([Status]');
        expect(fb(host).getAttribute('data-tone')).toBe('error');
        vi.advanceTimersByTime(6000);
        expect(fb(host).textContent).toBe('');
        expect(fb(host).hasAttribute('data-tone')).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps a read-only note visible (a persistent condition, not a refusal)', () => {
      const host = mountWith({
        elmType: 'div',
        style: { 'background-color': '=toString([$DueDate])' },
      });
      setSlot(host, 'fill');
      expect(fb(host).getAttribute('data-tone')).toBe('raw');
      expect(fb(host).textContent).toMatch(/Advanced/i);
    });
  });

  describe('floating / detached editor', () => {
    const openFloat = (host: HTMLElement): HTMLElement => {
      $<HTMLButtonElement>(host, '.wb-fx-expand').dispatchEvent(new Event('click'));
      const panel = document.querySelector<HTMLElement>('.wb-fx-float');
      if (!panel) throw new Error('float did not open');
      return panel;
    };

    it('⤢ opens a roomy editor; Apply transpiles and keeps the window open', () => {
      const host = mountWith({ elmType: 'div' });
      setSlot(host, 'ink');
      const panel = openFloat(host);
      const ta = $<HTMLTextAreaElement>(panel, '.wb-fx-float-editor');
      ta.value = '=IF([Status] = "Blocked", "#d13438", "")';
      $<HTMLButtonElement>(panel, '.wb-fx-float-apply').dispatchEvent(new Event('click'));
      expect(state.selectedNode!.style!['color']).toBe("=if([$Status] == 'Blocked', '#d13438', '')");
      // it's a free-floating tool window now — it stays open after Apply
      expect(document.querySelector('.wb-fx-float')).not.toBeNull();
    });

    it('✕ dismisses without mutating, keeping the typed text unapplied for reopen', () => {
      const host = mountWith({ elmType: 'div' });
      setSlot(host, 'fill');
      const panel = openFloat(host);
      $<HTMLTextAreaElement>(panel, '.wb-fx-float-editor').value = '#000000';
      $<HTMLButtonElement>(panel, '.wb-fx-float-dismiss').dispatchEvent(new Event('click'));
      expect(state.selectedNode!.style).toBeUndefined(); // dismiss never commits
      expect(document.querySelector('.wb-fx-float')).toBeNull();
      // reopening on the same cell/slot resumes the unapplied text
      const reopened = openFloat(host);
      expect($<HTMLTextAreaElement>(reopened, '.wb-fx-float-editor').value).toBe('#000000');
      expect(state.selectedNode!.style).toBeUndefined(); // still uncommitted
    });

    it('refused input in the float keeps it open and leaves the doc untouched', () => {
      const host = mountWith({ elmType: 'div' });
      setSlot(host, 'fill');
      const panel = openFloat(host);
      $<HTMLTextAreaElement>(panel, '.wb-fx-float-editor').value = '=NOPE([Status]';
      $<HTMLButtonElement>(panel, '.wb-fx-float-apply').dispatchEvent(new Event('click'));
      expect(state.selectedNode!.style).toBeUndefined();
      expect(document.querySelector('.wb-fx-float')).not.toBeNull(); // stays open
      expect($(panel, '.wb-fx-feedback').getAttribute('data-tone')).toBe('error');
    });
  });
});
