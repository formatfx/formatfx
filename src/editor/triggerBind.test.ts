/**
 * Contract for the one trigger model (issue #204, docs/specs/TRIGGER-MODEL.md):
 * candidate scan (§3.1), fixed vocabulary, and the robust-pattern generator
 * (§5) — the workflow GENERATES what card-trigger-button would otherwise lint.
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { SPElement, MockField } from '../core/types';
import {
  candidateHostPaths, applyTriggerAt, hostLabel, canHostTrigger,
  applyConfirmEditAt, displayedField, inlineEditBlockReason,
} from './triggerBind';
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

describe('applyTriggerAt — inline edit (#212, element-level)', () => {
  it('stamps inlineEditField on the element directly — no overlay, no customRowAction', () => {
    const root = div([div([span('a')])]);
    const at = applyTriggerAt(root, [0], { action: 'inlineEdit', inlineEditField: '[$Title]', cursor: 'pointer' });
    expect(at).toEqual([0]);
    const host = root.children![0];
    expect(host.inlineEditField).toBe('[$Title]');
    expect(host.children).toHaveLength(1); // rides the element — nothing appended
    expect(host.customRowAction).toBeUndefined();
    expect(host.style?.cursor).toBe('pointer');
  });

  it('is element-level like hover-reveal: rides a leaf, and COMPOSES with a structural trigger in the subtree', () => {
    const leafRoot = div([span('x')]);
    expect(applyTriggerAt(leafRoot, [0], { action: 'inlineEdit', inlineEditField: '[$Title]' })).toEqual([0]);
    expect(leafRoot.children![0].inlineEditField).toBe('[$Title]');
    // the same host would REFUSE a structural trigger (collision) — inline
    // edit is not a customRowAction/customCardProps, so it composes instead
    const busy = div([div([{ elmType: 'button', customRowAction: { action: 'defaultClick' }, txtContent: 'go' } as SPElement])]);
    expect(applyTriggerAt(busy, [0], { action: 'defaultClick' })).toBeNull();
    expect(applyTriggerAt(busy, [0], { action: 'inlineEdit', inlineEditField: '[$Title]' })).toEqual([0]);
    expect(busy.children![0].inlineEditField).toBe('[$Title]');
  });

  it('refuses a blank FieldRef and never silently clobbers an existing inline editor', () => {
    const root = div([div([span('a')], { inlineEditField: '[$Title]' })]);
    const snapshot = JSON.stringify(root);
    expect(applyTriggerAt(root, [0], { action: 'inlineEdit', inlineEditField: '[$Tags]' })).toBeNull();
    expect(applyTriggerAt(root, [0], { action: 'inlineEdit' })).toBeNull();
    expect(applyTriggerAt(root, [0], { action: 'inlineEdit', inlineEditField: '   ' })).toBeNull();
    expect(JSON.stringify(root)).toBe(snapshot);
  });
});

describe('inlineEditBlockReason — Text & Person only (refuse-don\'t-guess)', () => {
  const f = (name: string, type: MockField['type'], prot = false): MockField =>
    ({ name, type, ...(prot ? { protected: true } : {}) });

  it('allows text/person/personMulti; refuses every other type with a teaching reason', () => {
    expect(inlineEditBlockReason(f('Title', 'text'))).toBeNull();
    expect(inlineEditBlockReason(f('Owner', 'person'))).toBeNull();
    expect(inlineEditBlockReason(f('AssignedTo', 'personMulti'))).toBeNull(); // a Person column, multi-select
    expect(inlineEditBlockReason(f('Status', 'choice'))).toMatch(/Text & Person columns only/);
    expect(inlineEditBlockReason(f('DueDate', 'date'))).toMatch(/Date column/);
    expect(inlineEditBlockReason(f('Notes', 'note'))).toMatch(/Multiple lines of text/);
    expect(inlineEditBlockReason(f('ID', 'number', true))).toMatch(/read-only/);
  });
});

describe('displayedField (#212 — the column an element shows)', () => {
  it('prefers the _field cell stamp, then the first [$Ref] in a txtContent (depth-first), then @currentField', () => {
    expect(displayedField({ elmType: 'div', _field: 'Status', txtContent: '[$Title]' })).toBe('Status');
    expect(displayedField(span('[$Title]'))).toBe('Title');
    expect(displayedField({ elmType: 'div', txtContent: "=if([$Status]=='Done','✓','')" })).toBe('Status');
    expect(displayedField({ elmType: 'div', txtContent: { operator: '+', operands: ['[$Progress]', '%'] } as never })).toBe('Progress');
    expect(displayedField(div([span('static'), span('[$Owner.title]')]))).toBe('Owner');
    expect(displayedField(span('@currentField'), 'Progress')).toBe('Progress');
    expect(displayedField(span('just text'))).toBeNull();
    expect(displayedField(div([span('plain')]))).toBeNull();
  });
});

describe('applyConfirmEditAt — the draft-column confirm & commit recipe (#212)', () => {
  it('generates the whole loop: draft edit surface + a !=\'\'-gated confirm row with Save/Cancel', () => {
    const root = div([div([span('[$Status]')])]);
    const at = applyConfirmEditAt(root, [0], { realField: 'Status', draftField: 'Draft' });
    expect(at).toEqual([0]);
    const host = root.children![0];
    expect(host.children).toHaveLength(2);
    const [surface, confirm] = host.children!;

    // (a) the ORIGINAL content became the edit surface, staging into the draft
    expect(surface.inlineEditField).toBe('[$Draft]');
    expect(surface.children).toHaveLength(1);
    expect(surface.children![0].txtContent).toBe('[$Status]');

    // (b) visibility gate is `!=''` — there is NO logical NOT on SP (HANDOFF §3),
    // so the gate must never lean on a standalone `!`
    const gate = String(confirm.style?.display);
    expect(gate).toBe("=if([$Draft]!='','flex','none')");
    expect(gate).not.toMatch(/![^=]/); // any `!` is part of `!=`
    // the from → to readout
    const texts = confirm.children!.map((c) => c.txtContent);
    expect(texts).toContain('[$Status]');
    expect(texts).toContain('[$Draft]');

    // (c) Save: ONE setValue, TWO entries IN ORDER — promote, then clear
    const save = confirm.children!.find((c) => c.txtContent === 'Save')!;
    expect(save.customRowAction).toEqual({ action: 'setValue', actionInput: { Status: '[$Draft]', Draft: '' } });
    expect(Object.keys(save.customRowAction!.actionInput as Record<string, unknown>)).toEqual(['Status', 'Draft']);
    // Cancel: just clears the draft
    const cancel = confirm.children!.find((c) => c.txtContent === 'Cancel')!;
    expect(cancel.customRowAction).toEqual({ action: 'setValue', actionInput: { Draft: '' } });

    // schema-valid + ENTIRELY lint-quiet (complete setValues, buttons with
    // direct text, ascii-safe arrow icon) — the generator never emits JSON
    // its own linter would nag about
    expect(lintDocument({ kind: 'row', root })).toEqual([]);
  });

  it('refuses incomplete or colliding specs and leaves the tree untouched', () => {
    const root = div([div([span('a')])]);
    const snapshot = JSON.stringify(root);
    expect(applyConfirmEditAt(root, [0], { realField: '', draftField: 'Draft' })).toBeNull();
    expect(applyConfirmEditAt(root, [0], { realField: 'Status', draftField: '' })).toBeNull();
    expect(applyConfirmEditAt(root, [0], { realField: 'Draft', draftField: 'Draft' })).toBeNull();
    expect(JSON.stringify(root)).toBe(snapshot);
    // a host already carrying a trigger refuses — the recipe adds action buttons
    const busy = div([div([span('a')])]);
    applyTriggerAt(busy, [0], { action: 'defaultClick' });
    const busySnap = JSON.stringify(busy);
    expect(applyConfirmEditAt(busy, [0], { realField: 'Status', draftField: 'Draft' })).toBeNull();
    expect(JSON.stringify(busy)).toBe(busySnap);
    // a leaf host refuses too — nothing to wrap as the edit surface
    const leaf = div([span('x')]);
    expect(applyConfirmEditAt(leaf, [0], { realField: 'Status', draftField: 'Draft' })).toBeNull();
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
