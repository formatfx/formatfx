/**
 * editor/breadcrumb.ts — the "where am I / where does it save" line above the
 * canvas. It owns the left side of the ribbon strip and re-renders on state
 * change. One purpose: render the crumbs + Back from workspace state, and open
 * the right menu on a root-crumb click. It reads state and calls
 * state.open* / the two menu modules; nothing reads it back.
 *
 *   [ Root crumb ▾ ] › [ Tail crumb ]      ← Back to {view} view formatter
 *   └ menu trigger (browse)  └ current doc  └ retrace (only when drilled in)
 *
 * Three workspace states map to two shapes, derived from activeDocKey and
 * doc.kind (spec §4):
 *   · main + grid/row/tile → View Formatters ▾ · tail = the view name
 *   · main + column        → Column Formatters ▾ · tail = the field name
 *   · drilled into a ref   → Column Formatters ▾ · tail = the ref's column
 */

import { state } from './state';
import { openViewMenu } from './viewMenu';
import { openColumnGallery } from './columnGallery';

/** Display label for a field: its display name when set, else its raw name —
 *  matches the Column Formatters cards. */
function fieldDisplay(name: string): string {
  return state.fields.find((f) => f.name === name)?.displayName ?? name;
}

export function mountBreadcrumb(host: HTMLElement, onToast: (m: string) => void): void {
  const render = (): void => {
    host.replaceChildren();
    const drilled = state.activeDocKey !== 'main';
    const isColumn = drilled || state.doc.kind === 'column';

    // root crumb — the menu trigger (browse)
    const root = document.createElement('button');
    root.type = 'button';
    root.className = 'wb-crumb wb-crumb-root';
    root.textContent = isColumn ? 'Column Formatters ▾' : 'View Formatters ▾';
    root.title = isColumn
      ? 'Browse the columns that have a formatter, or start one'
      : 'The view formatter on the canvas — rename it or manage views';
    root.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isColumn) openColumnGallery(root, onToast);
      else openViewMenu(root, onToast);
    });
    host.appendChild(root);

    const sep = document.createElement('span');
    sep.className = 'wb-crumb-sep';
    sep.textContent = '›';
    sep.setAttribute('aria-hidden', 'true');
    host.appendChild(sep);

    // tail crumb — non-interactive: where you are = where it saves
    const tail = document.createElement('span');
    tail.className = 'wb-crumb wb-crumb-tail';
    tail.textContent = isColumn
      ? fieldDisplay(drilled ? state.activeDocKey : state.currentFieldName)
      : state.viewName;
    host.appendChild(tail);

    // retrace: shown only when drilled into a column from a view
    if (drilled) {
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'wb-crumb-back';
      back.textContent = `← Back to ${state.viewName} view formatter`;
      back.title = `Return to the ${state.viewName} view formatter you drilled from`;
      back.addEventListener('click', () => {
        state.openMain();
        onToast(`Back to the ${state.viewName} view formatter`);
      });
      host.appendChild(back);
    }
  };

  state.subscribe((reason) => {
    if (reason === 'data' || reason === 'load' || reason === 'kind') render();
  });
  render();
}
