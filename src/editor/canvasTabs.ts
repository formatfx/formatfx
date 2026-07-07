/**
 * editor/canvasTabs.ts — the CANVAS TAB STRIP (COLUMNS-COMPONENTS-VIEWS §2,
 * Phase B): "each component or view that gets opened using the left pane
 * becomes a tab in the right canvas pane in the order that they're opened,
 * but the tabs can be rearranged" (owner, 2026-07-06).
 *
 *   · One tab per state.openTabs entry: the standing ▦ Grid tab, the named
 *     views (double-click renames inline — the viewStrip convention), and ⬡
 *     component WORKSHOP tabs (dirty dot while staged edits are unsaved).
 *   · Clicking a grid/view tab is NAVIGATION (minimizeView/openView — never a
 *     mutation); clicking a component tab activates the workshop, which
 *     COVERS the canvas region (#wb-canvas hides, the workshop host shows).
 *     The fx bar / JSON pane / Explain keep following the active SURFACE in
 *     v1 — they read state.doc, which never aliases a staged def.
 *   · Tabs drag to REARRANGE (insert-before semantics → state.moveTab), and
 *     view tabs are SPRING-LOADED during component/field drags: hover one
 *     ~600ms and it opens under the drag (navigation only, §5).
 *   · Per-def staged edits stay alive across tab switches (a small keep-alive
 *     map feeds mountComponentWorkshop's resume); closing a dirty workshop
 *     tab asks confirm() once — close means discard.
 */

import { state, tabKey, type CanvasTab } from './state';
import { componentById, COMPONENT_MIME } from './componentLibrary';
import { FIELD_MIME } from './templateUi';
import {
  mountComponentWorkshop,
  type WorkshopHandle, type WorkshopStaging,
} from './componentEditor';

/** Drag payload for rearranging tabs (carries the source index). */
export const TAB_MIME = 'application/x-wb-canvastab';

/** How long a component/field drag hovers a view tab before it springs open. */
const SPRING_MS = 600;

/** How many defs' staged edits the keep-alive map retains (oldest dropped). */
const STAGING_CAP = 8;

