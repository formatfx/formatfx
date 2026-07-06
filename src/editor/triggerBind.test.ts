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

  it('link generates an overlay <a href> with rel noopener (and refuses without href)', () => {
    const root = div([div([span('a')])]);
    expect(applyTriggerAt(root, [0], { action: 'link' })).toBeNull();
    const at = applyTriggerAt(root, [0], { action: 'link', href: 'https://contoso.com' });
    expect(at).toEqual([0, 1]);
    const overlay = root.children![0].children![1];
    expect(overlay.elmType).toBe('a');
    expect(overlay.attributes?.href).toBe('https://contoso.com');
    expect(overlay.attributes?.target).toBe('_blank');
    // the EXPORTED JSON carries rel — reverse-tabnabbing guard on real SP,
    // not just in the sandbox renderer
    expect(overlay.attributes?.rel).toBe('noopener noreferrer');
  });

  it('link on an <a> host sets href + rel directly instead of overlaying', () => {
    const root = div([{ elmType: 'a', txtContent: 'go' } as SPElement]);
    const at = applyTriggerAt(root, [0], { action: 'link', href: 'https://contoso.com' });
    expect(at).toEqual([0]);
    expect(root.children![0].attributes?.href).toBe('https://contoso.com');
    expect(root.children![0].attributes?.rel).toBe('noopener noreferrer');
    expect(root.children![0].children).toBeUndefined();
  });

  it('re-validates the host at apply time: a stale pick (host gained a trigger) refuses instead of colliding', () => {
    const root = div([div([span('a')])]);
    // first bind succeeds…
    expect(applyTriggerAt(root, [0], { action: 'defaultClick' })).toEqual([0, 1]);
    const snapshot = JSON.stringify(root);
    // …a second bind against the SAME host (as a stale mapper pick would be)
    // must refuse and leave the tree untouched — trigger collisions are #205
    expect(applyTriggerAt(root, [0], { action: 'card', event: 'hover' }, { elmType: 'div' })).toBeNull();
    expect(applyTriggerAt(root, [0], { action: 'executeFlow', actionParams: '{"id":"x"}' })).toBeNull();
    expect(JSON.stringify(root)).toBe(snapshot);
    // a host that is no longer a division with children refuses too
    const leafRoot = div([span('just text')]);
    expect(applyTriggerAt(leafRoot, [0], { action: 'card', event: 'hover' }, { elmType: 'div' })).toBeNull();
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

  it('executeFlow refuses until the flow id is filled, then generates complete actionParams', () => {
    state.resetAll();
    state.activeLens = 'pro';
    state.doc = { kind: 'row', root: div([div([span('content')])]) };
    state.selection = [0];
    const host = document.createElement('div');
    document.body.appendChild(host);
    mountInspector(host);

    const kindSel = host.querySelector<HTMLSelectElement>('.wb-cs-kind')!;
    kindSel.value = 'executeFlow';
    kindSel.dispatchEvent(new Event('change', { bubbles: true }));
    const gen = host.querySelector<HTMLButtonElement>('.wb-cs-gen')!;
    expect(gen.disabled).toBe(true); // refuse-and-teach: no blank flow ids
    const flow = host.querySelector<HTMLInputElement>('.wb-cs-flowid')!;
    flow.value = 'flow-guid-1';
    flow.dispatchEvent(new Event('input', { bubbles: true }));
    expect(gen.disabled).toBe(false);
    gen.click();

    const overlay = state.doc.root.children![0].children![1];
    expect(overlay.customRowAction).toEqual({ action: 'executeFlow', actionParams: '{"id":"flow-guid-1"}' });
    // complete params → the deploy-gating lint stays quiet
    expect(lintDocument(state.doc).map((i) => i.rule)).not.toContain('flow-missing-id');
    state.resetAll();
  });

  it('setValue asks for column + value; link asks for a url and emits the rel-guarded overlay <a>', () => {
    state.resetAll();
    state.activeLens = 'pro';
    state.doc = { kind: 'row', root: div([div([span('content')])]) };
    state.selection = [0];
    const host = document.createElement('div');
    document.body.appendChild(host);
    mountInspector(host);

    const kindSel = host.querySelector<HTMLSelectElement>('.wb-cs-kind')!;
    kindSel.value = 'setValue';
    kindSel.dispatchEvent(new Event('change', { bubbles: true }));
    const gen = host.querySelector<HTMLButtonElement>('.wb-cs-gen')!;
    expect(gen.disabled).toBe(true);
    const fieldSel = host.querySelector<HTMLSelectElement>('.wb-cs-field')!;
    fieldSel.value = 'Status';
    fieldSel.dispatchEvent(new Event('change', { bubbles: true }));
    const val = host.querySelector<HTMLInputElement>('.wb-cs-value')!;
    val.value = 'Done';
    val.dispatchEvent(new Event('input', { bubbles: true }));
    expect(gen.disabled).toBe(false);
    gen.click();
    expect(state.doc.root.children![0].children![1].customRowAction)
      .toEqual({ action: 'setValue', actionInput: { Status: 'Done' } });
    state.undo();

    // link: url required, overlay is an <a> with the tabnabbing guard
    // (the undo re-rendered the inspector — query the rebuilt form)
    const kindSel2 = host.querySelector<HTMLSelectElement>('.wb-cs-kind')!;
    kindSel2.value = 'link';
    kindSel2.dispatchEvent(new Event('change', { bubbles: true }));
    const gen2 = host.querySelector<HTMLButtonElement>('.wb-cs-gen')!;
    expect(gen2.disabled).toBe(true);
    const url = host.querySelector<HTMLInputElement>('.wb-cs-href')!;
    url.value = 'https://contoso.com/wiki';
    url.dispatchEvent(new Event('input', { bubbles: true }));
    gen2.click();
    const overlay = state.doc.root.children![0].children![1];
    expect(overlay.elmType).toBe('a');
    expect(overlay.attributes?.rel).toBe('noopener noreferrer');
    state.resetAll();
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
