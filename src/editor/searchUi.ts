// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * editor/searchUi.ts — the universal search overlay (Ctrl+F / topbar 🔎).
 *
 * A command-palette box over the app: one query, grouped results from the
 * search brain (search.ts — pure, node-tested), fully keyboard-drivable.
 * The rule the whole surface is built on: activating a result NAVIGATES,
 * never mutates — the only writes are the explicit Insert / Apply buttons
 * on an insertable's preview card, each exactly one undoable step. Esc (or
 * the backdrop) closes with nothing changed, so a misclick can't corrupt a
 * formatter.
 */

import { state } from './state';
import { createOverlay, type OverlayHandle } from './overlay';
import { PALETTE, instantiate } from './presets';
import { QUICK_LOOKS } from './playground';
import { gridColumnForField } from './gridView';
import { focusFxSlot } from './fxBar';
import {
  indexElements, indexColumns, indexInsertables, indexReference,
  runSearch, teachingNote,
  type SearchEntry, type SearchHit, type SearchSurface, type SearchAction,
} from './search';

let handle: OverlayHandle | null = null;
/** Session memory only — no new localStorage key (frozen-keys house rule). */
const recents: string[] = [];

export function closeSearch(): void {
  handle?.close();
  handle = null;
}

function recordRecent(q: string): void {
  const trimmed = q.trim();
  if (!trimmed) return;
  const i = recents.indexOf(trimmed);
  if (i >= 0) recents.splice(i, 1);
  recents.unshift(trimmed);
  if (recents.length > 6) recents.length = 6;
}

// ─── navigation targets (close first, then move, then flash) ─────────────────

/** Put the canvas on the surface a document hit lives on. Pure navigation —
 *  openView/minimizeView never touch the undo stack. */
function goToSurface(surface: SearchSurface): void {
  if (surface.kind === 'view') {
    if (state.activeViewId !== surface.id) state.openView(surface.id);
  } else if (state.activeViewId !== null) {
    state.minimizeView();
  }
}

/** Brief highlight pulse on the canvas element (and tree row) for a path —
 *  the "here it is" moment after the overlay closes. Best-effort: if the
 *  node isn't painted (hidden pane, empty render) the selection still shows. */
function flashPath(path: number[]): void {
  const key = path.join('.');
  window.setTimeout(() => {
    const targets = [
      document.querySelector(`#wb-canvas [data-sp-path="${CSS.escape(key)}"]`),
      document.querySelector(`.wb-tree-row[data-path="${CSS.escape(key)}"]`),
    ];
    for (const el of targets) {
      if (!el) continue;
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      el.classList.add('wb-search-flash');
      window.setTimeout(() => el.classList.remove('wb-search-flash'), 1300);
    }
  }, 60);
}

function flashGridColumn(colIndex: number): void {
  window.setTimeout(() => {
    const header = document.querySelector(`#wb-canvas .wb-grid-header[data-col="${colIndex}"]`);
    if (!header) return;
    header.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    header.classList.add('wb-search-flash');
    window.setTimeout(() => header.classList.remove('wb-search-flash'), 1300);
  }, 60);
}

/** When a jump changed the active surface, say where we landed and that the
 *  previous surface is still there — a silent canvas+JSON swap reads as "it
 *  replaced my work" even though it's pure navigation (owner report). */
function surfaceSwitchNote(fromViewId: string | null, toast: (m: string) => void): void {
  const nowId = state.activeViewId;
  if (nowId === fromViewId) return;
  const name = (id: string | null): string => (id === null
    ? 'the Grid'
    : `“${state.views.find((v) => v.id === id)?.name ?? 'your view'}”`);
  const back = fromViewId === null
    ? 'the ▦ Grid tab is still there'
    : `${name(fromViewId)} stays open in its tab`;
  toast(`Jumped to ${name(nowId)} — ${back}.`);
}

/** The navigate verbs — everything here is selection/navigation, no mutation. */
function navigate(action: SearchAction, toast: (m: string) => void): void {
  const fromViewId = state.activeViewId;
  switch (action.type) {
    case 'node': {
      goToSurface(action.surface);
      state.select(action.path);
      if (action.prop) window.setTimeout(() => focusFxSlot(action.prop!), 80);
      flashPath(action.path);
      surfaceSwitchNote(fromViewId, toast);
      return;
    }
    // a rule lives inside the column's look, so both hits land the same way:
    // on the grid, with the column's cell selected and flashed
    case 'column':
    case 'rules': {
      const field = state.fields.find((f) => f.name === action.fieldName);
      if (!field) return;
      if (state.activeViewId !== null) state.minimizeView();
      const col = gridColumnForField(field);
      if (col.path.length) {
        state.select(col.path);
        flashGridColumn(col.path[0]);
        surfaceSwitchNote(fromViewId, toast);
      } else {
        toast(`${field.displayName ?? field.name} isn't placed on the grid — add it with “+ column”.`);
      }
      return;
    }
    default:
      // preset / quicklook / reference never navigate — their cards act
      return;
  }
}

