// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Sam Yost

/**
 * editor/leftPane.ts — the Claude-style Left Edit Pane container, rebuilt to
 * COLUMNS-COMPONENTS-VIEWS §3 (Mockup B, approved). Top to bottom:
 *
 *   1. the NAV ROW — minimize (the shell prepends it), the Properties/Code
 *      lens tabs, then the actions cluster: ← Back (retrace navigation —
 *      moved OUT of the ⋮ menu and up here, issue #145/#152), 📷 take a
 *      snapshot (same move; the snapshot LIST stays under ⋮), and the ⋮ menu
 *      (tools + snapshots). Navigation between surfaces lives in the CANVAS
 *      TAB STRIP; the old formatter tablist and the document pill died with
 *      the drill-in model.
 *   2. the THIS VIEW card (viewCard.ts) — the active view's name/kind and its
 *      view-scoped behaviors & properties; a def card while a component
 *      workshop tab is up; hidden on the grid.
 *   3. the STRUCTURE TREE — always mounted, rendering the active SURFACE
 *      (state.doc) — or, while a component workshop tab is up, the STAGED
 *      component tree via state.workshopCtx (spec §C, 2026-07-09: the owner
 *      superseded the v1 never-re-targets constraint) — under its own frozen
 *      "Structure" section header (2026-07-09), which also carries the ⋮
 *      settings kebab (view settings / component options — moved off the
 *      view card 2026-07-10). Drag splitter below (kept).
 *   4. the COLUMNS SHELF (columnShelf.ts) — "Columns — your data": typed
 *      chips, drag (FIELD_MIME) or click-to-insert. Data only.
 *   5. the COMPONENTS library — always visible (the old tab-swap mode died),
 *      then the VIEWS list (viewMenu.ts) — composition last, the owner's
 *      left-to-right mental model. All three are collapsible sections whose
 *      headers stay frozen (sticky) while the shelves region scrolls.
 *   6. splitter 2 (shelves/props boundary — drag to grow the properties
 *      editor, double-click resets), and the lower workspace swapping between
 *      the Properties inspector and the Code declarations (the two lenses).
 *
 * The vertical COLLAPSE RAILS (owner ask 2026-07-24, corrected same day from
 * a horizontal first cut, then re-corrected the same day again): the tree and
 * the inspector each carry a rail down their left edge, and the three shelves
 * (Columns/Components/Views) SHARE ONE rail spanning the whole shelves region
 * — sections plus the slack space down to the props splitter — mirroring how
 * they already share the resize handle above Columns. A rail wears the
 * splitter-bar look — and subsumes the #280 shelves rail — but is a pure
 * click target: a section rail folds/unfolds its section exactly like its
 * header; the shared shelves rail folds/unfolds the trio as a group (any
 * open → fold all; all folded → open all), while each header keeps its
 * per-section toggle.
 */

import { state, type EditorLens } from './state';
import { mountTree } from './treeView';
import { mountInspector } from './inspector';
import { mountCodeEditor } from './codeEditor';
import { mountViewsList } from './viewMenu';
import { openKebabMenu, takeWorkspaceSnapshot } from './snapMenu';
import { openViewKebab, openComponentKebab } from './viewKebab';
import { mountComponentLibrary } from './componentLibrary';
import { mountColumnShelf } from './columnShelf';
import { mountViewCard } from './viewCard';
import {
  isSectionCollapsed, setSectionCollapsed, type PaneSectionId,
} from './paneSections';

export interface LeftPaneOptions {
  toast: (msg: string) => void;
  /** Preference read for the Structure tree's follow-selection scroll
   *  (☰ → Preferences; main.ts backs it with the wb-ui-prefs blob). */
  treeFollowSelection?: () => boolean;
}

const COLLAPSIBLE_SECTIONS: { id: PaneSectionId; label: string }[] = [
  { id: 'tree', label: 'Structure tree' },
  { id: 'columns', label: 'Columns shelf' },
  { id: 'components', label: 'Components library' },
  { id: 'views', label: 'Views list' },
  { id: 'inspector', label: 'Properties editor' },
];

