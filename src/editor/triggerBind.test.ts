/**
 * Contract for the one trigger model (issue #204, docs/specs/TRIGGER-MODEL.md):
 * candidate scan (§3.1), fixed vocabulary, and the robust-pattern generator
 * (§5) — the workflow GENERATES what card-trigger-button would otherwise lint.
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { SPElement } from '../core/types';
import { candidateHostPaths, applyTriggerAt, hostLabel, canHostTrigger } from './triggerBind';
import { lintDocument } from '../core/linter';
import { mountInspector } from './inspector';
import { state } from './state';

const div = (children: SPElement[], extra?: Partial<SPElement>): SPElement =>
  ({ elmType: 'div', children, ...extra });
const span = (txt: string): SPElement => ({ elmType: 'span', txtContent: txt });

describe('candidateHostPaths (§3.1)', () => {
  it('offers divisions with children and skips leaves and non-divs', () => {
    const root = div([
      div([span('a'), span('b')]),          // [0] candidate
      span('leaf'),                          // [1] no
      { elmType: 'button', children: [span('x')] }, // [2] not a division
    ]);
    expect(candidateHostPaths(root)).toEqual([[], [0]]);
  });

  it('excludes any division with a trigger already in its subtree (no collision — #205 parked)', () => {
    const root = div([
      div([span('a'), { elmType: 'button', customRowAction: { action: 'defaultClick' }, txtContent: 'go' } as SPElement]), // [0] collision
      div([span('b')]),                      // [1] candidate
    ]);
    // the root's subtree contains the action too, so only [1] qualifies
    expect(candidateHostPaths(root)).toEqual([[1]]);
  });

  it('never offers hosts inside a customCardProps card body', () => {
    const root = div([
      { elmType: 'div', customCardProps: { openOnEvent: 'hover', formatter: div([span('inside')]) } } as SPElement,
      div([span('ok')]),
    ]);
    expect(candidateHostPaths(root)).toEqual([[1]]);
  });

  it('labels a candidate with its breadcrumb', () => {
    const root = div([div([span('x')], { _elmName: 'Badge row' })], { _elmName: 'Card' });
    expect(hostLabel(root, [0])).toBe('Card › Badge row');
  });
});

describe('applyTriggerAt — cards (§5)', () => {
  const content: SPElement = { elmType: 'div', children: [span('card body')] };

  it('hover card: props land on the division directly (hover is not swallowed)', () => {
    const root = div([div([span('a')])]);
    const at = applyTriggerAt(root, [0], { action: 'card', event: 'hover', cursor: 'pointer' }, content);
    expect(at).toEqual([0]);
    const host = root.children![0];
    expect(host.customCardProps?.openOnEvent).toBe('hover');
    expect(host.customCardProps?.formatter).toBe(content);
    expect(host.style?.cursor).toBe('pointer');
    expect(host.children).toHaveLength(1); // no overlay for hover
  });

  it('click card: generates the sp-card-defaultClickButton overlay so children cannot swallow the click', () => {
    const root = div([div([span('a'), span('b')])]);
    const at = applyTriggerAt(root, [0], { action: 'card', event: 'click', label: 'Open details' }, content);
    expect(at).toEqual([0, 2]);
    const host = root.children![0];
    const overlay = host.children![2];
    expect(overlay.elmType).toBe('button');
    expect(overlay.attributes?.class).toBe('sp-card-defaultClickButton');
    expect(overlay.attributes?.title).toBe('Open details');
    expect(overlay.customCardProps?.openOnEvent).toBe('click');
    expect(host.style?.position).toBe('relative');
    // the robust pattern never trips the linter's card-trigger-button teaching rule
    const rules = lintDocument({ kind: 'row', root }).map((i) => i.rule);
    expect(rules).not.toContain('card-trigger-button');
  });

  it('respects an existing position on the host (never clobbers)', () => {
    const root = div([div([span('a')], { style: { position: 'absolute' } })]);
    applyTriggerAt(root, [0], { action: 'card', event: 'click' }, content);
    expect(root.children![0].style?.position).toBe('absolute');
  });

  it('refuses a card with no content', () => {
    const root = div([div([span('a')])]);
    expect(applyTriggerAt(root, [0], { action: 'card', event: 'hover' })).toBeNull();
  });
});

describe('applyTriggerAt — row actions and link (§5)', () => {
  it('executeFlow rides the overlay button with its params', () => {
    const root = div([div([span('a')])]);
    const at = applyTriggerAt(root, [0], {
      action: 'executeFlow', actionParams: '{"id":"flow-1"}', cursor: 'pointer',
    });
    expect(at).toEqual([0, 1]);
    const overlay = root.children![0].children![1];
    expect(overlay.customRowAction).toEqual({ action: 'executeFlow', actionParams: '{"id":"flow-1"}' });
    expect(overlay.attributes?.class).toBe('sp-card-defaultClickButton');
    expect(overlay.style?.cursor).toBe('pointer');
    // complete params → the completeness lint stays quiet
    expect(lintDocument({ kind: 'row', root }).map((i) => i.rule)).not.toContain('flow-missing-id');
  });

  it('setValue carries actionInput', () => {
    const root = div([div([span('a')])]);
    applyTriggerAt(root, [0], { action: 'setValue', actionInput: { Status: 'Done' } });
    const overlay = root.children![0].children![1];
    expect(overlay.customRowAction).toEqual({ action: 'setValue', actionInput: { Status: 'Done' } });
  });

  it('link generates an overlay <a href> (and refuses without href)', () => {
    const root = div([div([span('a')])]);
    expect(applyTriggerAt(root, [0], { action: 'link' })).toBeNull();
    const at = applyTriggerAt(root, [0], { action: 'link', href: 'https://contoso.com' });
    expect(at).toEqual([0, 1]);
    const overlay = root.children![0].children![1];
    expect(overlay.elmType).toBe('a');
    expect(overlay.attributes?.href).toBe('https://contoso.com');
    expect(overlay.attributes?.target).toBe('_blank');
  });

  it('link on an <a> host sets href directly instead of overlaying', () => {
    const root = div([{ elmType: 'a', txtContent: 'go' } as SPElement]);
    const at = applyTriggerAt(root, [0], { action: 'link', href: 'https://contoso.com' });
    expect(at).toEqual([0]);
    expect(root.children![0].attributes?.href).toBe('https://contoso.com');
    expect(root.children![0].children).toBeUndefined();
  });
});

describe('the inspector click-surface door (the action side of the vocabulary)', () => {
  afterEach(() => {
    document.querySelectorAll<HTMLElement>('body > *').forEach((el) => {
      (el as unknown as { _unsub?: () => void })._unsub?.();
      el.remove();
    });
  });

  it('generates the overlay on a candidate division as ONE undo step and selects it', () => {
    state.resetAll();
    state.activeLens = 'pro';
    state.doc = { kind: 'row', root: div([div([span('content')])]) };
    state.selection = [0];
    const host = document.createElement('div');
    document.body.appendChild(host);
    mountInspector(host);

    const gen = [...host.querySelectorAll('button')]
      .find((b) => /click surface/i.test(b.textContent ?? ''))!;
    expect(gen).toBeTruthy();
    expect(canHostTrigger(state.doc.root.children![0])).toBe(true);
    gen.click();

    const overlay = state.doc.root.children![0].children![1];
    expect(overlay.attributes?.class).toBe('sp-card-defaultClickButton');
    expect(overlay.customRowAction).toEqual({ action: 'defaultClick' });
    expect(state.selection).toEqual([0, 1]);

    state.undo();
    expect(state.doc.root.children![0].children).toHaveLength(1);
  });

  it('offers no door on an element that already carries an action in its subtree', () => {
    state.resetAll();
    state.activeLens = 'pro';
    state.doc = {
      kind: 'row',
      root: div([div([{ elmType: 'button', customRowAction: { action: 'defaultClick' }, txtContent: 'x' } as SPElement])]),
    };
    state.selection = [0];
    const host = document.createElement('div');
    document.body.appendChild(host);
    mountInspector(host);
    expect([...host.querySelectorAll('button')].find((b) => /click surface/i.test(b.textContent ?? ''))).toBeUndefined();
    state.resetAll();
  });
});
