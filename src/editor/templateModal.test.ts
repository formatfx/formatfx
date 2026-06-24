import { describe, it, expect, vi, beforeEach } from 'vitest';
import { state } from './state';
import { openTemplateModal } from './templateModal';

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  state.fields = [{ name: 'Title', type: 'text' }, { name: 'Status', type: 'choice' }, { name: 'Due', type: 'date' }];
  state.loadDocument({ kind: 'grid', root: { elmType: 'div', children: [] } });
});

/** Build a synthetic field-chip drop carrying the wb-field MIME. */
function fieldDrop(name: string): Event {
  const ev = new Event('drop', { bubbles: true, cancelable: true });
  (ev as unknown as { dataTransfer: unknown }).dataTransfer = {
    getData: (t: string) => (t === 'application/x-wb-field' ? name : ''),
    types: ['application/x-wb-field'],
  };
  return ev;
}

describe('template modal — shell', () => {
  it('opens with the modal + a preview region', () => {
    openTemplateModal(() => {});
    expect(document.querySelector('.wb-template-modal')).toBeTruthy();
    expect(document.querySelector('.wb-template-preview')).toBeTruthy();
  });

  it('Escape closes the modal (shared overlay teardown)', () => {
    openTemplateModal(() => {});
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.wb-template-modal')).toBeNull();
  });

  it('opens in Edit mode with the rendered row as editable blocks (no dropdowns)', () => {
    openTemplateModal(() => {});
    expect(document.querySelector('.wb-template-modal')?.getAttribute('data-mode')).toBe('edit');
    expect(document.querySelectorAll('.wb-edit-block').length).toBe(3); // split → 3 areas
    expect(document.querySelector('select')).toBeNull();                // dropdowns are gone
  });
});

describe('template modal — row style inspector', () => {
  it('greys a control when composeRowStyle disables it, showing the reason', () => {
    openTemplateModal(() => {});
    (document.querySelector('[data-rowstyle="card"]') as HTMLElement).click();
    const border = document.querySelector('[data-toggle="border"]') as HTMLElement;
    expect(border.classList.contains('wb-disabled')).toBe(true);
    expect(border.title).toContain('Card style manages its own border');
  });
});

describe('template modal — direct manipulation on the preview', () => {
  it('dropping a field chip on a block sets that block fieldName', () => {
    openTemplateModal(() => {});
    (document.querySelector('[data-edit-area="0"]') as HTMLElement).dispatchEvent(fieldDrop('Status'));
    expect((document.querySelector('[data-edit-area="0"]') as HTMLElement).dataset.fieldName).toBe('Status');
  });

  it('dropping a chip on the end-gap appends a new block', () => {
    openTemplateModal(() => {});
    const before = document.querySelectorAll('.wb-edit-block').length;
    (document.querySelector('.wb-edit-endgap') as HTMLElement).dispatchEvent(fieldDrop('Due'));
    expect(document.querySelectorAll('.wb-edit-block').length).toBe(before + 1);
    expect((document.querySelector(`[data-edit-area="${before}"]`) as HTMLElement).dataset.fieldName).toBe('Due');
  });

  it('selecting a block shows its block inspector (width + remove)', () => {
    openTemplateModal(() => {});
    (document.querySelector('[data-edit-area="1"]') as HTMLElement).click();
    expect(document.querySelector('.wb-template-insp-title')?.textContent).toContain('Block 2');
    expect(document.querySelector('[data-weight="wide"]')).toBeTruthy();
    expect(document.querySelector('.wb-template-remove')).toBeTruthy();
  });

  it('Remove block drops the area from the config', () => {
    openTemplateModal(() => {});
    const before = document.querySelectorAll('.wb-edit-block').length;
    (document.querySelector('[data-edit-area="0"]') as HTMLElement).click();
    (document.querySelector('.wb-template-remove') as HTMLButtonElement).click();
    expect(document.querySelectorAll('.wb-edit-block').length).toBe(before - 1);
  });
});

describe('template modal — modes & apply', () => {
  it('the Preview toggle removes edit affordances and makes chips inert', () => {
    openTemplateModal(() => {});
    (document.querySelector('[data-mode="preview"]') as HTMLElement).click();
    expect(document.querySelector('.wb-template-modal')?.getAttribute('data-mode')).toBe('preview');
    expect(document.querySelector('.wb-edit-block')).toBeNull();
    expect(document.querySelector('.wb-template-field-chip')?.classList.contains('wb-chip-inert')).toBe(true);
  });

  it('Apply calls state.applyRowTemplate once and switches to a row view', () => {
    const spy = vi.spyOn(state, 'applyRowTemplate');
    openTemplateModal(() => {});
    (document.querySelector('.wb-template-apply') as HTMLButtonElement).click();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(state.doc.kind).toBe('row');
    spy.mockRestore();
  });

  it('Apply is disabled when no block has a field', () => {
    openTemplateModal(() => {});
    // clear all three seeded areas → nothing to apply
    for (let i = 2; i >= 0; i--) {
      (document.querySelector(`[data-edit-area="${i}"]`) as HTMLElement).click();
      (document.querySelector('.wb-template-remove') as HTMLButtonElement).click();
    }
    expect((document.querySelector('.wb-template-apply') as HTMLButtonElement).disabled).toBe(true);
  });
});
