/**
 * editor/snapMenu.ts — the snapshot menu (issue #140), anchored under the 🕘
 * history button on the Left Edit Pane's Formatters bar.
 *
 * Snapshots are full-workspace-only (owner decision, 2026-07-03): the ONE
 * take action always captures scope { kind: 'all' } — the view formatter,
 * every registered column formatter, and the view name together. The store
 * format still knows the old view/column scopes (snapshots.ts is unchanged
 * for compat), so any legacy scoped captures a maker already saved stay
 * restorable under a collapsed "Older, scoped snapshots" group — but taking
 * new scoped ones is gone. Every restore is one undoable step.
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
  type Snapshot, type SnapshotStore,
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

  // the legacy group survives re-renders (deleting one row must not collapse it)
  let legacyOpen = false;

  const render = (): void => {
    panel.replaceChildren();
    const store = readStore();

    const head = document.createElement('div');
    head.className = 'wb-snapmenu-head';
    head.textContent = 'Snapshots';
    panel.appendChild(head);

    // ── take: ONE action, always the whole workspace ────────────────────────
    const take = document.createElement('button');
    take.type = 'button';
    take.className = 'wb-snap-take';
    take.textContent = '📸 Take a snapshot';
    take.title = 'Capture the whole workspace — the view formatter, every column formatter, and the view name — and restore it from this menu any time';
    take.addEventListener('click', () => {
      const snap = state.captureSnapshot({ kind: 'all' });
      if (!snap) { onToast('Nothing to snapshot yet'); return; }
      if (!writeStore(addSnapshot(readStore(), snap))) {
        onToast('Could not save the snapshot — browser storage is full or blocked');
        return;
      }
      onToast('Snapshot taken of the whole workspace');
      render(); // the new snapshot appears in the list right away
    });
    panel.appendChild(take);

    // one restorable row (shared by the main list and the legacy group)
    const rowFor = (snap: Snapshot, restoreTitle: string): HTMLElement => {
      const row = document.createElement('div');
      row.className = 'wb-snap-row';

      const restore = document.createElement('button');
      restore.type = 'button';
      restore.className = 'wb-snap-restore';
      restore.title = restoreTitle;
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
      return row;
    };

    // ── the main list: the whole-workspace captures ──────────────────────────
    const snaps = snapshotsFor(store, { kind: 'all' });
    if (!snaps.length) {
      const none = document.createElement('div');
      none.className = 'wb-snapmenu-empty';
      none.textContent = 'No snapshots yet — take one above before you experiment.';
      panel.appendChild(none);
    }
    for (const snap of snaps) {
      panel.appendChild(rowFor(
        snap,
        'Restore this snapshot — one undoable step (Ctrl+Z brings the current state back)',
      ));
    }

    // ── legacy scoped captures: restorable, never orphaned, never re-taken ──
    const legacy = store.snapshots
      .filter((s) => s.scope.kind !== 'all')
      .sort((a, b) => b.takenAt.localeCompare(a.takenAt));
    if (legacy.length) {
      const details = document.createElement('details');
      details.className = 'wb-snap-legacy';
      details.open = legacyOpen;
      details.addEventListener('toggle', () => { legacyOpen = details.open; });
      const summary = document.createElement('summary');
      summary.className = 'wb-snapmenu-group';
      summary.textContent = `Older, scoped snapshots (${legacy.length})`;
      summary.title = 'Taken before snapshots covered the whole workspace — each restores only the view or column it captured';
      details.appendChild(summary);
      for (const snap of legacy) {
        details.appendChild(rowFor(
          snap,
          'Restore this older snapshot — it only covers the view or column it captured (one undoable step)',
        ));
      }
      panel.appendChild(details);
    }
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
