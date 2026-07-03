/**
 * editor/snapMenu.ts — the snapshot menu (issue #140), anchored under the 🕘
 * history button beside the Left Edit Pane's document dropdown.
 *
 * Placement decides the primary action (owner decision, 2026-07-02): the
 * button is grouped with the SELECTED formatter, so the primary action
 * snapshots/restores that selection — the view, or the column being edited —
 * and "everything" (view + every column formatter + the view name) is the
 * nearby alternative in the same menu. Every restore is one undoable step.
 *
 * Persistence: localStorage under snapshots.STORAGE_KEY ('wb-snapshots.v1',
 * additive — the frozen project/prefs keys stay untouched). The store brain
 * (caps, scope keys, eviction) is the pure snapshots.ts; this module only
 * renders it and calls state.captureSnapshot / state.applySnapshot.
 */

import { state } from './state';
import {
  STORAGE_KEY, loadStore, serializeStore, addSnapshot, removeSnapshot,
  snapshotsFor, relativeTime,
  type Snapshot, type SnapshotScope, type SnapshotStore,
} from './snapshots';

function readStore(): SnapshotStore {
  try {
    return loadStore(localStorage.getItem(STORAGE_KEY));
  } catch {
    return { version: 1, snapshots: [] };
  }
}

function writeStore(store: SnapshotStore): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, serializeStore(store));
    return true;
  } catch {
    return false; // quota/private mode — the caller toasts
  }
}

/** The scope the menu treats as "this" — mirrors the formatter tabs. */
function currentScope(): SnapshotScope {
  if (state.activeDocKey !== 'main') return { kind: 'column', field: state.activeDocKey };
  if (state.doc.kind === 'column') return { kind: 'column', field: state.currentFieldName };
  return { kind: 'view' };
}

function scopeNoun(scope: SnapshotScope): string {
  return scope.kind === 'column' ? `the ${scope.field} column formatter` : `the ${state.viewName} view`;
}

let openPanel: { panel: HTMLElement; cleanup: () => void } | null = null;

export function closeSnapMenu(): void {
  if (!openPanel) return;
  openPanel.cleanup();
  openPanel.panel.remove();
  openPanel = null;
}

/** Open the snapshot menu anchored under `anchor`. */
export function openSnapMenu(anchor: HTMLElement, onToast: (m: string) => void): void {
  closeSnapMenu();

  const panel = document.createElement('div');
  // wb-esc-owner: closes itself on Escape — see the convention in overlay.ts
  panel.className = 'wb-snapmenu wb-esc-owner';

  const render = (): void => {
    panel.replaceChildren();
    const scope = currentScope();
    const store = readStore();

    const head = document.createElement('div');
    head.className = 'wb-snapmenu-head';
    head.textContent = 'Snapshots';
    panel.appendChild(head);

    // ── take: the scoped primary, then the "everything" alternative ─────────
    const take = (s: SnapshotScope, what: string): void => {
      const snap = state.captureSnapshot(s);
      if (!snap) { onToast(`Nothing to snapshot yet for ${what}`); return; }
      if (!writeStore(addSnapshot(readStore(), snap))) {
        onToast('Could not save the snapshot — browser storage is full or blocked');
        return;
      }
      onToast(`Snapshot taken of ${what}`);
      render(); // the new snapshot appears in the list right away
    };

    const primary = document.createElement('button');
    primary.type = 'button';
    primary.className = 'wb-snap-take';
    primary.textContent = `📸 Snapshot ${scopeNoun(scope)}`;
    primary.title = `Capture ${scopeNoun(scope)} as it is right now — restore it from this menu any time`;
    primary.addEventListener('click', () => take(scope, scopeNoun(scope)));
    panel.appendChild(primary);

    const everything = document.createElement('button');
    everything.type = 'button';
    everything.className = 'wb-snap-take wb-snap-take-all';
    everything.textContent = '📸 Snapshot everything';
    everything.title = 'Capture the view formatter, every column formatter, and the view name together';
    everything.addEventListener('click', () => take({ kind: 'all' }, 'the whole workspace'));
    panel.appendChild(everything);

    // ── restore lists: this scope first, then the everything group ──────────
    const section = (title: string, snaps: Snapshot[], empty: string): void => {
      const label = document.createElement('div');
      label.className = 'wb-snapmenu-group';
      label.textContent = title;
      panel.appendChild(label);
      if (!snaps.length) {
        const none = document.createElement('div');
        none.className = 'wb-snapmenu-empty';
        none.textContent = empty;
        panel.appendChild(none);
        return;
      }
      for (const snap of snaps) {
        const row = document.createElement('div');
        row.className = 'wb-snap-row';

        const restore = document.createElement('button');
        restore.type = 'button';
        restore.className = 'wb-snap-restore';
        restore.title = 'Restore this snapshot — one undoable step (Ctrl+Z brings the current state back)';
        const name = document.createElement('span');
        name.className = 'wb-snap-label';
        name.textContent = snap.label;
        const when = document.createElement('span');
        when.className = 'wb-snap-when';
        when.textContent = relativeTime(snap.takenAt, new Date());
        when.title = new Date(snap.takenAt).toLocaleString();
        restore.append(name, when);
        restore.addEventListener('click', () => {
          if (!state.applySnapshot(snap)) {
            onToast('This snapshot could not be restored (its data is missing or corrupt)');
            return;
          }
          closeSnapMenu();
          onToast(`Restored ${snap.label} — Ctrl+Z brings back what you had`);
        });

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'wb-snap-del';
        del.textContent = '✕';
        del.title = 'Delete this snapshot';
        del.setAttribute('aria-label', `Delete snapshot ${snap.label}`);
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          writeStore(removeSnapshot(readStore(), snap.id));
          render();
        });

        row.append(restore, del);
        panel.appendChild(row);
      }
    };

    section(
      scope.kind === 'column' ? `${scope.field} column` : 'This view',
      snapshotsFor(store, scope),
      'No snapshots yet — take one above before you experiment.',
    );
    section(
      'Everything',
      snapshotsFor(store, { kind: 'all' }),
      'No workspace snapshots yet.',
    );
  };

  render();
  document.body.appendChild(panel);

  // position under the anchor, kept on-screen
  const r = anchor.getBoundingClientRect();
  panel.style.top = `${Math.min(r.bottom + 6, Math.max(8, window.innerHeight - 340))}px`;
  panel.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 300))}px`;

  let done = false;
  const close = (): void => { if (!done) { done = true; closeSnapMenu(); } };
  const onOutside = (e: PointerEvent): void => {
    if (!panel.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); };
  // defer the outside-close so the opening click doesn't close the menu;
  // Escape listens immediately (matches columnGallery)
  const armTimer = window.setTimeout(() => document.addEventListener('pointerdown', onOutside), 0);
  document.addEventListener('keydown', onKey);
  const cleanup = (): void => {
    window.clearTimeout(armTimer);
    document.removeEventListener('pointerdown', onOutside);
    document.removeEventListener('keydown', onKey);
  };
  openPanel = { panel, cleanup };
}