// ─── the overlay ─────────────────────────────────────────────────────────────

export function openSearch(onToast?: (m: string) => void): void {
  closeSearch();
  const toast = onToast ?? (() => { /* entry points without a toaster stay quiet */ });

  // Build the index fresh on every open — documents are small and this keeps
  // the results honest against the live workspace, no cache to go stale.
  // The ACTIVE surface's hits pin above other surfaces' (search right after
  // working in a view means THAT view, not the showcase floor content).
  const pinFor = (surface: SearchSurface): number =>
    ((surface.kind === 'view' ? surface.id : null) === state.activeViewId ? 0 : 1);
  const pinned = (list: SearchEntry[], surface: SearchSurface): SearchEntry[] =>
    list.map((e) => ({ ...e, pin: pinFor(surface) }));
  const entries: SearchEntry[] = [
    ...pinned(indexElements(state.floorDoc.root, { kind: 'floor' }, 'Grid'), { kind: 'floor' }),
    ...state.views.flatMap((v) => pinned(indexElements(v.doc.root, { kind: 'view', id: v.id }, v.name), { kind: 'view', id: v.id })),
    // column looks aren't indexed as a document of their own: they render
    // EMBEDDED in the floor's cells, which the floor walk above already covers
    ...indexColumns(state.fields, state.columnLooks),
    ...indexInsertables(
      PALETTE.map((p) => ({ id: p.id, label: p.label, description: p.description, group: p.group })),
      QUICK_LOOKS.map((q) => ({ label: q.label, hint: q.hint, props: q.props })),
    ),
    ...indexReference(),
  ];

  handle = createOverlay('wb-search-overlay', closeSearch);
  const overlay = handle.overlay;

  const panel = document.createElement('div');
  panel.className = 'wb-search-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Search everything');

  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'wb-search-input';
  input.placeholder = 'Search elements, columns, rules, presets, functions…';
  input.setAttribute('aria-label', 'Search everything');

  const body = document.createElement('div');
  body.className = 'wb-search-body';
  const list = document.createElement('div');
  list.className = 'wb-search-list';
  const card = document.createElement('div');
  card.className = 'wb-search-card';
  body.append(list, card);
  panel.append(input, body);
  overlay.appendChild(panel);

  let flat: SearchHit[] = [];
  let activeIdx = -1;

  const highlighted = (hit: SearchHit): DocumentFragment => {
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const [a, b] of hit.ranges) {
      if (a > last) frag.append(hit.entry.label.slice(last, a));
      const mark = document.createElement('mark');
      mark.textContent = hit.entry.label.slice(a, b);
      frag.append(mark);
      last = b;
    }
    frag.append(hit.entry.label.slice(last));
    return frag;
  };

  /** The preview card for insert/reference hits — the explicit-button home. */
  const renderCard = (entry: SearchEntry | null): void => {
    card.innerHTML = '';
    if (!entry) { card.hidden = true; return; }
    card.hidden = false;

    const title = document.createElement('div');
    title.className = 'wb-search-card-title';
    title.textContent = `${entry.icon} ${entry.label}`;
    const kind = document.createElement('div');
    kind.className = 'wb-search-card-kind';
    kind.textContent = entry.trail;
    card.append(title, kind);

    if (entry.detail) {
      const detail = document.createElement('p');
      detail.className = 'wb-search-card-detail';
      detail.textContent = entry.detail;
      card.appendChild(detail);
    }
    if (entry.example) {
      const ex = document.createElement('code');
      ex.className = 'wb-search-card-example';
      ex.textContent = entry.example;
      card.appendChild(ex);
    }

    const actions = document.createElement('div');
    actions.className = 'wb-search-card-actions';

    if (entry.action.type === 'preset') {
      const presetId = entry.action.presetId;
      const insert = document.createElement('button');
      insert.className = 'wb-search-card-btn';
      insert.textContent = 'Insert';
      insert.title = 'Insert this element into what you’re editing — one undoable step (Ctrl+Z takes it back)';
      insert.addEventListener('click', () => {
        const item = PALETTE.find((p) => p.id === presetId);
        if (!item) return;
        recordRecent(input.value);
        state.insertNode(instantiate(item, state.fields)); // ONE undoable mutation
        closeSearch();
        toast(`Inserted ${item.label} — Ctrl+Z takes it back.`);
      });
      actions.appendChild(insert);
    } else if (entry.action.type === 'quicklook') {
      const lookLabel = entry.action.label;
      const apply = document.createElement('button');
      apply.className = 'wb-search-card-btn';
      const target = state.selection ? state.nodeAt(state.selection) : null;
      if (target) {
        apply.textContent = 'Apply to selected element';
        apply.title = 'Layer this style bundle onto the selected element — one undoable step';
        apply.addEventListener('click', () => {
          const look = QUICK_LOOKS.find((q) => q.label === lookLabel);
          const path = state.selection;
          if (!look || !path) return;
          recordRecent(input.value);
          state.mutateDocument(() => { // ONE undoable mutation
            const node = state.nodeAt(path);
            if (node) node.style = { ...node.style, ...look.props };
          });
          closeSearch();
          toast(`${lookLabel} applied — Ctrl+Z takes it back.`);
        });
      } else {
        apply.textContent = 'Select an element first';
        apply.disabled = true;
        apply.title = 'Quick looks layer styles onto an element — pick one on the canvas or tree, then reopen search';
      }
      actions.appendChild(apply);
    } else if (entry.action.type === 'reference' && entry.example) {
      const copy = document.createElement('button');
      copy.className = 'wb-search-card-btn';
      copy.textContent = 'Copy example';
      copy.title = 'Copy the ready-to-paste example to the clipboard';
      const example = entry.example;
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(example);
          toast('Example copied — paste it into the fx bar.');
        } catch {
          toast('Copy failed — clipboard access blocked (select the text and use Ctrl/Cmd+C).');
        }
      });
      actions.appendChild(copy);
    }

    if (actions.childElementCount) card.appendChild(actions);
  };

  const setActive = (idx: number): void => {
    activeIdx = idx;
    list.querySelectorAll('.wb-search-row').forEach((row, i) => {
      row.classList.toggle('active', i === idx);
      if (i === idx) row.scrollIntoView({ block: 'nearest' });
    });
    renderCard(idx >= 0 ? flat[idx].entry : null);
  };

  /** Activate = the click rule: navigation hits act now and close; insertable
   *  and reference hits only surface their card and hand focus to its button. */
  const activate = (hit: SearchHit): void => {
    const { action } = hit.entry;
    if (action.type === 'node' || action.type === 'column' || action.type === 'rules') {
      recordRecent(input.value);
      closeSearch();
      navigate(action, toast);
      return;
    }
    renderCard(hit.entry);
    card.querySelector<HTMLButtonElement>('.wb-search-card-btn')?.focus();
  };

  const renderIdle = (): void => {
    list.innerHTML = '';
    renderCard(null);
    flat = [];
    activeIdx = -1;
    const hint = document.createElement('div');
    hint.className = 'wb-search-hint';
    hint.textContent = 'Search anything in this workspace — a column name, a color like #ff0000, a function like toLocaleDateString, or something to insert.';
    list.appendChild(hint);
    if (recents.length) {
      const head = document.createElement('div');
      head.className = 'wb-search-group';
      head.textContent = 'Recent searches';
      list.appendChild(head);
      for (const q of recents) {
        const row = document.createElement('button');
        row.className = 'wb-search-row wb-search-recent';
        row.textContent = q;
        row.addEventListener('click', () => { input.value = q; render(); input.focus(); });
        list.appendChild(row);
      }
    }
  };

  const render = (): void => {
    const q = input.value;
    if (!q.trim()) { renderIdle(); return; }

    const grouped = runSearch(entries, q);
    list.innerHTML = '';
    flat = [];

    if (!grouped.length) {
      renderCard(null);
      activeIdx = -1;
      const none = document.createElement('div');
      none.className = 'wb-search-none';
      none.textContent = teachingNote(q) ?? `Nothing here matches “${q.trim()}”.`;
      list.appendChild(none);
      return;
    }

    for (const group of grouped) {
      const head = document.createElement('div');
      head.className = 'wb-search-group';
      head.textContent = `${group.label} — ${group.hits.length}`;
      list.appendChild(head);
      for (const hit of group.hits) {
        const idx = flat.length;
        flat.push(hit);
        const row = document.createElement('button');
        row.className = 'wb-search-row';
        row.dataset.group = hit.entry.group;
        const icon = document.createElement('span');
        icon.className = 'wb-search-icon';
        icon.textContent = hit.entry.icon;
        const label = document.createElement('span');
        label.className = 'wb-search-label';
        label.appendChild(highlighted(hit));
        const trail = document.createElement('span');
        trail.className = 'wb-search-trail';
        trail.textContent = hit.entry.trail;
        row.append(icon, label, trail);
        row.addEventListener('click', () => { setActive(idx); activate(hit); });
        list.appendChild(row);
      }
    }
    setActive(0);
  };

  input.addEventListener('input', render);

  // Keyboard: arrows walk the flattened list, Enter = click. Everything except
  // Escape stops here so the app's global shortcuts (Delete removes the
  // selected node!) can never fire from inside the overlay — click-safety.
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') return; // let createOverlay's document handler close
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      // main.ts's Ctrl+F handler never sees events fenced in here, so keep the
      // browser's native find suppressed ourselves; re-press = fresh query
      e.preventDefault();
      input.focus();
      input.select();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (flat.length) {
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        setActive((activeIdx + delta + flat.length) % flat.length);
        input.focus();
      }
    } else if (e.key === 'Enter' && document.activeElement === input) {
      e.preventDefault();
      if (activeIdx >= 0 && flat[activeIdx]) activate(flat[activeIdx]);
    }
    e.stopPropagation();
  });

  renderIdle();
  document.body.appendChild(overlay);
  input.focus();
}
