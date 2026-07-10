/**
 * canvas.ts DOM contracts. The kind-'column' single-cell preview left the
 * canvas with the model-B migration (COLUMNS-COMPONENTS-VIEWS §1 — the canvas
 * renders grid/row/tile only), so the DOM-XSS guard it pinned moves to the
 * surviving field-name surface: grid column HEADERS render imported names as
 * text, never as HTML (gridView's textContent treatment).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mountCanvas } from './canvas';
import { state } from './state';

// Each test mounts a canvas onto a fresh body-level host, and mountCanvas
// installs document-level listeners (click, keydown) — tear every host down
// via its _unsub hook so no listener leaks into later tests. The Escape
// dispatch first closes any overlay a test left open via its own real path,
// so createOverlay detaches its document listener too (the viewMenu.test
// precedent) — a bare .remove() would leak it.
afterEach(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  document.querySelectorAll<HTMLElement>('body > *').forEach((el) => {
    (el as unknown as { _unsub?: () => void })._unsub?.();
    el.remove();
  });
});

describe('grid column headers (the surviving field-name surface)', () => {
  it('renders an imported field name as text, not HTML (no DOM-XSS)', () => {
    state.resetAll(); // the floor grid — kind 'grid', Title placed first
    const payload = '<img src=x onerror="globalThis.__xss=1">';
    state.fields.find((f) => f.name === 'Title')!.displayName = payload;
    const host = document.createElement('div');
    document.body.appendChild(host);

    mountCanvas(host, () => {});

    // the payload is inert text in the header label, never a parsed <img>
    expect(host.querySelector('.wb-grid-header img')).toBeNull();
    const labels = [...host.querySelectorAll('.wb-grid-header-label')].map((n) => n.textContent);
    expect(labels).toContain(payload);
    state.resetAll();
  });
});

describe('row-view toolbar', () => {
  it('is label-only now — density and Templates moved to the structure-header kebab (2026-07-10)', () => {
    state.doc = { kind: 'row', root: { elmType: 'div', children: [] } };
    state.selection = null;
    const host = document.createElement('div');
    document.body.appendChild(host);
    mountCanvas(host, () => {});
    expect(host.querySelector('.wb-rowview-bar-label')?.textContent).toBe('Row view');
    expect(host.querySelector('.wb-rowview-bar button')).toBeNull();
    expect([...host.querySelectorAll('.wb-rowview-bar *')].some((n) => /Templates|Density/.test(n.textContent ?? ''))).toBe(false);
  });
});

describe('simulate-hover pin (issue #203)', () => {
  // kind 'tile' — 'column' documents are never a canvas surface anymore
  const hoverDoc = () => ({
    kind: 'tile' as const,
    root: {
      elmType: 'div' as const,
      attributes: { class: 'sp-card-showOnHoverParent' },
      children: [{ elmType: 'span' as const, attributes: { class: 'sp-card-showOnHoverChild' }, txtContent: '⋯' }],
    },
  });

  it('offers the pin only when the document uses the hover-child class', () => {
    state.resetAll();
    state.doc = { kind: 'tile', root: { elmType: 'div', txtContent: 'x' } };
    state.selection = null;
    const host = document.createElement('div');
    document.body.appendChild(host);
    mountCanvas(host, () => {});
    expect(host.querySelector('.wb-canvas-hoverpin')).toBeNull();

    state.doc = hoverDoc();
    state.emit('document');
    expect(host.querySelector('.wb-canvas-hoverpin')).toBeTruthy();
    state.resetAll();
  });

  it('toggling the pin flags the canvas for force-reveal; Live mode stands it down', () => {
    state.resetAll();
    state.doc = hoverDoc();
    state.selection = null;
    const host = document.createElement('div');
    document.body.appendChild(host);
    mountCanvas(host, () => {});

    expect(host.classList.contains('wb-simulate-hover')).toBe(false);
    (host.querySelector('.wb-canvas-hoverpin') as HTMLButtonElement).click();
    expect(state.simulateHover).toBe(true);
    expect(host.classList.contains('wb-simulate-hover')).toBe(true);

    // Live mode must behave like real SP: the reveal class comes off and the
    // pin is disabled while live, even though the pin state itself is kept
    state.setCanvasMode('live');
    expect(host.classList.contains('wb-simulate-hover')).toBe(false);
    expect((host.querySelector('.wb-canvas-hoverpin') as HTMLButtonElement).disabled).toBe(true);

    state.setCanvasMode('select');
    expect(host.classList.contains('wb-simulate-hover')).toBe(true);

    state.setSimulateHover(false);
    expect(host.classList.contains('wb-simulate-hover')).toBe(false);
    state.resetAll();
  });
});

describe('field drops (§5: FIELD_MIME lands as the look-aware cell)', () => {
  const dragEvent = (type: string, fieldName: string): Event => {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    (ev as unknown as { dataTransfer: unknown }).dataTransfer = {
      types: ['application/x-wb-field'],
      getData: (mime: string) => (mime === 'application/x-wb-field' ? fieldName : ''),
      setData: () => {},
      dropEffect: '',
      effectAllowed: '',
    };
    return ev;
  };

  it('accept-gates the dragover and inserts gridCellForField on drop — one undo step', () => {
    state.resetAll(); // Status wears the status-pill look by default
    state.createView({ kind: 'row', root: { elmType: 'div', children: [] } });
    state.selection = null;
    const host = document.createElement('div');
    document.body.appendChild(host);
    mountCanvas(host, () => {});

    const over = dragEvent('dragover', 'Status');
    host.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true); // the canvas advertises the drop

    const undoDepth = (state as unknown as { undoStack: string[] }).undoStack.length;
    host.dispatchEvent(dragEvent('drop', 'Status'));
    const cell = state.doc.root.children!.at(-1)!;
    expect(cell._field).toBe('Status');
    expect(cell._component?.id).toBe('palette-status-pill'); // arrived dressed
    expect((state as unknown as { undoStack: string[] }).undoStack.length).toBe(undoDepth + 1);
    state.resetAll();
  });

  it('an unknown field name is a no-op drop', () => {
    state.resetAll();
    state.createView({ kind: 'row', root: { elmType: 'div', children: [] } });
    const host = document.createElement('div');
    document.body.appendChild(host);
    mountCanvas(host, () => {});
    const before = JSON.stringify(state.doc.root);
    host.dispatchEvent(dragEvent('drop', 'Ghost'));
    expect(JSON.stringify(state.doc.root)).toBe(before);
    state.resetAll();
  });
});

describe('canvas zoom (#216) — a read-only VIEW control', () => {
  const mount = (prefs?: unknown) => {
    const sets: unknown[] = [];
    const host = document.createElement('div');
    document.body.appendChild(host);
    mountCanvas(host, () => {}, { get: () => prefs, set: (p) => sets.push({ ...p }) });
    return { host, sets };
  };

  it('renders −/%/＋/↺ on the toolbar; stepping scales the zoom box and persists', () => {
    state.resetAll();
    const { host, sets } = mount();
    const box = host.querySelector('.wb-canvas-zoombox') as HTMLElement;
    expect(box.style.transform).toBe(''); // 100% = no transform (e2e-safe default)
    expect(host.querySelector('.wb-canvas-zoompct')?.textContent).toBe('100%');

    const resetBtn = host.querySelector('[data-zoom="reset"]') as HTMLButtonElement;
    expect(resetBtn).toBeTruthy();
    expect(resetBtn.textContent).toBe('↺');
    expect(resetBtn.disabled).toBe(true); // disabled at 100%

    (host.querySelector('[data-zoom="in"]') as HTMLButtonElement).click();
    expect(box.style.transform).toBe('scale(1.1)');
    expect(host.querySelector('.wb-canvas-zoompct')?.textContent).toBe('110%');
    expect(sets.at(-1)).toMatchObject({ zoom: 1.1 });
    expect(resetBtn.disabled).toBe(false); // enabled now

    // clicking resetBtn resets to 100%
    resetBtn.click();
    expect(box.style.transform).toBe('');
    expect(sets.at(-1)).toMatchObject({ zoom: 1 });
    expect(resetBtn.disabled).toBe(true); // disabled again

    // the % readout also still works as a reset button
    (host.querySelector('[data-zoom="in"]') as HTMLButtonElement).click();
    expect(resetBtn.disabled).toBe(false);
    (host.querySelector('.wb-canvas-zoompct') as HTMLButtonElement).click();
    expect(box.style.transform).toBe('');
    expect(sets.at(-1)).toMatchObject({ zoom: 1 });
    expect(resetBtn.disabled).toBe(true);
    state.resetAll();
  });

  it('clamps at 25%–200% (buttons disable at the ends)', () => {
    state.resetAll();
    const { host } = mount({ zoom: 2 });
    const inBtn = host.querySelector('[data-zoom="in"]') as HTMLButtonElement;
    expect(inBtn.disabled).toBe(true);
    expect((host.querySelector('.wb-canvas-zoombox') as HTMLElement).style.transform).toBe('scale(2)');
    state.resetAll();
  });

  it('Ctrl+wheel zooms; a bare wheel scrolls as usual', () => {
    state.resetAll();
    const { host } = mount();
    const box = host.querySelector('.wb-canvas-zoombox') as HTMLElement;

    host.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }));
    expect(box.style.transform).toBe(''); // no Ctrl → untouched

    const zoomWheel = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true });
    // happy-dom's WheelEventInit drops modifier keys — stamp it on directly
    Object.defineProperty(zoomWheel, 'ctrlKey', { value: true });
    host.dispatchEvent(zoomWheel);
    expect(zoomWheel.defaultPrevented).toBe(true); // never page-zooms the app
    expect(box.style.transform).toBe('scale(1.1)');
    state.resetAll();
  });

  it('zoom mutates nothing: no undo entry, document JSON untouched', () => {
    state.resetAll();
    const { host } = mount();
    const doc = JSON.stringify(state.doc.root);
    const undoDepth = (state as unknown as { undoStack: string[] }).undoStack.length;
    (host.querySelector('[data-zoom="out"]') as HTMLButtonElement).click();
    expect(JSON.stringify(state.doc.root)).toBe(doc);
    expect((state as unknown as { undoStack: string[] }).undoStack.length).toBe(undoDepth);
    state.resetAll();
  });

  it('restores a persisted zoom at mount (and sanitizes garbage)', () => {
    state.resetAll();
    const { host } = mount({ zoom: 1.5 });
    expect((host.querySelector('.wb-canvas-zoombox') as HTMLElement).style.transform).toBe('scale(1.5)');
    const { host: h2 } = mount({ zoom: 'huge' });
    expect((h2.querySelector('.wb-canvas-zoombox') as HTMLElement).style.transform).toBe('');
    state.resetAll();
  });
});

describe('viewport width presets + drag handle (#224) — width reflows, zoom magnifies', () => {
  const mount = (prefs?: unknown) => {
    const sets: unknown[] = [];
    const host = document.createElement('div');
    document.body.appendChild(host);
    mountCanvas(host, () => {}, { get: () => prefs, set: (p) => sets.push({ ...p }) });
    return { host, sets };
  };

  it('offers a Fit/Average/Half/Phone dropdown and a resize handle in every canvas kind', () => {
    state.resetAll(); // the floor grid
    for (const make of [
      () => {},
      () => state.createView({ kind: 'row', root: { elmType: 'div', children: [] } }),
      () => state.createView({ kind: 'tile', root: { elmType: 'div', children: [] } }),
    ]) {
      make();
      const { host } = mount();
      expect([...host.querySelectorAll('.wb-canvas-vpsel [data-viewport]')].map((o) => o.getAttribute('data-viewport')))
        .toEqual(['fit', 'average', 'half', 'phone']);
      expect(host.querySelector('.wb-canvas-widthhandle')).toBeTruthy();
    }
    state.resetAll();
  });

  it('a preset constrains the STAGE layout width (real reflow), shows ≈px, persists — and mutates nothing', () => {
    state.resetAll();
    const { host, sets } = mount();
    const stage = host.querySelector('.wb-canvas-stage') as HTMLElement;
    const doc = JSON.stringify(state.doc.root);
    const undoDepth = (state as unknown as { undoStack: string[] }).undoStack.length;

    const sel = host.querySelector('.wb-canvas-vpsel') as HTMLSelectElement;
    sel.value = 'phone';
    sel.dispatchEvent(new Event('change'));
    expect(stage.style.width).toBe('360px');
    expect(stage.classList.contains('wb-canvas-stage--framed')).toBe(true);
    expect(host.querySelector('.wb-canvas-vppx')?.textContent).toBe('≈360px'); // honesty on screen
    expect(sel.value).toBe('phone');
    expect(sets.at(-1)).toEqual({ zoom: 1, viewportWidth: 360 });
    // read-only view control: no undo entry, no document change
    expect(JSON.stringify(state.doc.root)).toBe(doc);
    expect((state as unknown as { undoStack: string[] }).undoStack.length).toBe(undoDepth);

    sel.value = 'fit';
    sel.dispatchEvent(new Event('change'));
    expect(stage.style.width).toBe('');
    expect(stage.classList.contains('wb-canvas-stage--framed')).toBe(false);
    expect(sets.at(-1)).toEqual({ zoom: 1, viewportWidth: null });
    state.resetAll();
  });

  it('zoom and width COMPOSE (phone width and zoomed in) and restore together at mount', () => {
    state.resetAll();
    const { host } = mount({ zoom: 1.5, viewportWidth: 860 });
    expect((host.querySelector('.wb-canvas-zoombox') as HTMLElement).style.transform).toBe('scale(1.5)');
    const stage = host.querySelector('.wb-canvas-stage') as HTMLElement;
    expect(stage.style.width).toBe('860px'); // layout width unscathed by zoom
    expect((host.querySelector('.wb-canvas-vpsel') as HTMLSelectElement).value).toBe('half');
    state.resetAll();
  });

  it('a custom (dragged) width shows the ≈px readout and reads back as Custom', () => {
    state.resetAll();
    const { host } = mount({ zoom: 1, viewportWidth: 500 });
    const sel = host.querySelector('.wb-canvas-vpsel') as HTMLSelectElement;
    expect((host.querySelector('.wb-canvas-stage') as HTMLElement).style.width).toBe('500px');
    expect(host.querySelector('.wb-canvas-vppx')?.textContent).toBe('≈500px');
    expect(sel.value).toBe('custom');
    // double-clicking the handle dissolves the constraint back to Fit
    (host.querySelector('.wb-canvas-widthhandle') as HTMLElement)
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect((host.querySelector('.wb-canvas-stage') as HTMLElement).style.width).toBe('');
    expect(sel.value).toBe('fit');
    state.resetAll();
  });
});

describe('token drops (#217): a chip onto a rendered text element binds its text', () => {
  const dragEvent = (type: string, fieldName: string): Event => {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    (ev as unknown as { dataTransfer: unknown }).dataTransfer = {
      types: ['application/x-wb-field'],
      getData: (mime: string) => (mime === 'application/x-wb-field' ? fieldName : ''),
      setData: () => {},
      dropEffect: '',
      effectAllowed: '',
    };
    return ev;
  };
  const undoDepth = (): number => (state as unknown as { undoStack: string[] }).undoStack.length;

  const mountRowView = (toasts: string[]): HTMLElement => {
    state.resetAll();
    state.createView({
      kind: 'row',
      root: { elmType: 'div', children: [{ elmType: 'span', txtContent: 'hello' }] },
    });
    state.selection = null;
    const host = document.createElement('div');
    document.body.appendChild(host);
    mountCanvas(host, (m) => toasts.push(m));
    return host;
  };

  it('binds txtContent to the field token — ONE undoable mutation, toast, selected', () => {
    const toasts: string[] = [];
    const host = mountRowView(toasts);
    const leaf = host.querySelector('.wb-mock-viewrow [data-sp-path="0"]') as HTMLElement;

    const before = undoDepth();
    leaf.dispatchEvent(dragEvent('drop', 'Status'));
    expect(state.nodeAt([0])!.txtContent).toBe('[$Status]');
    expect(state.doc.root.children).toHaveLength(1); // bound, not inserted
    expect(undoDepth()).toBe(before + 1);            // ONE undo step
    expect(state.selection).toEqual([0]);
    expect(toasts.at(-1)).toContain('now shows Status');

    state.undo();
    expect(state.nodeAt([0])!.txtContent).toBe('hello');
    state.resetAll();
  });

  it('the token is type-aware (a person chip lands as [$Owner.title])', () => {
    const host = mountRowView([]);
    (host.querySelector('.wb-mock-viewrow [data-sp-path="0"]') as HTMLElement)
      .dispatchEvent(dragEvent('drop', 'Owner'));
    expect(state.nodeAt([0])!.txtContent).toBe('[$Owner.title]');
    state.resetAll();
  });

  it('a container keeps insert semantics — dropping on the row root adds a cell, text untouched', () => {
    const toasts: string[] = [];
    const host = mountRowView(toasts);
    (host.querySelector('.wb-mock-viewrow [data-sp-path=""]') as HTMLElement)
      .dispatchEvent(dragEvent('drop', 'Status'));
    expect(state.doc.root.children).toHaveLength(2); // inserted into the container
    expect(state.nodeAt([0])!.txtContent).toBe('hello');
    expect(toasts.at(-1)).toContain('Added the Status column');
    state.resetAll();
  });

  it('the grid floor keeps its "chips are columns" grammar: a cell drop still adds a column', () => {
    state.resetAll(); // the floor grid — Title is column 0, a plain text cell
    const toasts: string[] = [];
    const host = document.createElement('div');
    document.body.appendChild(host);
    mountCanvas(host, (m) => toasts.push(m));

    const columnsBefore = state.doc.root.children!.length;
    (host.querySelector('.wb-grid [data-sp-path="0"]') as HTMLElement)
      .dispatchEvent(dragEvent('drop', 'Tags'));
    expect(state.doc.root.children!.length).toBe(columnsBefore + 1); // a NEW column
    expect(state.nodeAt([0])!.txtContent).toBe('[$Title]');          // never rebound
    expect(toasts.at(-1)).toContain('Added the Tags column');
    state.resetAll();
  });
});

describe('Select/Live canvas mode (FLOOR-AND-SHEETS Stage 3)', () => {
  it('Select: a customRowAction click SELECTS; Live: it fires the behavior instead', () => {
    state.resetAll();
    const toasts: string[] = [];
    state.createView({
      kind: 'row',
      root: {
        elmType: 'div',
        children: [{ elmType: 'button', txtContent: 'Go', customRowAction: { action: 'executeFlow', actionParams: '{"id":"x"}' } }],
      },
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    mountCanvas(host, (m) => toasts.push(m));

    // the shared chrome renders the segmented toggle, Select active by default
    expect(host.querySelector('.wb-canvas-mode.active')?.textContent).toBe('Select');

    const clickButton = (): void => {
      (host.querySelector('.wb-mock-viewrow [data-sp-path="0"]') as HTMLElement)
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    };
    clickButton();
    expect(state.selection).toEqual([0]); // selected…
    expect(toasts.some((t) => t.includes('customRowAction'))).toBe(false); // …not fired

    state.setCanvasMode('live');
    clickButton();
    expect(toasts.some((t) => t.includes('customRowAction: executeFlow'))).toBe(true);
    expect(state.selection).toEqual([0]); // live clicks never change the selection

    state.setCanvasMode('select'); // leave the singleton the way we found it
    state.resetAll();
  });
});
