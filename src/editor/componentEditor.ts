// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * editor/componentEditor.ts — the component WORKSHOP: edit a component
 * DEFINITION itself — its name/description, what each slot ASKS for
 * (labels/tooltips; slot KEYS are immutable, they're the tree's field refs),
 * and its elements visually: click the live preview (or the Structure tree,
 * which renders the STAGED tree while this tab is up) to select, then style
 * in the real Properties pane — both ride the WorkshopContext seam this
 * mount registers on state (spec §C, 2026-07-09; the embedded style panel
 * and mini structure list died with it).
 * Everything stages into a deep copy; nothing commits until a Save button.
 *
 * COLUMNS-COMPONENTS-VIEWS §2 (Phase B): the workshop is a CANVAS TAB, not a
 * modal. `mountComponentWorkshop` renders the editor into a host the canvas
 * tab strip owns (canvasTabs.ts swaps it over #wb-canvas while a component
 * tab is active); the old `openComponentEditor` entry stays as a thin wrapper
 * that opens the def's tab, so the library's ✎/Edit… buttons keep working
 * unchanged. Staged state survives tab switches — the strip keeps each def's
 * staging alive and resumes it on re-mount.
 *
 * Saving (the tab stays open; the strip re-stages on the saved def):
 *   · "Save as new component" — a fresh def (new id); never touches usages.
 *     The ONLY option for built-ins (they can't be overwritten). The tab
 *     swaps onto the copy (onSaved carries the new id).
 *   · "Save and apply to N places" — replaces the def (keeps its id) and
 *     re-bakes every current usage to the new recipe, EXCEPT usages pinned
 *     "keep as-found": those get a one-off variant def frozen from the OLD
 *     recipe (variantOf lineage) and are restamped onto it. The whole apply —
 *     view subtree replacements, column-look re-bakes (store + floor cell),
 *     variant restamps — rides state.batchProjectUpdate, so ONE Ctrl+Z
 *     reverts everything.
 */

import { state, CARD_SEGMENT, type WorkshopContext } from './state';
import { renderElement } from '../core/renderer';
import { ctxForRow } from './previewCtx';
import { gridColumnField, gridCellForField } from './gridScaffold';
import type { SPElement, SPExpr, NodePath } from '../core/types';
import {
  COMPONENTS_KEY, BUILTIN_COMPONENTS, loadComponents, serializeComponents, addComponent,
  bestGuessMapping, bindComponent, componentId, componentKind,
  createVariant, rebindInstance, replaceStampedIn, restampIn, uniqueName,
  flattenComponent, embedRefusal, embedClosure, withEmbed, withoutEmbed,
  transitiveEmbedders, MAX_COMPONENT_DEPTH,
  type ComponentDef, type ComponentEmbed,
} from './components';
import { paletteComponents } from './paletteComponents';
import { scanComponentUsages, mainUsageLabel, type ComponentUsage } from './componentUsage';
import { createModalUndo, wireModalUndoKeys, modalUndoButtons } from './modalUndo';

// Store access mirrors componentLibrary's readCustom/writeCustom — duplicated
// (6 lines) rather than imported so componentLibrary → componentEditor stays
// a one-way edge (the library mounts the Edit… buttons).
function readCustom(): ComponentDef[] {
  try {
    return loadComponents(localStorage.getItem(COMPONENTS_KEY));
  } catch {
    return [];
  }
}
function writeCustom(components: ComponentDef[]): boolean {
  try {
    localStorage.setItem(COMPONENTS_KEY, serializeComponents(components));
    return true;
  } catch {
    return false;
  }
}

function fieldLabel(name: string): string {
  return state.fields.find((f) => f.name === name)?.displayName ?? name;
}

/** Everything a nested def can resolve against: built-ins, the palette
 *  derivations, and the maker's stored customs (raw — resolution wants the
 *  stored shapes, flattenComponent does the expanding itself). */
function libraryDefs(): ComponentDef[] {
  return [...BUILTIN_COMPONENTS, ...paletteComponents(), ...readCustom()];
}

// SPExpr classification (exported as the pure seam the unit tests pin; the
// embedded style panel that used it died 2026-07-09 — the real inspector
// styles staged elements through state.workshopCtx now). A FORMULA is an
// '='-prefixed string or the AST object form ({operator, operands}); plain
// strings, NUMBERS and BOOLEANS are static literals (e.g. `opacity: 0.6`,
// `font-weight: 600`) — the same split the engine and the inspector make.

/** A style prop's committed literal value, stringified ('' = unset/formula). */
export function stylePlainValue(style: Record<string, SPExpr | undefined> | undefined, prop: string): string {
  const v = style?.[prop];
  if (v === undefined || v === null) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return typeof v === 'string' && !v.startsWith('=') ? v : '';
}

/** Whether a style prop is formula-driven ('=' string or the AST object form). */
export function styleIsFormula(style: Record<string, SPExpr | undefined> | undefined, prop: string): boolean {
  const v = style?.[prop];
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.startsWith('=');
  return typeof v === 'object'; // the legacy {operator, operands} form
}

/** A workshop's live staging — what the tab strip keeps alive across tab
 *  switches so flipping away and back never loses un-saved edits. */
export interface WorkshopStaging {
  staged: ComponentDef;
  dirty: boolean;
}

/** What mountComponentWorkshop hands back to the tab strip. */
export interface WorkshopHandle {
  /** Deep snapshot of the current staging (for keep-alive on unmount). */
  staging(): WorkshopStaging;
  /** Detach document-level listeners (the modal-undo keys). Call on unmount. */
  destroy(): void;
}

export interface WorkshopOpts {
  onToast: (m: string) => void;
  /** A save landed. `newDefId` is the id the tab should now show — the same
   *  id for save/save-and-apply, a FRESH id when a builtin (or save-as-new)
   *  produced a copy. The strip re-stages the tab on the saved def. */
  onSaved: (newDefId: string) => void;
  /** Staged-edits dirt flipped — drives the tab's dirty dot. */
  onDirtyChange: (dirty: boolean) => void;
  /** Resume a previous mount's staging (tab switch keep-alive). */
  resume?: WorkshopStaging;
}

/** The library list's refresh hook — remembered from the last ✎/Edit… click
 *  so a workshop save redraws the open library pane (the old modal called it
 *  onSaved; the tab decouples open-time from save-time). */
let libraryRefresh: (() => void) | null = null;

/**
 * The old modal entry, now a thin wrapper (§2: "the modal dies") — opening a
 * component for editing opens (or focuses) its CANVAS TAB. Kept
 * signature-compatible with the library's call sites. Custom defs are
 * id-addressed; every def reaching here (built-in / palette / custom) is
 * resolvable via componentById, so the tab carries only the id.
 */
export function openComponentEditor(
  def: ComponentDef,
  onToast: (m: string) => void,
  onSaved?: () => void,
): void {
  void onToast; // the workshop tab owns its own toasts
  if (onSaved) libraryRefresh = onSaved;
  state.openComponentTab(def.id);
}

/**
 * Mount the workshop for `def` into `host` (a canvas-region div the tab strip
 * owns). Re-housed from the modal — same staged tree, modal-local undo, slot
 * editing, live preview, style panel and Save machinery; only the overlay
 * chrome (Esc/backdrop/close) is gone, because the TAB is the chrome now.
 */
export function mountComponentWorkshop(
  host: HTMLElement,
  def: ComponentDef,
  opts: WorkshopOpts,
): WorkshopHandle {
  const { onToast } = opts;
  // ── staged copy: every edit lands here; Save commits ──
  const staged: ComponentDef = JSON.parse(
    JSON.stringify(opts.resume ? opts.resume.staged : def),
  ) as ComponentDef;
  let dirty = opts.resume?.dirty ?? false;
  const setDirty = (v: boolean): void => {
    if (dirty === v) return;
    dirty = v;
    opts.onDirtyChange(dirty);
  };
  let sel: NodePath = [];

  // modal-local undo (§2.3, Stage 4): the ELEMENT edits — the destructive
  // gestures — bottom out at the moment the workshop (re)mounted. Name/
  // description/slot text fields stay on native input undo (the builder
  // rule), so the bag is the staged TREE plus its embed records (#225 — an
  // embed insert/remove touches both together, so one ↶ reverts both). Save
  // still commits ONE app-level step. (muRestore is a function declaration
  // on purpose: it runs only after the render fns below are assigned, but
  // the head's buttons wire up first.)
  const muBag = (): { root: SPElement; embeds: ComponentEmbed[] } =>
    ({ root: staged.root, embeds: staged.embeds ?? [] });
  const mu = createModalUndo(muBag());
  function muRestore(bag: { root: SPElement; embeds: ComponentEmbed[] } | null): void {
    if (!bag) return;
    staged.root = bag.root;
    if (bag.embeds.length) staged.embeds = bag.embeds;
    else delete staged.embeds;
    if (!nodeAtStaged(sel)) sel = [];
    renderPreview();
    renderEmbeds();
    muButtons.refresh();
    state.emit('workshop'); // the tree + inspector ride the staged seam now
  }
  const muButtons = modalUndoButtons(mu, () => muRestore(mu.undo()), () => muRestore(mu.redo()));
  const detachMuKeys = wireModalUndoKeys(() => muRestore(mu.undo()), () => muRestore(mu.redo()));

  // usages, scanned once at mount (the active surface doc + the column
  // looks); built-ins can be in use too, but they only ever save-as-new
  const usages: ComponentUsage[] = def.builtin
    ? []
    : scanComponentUsages([def], state.doc.root, state.columnLooks).get(def.id) ?? [];
  const pinned = new Set<number>();

  const panel = document.createElement('div');
  panel.className = 'wb-ce wb-ce-workshop';
  host.replaceChildren(panel);

  // ── staged-tree addressing (local mirror of state's path convention) ──
  const nodeAtStaged = (path: NodePath): SPElement | null => {
    let node: SPElement | undefined = staged.root;
    for (const i of path) {
      node = i === CARD_SEGMENT ? node?.customCardProps?.formatter : node?.children?.[i];
      if (!node) return null;
    }
    return node ?? null;
  };

  // ── head ──
  const head = document.createElement('div');
  head.className = 'wb-ce-head';
  const title = document.createElement('span');
  title.className = 'wb-ce-title';
  title.textContent = `Edit component — ${def.name}`;
  const sub = document.createElement('span');
  sub.className = 'wb-ce-sub';
  sub.textContent = def.builtin
    ? 'built-ins can\'t be overwritten — saving creates your own copy'
    : 'nothing changes until you save — close the tab (✕) to discard';
  head.append(title, sub, muButtons.root);
  panel.appendChild(head);

  const body = document.createElement('div');
  body.className = 'wb-ce-body';
  panel.appendChild(body);
  const left = document.createElement('div');
  left.className = 'wb-ce-col';
  const right = document.createElement('div');
  right.className = 'wb-ce-col';
  body.append(left, right);

  const section = (sectionHost: HTMLElement, label: string): HTMLElement => {
    const h = document.createElement('div');
    h.className = 'wb-ce-seclab';
    h.textContent = label;
    sectionHost.appendChild(h);
    const s = document.createElement('div');
    s.className = 'wb-ce-sec';
    sectionHost.appendChild(s);
    return s;
  };

  // ── identity: name + description ──
  const ident = section(left, 'Component');
  const textRow = (label: string, value: string, commit: (v: string) => void, cls: string): void => {
    const row = document.createElement('label');
    row.className = 'wb-ce-row';
    const lab = document.createElement('span');
    lab.className = 'wb-ce-rowlab';
    lab.textContent = label;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = `wb-ce-input ${cls}`;
    input.value = value;
    input.addEventListener('input', () => { commit(input.value); setDirty(true); });
    row.append(lab, input);
    ident.appendChild(row);
  };
  textRow('Name', staged.name, (v) => { staged.name = v; }, 'wb-ce-name');
  textRow('Description', staged.description, (v) => { staged.description = v; }, 'wb-ce-desc');

  // ── slots: labels/tooltips are editable, KEYS are not (they're field refs) ──
  const slotsSec = section(left, 'Slots — what the mapping dialog asks for');
  if (!staged.slots.length) {
    const none = document.createElement('div');
    none.className = 'wb-ce-note';
    none.textContent = 'No slots — this component references no columns and drops in as-is.';
    slotsSec.appendChild(none);
  }
  for (const slot of staged.slots) {
    const row = document.createElement('div');
    row.className = 'wb-ce-slot';
    const key = document.createElement('span');
    key.className = 'wb-ce-slotkey';
    key.textContent = `[$${slot.key}]`;
    key.title = 'The slot key is the tree\'s field reference — it can\'t change here';
    const lab = document.createElement('input');
    lab.type = 'text';
    lab.className = 'wb-ce-input wb-ce-slotlabel';
    lab.value = slot.label;
    lab.title = 'The question the mapping dialog asks for this slot';
    lab.setAttribute('aria-label', `Label for the ${slot.key} slot`);
    lab.addEventListener('input', () => { slot.label = lab.value; setDirty(true); });
    const desc = document.createElement('input');
    desc.type = 'text';
    desc.className = 'wb-ce-input wb-ce-slotdesc';
    desc.value = slot.description ?? '';
    desc.placeholder = 'tooltip (optional)';
    desc.setAttribute('aria-label', `Tooltip for the ${slot.key} slot`);
    desc.addEventListener('input', () => {
      if (desc.value.trim()) slot.description = desc.value;
      else delete slot.description;
      setDirty(true);
    });
    row.append(key, lab, desc);
    slotsSec.appendChild(row);
  }

  // ── embedded components (#225): reuse another component inside this one ──
  // Composition at the definition layer. Embedding is ONE gesture = one ↶
  // step (the bindComponentInstance precedent); cycles and over-deep chains
  // are refused with teaching copy BEFORE anything mutates. What eventually
  // bakes is the inline-flattened snapshot — flattenComponent at bind time.
  const embedsSec = section(left, 'Embedded components — reuse a component inside this one');
  const embedsHost = document.createElement('div');
  embedsHost.className = 'wb-ce-embeds';
  embedsSec.appendChild(embedsHost);

  const afterEmbedChange = (): void => {
    if (!nodeAtStaged(sel)) sel = [];
    setDirty(true);
    mu.commit(muBag());
    muButtons.refresh();
    renderPreview();
    renderEmbeds();
    state.emit('workshop');
  };

  const renderEmbeds = (): void => {
    embedsHost.replaceChildren();
    const note = document.createElement('div');
    note.className = 'wb-ce-note';
    note.textContent = 'Editing an embedded component updates every place that nests it, live, across the app. Applying still bakes ONE flattened, self-contained formatter — SharePoint stores a copy, not a live link, so a formatter you\'ve already applied there won\'t change after the fact. An embedded component\'s unmapped slots surface on this one, namespaced.';
    embedsHost.appendChild(note);
    for (const em of staged.embeds ?? []) {
      const row = document.createElement('div');
      row.className = 'wb-ce-embed';
      const chip = document.createElement('span');
      chip.className = 'wb-ce-slotkey';
      chip.textContent = `⬡ ${em.name}`;
      chip.title = libraryDefs().some((d) => d.id === em.of)
        ? `Embedded component — its unbound slots surface as [$${em.ns}_…]`
        : `“${em.name}” is no longer in the library — this embed bakes as nothing until you remove it here or restore the component`;
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'wb-ce-embeddel';
      rm.textContent = '✕';
      rm.title = `Remove the embedded ${em.name} — one ↶ step`;
      rm.setAttribute('aria-label', rm.title);
      rm.addEventListener('click', () => {
        const next = withoutEmbed(staged, em.ns);
        staged.root = next.root;
        if (next.embeds) staged.embeds = next.embeds;
        else delete staged.embeds;
        afterEmbedChange();
      });
      row.append(chip, rm);
      embedsHost.appendChild(row);
    }
    // the insert row: pick an offered element component, ＋ Embed appends it
    const addRow = document.createElement('div');
    addRow.className = 'wb-ce-row';
    const pick = document.createElement('select');
    pick.className = 'wb-ce-input wb-ce-embedpick';
    pick.setAttribute('aria-label', 'Component to embed');
    const candidates = libraryDefs()
      .filter((d) => d.id !== def.id && componentKind(d) === 'element');
    for (const d of candidates) {
      const o = document.createElement('option');
      o.value = d.id;
      o.textContent = d.name;
      pick.appendChild(o);
    }
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'wb-ce-embedadd';
    add.textContent = '＋ Embed';
    add.title = `Insert the chosen component into this one — one ↶ step. Loops are refused; nesting caps at ${MAX_COMPONENT_DEPTH} levels.`;
    add.disabled = !candidates.length;
    add.addEventListener('click', () => {
      const child = candidates.find((d) => d.id === pick.value);
      if (!child) return;
      // refuse-and-teach BEFORE any mutation — a cycle is never even staged
      const refusal = embedRefusal(staged, child, libraryDefs());
      if (refusal) {
        onToast(refusal);
        return;
      }
      const next = withEmbed(staged, child);
      staged.root = next.root;
      staged.embeds = next.embeds;
      afterEmbedChange();
      onToast(`Embedded “${child.name}” — its slots now surface on this component (↶ undoes)`);
    });
    addRow.append(pick, add);
    embedsHost.appendChild(addRow);
  };

  // ── live preview: best-guess bound, click-to-select via data-sp-path ──
  const prevSec = section(right, 'Elements — click to select; style them in the Properties pane');
  const previewHost = document.createElement('div');
  previewHost.className = 'wb-ce-preview';
  prevSec.appendChild(previewHost);
  // (the mini structure list died with the style panel — the Structure tree
  //  renders the staged tree itself now, card content included)

  const previewMapping = (def2: ComponentDef): Record<string, string> => {
    const m = bestGuessMapping(def2, state.fields);
    // slot-key identity fallback: when the schema can't fill a slot the
    // preview still renders the recipe's own refs rather than nothing
    for (const s of def2.slots) if (!m[s.key]) m[s.key] = s.key;
    return m;
  };

  const renderPreview = (): void => {
    previewHost.replaceChildren();
    try {
      // resolve embeds first (#225) so the preview is WYSIWYG for a nested
      // def; binding then rewrites refs only, and substitution is node-for-
      // node, so every path that EXISTS in staged.root still lines up —
      // grafted children add deeper paths, which the click handler clamps
      const flat = flattenComponent(staged, libraryDefs());
      const bound = bindComponent(flat, previewMapping(flat));
      previewHost.appendChild(renderElement(bound, ctxForRow(0), { tagPaths: true }));
    } catch {
      previewHost.textContent = '—';
    }
    const picked = previewHost.querySelector(`[data-sp-path="${sel.join('.')}"]`);
    picked?.classList.add('wb-ce-picked');
  };
  /** Clamp a preview path to the nearest node staged.root actually has —
   *  clicking INSIDE an embedded component's graft selects its placeholder. */
  const clampToStaged = (path: NodePath): NodePath => {
    const ok: NodePath = [];
    let node: SPElement | undefined = staged.root;
    for (const i of path) {
      node = i === CARD_SEGMENT ? node?.customCardProps?.formatter : node?.children?.[i];
      if (!node) break;
      ok.push(i);
    }
    return ok;
  };
  /** THE staged-selection setter — preview clicks, struct rows and the
   *  tree (via ctx.select) all land here so the seam always announces. */
  const setSel = (p: NodePath): void => {
    sel = p;
    refreshSelection();
    state.emit('workshop');
  };

  // selection only — preview clicks never trigger card flyouts/row actions
  previewHost.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const t = (e.target as HTMLElement).closest?.('[data-sp-path]');
    if (!(t instanceof Element) || !previewHost.contains(t)) return;
    const raw = (t as HTMLElement).dataset.spPath ?? '';
    setSel(clampToStaged(raw === '' ? [] : raw.split('.').map(Number)));
  }, true);


  // (The compact staged style panel died 2026-07-09 — spec §C. The real
  //  inspector styles staged elements through the WorkshopContext below,
  //  with the full element vocabulary instead of the eight-property chip set.)

  const refreshSelection = (): void => {
    previewHost.querySelector('.wb-ce-picked')?.classList.remove('wb-ce-picked');
    previewHost.querySelector(`[data-sp-path="${sel.join('.')}"]`)?.classList.add('wb-ce-picked');
  };

  // ── usages + "keep as-found" pinning (customs with usages only) ──
  const isCustomWithUsages = !def.builtin && usages.length > 0;
  if (isCustomWithUsages) {
    const useSec = section(left, `Where it's used — ${usages.length} place${usages.length === 1 ? '' : 's'}`);
    const note = document.createElement('div');
    note.className = 'wb-ce-note';
    note.textContent = 'Save and apply updates every place below. Pin “keep as-found” to leave a place on the OLD look — it gets a one-off variant instead.';
    useSec.appendChild(note);
    usages.forEach((u, i) => {
      const row = document.createElement('div');
      row.className = 'wb-ce-usage';
      const pin = document.createElement('label');
      pin.className = 'wb-ce-pinlab';
      pin.title = 'Keep this place exactly as it looks today (a one-off variant of the old recipe)';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'wb-ce-pin';
      cb.addEventListener('change', () => {
        if (cb.checked) pinned.add(i); else pinned.delete(i);
        refreshFoot();
      });
      pin.append(cb, document.createTextNode('keep as-found'));
      const jump = document.createElement('button');
      jump.type = 'button';
      jump.className = 'wb-ce-jump';
      jump.textContent = u.kind === 'view'
        ? mainUsageLabel(u)
        : `${fieldLabel(u.field)} — column look`;
      // jumping is NAVIGATION now: the surface shows, this tab (and its
      // staged edits) waits in the strip — no discard prompt needed
      jump.title = 'Jump there — this workshop tab stays open with your staged edits';
      jump.addEventListener('click', () => {
        if (u.kind === 'view') {
          state.deactivateComponentTab(); // uncover the surface the scan saw
          state.select(u.path);
        } else {
          // the look renders embedded in the floor's grid cell — go select it
          state.minimizeView(); // clears the component-tab cover either way
          const i = (state.floorDoc.root.children ?? []).findIndex((c) => gridColumnField(c) === u.field);
          if (i >= 0) state.select([i]);
        }
      });
      row.append(jump, pin);
      useSec.appendChild(row);
    });
  }

  // ── saving ──
  /** The staged def, cleaned for persistence (never a builtin; name/label
   *  fallbacks so an emptied input can't produce an unnamed def). */
  const stagedPlain = (): ComponentDef => {
    const out = JSON.parse(JSON.stringify(staged)) as ComponentDef;
    delete out.builtin;
    out.name = out.name.trim() || def.name;
    out.description = out.description.trim();
    for (const s of out.slots) s.label = s.label.trim() || s.key;
    if (out.embeds && !out.embeds.length) delete out.embeds;
    return out;
  };

  /** Last-line cycle guard at SAVE time (#225): the author-time refusal
   *  can't see another tab embedding the other way while this one staged, so
   *  re-check against the store as it is NOW — a cycle is never persisted. */
  const savedCycleRefusal = (candidate: ComponentDef, list: ComponentDef[]): string | null => {
    const defs = [...list.filter((c) => c.id !== candidate.id), candidate];
    return embedClosure(candidate, defs).has(candidate.id)
      ? `Saving would loop “${candidate.name}” back into itself through another component — the library changed while you edited. Remove one side's embed first.`
      : null;
  };

  const saveAsNew = (): void => {
    const list = readCustom();
    const base = stagedPlain();
    const fresh: ComponentDef = {
      ...base,
      id: componentId(new Date()),
      name: uniqueName(base.name, list.map((c) => c.name)),
    };
    delete fresh.variantOf; // a fresh save stands on its own, no lineage
    if (!writeCustom(addComponent(list, fresh))) {
      onToast('Could not save the component — browser storage is full or blocked');
      return;
    }
    setDirty(false);
    onToast(`Saved “${fresh.name}” as a new component — nothing already on the canvas changed`);
    libraryRefresh?.();
    opts.onSaved(fresh.id); // the tab swaps onto the copy (may remount us)
  };

  /** Replace the subtree at `path` in the LIVE main doc (root/card aware). */
  const replaceInDoc = (path: NodePath, node: SPElement): void => {
    if (path.length === 0) { state.doc.root = node; return; }
    if (path[path.length - 1] === CARD_SEGMENT) {
      const cardHost = state.nodeAt(path.slice(0, -1));
      if (cardHost?.customCardProps) cardHost.customCardProps.formatter = node;
      return;
    }
    const p = state.parentOf(path);
    if (p?.parent.children) p.parent.children[p.index] = node;
  };

  /** Mirror a column's (re)written look back onto its placed floor cell —
   *  the store and the embedded clone must never disagree. */
  const rewriteFloorCell = (fieldName: string): void => {
    const f = state.fields.find((x) => x.name === fieldName);
    const children = state.floorDoc.root.children;
    const i = children?.findIndex((c) => gridColumnField(c) === fieldName) ?? -1;
    if (f && children && i >= 0) children[i] = gridCellForField(f, state.columnLooks);
  };

  /** Re-bake ONE usage of the def stamped `targetId` to `bakedDef` (that def
   *  flattened against the fresh library), using the instance's OWN stored slot
   *  map. `oldName` is the name instances were stamped under — rebindInstance
   *  preserves a maker's rename against it. Generalized over `targetId` so the
   *  embedder cascade can re-bake PARENT instances, not only the edited def.
   *  Returns whether it ACTUALLY re-baked: a stale NodePath or a since-removed
   *  column look changes nothing, and the cascade counts only real changes so
   *  its toast can't overclaim. */
  const rebakeUsage = (u: ComponentUsage, targetId: string, oldName: string, bakedDef: ComponentDef): boolean => {
    if (u.kind === 'view') {
      const el = state.nodeAt(u.path);
      if (!el || el._component?.id !== targetId) return false; // stale path — never clobber
      const next = rebindInstance(bakedDef, el, oldName);
      if (!next) return false;
      replaceInDoc(u.path, next);
      return true;
    }
    // column wearer: the look IS a stamped instance — re-bind it with its own
    // stored slot map (looks stay in explicit-[$Field] dialect) and mirror the
    // floor cell. An imported (unstamped-root) look can still carry stamped
    // subtrees; those re-bind in place.
    const look = Object.hasOwn(state.columnLooks, u.field) ? state.columnLooks[u.field] : undefined;
    if (!look) return false;
    const next = look._component?.id === targetId
      ? rebindInstance(bakedDef, look, oldName)
      : replaceStampedIn(look, targetId, (el) => rebindInstance(bakedDef, el, oldName) ?? el);
    if (!next) return false;
    state.columnLooks[u.field] = next;
    rewriteFloorCell(u.field);
    return true;
  };

  /** The edited def's own direct usages (behaviour-identical to before). */
  const applyUsage = (u: ComponentUsage, newDef: ComponentDef): void => {
    rebakeUsage(u, def.id, def.name, newDef);
  };

  /**
   * The in-app LIVE cascade (#225 follow-up): saving a component re-bakes every
   * place on the canvas that uses a DIFFERENT component which (transitively)
   * embeds the one just saved — so editing a Status pill refreshes the Task
   * card and the Badge that wraps it, wherever they sit, without reopening
   * them. SharePoint-exported JSON is a dead copy and stays out of reach (there
   * is no live link to push to — that's the CFR decision, not this one); this
   * is purely the formatfx-side surface. Parent instances carry no per-usage
   * pin UI here, so they always re-bake (their own "keep as-found" variants are
   * flattened, carry no embeds, and so never appear in the blast radius).
   * Runs INSIDE an already-open batchProjectUpdate; returns what it touched.
   */
  const cascadeToEmbedders = (savedId: string, allDefs: ComponentDef[]): { places: number; fields: string[] } => {
    const parents = transitiveEmbedders(savedId, allDefs);
    if (!parents.length) return { places: 0, fields: [] };
    const scan = scanComponentUsages(parents, state.doc.root, state.columnLooks);
    const fields = new Set<string>();
    let places = 0;
    for (const parent of parents) {
      const parentUsages = scan.get(parent.id) ?? [];
      if (!parentUsages.length) continue;
      // re-bake from the parent's OWN flatten — it inlines the fresh child
      const baked = flattenComponent(parent, allDefs);
      for (const u of parentUsages) {
        if (!rebakeUsage(u, parent.id, parent.name, baked)) continue; // count only real re-bakes
        places += 1;
        if (u.kind === 'column') fields.add(u.field);
      }
    }
    return { places, fields: [...fields] };
  };

  const pinUsage = (u: ComponentUsage, variantId: string): void => {
    if (u.kind === 'view') {
      const el = state.nodeAt(u.path);
      if (el?._component?.id === def.id) el._component = { ...el._component, id: variantId };
      return;
    }
    const look = Object.hasOwn(state.columnLooks, u.field) ? state.columnLooks[u.field] : undefined;
    if (!look) return;
    state.columnLooks[u.field] = restampIn(look, def.id, variantId);
    rewriteFloorCell(u.field); // same content, new stamp — keep the mirror true
  };

  const saveAndApply = (): void => {
    const now = new Date();
    const newDef: ComponentDef = { ...stagedPlain(), id: def.id };
    let list = readCustom();
    const refusal = savedCycleRefusal(newDef, list);
    if (refusal) {
      onToast(refusal);
      return;
    }
    list = list.some((c) => c.id === def.id)
      ? list.map((c) => (c.id === def.id ? newDef : c))
      : addComponent(list, newDef);
    const pinnedList = usages.filter((_, i) => pinned.has(i));
    const unpinnedList = usages.filter((_, i) => !pinned.has(i));
    let variant: ComponentDef | null = null;
    if (pinnedList.length) {
      // freeze the FLATTENED old recipe (#225): "as-found" must mean as it
      // bakes today — a variant carrying live embeds would keep drifting
      variant = createVariant(flattenComponent(def, libraryDefs()),
        componentId(now), list.map((c) => c.name), now);
      list = addComponent(list, variant);
    }
    if (!writeCustom(list)) {
      onToast('Could not save the component — browser storage is full or blocked');
      return;
    }
    // instances always wear the RESOLVED recipe — re-bakes bind the flattened
    // shape (#225), matching what the mapper bound at insert time
    const allDefs = [...BUILTIN_COMPONENTS, ...paletteComponents(), ...list];
    const bakedDef = flattenComponent(newDef, allDefs);
    // the WHOLE apply — doc subtree replacements + registry re-bakes + tag
    // restamps + the embedder cascade — is ONE undoable step (batchProjectUpdate
    // wraps one snapshot)
    let cascaded = { places: 0, fields: [] as string[] };
    const touched = [...new Set(usages.flatMap((u) => (u.kind === 'column' ? [u.field] : [])))];
    state.batchProjectUpdate(touched, () => {
      for (const u of unpinnedList) applyUsage(u, bakedDef);
      if (variant) for (const u of pinnedList) pinUsage(u, variant.id);
      cascaded = cascadeToEmbedders(def.id, allDefs); // live: refresh every component that embeds this one
    });
    setDirty(false);
    const parts = [`Replaced “${newDef.name}”`];
    if (unpinnedList.length) parts.push(`updated ${unpinnedList.length} place${unpinnedList.length === 1 ? '' : 's'}`);
    if (variant) parts.push(`kept ${pinnedList.length} as-found via “${variant.name}”`);
    if (cascaded.places) parts.push(`refreshed ${cascaded.places} place${cascaded.places === 1 ? '' : 's'} nesting it`);
    onToast(`${parts.join(', ')}${usages.length || cascaded.places ? ' — one Ctrl+Z reverts the whole apply' : ''}`);
    libraryRefresh?.();
    opts.onSaved(def.id); // the tab re-stages on the saved def (remounts us)
  };

  const saveReplaceOnly = (): void => {
    const newDef: ComponentDef = { ...stagedPlain(), id: def.id };
    const list = readCustom();
    const refusal = savedCycleRefusal(newDef, list);
    if (refusal) {
      onToast(refusal);
      return;
    }
    const next = list.some((c) => c.id === def.id)
      ? list.map((c) => (c.id === def.id ? newDef : c))
      : addComponent(list, newDef);
    if (!writeCustom(next)) {
      onToast('Could not save the component — browser storage is full or blocked');
      return;
    }
    // no DIRECT usages, but a component that EMBEDS this one may be live on the
    // canvas — refresh those in one undoable step (a no-op cascade records
    // nothing, so the "nothing changed" message below still holds)
    const allDefs = [...BUILTIN_COMPONENTS, ...paletteComponents(), ...next];
    let cascaded = { places: 0, fields: [] as string[] };
    state.batchProjectUpdate([], () => { cascaded = cascadeToEmbedders(def.id, allDefs); });
    setDirty(false);
    onToast(cascaded.places
      ? `Saved “${newDef.name}” — refreshed ${cascaded.places} place${cascaded.places === 1 ? '' : 's'} that nest it (one Ctrl+Z reverts)`
      : `Saved “${newDef.name}” — it's not used anywhere yet, so nothing on the canvas changed`);
    libraryRefresh?.();
    opts.onSaved(def.id);
  };

  // ── footer ──
  const foot = document.createElement('div');
  foot.className = 'wb-ce-foot';
  panel.appendChild(foot);
  const refreshFoot = (): void => {
    foot.replaceChildren();
    const saveNew = document.createElement('button');
    saveNew.type = 'button';
    saveNew.className = 'wb-ce-savenew' + (def.builtin ? ' wb-ce-save' : '');
    saveNew.textContent = 'Save as new component';
    saveNew.title = def.builtin
      ? 'Built-ins can\'t be overwritten — this saves your edited copy to the library (this tab becomes the copy\'s)'
      : 'Save these edits as a separate component — every current usage stays untouched';
    saveNew.addEventListener('click', saveAsNew);
    foot.appendChild(saveNew);
    if (def.builtin) return; // save-as-new is the ONLY option for built-ins
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'wb-ce-save';
    if (usages.length === 0) {
      save.textContent = 'Save';
      save.title = 'Replace this component in the library — it\'s not used anywhere, so nothing re-bakes';
    } else {
      const n = usages.length - pinned.size;
      save.textContent = n > 0
        ? `Save and apply to ${n} place${n === 1 ? '' : 's'}`
        : `Save (keep all ${usages.length} as-found)`;
      save.title = pinned.size
        ? `Update ${n} place${n === 1 ? '' : 's'}; the ${pinned.size} pinned place${pinned.size === 1 ? ' keeps' : 's keep'} the old look as a one-off variant — all one undoable step`
        : 'Replace the component and re-bake every place using it — all one undoable step';
    }
    save.addEventListener('click', usages.length === 0 ? saveReplaceOnly : saveAndApply);
    foot.appendChild(save);
  };

  renderPreview();
  renderEmbeds();
  refreshFoot();
  if (!opts.resume) panel.querySelector<HTMLElement>('.wb-ce-name')?.focus();

  // ── the staged-editing seam (spec §C): while this workshop is mounted the
  //    Structure tree and the inspector resolve against the STAGED tree.
  //    commit() is the one staged-mutation chokepoint — dirty + a modal-undo
  //    step + preview/struct refresh + the 'workshop' announce; the app undo
  //    stack never hears about it (Save stays the one app-level step). ──────
  const ctx: WorkshopContext = {
    root: () => staged.root,
    selection: () => sel,
    select: (p: NodePath) => setSel(clampToStaged(p)),
    nodeAt: (p: NodePath) => nodeAtStaged(p),
    embedNameOf: (el: SPElement) => el._embed !== undefined
      ? ((staged.embeds ?? []).find((em) => em.ns === el._embed)?.name ?? String(el._embed))
      : null,
    commit: (fn: () => void): void => {
      fn();
      if (!nodeAtStaged(sel)) sel = [];
      setDirty(true);
      mu.commit(muBag());
      muButtons.refresh();
      renderPreview();
      state.emit('workshop');
    },
  };
  state.registerWorkshop(ctx);

  return {
    staging: (): WorkshopStaging => ({
      staged: JSON.parse(JSON.stringify(staged)) as ComponentDef,
      dirty,
    }),
    destroy: (): void => {
      detachMuKeys();
      state.unregisterWorkshop(ctx);
    },
  };
}

