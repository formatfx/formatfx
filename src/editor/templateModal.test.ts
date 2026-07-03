import { describe, it, expect, vi, beforeEach } from 'vitest';
import { state } from './state';
import { openTemplateModal } from './templateModal';

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  state.fields = [{ name: 'Title', type: 'text' }, { name: 'Status', type: 'choice' }, { name: 'Due', type: 'date' }];
  state.loadDocument({ kind: 'grid', root: { elmType: 'div', children: [] } });
});

/** Build a synthetic chip/item drop carrying one of the builder MIMEs. */
function drop(mime: string, payload: string): Event {
  const ev = new Event('drop', { bubbles: true, cancelable: true });
  (ev as unknown as { dataTransfer: unknown }).dataTransfer = {
    getData: (t: string) => (t === mime ? payload : ''),
    types: [mime],
  };
  return ev;
}
const fieldDrop = (name: string): Event => drop('application/x-wb-field', name);
const componentDrop = (id: string): Event => drop('application/x-wb-component', id);

/** Open the builder and pick a wireframe (default: Lead + details → 2 zones). */
function enterEditor(id = 'lead-detail'): void {
  openTemplateModal(() => {});
  (document.querySelector(`[data-wireframe="${id}"]`) as HTMLElement).click();
}

const zone = (zi: number): HTMLElement => document.querySelector(`[data-edit-zone="${zi}"]`) as HTMLElement;

describe('row view builder — gallery + shell', () => {
  it('opens on the wireframe gallery (visual cards, no dropdowns)', () => {
    openTemplateModal(() => {});
    expect(document.querySelector('.wb-template-modal')?.getAttribute('data-stage')).toBe('pick');
    expect(document.querySelectorAll('.wb-wf-card').length).toBeGreaterThanOrEqual(5);
    expect(document.querySelector('.wb-wf-thumb')).toBeTruthy(); // drawn thumbnails, not names alone
    expect(document.querySelector('select')).toBeNull();
  });

  it('picking a wireframe enters the editor with its zones seeded', () => {
    enterEditor();
    expect(document.querySelector('.wb-template-modal')?.getAttribute('data-stage')).toBe('edit');
    expect(document.querySelectorAll('.wb-edit-zone').length).toBe(2); // Lead + Details
    // the seeded Lead zone holds the text field
    expect((document.querySelector('[data-edit-item="0:0"]') as HTMLElement).dataset.fieldName).toBe('Title');
  });

  it('the Layouts button returns to the gallery', () => {
    enterEditor();
    (document.querySelector('.wb-template-layouts') as HTMLElement).click();
    expect(document.querySelector('.wb-template-modal')?.getAttribute('data-stage')).toBe('pick');
  });

  it('Escape closes the modal (shared overlay teardown)', () => {
    openTemplateModal(() => {});
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.wb-template-modal')).toBeNull();
  });
});

describe('row view builder — row style inspector', () => {
  it('greys a control when composeRowStyle disables it, showing the reason', () => {
    enterEditor();
    (document.querySelector('[data-rowstyle="card"]') as HTMLElement).click();
    const border = document.querySelector('[data-toggle="border"]') as HTMLElement;
    expect(border.classList.contains('wb-disabled')).toBe(true);
    expect(border.title).toContain('Card style manages its own border');
  });
});

describe('row view builder — direct manipulation on the preview', () => {
  it('dropping a field chip on a zone appends an item there', () => {
    enterEditor();
    const before = document.querySelectorAll('[data-edit-item^="0:"]').length;
    zone(0).dispatchEvent(fieldDrop('Status'));
    const items = document.querySelectorAll('[data-edit-item^="0:"]');
    expect(items.length).toBe(before + 1);
    expect((items[items.length - 1] as HTMLElement).dataset.fieldName).toBe('Status');
  });

  it('dropping a chip on the end-gap starts a NEW zone', () => {
    enterEditor();
    const before = document.querySelectorAll('.wb-edit-zone').length;
    (document.querySelector('.wb-edit-endgap') as HTMLElement).dispatchEvent(fieldDrop('Due'));
    expect(document.querySelectorAll('.wb-edit-zone').length).toBe(before + 1);
    expect((document.querySelector(`[data-edit-item="${before}:0"]`) as HTMLElement).dataset.fieldName).toBe('Due');
  });

  it('selecting a zone shows its behavior controls (width, wrap-when-tight, stacked)', () => {
    enterEditor();
    zone(1).click();
    expect(document.querySelector('.wb-template-insp-title')?.textContent).toContain('Details zone');
    expect(document.querySelector('[data-zonesize="hug"]')).toBeTruthy();
    expect(document.querySelector('[data-zoneflow="wrap"]')).toBeTruthy();
    expect(document.querySelector('[data-zoneflow="stack"]')).toBeTruthy();
    expect(document.querySelector('.wb-template-remove')).toBeTruthy();
  });

  it('selecting an item shows its width + text controls', () => {
    enterEditor();
    (document.querySelector('[data-edit-item="0:0"]') as HTMLElement).click();
    expect(document.querySelector('.wb-template-insp-title')?.textContent).toContain('Title');
    expect(document.querySelector('[data-itemwidth="natural"]')).toBeTruthy();
    expect(document.querySelector('[data-wrap="truncate"]')).toBeTruthy();
  });

  it('Remove zone drops the zone from the config', () => {
    enterEditor();
    const before = document.querySelectorAll('.wb-edit-zone').length;
    zone(0).click();
    (document.querySelector('.wb-template-remove') as HTMLButtonElement).click();
    expect(document.querySelectorAll('.wb-edit-zone').length).toBe(before - 1);
  });

  it('a divider click cycles the left zone size (visible in its tag)', () => {
    enterEditor();
    const tag = (): string => (zone(0).querySelector('.wb-edit-zone-tag') as HTMLElement).textContent ?? '';
    expect(tag()).toContain('Fill 2×');   // Lead seeds wide
    (document.querySelector('.wb-edit-divider') as HTMLElement).click();
    expect(tag()).toContain('Fill 3×');   // wide → widest
    (document.querySelector('.wb-edit-divider') as HTMLElement).click();
    expect(tag()).toContain('Hug');       // widest → hug
  });
});