function sectionHead(id: PaneSectionId, title: string, controls: string): string {
  return `
    <button type="button" class="wb-lp-sec-head" data-sec-head="${id}" aria-controls="${controls}" aria-expanded="true">
      <span class="wb-lp-sec-caret" aria-hidden="true">▸</span>
      <span class="wb-lp-sec-title">${title}</span>
    </button>
  `;
}

/** The click-to-fold rail down a section's left edge: splitter-bar look
 *  (vertical), header-click behavior. aria-hidden — the header button IS the
 *  accessible control; this is a redundant pointer affordance. Only the tree
 *  and the inspector carry one of their own — the three shelves share the
 *  region-level rail written inline below (data-sec-bar="shelves"), which is
 *  a REAL button: its fold-the-trio action has no other single control. */
function collapseBar(id: PaneSectionId): string {
  return `<div class="wb-lp-collapsebar" data-sec-bar="${id}" aria-hidden="true"></div>`;
}

// 'pro' is the Properties lens — the stored id predates the Simple/Pro merge
// (2026-07-24) and is frozen in the wb-ui-prefs blob (see state.ts).
const LENSES: { id: EditorLens; label: string }[] = [
  { id: 'pro', label: 'Properties' },
  { id: 'code', label: 'Code' },
];

export function mountLeftPane(host: HTMLElement, opts: LeftPaneOptions): void {
  const hostAny = host as any;
  if (typeof hostAny._unsub === 'function') {
    hostAny._unsub();
  }
  host.querySelectorAll('*').forEach((el: any) => {
    if (typeof el._unsub === 'function') {
      el._unsub();
    }
  });

  const { toast } = opts;
  host.classList.add('wb-leftpane');
  host.innerHTML = `
    <div class="wb-lp-nav">
      <div class="wb-lens-tabs" role="tablist" aria-label="Edit lens">
        ${LENSES.map((l) => `<button class="wb-lens-tab" role="tab" data-lens="${l.id}">${l.label}</button>`).join('')}
      </div>
      <div class="wb-lp-nav-actions">
        <button class="wb-snap-btn" id="wb-nav-back" aria-label="Back" disabled>${ICONS.back}</button>
        <button class="wb-snap-btn" id="wb-nav-snap" aria-label="Take a snapshot" title="Take a snapshot of the whole workspace — restore it any time from the ⋮ menu">${ICONS.camera}</button>
        <button class="wb-kebab-btn" id="wb-kebab-btn" aria-haspopup="menu" aria-label="Menu" title="Menu — tools and snapshots">${ICONS.kebab}</button>
      </div>
    </div>
    <div id="wb-lp-viewcard"></div>
    <div class="wb-lp-tree wb-lp-sec" data-sec="tree" id="wb-lp-tree">
      ${collapseBar('tree')}
      <div class="wb-lp-sec-headrow">
        ${sectionHead('tree', 'Structure', 'wb-tree-body')}
        <button class="wb-structure-kebab" id="wb-structure-kebab" aria-haspopup="dialog" hidden>${ICONS.kebab}</button>
      </div>
      <div class="wb-tree-sec-body wb-lp-sec-body" id="wb-tree-body"></div>
    </div>
    <div class="wb-lp-splitter" id="wb-lp-splitter" title="Drag to resize the structure tree"></div>
    <div class="wb-lp-shelves" id="wb-lp-shelves">
      <button type="button" class="wb-lp-collapsebar" data-sec-bar="shelves"
        aria-controls="wb-lp-shelf wb-lp-library wb-lp-views" aria-expanded="true"></button>
      <div class="wb-lp-shelves-scroll" id="wb-lp-shelves-scroll">
        <section class="wb-lp-sec" data-sec="columns">
          ${sectionHead('columns', 'Columns', 'wb-lp-shelf')}
          <div id="wb-lp-shelf" class="wb-lp-sec-body"></div>
        </section>
        <section class="wb-lp-sec" data-sec="components">
          ${sectionHead('components', 'Components', 'wb-lp-library')}
          <div class="wb-complib wb-lp-sec-body" id="wb-lp-library"></div>
        </section>
        <section class="wb-lp-sec" data-sec="views">
          ${sectionHead('views', 'Views', 'wb-lp-views')}
          <div class="wb-lp-sec-body" id="wb-lp-views"></div>
        </section>
      </div>
    </div>
    <div class="wb-lp-splitter" id="wb-lp-splitter2" title="Drag to give the properties editor more or less height — double-click resets"></div>
    <div class="wb-lp-props" id="wb-lp-props">
      <section class="wb-lp-sec wb-lp-sec-inspector" data-sec="inspector">
        ${collapseBar('inspector')}
        ${sectionHead('inspector', 'Properties', 'wb-lp-inspector')}
        <div class="wb-lp-inspector wb-lp-sec-body" id="wb-lp-inspector"></div>
      </section>
      <div class="wb-lp-code" id="wb-lp-code"></div>
    </div>
  `;

  // ── mount the sections ─────────────────────────────────────────────────────
  mountViewCard(host.querySelector<HTMLElement>('#wb-lp-viewcard')!, toast);
  mountTree(host.querySelector<HTMLElement>('#wb-tree-body')!, toast,
    { ...(opts.treeFollowSelection ? { followSelection: opts.treeFollowSelection } : {}) });
  mountColumnShelf(host.querySelector<HTMLElement>('#wb-lp-shelf')!, toast);
  mountComponentLibrary(host.querySelector<HTMLElement>('#wb-lp-library')!, toast);
  mountViewsList(host.querySelector<HTMLElement>('#wb-lp-views')!, toast);
  mountInspector(host.querySelector<HTMLElement>('#wb-lp-inspector')!, { toast });
  mountCodeEditor(host.querySelector<HTMLElement>('#wb-lp-code')!);

  // ── the structure-tree region + the splitter-2 displacement baseline: when
  //    the props drag squeezes the tree (#292), treePreDisplace remembers the
  //    tree's OWN inline height from before the squeeze, so the reset paths
  //    (splitter-2 double-click, folding the inspector) can hand it back —
  //    the two pinned sizes are coupled, never reset one-sidedly ─────────────
  const treeRegion = host.querySelector<HTMLElement>('#wb-lp-tree')!;
  let treePreDisplace: string | null = null;
  const restoreDisplacedTree = (): void => {
    if (treePreDisplace === null) return;
    treeRegion.style.height = treePreDisplace;
    treePreDisplace = null;
  };

  // ── collapsible sections (issue #236 + the 2026-07-09 additions): the tree,
  //    Columns, Components, Views and the Inspector all fold from their header.
  //    Folding a REGION with a dragged inline size also clears that size, so a
  //    stale drag never holds the fold open (tree height / props height).
  //    The three shelves share ONE collapse rail (declared up here so the
  //    header toggles below can keep its tooltip honest) — wired after the
  //    loop, once the per-section appliers exist.
  const SHELF_SECTIONS: PaneSectionId[] = ['columns', 'components', 'views'];
  const shelvesBar = host.querySelector<HTMLElement>('.wb-lp-collapsebar[data-sec-bar="shelves"]')!;
  // the group state reads the RENDERED classes, never the persisted flags —
  // paneSections deliberately swallows blocked-storage write failures, so
  // after a fold the store can still say "open"; deriving from the DOM keeps
  // the rail's toggle and tooltip honest exactly like the header toggles
  const anyShelfOpen = (): boolean => SHELF_SECTIONS.some((sid) =>
    !host.querySelector(`.wb-lp-sec[data-sec="${sid}"]`)?.classList.contains('wb-collapsed'));
  const refreshShelvesBar = (): void => {
    const open = anyShelfOpen();
    shelvesBar.title = open
      ? 'Hide Columns, Components & Views'
      : 'Show Columns, Components & Views';
    // the group action has no other single control, so the rail is a REAL
    // button (Copilot a11y catch on #306): keep its name and state honest
    shelvesBar.setAttribute('aria-label', shelvesBar.title);
    shelvesBar.setAttribute('aria-expanded', String(open));
  };
  // when the trio folds away entirely, the shelves region shrinks to its
  // three header bars (style.css :has rule) — hand the freed height to
  // Properties: clear the splitter-2 pin so the props region flex-fills up
  // to the shrunken shelves (owner follow-up on #305), and — as with the
  // inspector fold — give a #292-squeezed tree its pre-drag height back.
  // Runs on BOTH crossings of the all-folded boundary (review catch): a
  // splitter-2 drag made WHILE folded pins props to the folded geometry, so
  // reopening (rail or a single header) must also reset the coupled sizes
  // or the reopened shelves come back squeezed instead of the default split.
  const reclaimShelvesSpace = (): void => {
    const props = host.querySelector<HTMLElement>('#wb-lp-props');
    if (props) { props.style.height = ''; props.style.flex = ''; }
    restoreDisplacedTree();
  };
  const applySection = new Map<PaneSectionId, (collapsed: boolean) => void>();
  for (const { id, label } of COLLAPSIBLE_SECTIONS) {
    const sec = host.querySelector<HTMLElement>(`.wb-lp-sec[data-sec="${id}"]`);
    const head = host.querySelector<HTMLButtonElement>(`.wb-lp-sec-head[data-sec-head="${id}"]`);
    if (!sec || !head) continue;
    const bar = host.querySelector<HTMLElement>(`.wb-lp-collapsebar[data-sec-bar="${id}"]`);
    const apply = (collapsed: boolean): void => {
      sec.classList.toggle('wb-collapsed', collapsed);
      head.setAttribute('aria-expanded', String(!collapsed));
      head.title = collapsed ? `Show ${label}` : `Hide ${label}`;
      if (bar) bar.title = head.title;
      // folding the tree clears its inline size AND forgets the displacement
      // baseline — the fold owns the height now, nothing left to hand back
      if (collapsed && id === 'tree') { sec.style.height = ''; treePreDisplace = null; }
      if (collapsed && id === 'inspector') {
        const props = host.querySelector<HTMLElement>('#wb-lp-props');
        if (props) { props.style.height = ''; props.style.flex = ''; }
        // the props pin and the tree squeeze travel together (#292): letting
        // the fold clear one but not the other would strand a shrunken tree
        restoreDisplacedTree();
      }
    };
    applySection.set(id, apply);
    apply(isSectionCollapsed(id));
    const toggle = (): void => {
      // whether this toggle CROSSES the all-folded boundary is only knowable
      // by comparing before and after — capture the before side here
      const wasAllFolded = SHELF_SECTIONS.includes(id) && !anyShelfOpen();
      const next = !sec.classList.contains('wb-collapsed');
      apply(next);
      setSectionCollapsed(id, next);
      // a per-header fold changes what the SHARED rail would do next —
      // keep its tooltip in step; and a header crossing the all-folded
      // boundary (folding the last open shelf, or reopening the first)
      // reaches the same states as the rail, so it reclaims too
      if (SHELF_SECTIONS.includes(id)) {
        refreshShelvesBar();
        if ((next && !anyShelfOpen()) || (!next && wasAllFolded)) reclaimShelvesSpace();
      }
    };
    head.addEventListener('click', toggle);
    // a section's own collapse rail folds it the same way (tree, inspector)
    bar?.addEventListener('click', toggle);
  }

  // ── the SHARED shelves rail: Columns, Components and Views fold as a group
  //    (owner ask 2026-07-24: one rail for the region they're members of —
  //    slack space included — like the one resize handle they already share).
  //    Any open → fold all three; all folded → open all three. The persisted
  //    per-section flags are the same ones the headers write.
  shelvesBar.addEventListener('click', () => {
    const collapse = anyShelfOpen();
    for (const sid of SHELF_SECTIONS) {
      applySection.get(sid)?.(collapse);
      setSectionCollapsed(sid, collapse);
    }
    // both directions cross the all-folded boundary: collapsing hands the
    // freed height to Properties; reopening discards any folded-era pin so
    // the default flex split returns rather than squeezed shelves
    reclaimShelvesSpace();
    refreshShelvesBar();
  });
  refreshShelvesBar();

  // ── kebab menu: unified tools + snapshots (← Back moved back OUT to the
  //    nav row, issue #145 — it was under this ⋮ 2026-07-10→2026-07-24) ──────
  const kebabBtn = host.querySelector<HTMLButtonElement>('#wb-kebab-btn')!;
  kebabBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openKebabMenu(kebabBtn, toast);
  });

  // ── ← Back: retrace the nav trail (surface switches AND lens switches,
  //    #145). Navigation, never undo — the tooltip names the destination. ────
  const navBack = host.querySelector<HTMLButtonElement>('#wb-nav-back')!;
  navBack.addEventListener('click', () => {
    const label = state.backLabel;
    if (state.goBack() !== null) toast(`Back to ${label}`);
  });
  const refreshBack = (): void => {
    const label = state.backLabel;
    navBack.disabled = label === null;
    navBack.title = label === null
      ? 'Back — retrace where you were (nothing to go back to yet)'
      : `Back to ${label}`;
  };

  // ── 📷 one-click whole-workspace snapshot (#145: the take action rides the
  //    nav row; the restore list stays under ⋮) ──────────────────────────────
  host.querySelector<HTMLButtonElement>('#wb-nav-snap')!
    .addEventListener('click', () => takeWorkspaceSnapshot(toast));

  // ── the structure-header kebab: view settings on a view tab, component
  //    options on a workshop tab, hidden on the grid floor (no settings) ─────
  const structKebab = host.querySelector<HTMLButtonElement>('#wb-structure-kebab')!;
  structKebab.addEventListener('click', (e) => {
    e.stopPropagation(); // never fold the section
    if (state.activeComponentTab !== null) openComponentKebab(structKebab, state.activeComponentTab, toast);
    else openViewKebab(structKebab, toast);
  });
  const refreshStructKebab = (): void => {
    const componentMode = state.activeComponentTab !== null;
    structKebab.hidden = !componentMode && state.onFloor;
    structKebab.title = componentMode
      ? 'Component options — add it to a view, see where it’s used'
      : 'View settings — density, row class, templates, and what SharePoint shows around this view';
    // aria-label overrides title for screen readers — keep the accessible
    // name in step with whichever panel the click actually opens
    structKebab.setAttribute('aria-label', componentMode ? 'Component options' : 'View settings');
  };

  // ── lens tabs ──────────────────────────────────────────────────────────────
  for (const btn of host.querySelectorAll<HTMLButtonElement>('.wb-lens-tab')) {
    btn.addEventListener('click', () => state.setLens(btn.dataset.lens as EditorLens));
  }
  const applyLens = (): void => {
    const lens = state.activeLens;
    host.classList.toggle('wb-lens-pro', lens === 'pro');
    host.classList.toggle('wb-lens-code', lens === 'code');
    for (const btn of host.querySelectorAll<HTMLButtonElement>('.wb-lens-tab')) {
      btn.classList.toggle('active', btn.dataset.lens === lens);
      btn.setAttribute('aria-selected', String(btn.dataset.lens === lens));
    }
  };

  // ── splitter: resize the tree region height ────────────────────────────────
  const splitter = host.querySelector<HTMLElement>('#wb-lp-splitter')!;
  splitter.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    splitter.setPointerCapture(e.pointerId);
    // an intentional tree resize sets a NEW baseline — a later splitter-2
    // reset must not roll the tree back behind this gesture
    treePreDisplace = null;
    const startY = e.clientY;
    const startH = treeRegion.getBoundingClientRect().height;
    const move = (ev: PointerEvent) => {
      const next = Math.max(80, Math.min(host.clientHeight - 220, startH + (ev.clientY - startY)));
      treeRegion.style.height = `${next}px`;
    };
    const up = () => {
      splitter.removeEventListener('pointermove', move);
      splitter.removeEventListener('pointerup', up);
    };
    splitter.addEventListener('pointermove', move);
    splitter.addEventListener('pointerup', up);
  });

  // ── splitter 2: the shelves/props boundary — the answer to "why can't the
  //    properties section take more space" (2026-07-09). Dragging pins the
  //    props region to a height (shelves absorb the rest); double-click
  //    resets to the default flex split. Once the shelves hit their floor the
  //    STRUCTURE TREE above gives way too — dragging up displaces whatever
  //    sits above, usually the tree (issue #292, round 2) — and regrows up to
  //    where it started while the same drag moves back down. ─────────────────
  const SHELVES_MIN = 72; // .wb-lp-shelves min-height (style.css)
  const TREE_MIN = 80;    // the tree splitter's own floor
  const shelvesRegion = host.querySelector<HTMLElement>('#wb-lp-shelves')!;
  const propsRegion = host.querySelector<HTMLElement>('#wb-lp-props')!;
  const splitter2 = host.querySelector<HTMLElement>('#wb-lp-splitter2')!;
  splitter2.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    splitter2.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startH = propsRegion.getBoundingClientRect().height;
    const startTreeH = treeRegion.getBoundingClientRect().height;
    const startShelvesH = shelvesRegion.getBoundingClientRect().height;
    // with the trio folded the shelves sit at their header-bars height
    // (flex 0 0 auto — the :has shrink rule) and can't give anything more:
    // their floor for THIS drag is whatever they measure right now
    const shelvesOpen = anyShelfOpen();
    const shelvesFloor = shelvesOpen ? SHELVES_MIN : startShelvesH;
    // a folded tree is just its bar + header — never resize it from here
    const treeOpen = !treeRegion.classList.contains('wb-collapsed');
    // remember the tree's pre-squeeze inline height ONCE per displacement
    // sequence ('' = the CSS default) — the reset paths restore it
    if (treeOpen && treePreDisplace === null) treePreDisplace = treeRegion.style.height;
    // the fixed rows (nav, view card, splitters, collapse bars): whatever the
    // three resizable regions don't account for right now
    const chrome = host.clientHeight - startTreeH - startShelvesH - startH;
    const move = (ev: PointerEvent) => {
      // dragging UP grows the props region; on a squeezed pane the ceiling
      // can dip below the 110px floor — the ceiling wins so the region never
      // overflows the space that actually exists (PR #267). The ceiling now
      // assumes the tree can be squeezed to its floor (#292).
      const treeFloor = treeOpen ? Math.min(TREE_MIN, startTreeH) : startTreeH;
      const ceiling = Math.max(56, host.clientHeight - chrome - shelvesFloor - treeFloor);
      // with the trio folded, dragging DOWN has no absorber — the shelves are
      // pinned at header-bars height and the tree never grows past its start —
      // so props would strand blank space below; its floor for that drag is
      // where it started (dragging UP still works: the tree gives way)
      const dragFloor = shelvesOpen ? Math.min(110, ceiling) : Math.min(startH, ceiling);
      const next = Math.min(ceiling, Math.max(dragFloor, startH + (startY - ev.clientY)));
      propsRegion.style.height = `${next}px`;
      propsRegion.style.flex = '0 0 auto';
      if (treeOpen) {
        // room left for the tree once the shelves are pinned at their floor:
        // shrink it when the drag needs the space, restore it (up to its
        // starting height) when the drag gives the space back
        const room = host.clientHeight - chrome - shelvesFloor - next;
        treeRegion.style.height = `${Math.max(treeFloor, Math.min(startTreeH, room))}px`;
      }
    };
    const up = () => {
      splitter2.removeEventListener('pointermove', move);
      splitter2.removeEventListener('pointerup', up);
    };
    splitter2.addEventListener('pointermove', move);
    splitter2.addEventListener('pointerup', up);
  });
  splitter2.addEventListener('dblclick', () => {
    propsRegion.style.height = '';
    propsRegion.style.flex = '';
    // reset means BOTH coupled sizes: the props pin and the tree squeeze the
    // same drags caused — otherwise "reset" strands Structure at its floor
    restoreDisplacedTree();
  });

  // ── subscriptions ──────────────────────────────────────────────────────────
  const unsub = state.subscribe((reason) => {
    if (reason === 'lens') applyLens();
    if (reason === 'load' || reason === 'data' || reason === 'kind') refreshStructKebab();
    // the trail moves on surface switches (load/data) AND lens switches
    if (reason === 'lens' || reason === 'load' || reason === 'data' || reason === 'kind') refreshBack();
  });
  hostAny._unsub = () => {
    unsub();
    host.querySelectorAll('*').forEach((el: any) => {
      if (typeof el._unsub === 'function') {
        el._unsub();
      }
    });
  };
  applyLens();
  refreshStructKebab();
  refreshBack();
}

// Inline SVG glyphs for the toolbar — crisp at any size, theme via currentColor.
const ICONS = {
  kebab: '<svg viewBox="0 0 16 16" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M8 3a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm0 6.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm0 6.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/></svg>',
  back: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.3" d="M13 8H3.5m0 0L7 4.5M3.5 8L7 11.5"/></svg>',
  camera: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.2" d="M2.5 5.5h2l1-1.5h5l1 1.5h2v7h-11z"/><circle cx="8" cy="8.7" r="2.2" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
};
