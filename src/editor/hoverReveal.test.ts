/**
 * Contract for the "Reveal on hover" authoring gesture (issue #203):
 * one toggle = both class edits (child on the element, parent on a container)
 * in one undoable mutation; semantics per HANDOFF §3.7.
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { SPElement } from '../core/types';
import {
  HOVER_PARENT_CLASS, HOVER_CHILD_CLASS,
  hoverRevealStatus, setRevealOnHover, subtreeHasHoverChild,
  addClassToken, removeClassToken, hasClassToken,
} from './hoverReveal';
import { mountInspector } from './inspector';
import { state } from './state';

const cls = (el: SPElement) => (typeof el.attributes?.class === 'string' ? el.attributes.class : '');

describe('class token helpers', () => {
  it('add/remove preserve unrelated tokens and drop empty attribute objects', () => {
    const el: SPElement = { elmType: 'div', attributes: { class: 'ms-fontColor-themePrimary' } };
    addClassToken(el, HOVER_CHILD_CLASS);
    expect(cls(el)).toBe(`ms-fontColor-themePrimary ${HOVER_CHILD_CLASS}`);
    addClassToken(el, HOVER_CHILD_CLASS); // idempotent
    expect(cls(el)).toBe(`ms-fontColor-themePrimary ${HOVER_CHILD_CLASS}`);
    removeClassToken(el, HOVER_CHILD_CLASS);
    expect(cls(el)).toBe('ms-fontColor-themePrimary');

    const bare: SPElement = { elmType: 'span' };
    addClassToken(bare, HOVER_CHILD_CLASS);
    expect(cls(bare)).toBe(HOVER_CHILD_CLASS);
    removeClassToken(bare, HOVER_CHILD_CLASS);
    expect(bare.attributes).toBeUndefined();
  });
});

describe('setRevealOnHover', () => {
  it('toggling on adds the child class and defaults the parent class onto the tree root', () => {
    const root: SPElement = { elmType: 'div', children: [{ elmType: 'div', children: [{ elmType: 'span' }] }] };
    setRevealOnHover(root, [0, 0], true);
    expect(hasClassToken(root.children![0].children![0], HOVER_CHILD_CLASS)).toBe(true);
    expect(hasClassToken(root, HOVER_PARENT_CLASS)).toBe(true);
    // the intermediate div stays untouched — one parent is enough
    expect(hasClassToken(root.children![0], HOVER_PARENT_CLASS)).toBe(false);
  });

  it('respects an existing parent ancestor instead of adding a second one', () => {
    const root: SPElement = {
      elmType: 'div',
      children: [{ elmType: 'div', attributes: { class: HOVER_PARENT_CLASS }, children: [{ elmType: 'span' }] }],
    };
    setRevealOnHover(root, [0, 0], true);
    expect(hasClassToken(root, HOVER_PARENT_CLASS)).toBe(false);
    expect(hasClassToken(root.children![0], HOVER_PARENT_CLASS)).toBe(true);
  });

  it('toggling off removes the child class and sweeps a now-inert parent class', () => {
    const root: SPElement = { elmType: 'div', children: [{ elmType: 'span' }] };
    setRevealOnHover(root, [0], true);
    setRevealOnHover(root, [0], false);
    expect(cls(root.children![0])).toBe('');
    expect(hasClassToken(root, HOVER_PARENT_CLASS)).toBe(false);
  });

  it('toggling off keeps the parent class while another hover child remains under it', () => {
    const root: SPElement = { elmType: 'div', children: [{ elmType: 'span' }, { elmType: 'span' }] };
    setRevealOnHover(root, [0], true);
    setRevealOnHover(root, [1], true);
    setRevealOnHover(root, [0], false);
    expect(hasClassToken(root, HOVER_PARENT_CLASS)).toBe(true);
    expect(subtreeHasHoverChild(root)).toBe(true);
  });

  it('inside a customCardProps card, the parent lands on the CARD root, not the host tree', () => {
    // the card renders in a callout — pairing across the boundary would be
    // dead on real SP (HANDOFF §3.7), so both classes stay inside the card
    const root: SPElement = {
      elmType: 'div',
      customCardProps: {
        openOnEvent: 'hover',
        formatter: { elmType: 'div', children: [{ elmType: 'span' }] },
      },
    };
    setRevealOnHover(root, [-1, 0], true);
    const cardRoot = root.customCardProps!.formatter;
    expect(hasClassToken(cardRoot.children![0], HOVER_CHILD_CLASS)).toBe(true);
    expect(hasClassToken(cardRoot, HOVER_PARENT_CLASS)).toBe(true);
    expect(hasClassToken(root, HOVER_PARENT_CLASS)).toBe(false);
  });
});

describe('hoverRevealStatus', () => {
  it('is off+cannot for the tree root (nothing above it to hover)', () => {
    const root: SPElement = { elmType: 'div' };
    const st = hoverRevealStatus(root, []);
    expect(st.on).toBe(false);
    expect(st.can).toBe(false);
    expect(st.reason).toMatch(/root/i);
  });

  it('refuses to token-edit a formula-driven class (refuse and teach)', () => {
    const root: SPElement = {
      elmType: 'div',
      children: [{ elmType: 'span', attributes: { class: "=if([$Done],'a','b')" } }],
    };
    const st = hoverRevealStatus(root, [0]);
    expect(st.can).toBe(false);
    expect(st.reason).toMatch(/formula/i);
  });

  it('reports on=true when the element already carries the child class', () => {
    const root: SPElement = {
      elmType: 'div',
      attributes: { class: HOVER_PARENT_CLASS },
      children: [{ elmType: 'span', attributes: { class: HOVER_CHILD_CLASS } }],
    };
    expect(hoverRevealStatus(root, [0])).toEqual({ on: true, can: true });
  });
});

describe('inspector toggle (one undoable gesture)', () => {
  afterEach(() => {
    document.querySelectorAll<HTMLElement>('body > *').forEach((el) => {
      (el as unknown as { _unsub?: () => void })._unsub?.();
      el.remove();
    });
  });

  it('renders a Reveal-on-hover checkbox that applies both class edits as ONE undo step', () => {
    state.resetAll();
    state.doc = { kind: 'column', root: { elmType: 'div', children: [{ elmType: 'span', txtContent: 'hi' }] } };
    state.selection = [0];
    const host = document.createElement('div');
    document.body.appendChild(host);
    mountInspector(host);

    const sectionEl = [...host.querySelectorAll('details')].find((d) =>
      /Reveal on hover/i.test(d.querySelector('summary')?.textContent ?? ''));
    expect(sectionEl).toBeTruthy();
    const cb = sectionEl!.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    expect(cb.checked).toBe(false);
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));

    expect(hasClassToken(state.doc.root.children![0], HOVER_CHILD_CLASS)).toBe(true);
    expect(hasClassToken(state.doc.root, HOVER_PARENT_CLASS)).toBe(true);

    state.undo(); // one gesture — a single undo removes BOTH class edits
    expect(hasClassToken(state.doc.root.children![0], HOVER_CHILD_CLASS)).toBe(false);
    expect(hasClassToken(state.doc.root, HOVER_PARENT_CLASS)).toBe(false);
  });

  it('disables the checkbox on the root element with a teaching tooltip', () => {
    state.resetAll();
    state.doc = { kind: 'column', root: { elmType: 'div' } };
    state.selection = [];
    const host = document.createElement('div');
    document.body.appendChild(host);
    mountInspector(host);
    const sectionEl = [...host.querySelectorAll('details')].find((d) =>
      /Reveal on hover/i.test(d.querySelector('summary')?.textContent ?? ''));
    const cb = sectionEl!.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    expect(cb.disabled).toBe(true);
  });
});