describe('row view builder — components in zones', () => {
  it('dropping a component chip binds it best-guess and opens its slot mapping', () => {
    enterEditor();
    zone(1).dispatchEvent(componentDrop('builtin-deadline-chip'));
    const item = document.querySelector('[data-component-id="builtin-deadline-chip"]') as HTMLElement;
    expect(item).toBeTruthy();
    // the new item is selected and its slot picker is prefilled with the date column
    const slot = document.querySelector('select[data-slot="Due"]') as HTMLSelectElement;
    expect(slot).toBeTruthy();
    expect(slot.value).toBe('Due');
    expect((document.querySelector('.wb-template-apply') as HTMLButtonElement).disabled).toBe(false);
  });

  it('an unmapped component slot blocks Apply with a teaching reason', () => {
    enterEditor();
    zone(1).dispatchEvent(componentDrop('builtin-deadline-chip'));
    const slot = document.querySelector('select[data-slot="Due"]') as HTMLSelectElement;
    slot.value = '';
    slot.dispatchEvent(new Event('change'));
    const apply = document.querySelector('.wb-template-apply') as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    expect(apply.title).toContain('Map every slot');
  });
});

describe('row view builder — modes, squeeze & apply', () => {
  it('the Preview toggle removes edit affordances and makes chips inert', () => {
    enterEditor();
    (document.querySelector('[data-mode="preview"]') as HTMLElement).click();
    expect(document.querySelector('.wb-template-modal')?.getAttribute('data-mode')).toBe('preview');
    expect(document.querySelector('.wb-edit-zone')).toBeNull();
    expect(document.querySelector('.wb-template-field-chip')?.classList.contains('wb-chip-inert')).toBe(true);
  });

  it('the width presets squeeze the stage so wrap behavior can be WATCHED', () => {
    enterEditor();
    (document.querySelector('[data-stagewidth="narrow"]') as HTMLElement).click();
    expect((document.querySelector('.wb-template-stage') as HTMLElement).style.width).toBe('360px');
    (document.querySelector('[data-stagewidth="full"]') as HTMLElement).click();
    expect((document.querySelector('.wb-template-stage') as HTMLElement).style.width).toBe('');
  });

  it('Apply calls state.applyRowTemplate once and switches to a row view', () => {
    const spy = vi.spyOn(state, 'applyRowTemplate');
    enterEditor();
    (document.querySelector('.wb-template-apply') as HTMLButtonElement).click();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(state.doc.kind).toBe('row');
    spy.mockRestore();
  });

  it('empty zones are pruned from the applied layout', () => {
    enterEditor('dashboard'); // no number/person columns → Progress + People zones stay empty
    (document.querySelector('.wb-template-apply') as HTMLButtonElement).click();
    expect(state.doc.root.children!.length).toBe(2); // Title + Status only
  });

  it('Apply is disabled when no zone has an item', () => {
    enterEditor();
    for (const zi of [1, 0]) {
      zone(zi).click();
      (document.querySelector('.wb-template-remove') as HTMLButtonElement).click();
    }
    const apply = document.querySelector('.wb-template-apply') as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    expect(apply.title).toContain('at least one');
  });
});

describe('row view builder — dock persistence & kebab refusal hints', () => {
  it('remembers the inspector dock across close + reopen', () => {
    enterEditor();
    expect(document.querySelector('.wb-template-modal')?.getAttribute('data-dock')).toBe('bottom');
    (document.querySelector('.wb-template-dock') as HTMLButtonElement).click();
    expect(document.querySelector('.wb-template-modal')?.getAttribute('data-dock')).toBe('left');
    expect(localStorage.getItem('wb-template-inspector-dock')).toBe('left');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    openTemplateModal(() => {});
    expect(document.querySelector('.wb-template-modal')?.getAttribute('data-dock')).toBe('left'); // restored
  });

  it('a custom kebab action with a blank param shows an inline refusal hint (mirrors buildKebab)', () => {
    enterEditor();
    const check = (sel: string): void => {
      const cb = document.querySelector(`${sel} input`) as HTMLInputElement;
      cb.checked = true;
      cb.dispatchEvent(new Event('change'));
    };
    check('[data-toggle="kebab"]');             // enable the kebab (defaults to custom behavior)
    check('[data-toggle="kebab-executeFlow"]'); // Run-flow action, but no flow id yet
    expect(document.querySelector('.wb-template-hint')?.textContent).toContain('flow ID');
  });
});
