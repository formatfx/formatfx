/**
 * fxBar DOM integration (happy-dom): the bar mounts, the slot picker drives
 * what's edited, Excel input is transpiled to SP in one undoable mutation, and
 * refuse-don't-guess input is rejected without ever touching the document.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mountFxBar } from './fxBar';
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
  editor.dispatchEvent(new Event('change'));
};

describe('fxBar', () => {
  beforeEach(() => {
    state.loadDocument({ kind: 'column', root: { elmType: 'div' } });
    state.select([]);
  });

  it('lists the slots for the selected element', () => {
    const host = mountWith({ elmType: 'div' });
    const labels = [...host.querySelectorAll('.wb-fx-slot option')].map((o) => o.textContent);
    expect(labels).toEqual(expect.arrayContaining(['Text shown', 'Fill color', 'Text color']));
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
});
