/**
 * fxBar DOM integration (happy-dom): the bar mounts, the slot picker drives
 * what's edited, Excel input is transpiled to SP in one undoable mutation, and
 * refuse-don't-guess input is rejected without ever touching the document.
 *
 * Each test opens the element under test as a view sheet's ROOT and selects
 * it — kind-'column' canvas documents left the model (COLUMNS-COMPONENTS-
 * VIEWS §1: a column's look is a component instance, not a document), and
 * loadDocument('column') now registers an imported LOOK instead of putting
 * the tree on the canvas.
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
  state.createView({ kind: 'row', root });
  state.select([]); // the element under test IS the view root
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
    state.resetAll(); // fresh workspace + empty undo stack per test
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

  it('marks slots with a static value with a · suffix and heavy bold; unset slots stay plain', () => {
    const host = mountWith({ elmType: 'div', style: { color: '#000' } });
    const opts = [...host.querySelectorAll<HTMLOptionElement>('.wb-fx-slot option')];
    const set = opts.find((o) => o.textContent === 'Text color ·');
    const unset = opts.find((o) => o.textContent === 'Fill color');
    expect(set).toBeDefined();        // · suffix is present when a static value is set
    expect(set?.style.fontWeight).toBe('800');
    expect(unset).toBeDefined();      // no suffix when nothing is set
    expect(unset?.style.fontWeight).toBe('');
  });

  it('marks formula-driven slots with a ƒ suffix (not ·) so makers can spot dynamic slots at a glance', () => {
    const host = mountWith({ elmType: 'div', style: { 'background-color': "=if([$Status] == 'Done', '#107c10', '#d13438')" } });
    const opts = [...host.querySelectorAll<HTMLOptionElement>('.wb-fx-slot option')];
    const formula = opts.find((o) => o.textContent === 'Fill color ƒ');
    const literal = opts.find((o) => o.textContent === 'Text color');
    expect(formula).toBeDefined();        // ƒ suffix for formula-driven
    expect(formula?.style.fontWeight).toBe('800');
    expect(literal).toBeDefined();        // no suffix when nothing is set
    expect(literal?.style.fontWeight).toBe('');
  });

  it('treats number and boolean slot values as static (·), not formula-driven (ƒ)', () => {
    // opacity: 0.6 is a number literal — a valid SPExpr but not a formula
    const host = mountWith({ elmType: 'div', style: { opacity: 0.6 as unknown as string } });
    const opts = [...host.querySelectorAll<HTMLOptionElement>('.wb-fx-slot option')];
    const numericSlot = opts.find((o) => o.textContent === 'Opacity ·');
    expect(numericSlot).toBeDefined();    // · not ƒ — a number is a static literal
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

  describe('× clear-slot button', () => {
    it('removes the slot value in one undoable mutation when clicked', () => {
      const host = mountWith({ elmType: 'div', style: { 'background-color': '#107c10' } });
      setSlot(host, 'fill');
      const btn = $<HTMLButtonElement>(host, '.wb-fx-clear');
      expect(btn.hidden).toBe(false);
      btn.dispatchEvent(new Event('click'));
      expect(state.selectedNode!.style?.['background-color']).toBeUndefined();
      state.undo();
      expect(state.selectedNode!.style!['background-color']).toBe('#107c10');
    });

    it('is hidden when the slot has no value', () => {
      const host = mountWith({ elmType: 'div' });
      setSlot(host, 'fill');
      expect($<HTMLButtonElement>(host, '.wb-fx-clear').hidden).toBe(true);
    });

    it('is hidden when the slot holds a read-only AST-form formula', () => {
      const host = mountWith({ elmType: 'div', style: { 'background-color': '=toString([$DueDate])' } });
      setSlot(host, 'fill');
      expect($<HTMLButtonElement>(host, '.wb-fx-clear').hidden).toBe(true);
    });
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

    // instant model: input clears a lingering refusal, change (blur) commits.
    // There is no Apply button — the roomy editor commits like the inline bar.
    const typeFloat = (panel: HTMLElement, text: string): void => {
      const ta = $<HTMLTextAreaElement>(panel, '.wb-fx-float-editor');
      ta.value = text;
      ta.dispatchEvent(new Event('input'));
      ta.dispatchEvent(new Event('change'));
    };

    // a column chip dragged from the shelf: FIELD_MIME payload = the field name
    const fieldDrag = (name: string, kind: 'dragover' | 'drop'): Event => {
      const ev = new Event(kind, { bubbles: false, cancelable: true });
      (ev as unknown as { dataTransfer: unknown }).dataTransfer = {
        types: ['application/x-wb-field'],
        getData: (m: string) => (m === 'application/x-wb-field' ? name : ''),
        setData: () => {},
        dropEffect: '',
        effectAllowed: '',
      };
      return ev;
    };

    it('⤢ opens a roomy editor; typing + blur (change) commits — no Apply button', () => {
      const host = mountWith({ elmType: 'div' });
      setSlot(host, 'ink');
      const panel = openFloat(host);
      expect(panel.querySelector('.wb-fx-float-apply')).toBeNull(); // Apply is gone
      typeFloat(panel, '=IF([Status] = "Blocked", "#d13438", "")');
      expect(state.selectedNode!.style!['color']).toBe("=if([$Status] == 'Blocked', '#d13438', '')");
      // a free-floating tool window — it stays open after the commit
      expect(document.querySelector('.wb-fx-float')).not.toBeNull();
    });

    it('a refusal on commit leaves the document untouched and shows an error', () => {
      const host = mountWith({ elmType: 'div' });
      setSlot(host, 'fill');
      const panel = openFloat(host);
      typeFloat(panel, '=NOPE([Status]');
      expect(state.selectedNode!.style).toBeUndefined();            // nothing written
      expect(document.querySelector('.wb-fx-float')).not.toBeNull(); // stays open
      expect($(panel, '.wb-fx-feedback').getAttribute('data-tone')).toBe('error');
    });

    it('✕ closes the window (changes already applied instantly)', () => {
      const host = mountWith({ elmType: 'div' });
      setSlot(host, 'fill');
      const panel = openFloat(host);
      $<HTMLButtonElement>(panel, '.wb-fx-float-dismiss').dispatchEvent(new Event('click'));
      expect(document.querySelector('.wb-fx-float')).toBeNull();
    });

    it('accepts a column-chip drag (FIELD_MIME): prevents default and highlights', () => {
      const host = mountWith({ elmType: 'div' });
      setSlot(host, 'fill');
      const ta = $<HTMLTextAreaElement>(openFloat(host), '.wb-fx-float-editor');
      const ev = fieldDrag('Status', 'dragover');
      ta.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(true);
      expect(ta.classList.contains('wb-fx-float-drop')).toBe(true);
      // a payload it won't act on is ignored — no highlight, no preventDefault
      const foreign = new Event('dragover', { bubbles: false, cancelable: true });
      (foreign as unknown as { dataTransfer: unknown }).dataTransfer = { types: ['application/x-wb-component'], getData: () => '', setData: () => {}, dropEffect: '' };
      ta.dispatchEvent(foreign);
      expect(foreign.defaultPrevented).toBe(false);
    });

    it('dropping a column onto an empty editor binds it as =[Column] and applies', () => {
      const host = mountWith({ elmType: 'div' });
      setSlot(host, 'fill');
      const ta = $<HTMLTextAreaElement>(openFloat(host), '.wb-fx-float-editor');
      ta.value = ''; // an empty editor — a bare drop becomes a whole-column binding
      ta.dispatchEvent(fieldDrag('Status', 'drop'));
      expect(ta.value).toBe('=[Status]');
      expect(state.selectedNode!.style!['background-color']).toBe('=[$Status]');
    });

    it('dropping a column into a formula splices its [Column] reference at the caret', () => {
      const host = mountWith({ elmType: 'div' });
      setSlot(host, 'fill');
      const ta = $<HTMLTextAreaElement>(openFloat(host), '.wb-fx-float-editor');
      ta.value = '=IF(';
      ta.setSelectionRange(4, 4);
      ta.dispatchEvent(fieldDrag('Owner', 'drop'));
      expect(ta.value).toBe('=IF([Owner]');
      expect(state.selectedNode!.style).toBeUndefined(); // mid-formula: not committed yet
    });

    it('dropping an unknown field is a no-op', () => {
      const host = mountWith({ elmType: 'div' });
      setSlot(host, 'fill');
      const ta = $<HTMLTextAreaElement>(openFloat(host), '.wb-fx-float-editor');
      ta.value = '';
      ta.dispatchEvent(fieldDrag('Ghost', 'drop'));
      expect(ta.value).toBe('');
      expect(state.selectedNode!.style).toBeUndefined();
    });
  });
});
