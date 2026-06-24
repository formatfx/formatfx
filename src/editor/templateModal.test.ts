import { describe, it, expect, vi, beforeEach } from 'vitest';
import { state } from './state';
import { openTemplateModal } from './templateModal';

beforeEach(() => {
  document.body.innerHTML = '';
  state.loadDocument({ kind: 'grid', root: { elmType: 'div', children: [] } });
});

describe('template modal', () => {
  it('opens with a config pane and a preview pane', () => {
    openTemplateModal(() => {});
    expect(document.querySelector('.wb-template-modal')).toBeTruthy();
    expect(document.querySelector('.wb-template-preview')).toBeTruthy();
  });

  it('greys a control when composeRowStyle disables it, showing the reason', () => {
    openTemplateModal(() => {});
    const sel = document.querySelector('[data-field="rowStyle"]') as HTMLSelectElement;
    sel.value = 'card';
    sel.dispatchEvent(new Event('change'));
    const borderCtl = document.querySelector('[data-toggle="border"]') as HTMLElement;
    expect(borderCtl.classList.contains('wb-disabled')).toBe(true);
    expect(borderCtl.title).toContain('Card style manages its own border');
  });

  it('Apply calls state.applyRowTemplate and switches to row', () => {
    const spy = vi.spyOn(state, 'applyRowTemplate');
    openTemplateModal(() => {});
    (document.querySelector('.wb-template-apply') as HTMLButtonElement).click();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(state.doc.kind).toBe('row');
    spy.mockRestore();
  });

  it('dropping a field chip on an area sets that area fieldName', () => {
    state.fields = [{ name: 'Title', type: 'text' }, { name: 'Status', type: 'choice' }, { name: 'Due', type: 'date' }];
    state.loadDocument({ kind: 'grid', root: { elmType: 'div', children: [] } });
    openTemplateModal(() => {});
    const area = document.querySelector('[data-area="0"]') as HTMLElement;
    const ev = new Event('drop', { bubbles: true, cancelable: true });
    (ev as unknown as { dataTransfer: unknown }).dataTransfer = {
      getData: (t: string) => (t === 'application/x-wb-field' ? 'Status' : ''),
      types: ['application/x-wb-field'],
    };
    area.dispatchEvent(ev);
    const select = document.querySelector('[data-area="0"] [data-field="areaField"]') as HTMLSelectElement;
    expect(select.value).toBe('Status'); // both channels write areas[i].fieldName
  });
});