export function mountCanvasTabs(
  stripHost: HTMLElement,
  workshopHost: HTMLElement,
  onToast: (m: string) => void,
): void {
  stripHost.classList.add('wb-canvastabs');
  // plain NAVIGATION semantics, deliberately not the ARIA tabs pattern (the
  // viewStrip precedent): no tab-panel relationship exists, so tab roles
  // would promise interactions they don't have; aria-current marks active
  stripHost.setAttribute('role', 'navigation');
  stripHost.setAttribute('aria-label', 'Canvas tabs');

  // ── workshop keep-alive: per-def staging + dirty dots ──────────────────────
  const staging = new Map<string, WorkshopStaging>();
  const dirtyByDef = new Map<string, boolean>();
  let handle: WorkshopHandle | null = null;
  let mountedDef: string | null = null;

  const isDirty = (defId: string): boolean =>
    dirtyByDef.get(defId) ?? staging.get(defId)?.dirty ?? false;

  /** Stash the live workshop's staging (capped) and tear its DOM down. */
  const unmountWorkshop = (stash: boolean): void => {
    if (handle && mountedDef !== null && stash) {
      staging.set(mountedDef, handle.staging());
      while (staging.size > STAGING_CAP) {
        const oldest = staging.keys().next().value;
        if (oldest === undefined) break;
        staging.delete(oldest);
      }
    }
    handle?.destroy();
    handle = null;
    mountedDef = null;
    workshopHost.replaceChildren();
  };

  /** A workshop save landed: re-stage this tab on the SAVED def. When a
   *  builtin (or save-as-new) produced a copy, the tab swaps onto the copy's
   *  id in place — the maker keeps editing "their" component. */
  const onWorkshopSaved = (oldId: string, newId: string): void => {
    staging.delete(oldId);
    staging.delete(newId);
    dirtyByDef.delete(oldId);
    dirtyByDef.set(newId, false);
    unmountWorkshop(false); // never stash pre-save staging — the def IS it now
    if (newId !== oldId) {
      const at = state.openTabs.findIndex((t) => tabKey(t) === `component:${oldId}`);
      state.closeTab(`component:${oldId}`);
      state.openComponentTab(newId); // appends at the end…
      if (at >= 0) state.moveTab(state.openTabs.length - 1, at); // …swap in place
    }
    render(); // same-id saves emit nothing — remount on the saved def explicitly
  };

  /** Swap the canvas region: workshop over #wb-canvas while a component tab
   *  is active; the surface (and state.doc) waits untouched underneath. */
  const refreshRegion = (): void => {
    const active = state.activeComponentTab;
    const canvas = document.getElementById('wb-canvas');
    if (active === null) {
      if (mountedDef !== null) unmountWorkshop(true);
      workshopHost.hidden = true;
      if (canvas) canvas.hidden = false;
      return;
    }
    const def = componentById(active);
    if (!def) return; // render() already queued this tab's drop
    if (canvas) canvas.hidden = true;
    workshopHost.hidden = false;
    if (mountedDef === active) return;
    unmountWorkshop(true);
    mountedDef = active;
    dirtyByDef.set(active, staging.get(active)?.dirty ?? false);
    handle = mountComponentWorkshop(workshopHost, def, {
      onToast,
      resume: staging.get(active),
      onDirtyChange: (d) => {
        dirtyByDef.set(active, d);
        renderStrip(); // the dirty dot toggles
      },
      onSaved: (newDefId) => onWorkshopSaved(active, newDefId),
    });
  };

  // ── closing ────────────────────────────────────────────────────────────────
  const requestClose = (t: CanvasTab): void => {
    if (t.kind === 'component') {
      if (isDirty(t.defId)
        && !window.confirm('Discard your staged component edits? Closing the tab throws them away.')) {
        return;
      }
      // close means discard — drop the keep-alive too
      staging.delete(t.defId);
      dirtyByDef.delete(t.defId);
      if (mountedDef === t.defId) unmountWorkshop(false);
    }
    state.closeTab(tabKey(t)); // emits 'data' → the strip re-renders
  };

  // ── inline rename (the viewStrip convention: Enter/blur commit, Esc cancels) ──
  const startRename = (btn: HTMLElement, viewId: string): void => {
    const view = state.viewById(viewId);
    if (!view) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'wb-canvastab-input';
    input.value = view.name;
    input.setAttribute('aria-label', `Rename the ${view.name} view`);
    btn.replaceWith(input);
    let done = false;
    const commit = (): void => {
      if (done) return;
      done = true;
      state.renameView(viewId, input.value); // emits 'data' → the strip re-renders
      const now = state.viewById(viewId)?.name ?? view.name;
      if (now !== view.name) onToast(`View renamed to “${now}”`);
      else render();
    };
    const cancel = (): void => {
      if (done) return;
      done = true;
      render();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
    });
    input.addEventListener('blur', commit);
    input.focus();
    input.select();
  };

  // ── one tab ────────────────────────────────────────────────────────────────
  const tabEl = (t: CanvasTab, index: number, activeKey: string): HTMLElement => {
    const key = tabKey(t);
    const active = key === activeKey;
    const tab = document.createElement('div');
    tab.className = `wb-canvastab wb-canvastab-${t.kind === 'component' ? 'comp' : t.kind}`
      + (active ? ' active' : '');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wb-canvastab-btn';
    if (active) btn.setAttribute('aria-current', 'true');

    const mark = document.createElement('span');
    mark.className = 'wb-canvastab-mark';
    mark.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.className = 'wb-canvastab-name';

    if (t.kind === 'grid') {
      mark.textContent = '▦';
      name.textContent = 'Grid';
      btn.title = active
        ? 'The columns grid is on the canvas'
        : 'Back to the columns grid — any open view waits in its tab';
      btn.addEventListener('click', () => {
        if (state.activeTabKey === 'grid') return;
        state.minimizeView(); // navigation (or just uncovers the floor)
      });
    } else if (t.kind === 'view') {
      const view = state.viewById(t.id);
      mark.textContent = view?.doc.kind === 'tile' ? '▤' : '☰';
      name.textContent = view?.name ?? t.id;
      btn.title = (active
        ? 'This view is on the canvas'
        : `Open “${view?.name ?? t.id}” (${view?.doc.kind === 'tile' ? 'tile' : 'row'} view)`)
        + ' — double-click to rename';
      btn.addEventListener('click', () => {
        if (state.activeTabKey === key) return;
        const navigates = state.activeViewId !== t.id;
        state.openView(t.id); // clears any workshop cover too
        if (navigates) onToast(`Opened “${state.viewById(t.id)?.name ?? t.id}”`);
      });
      btn.addEventListener('dblclick', () => startRename(btn, t.id));
    } else {
      const def = componentById(t.defId);
      mark.textContent = '⬡';
      name.textContent = def?.name ?? t.defId;
      btn.title = active
        ? `The ${def?.name ?? 'component'} workshop is on the canvas`
        : `Open the ${def?.name ?? 'component'} workshop — staged edits, nothing changes until you save`;
      if (isDirty(t.defId)) {
        tab.classList.add('wb-canvastab-dirty');
        const dot = document.createElement('span');
        dot.className = 'wb-canvastab-dot';
        dot.title = 'Unsaved staged edits';
        dot.setAttribute('aria-label', 'Unsaved staged edits');
        name.appendChild(dot);
      }
      btn.addEventListener('click', () => state.openComponentTab(t.defId));
    }
    btn.prepend(mark);
    btn.appendChild(name);
    tab.appendChild(btn);

    if (t.kind !== 'grid') {
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'wb-canvastab-close';
      close.textContent = '✕';
      close.title = t.kind === 'view'
        ? 'Close this tab — the view itself waits in the views list'
        : 'Close this tab — unsaved staged edits are discarded (you\'ll be asked)';
      close.setAttribute('aria-label', `Close the ${name.textContent} tab`);
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        requestClose(t);
      });
      tab.appendChild(close);
    }

    // ── drag: rearrange tabs; view tabs spring open under component/field drags ──
    let springTimer = 0;
    const clearSpring = (): void => {
      if (springTimer) { window.clearTimeout(springTimer); springTimer = 0; }
      tab.classList.remove('wb-canvastab-spring');
    };
    const clearInsert = (): void => {
      tab.classList.remove('wb-canvastab-before', 'wb-canvastab-after');
    };
    tab.draggable = true;
    tab.addEventListener('dragstart', (e) => {
      if (!e.dataTransfer) return;
      e.dataTransfer.setData(TAB_MIME, String(index));
      e.dataTransfer.effectAllowed = 'move';
      tab.classList.add('wb-canvastab-dragging');
    });
    tab.addEventListener('dragend', () => {
      tab.classList.remove('wb-canvastab-dragging');
      clearInsert();
      clearSpring();
    });
    tab.addEventListener('dragover', (e) => {
      const dt = e.dataTransfer;
      if (!dt) return;
      if (dt.types.includes(TAB_MIME)) {
        // rearrange: accept-gated to the tab payload, insert-before indicator
        e.preventDefault();
        dt.dropEffect = 'move';
        const before = e.offsetX < tab.offsetWidth / 2;
        tab.classList.toggle('wb-canvastab-before', before);
        tab.classList.toggle('wb-canvastab-after', !before);
      } else if (t.kind === 'view'
        && (dt.types.includes(FIELD_MIME) || dt.types.includes(COMPONENT_MIME))) {
        // spring-loading (§5): NOT a drop target — hovering long enough just
        // opens the view under the drag, so the canvas can take the drop
        tab.classList.add('wb-canvastab-spring');
        if (!springTimer) {
          springTimer = window.setTimeout(() => {
            springTimer = 0;
            if (state.activeTabKey !== key) {
              state.openView(t.id); // navigation only — the drag carries on
              onToast(`Opened “${state.viewById(t.id)?.name ?? t.id}” — drop it on the canvas`);
            }
          }, SPRING_MS);
        }
      }
    });
    tab.addEventListener('dragleave', () => {
      clearInsert();
      clearSpring();
    });
    tab.addEventListener('drop', (e) => {
      clearInsert();
      clearSpring();
      const dt = e.dataTransfer;
      if (!dt || !dt.types.includes(TAB_MIME)) return;
      e.preventDefault();
      e.stopPropagation();
      const from = Number(dt.getData(TAB_MIME));
      if (!Number.isInteger(from)) return;
      const before = e.offsetX < tab.offsetWidth / 2;
      let to = index + (before ? 0 : 1); // insert-before semantics
      if (to > from) to -= 1;            // removing the source shifts the slot left
      state.moveTab(from, to);           // emits 'data' → the strip re-renders
    });

    return tab;
  };

  // ── the strip ──────────────────────────────────────────────────────────────
  const renderStrip = (): void => {
    stripHost.replaceChildren();
    const activeKey = state.activeTabKey;
    state.openTabs.forEach((t, i) => stripHost.appendChild(tabEl(t, i, activeKey)));
  };

  const render = (): void => {
    // a def deleted from the library orphans its tab — drop it (closeTab
    // emits 'data', which re-runs render over the clean list)
    const stale = state.openTabs.filter(
      (t): t is Extract<CanvasTab, { kind: 'component' }> =>
        t.kind === 'component' && !componentById(t.defId),
    );
    if (stale.length) {
      for (const t of stale) {
        if (mountedDef === t.defId) unmountWorkshop(false);
        staging.delete(t.defId);
        dirtyByDef.delete(t.defId);
        state.closeTab(tabKey(t));
      }
      return;
    }
    renderStrip();
    refreshRegion();
  };

  // dropping a dragged tab past the last one moves it to the end
  stripHost.addEventListener('dragover', (e) => {
    if (e.target !== stripHost) return;
    if (!e.dataTransfer?.types.includes(TAB_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  });
  stripHost.addEventListener('drop', (e) => {
    if (e.target !== stripHost) return;
    const dt = e.dataTransfer;
    if (!dt?.types.includes(TAB_MIME)) return;
    e.preventDefault();
    const from = Number(dt.getData(TAB_MIME));
    if (Number.isInteger(from)) state.moveTab(from, state.openTabs.length - 1);
  });

  const hostAny = stripHost as unknown as { _unsub?: () => void };
  hostAny._unsub?.();
  hostAny._unsub = state.subscribe((reason) => {
    // 'load' = navigation/doc switch, 'data' = tab/rename/registry changes,
    // 'kind' = a sheet's row⇄tile flip (its tab mark + tooltip retitle)
    if (reason === 'load' || reason === 'data' || reason === 'kind') render();
  });
  render();
}
