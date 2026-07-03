/**
 * editor/componentEditor.ts — the component EDITOR: open a component from the
 * ⬡ library (inventory card or browse card) and edit the DEFINITION itself —
 * its name/description, what each slot ASKS for (labels/tooltips; slot KEYS
 * are immutable, they're the tree's field refs), and its elements visually
 * (click the live preview or the mini structure list to select, restyle with
 * the compact Format-cells vocabulary). Everything stages into a deep copy;
 * nothing commits until a Save button.
 *
 * Saving:
 *   · "Save as new component" — a fresh def (new id); never touches usages.
 *     The ONLY option for built-ins (they can't be overwritten).
 *   · "Save and apply to N places" — replaces the def (keeps its id) and
 *     re-bakes every current usage to the new recipe, EXCEPT usages pinned
 *     "keep as-found": those get a one-off variant def frozen from the OLD
 *     recipe (variantOf lineage) and are restamped onto it. The whole apply —
 *     view subtree replacements, registry re-bakes, tag restamps — rides
 *     state.batchProjectUpdate, so ONE Ctrl+Z reverts everything.
 *
 * The modal covers the CANVAS pane only (the Left Edit Pane stays visible) —
 * createOverlay supplies the wb-esc-owner/Esc/backdrop conventions and the
 * overlay is positioned over `.wb-pane-canvas` on open + window resize.
 */

import { state, CARD_SEGMENT } from './state';
import { renderElement } from '../core/renderer';
import { ctxForRow } from './previewCtx';
import { createOverlay } from './overlay';
import { toColumnFormatter } from './cfr';
import { FONT_SIZES, RADII, INK_SWATCHES, HAIRLINE } from './formatCells';
import { COND_COLORS } from './condRules';
import type { SPElement, SPExpr, NodePath } from '../core/types';
import {
  COMPONENTS_KEY, loadComponents, serializeComponents, addComponent,
  bestGuessMapping, bindComponent, componentId,
  createVariant, rebindInstance, replaceStampedIn, restampIn, uniqueName,
  type ComponentDef,
} from './components';
import { scanComponentUsages, mainUsageLabel, type ComponentUsage } from './componentUsage';

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

/** Managed by the compact style panel — the Format-cells vocabulary, compact. */
const CE_MANAGED = [
  'font-size', 'font-weight', 'font-style', 'color',
  'background-color', 'border', 'border-radius', 'text-align',
];

// SPExpr classification for the style panel (exported as the pure seam the
// unit tests pin). A FORMULA is an '='-prefixed string or the AST object form
// ({operator, operands}); plain strings, NUMBERS and BOOLEANS are static
// literals (e.g. `opacity: 0.6`, `font-weight: 600`) — the same split the
// engine and the inspector make.

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

export function openComponentEditor(
  def: ComponentDef,
  onToast: (m: string) => void,
  onSaved: () => void,
): void {
  // ── staged copy: every edit lands here; Save commits ──
  const staged: ComponentDef = JSON.parse(JSON.stringify(def)) as ComponentDef;
  let dirty = false;
  let sel: NodePath = [];

  // usages, scanned once at open (same live-doc merge as the library render);
  // built-ins can be in use too, but they only ever save-as-new
  const refs = state.activeDocKey !== 'main'
    ? { ...state.columnRefs, [state.activeDocKey]: state.doc.root }
    : state.columnRefs;
  const usages: ComponentUsage[] = def.builtin
    ? []
    : scanComponentUsages([def], state.mainRootForScope, refs, state.fields).get(def.id) ?? [];
  const pinned = new Set<number>();

  const confirmClose = (): void => {
    if (dirty && !window.confirm('Discard your staged component edits?')) return;
    close();
  };
  const { overlay, close: closeOverlay } = createOverlay('wb-compedit-overlay', confirmClose);
  const place = (): void => {
    // cover the CANVAS pane, not the screen — the Left Edit Pane stays visible
    const pane = document.querySelector('.wb-pane-canvas');
    if (!pane) return; // CSS inset:0 fallback (full screen)
    const r = pane.getBoundingClientRect();
    overlay.style.top = `${r.top}px`;
    overlay.style.left = `${r.left}px`;
    overlay.style.width = `${r.width}px`;
    overlay.style.height = `${r.height}px`;
    overlay.style.right = 'auto';
    overlay.style.bottom = 'auto';
  };
  window.addEventListener('resize', place);
  const close = (): void => {
    window.removeEventListener('resize', place);
    closeOverlay();
  };

  const panel = document.createElement('div');
  panel.className = 'wb-ce';
  overlay.appendChild(panel);

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
    : 'nothing changes until you save';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'wb-ce-close';
  closeBtn.textContent = '✕';
  closeBtn.title = 'Close (Esc) — discards staged edits';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.addEventListener('click', confirmClose);
  head.append(title, sub, closeBtn);
  panel.appendChild(head);

  const body = document.createElement('div');
  body.className = 'wb-ce-body';
  panel.appendChild(body);
  const left = document.createElement('div');
  left.className = 'wb-ce-col';
  const right = document.createElement('div');
  right.className = 'wb-ce-col';
  body.append(left, right);

  const section = (host: HTMLElement, label: string): HTMLElement => {
    const h = document.createElement('div');
    h.className = 'wb-ce-seclab';
    h.textContent = label;
    host.appendChild(h);
    const s = document.createElement('div');
    s.className = 'wb-ce-sec';
    host.appendChild(s);
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
    input.addEventListener('input', () => { commit(input.value); dirty = true; });
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
    lab.addEventListener('input', () => { slot.label = lab.value; dirty = true; });
    const desc = document.createElement('input');
    desc.type = 'text';
    desc.className = 'wb-ce-input wb-ce-slotdesc';
    desc.value = slot.description ?? '';
    desc.placeholder = 'tooltip (optional)';
    desc.setAttribute('aria-label', `Tooltip for the ${slot.key} slot`);
    desc.addEventListener('input', () => {
      if (desc.value.trim()) slot.description = desc.value;
      else delete slot.description;
      dirty = true;
    });
    row.append(key, lab, desc);
    slotsSec.appendChild(row);
  }

  // ── live preview: best-guess bound, click-to-select via data-sp-path ──
  const prevSec = section(right, 'Elements — click to select, restyle below');
  const previewHost = document.createElement('div');
  previewHost.className = 'wb-ce-preview';
  prevSec.appendChild(previewHost);
  const structHost = document.createElement('div');
  structHost.className = 'wb-ce-struct';
  prevSec.appendChild(structHost);

  const previewMapping = (): Record<string, string> => {
    const m = bestGuessMapping(staged, state.fields);
    // slot-key identity fallback: when the schema can't fill a slot the
    // preview still renders the recipe's own refs rather than nothing
    for (const s of staged.slots) if (!m[s.key]) m[s.key] = s.key;
    return m;
  };

  const renderPreview = (): void => {
    previewHost.replaceChildren();
    try {
      const bound = bindComponent(staged, previewMapping());
      // binding rewrites refs only — paths in the bound tree match staged.root
      previewHost.appendChild(renderElement(bound, ctxForRow(0), {
        resolveColumnRef: () => null, // components are self-contained by contract
        tagPaths: true,
      }));
    } catch {
      previewHost.textContent = '—';
    }
    const picked = previewHost.querySelector(`[data-sp-path="${sel.join('.')}"]`);
    picked?.classList.add('wb-ce-picked');
  };
  // selection only — preview clicks never trigger card flyouts/row actions
  previewHost.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const t = (e.target as HTMLElement).closest?.('[data-sp-path]');
    if (!(t instanceof Element) || !previewHost.contains(t)) return;
    const raw = (t as HTMLElement).dataset.spPath ?? '';
    sel = raw === '' ? [] : raw.split('.').map(Number);
    refreshSelection();
  }, true);

  // mini structure list (card content included — it only renders in flyouts,
  // so the list is how you reach it)
  const renderStruct = (): void => {
    structHost.replaceChildren();
    const walk = (el: SPElement, path: NodePath, depth: number, card: boolean): void => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'wb-ce-struct-row' + (path.join('.') === sel.join('.') ? ' active' : '');
      row.style.paddingLeft = `${8 + depth * 12}px`;
      row.textContent = `${card ? 'card · ' : ''}${el._elmName ?? `<${el.elmType}>`}`;
      row.addEventListener('click', () => { sel = path; refreshSelection(); });
      structHost.appendChild(row);
      el.children?.forEach((c, i) => walk(c, [...path, i], depth + 1, false));
      if (el.customCardProps?.formatter) walk(el.customCardProps.formatter, [...path, CARD_SEGMENT], depth + 1, true);
    };
    walk(staged.root, [], 0, false);
  };

  // ── the compact staged style panel (the Format-cells vocabulary) ──
  const styleSec = section(right, 'Style the selected element');
  const styleHost = document.createElement('div');
  styleHost.className = 'wb-ce-style';
  styleSec.appendChild(styleHost);

  const plainOf = stylePlainValue;
  const isFormula = styleIsFormula;
  const setStyle = (prop: string, value: string | null): void => {
    const node = nodeAtStaged(sel);
    if (!node) return;
    node.style = node.style ?? {};
    if (value === null) delete node.style[prop];
    else node.style[prop] = value;
    if (Object.keys(node.style).length === 0) delete node.style;
    dirty = true;
    renderPreview();
    renderStylePanel();
  };

  const renderStylePanel = (): void => {
    styleHost.replaceChildren();
    const node = nodeAtStaged(sel);
    if (!node) {
      const none = document.createElement('div');
      none.className = 'wb-ce-note';
      none.textContent = 'Select an element in the preview or the list above.';
      styleHost.appendChild(none);
      return;
    }
    const style = node.style;
    const row = (label: string, ...kids: HTMLElement[]): void => {
      const r = document.createElement('div');
      r.className = 'wb-ce-row';
      const lab = document.createElement('span');
      lab.className = 'wb-ce-rowlab';
      lab.textContent = label;
      r.appendChild(lab);
      for (const k of kids) r.appendChild(k);
      styleHost.appendChild(r);
    };
    const chips = (): HTMLElement => {
      const s = document.createElement('span');
      s.className = 'wb-ce-chips';
      return s;
    };
    const chip = (label: string, active: boolean, fn: () => void, titleTxt?: string): HTMLElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'wb-ce-chip' + (active ? ' active' : '');
      b.textContent = label;
      if (titleTxt) b.title = titleTxt;
      b.addEventListener('click', fn);
      return b;
    };
    const swatch = (color: string, active: boolean, fn: () => void): HTMLElement => {
      const s = document.createElement('button');
      s.type = 'button';
      s.className = 'wb-ce-swatch' + (active ? ' active' : '');
      s.title = color;
      s.style.background = color;
      s.addEventListener('click', fn);
      return s;
    };

    const sizes = chips();
    sizes.appendChild(chip('auto', plainOf(style, 'font-size') === '', () => setStyle('font-size', null)));
    for (const s of FONT_SIZES) {
      sizes.appendChild(chip(s.replace('px', ''), plainOf(style, 'font-size') === s, () => setStyle('font-size', s), s));
    }
    row('Size', sizes);

    const face = chips();
    const weight = plainOf(style, 'font-weight');
    const bold = weight === '600' || weight === '700' || weight === 'bold';
    face.appendChild(chip('Bold', bold, () => setStyle('font-weight', bold ? null : '600'), 'Semibold 600 — the SP emphasis weight'));
    const italic = plainOf(style, 'font-style') === 'italic';
    face.appendChild(chip('Italic', italic, () => setStyle('font-style', italic ? null : 'italic')));
    row('Style', face);

    const ink = chips();
    ink.appendChild(chip('auto', plainOf(style, 'color') === '', () => setStyle('color', null), 'No explicit color — the theme decides'));
    for (const c of INK_SWATCHES) ink.appendChild(swatch(c, plainOf(style, 'color') === c, () => setStyle('color', c)));
    row('Text', ink);

    const fill = chips();
    fill.appendChild(chip('none', plainOf(style, 'background-color') === '', () => setStyle('background-color', null)));
    for (const c of COND_COLORS) fill.appendChild(swatch(c.soft, plainOf(style, 'background-color') === c.soft, () => setStyle('background-color', c.soft)));
    for (const c of COND_COLORS) fill.appendChild(swatch(c.strong, plainOf(style, 'background-color') === c.strong, () => setStyle('background-color', c.strong)));
    row('Fill', fill);

    const borderVal = plainOf(style, 'border');
    const borderColor = borderVal.split(/\s+/).find((t) => t.startsWith('#')) ?? HAIRLINE;
    const bd = chips();
    bd.appendChild(chip('none', borderVal === '', () => setStyle('border', null)));
    bd.appendChild(chip('outline', borderVal !== '', () => setStyle('border', `1px solid ${borderColor}`), 'A 1px border on all four sides'));
    for (const c of [HAIRLINE, ...INK_SWATCHES.slice(0, 6)]) {
      bd.appendChild(swatch(c, borderVal !== '' && borderColor === c, () => setStyle('border', `1px solid ${c}`)));
    }
    row('Border', bd);

    const corners = chips();
    corners.appendChild(chip('square', plainOf(style, 'border-radius') === '', () => setStyle('border-radius', null)));
    for (const r of RADII) {
      corners.appendChild(chip(r === '50%' ? 'circle' : r, plainOf(style, 'border-radius') === r, () => setStyle('border-radius', r)));
    }
    row('Corners', corners);

    const align = chips();
    align.appendChild(chip('auto', plainOf(style, 'text-align') === '', () => setStyle('text-align', null)));
    for (const a of ['left', 'center', 'right']) {
      align.appendChild(chip(a, plainOf(style, 'text-align') === a, () => setStyle('text-align', a)));
    }
    row('Align', align);

    const driven = CE_MANAGED.filter((p) => isFormula(style, p));
    if (driven.length) {
      const warn = document.createElement('div');
      warn.className = 'wb-ce-note';
      warn.textContent = `𝑓x drives ${driven.join(', ')} on this element — picking a plain value here replaces that formula.`;
      styleHost.appendChild(warn);
    }
  };

  const refreshSelection = (): void => {
    previewHost.querySelector('.wb-ce-picked')?.classList.remove('wb-ce-picked');
    previewHost.querySelector(`[data-sp-path="${sel.join('.')}"]`)?.classList.add('wb-ce-picked');
    renderStruct();
    renderStylePanel();
  };

  // ── usages + "keep as-found" pinning (customs with usages only) ──
  const isCustomWithUsages = !def.builtin && usages.length > 0;
  if (isCustomWithUsages) {
    const useSec = section(left, `Where it's used — ${usages.length} place${usages.length === 1 ? '' : 's'}`);
    const note = document.createElement('div');
    note.className = 'wb-ce-note';
    note.textContent = 'Save and apply updates every place below. Pin “keep as-found” to leave a place on the OLD look — it gets a one-off variant instead.';
    useSec.appendChild(note);
    const mainIsColumn = state.activeDocKey === 'main' && state.doc.kind === 'column';
    const mainField = fieldLabel(state.currentFieldName);
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
        ? mainUsageLabel(u, mainIsColumn, mainField)
        : `${fieldLabel(u.field)} — column formatter`;
      jump.title = 'Jump there (closes this editor)';
      jump.addEventListener('click', () => {
        if (dirty && !window.confirm('Jumping closes the editor — discard your staged component edits?')) return;
        close();
        if (u.kind === 'view') {
          state.openMain();
          state.select(u.path);
        } else {
          state.openColumnRef(u.field);
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
    return out;
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
    dirty = false;
    close();
    onSaved();
    onToast(`Saved “${fresh.name}” as a new component — nothing already on the canvas changed`);
  };

  /** Replace the subtree at `path` in the LIVE main doc (root/card aware). */
  const replaceInDoc = (path: NodePath, node: SPElement): void => {
    if (path.length === 0) { state.doc.root = node; return; }
    if (path[path.length - 1] === CARD_SEGMENT) {
      const host = state.nodeAt(path.slice(0, -1));
      if (host?.customCardProps) host.customCardProps.formatter = node;
      return;
    }
    const p = state.parentOf(path);
    if (p?.parent.children) p.parent.children[p.index] = node;
  };

  const applyUsage = (u: ComponentUsage, newDef: ComponentDef): void => {
    if (u.kind === 'view') {
      const el = state.nodeAt(u.path);
      if (!el || el._component?.id !== def.id) return; // stale path — never clobber
      const next = rebindInstance(newDef, el, def.name);
      if (next) replaceInDoc(u.path, next);
      return;
    }
    const tree = Object.hasOwn(state.columnRefs, u.field) ? state.columnRefs[u.field] : undefined;
    if (!tree) return;
    if (tree._component?.id === def.id) {
      // the whole registered format IS the instance (the Format-this-column
      // catalog path): re-bind with its own map, back into @currentField terms
      const re = rebindInstance(newDef, tree, def.name);
      if (re) state.columnRefs[u.field] = toColumnFormatter(re, u.field);
      return;
    }
    // stamped subtrees INSIDE the registered tree keep explicit [$Field] refs —
    // that's how the mapping dialog inserted them into an open column formatter
    let next = replaceStampedIn(tree, def.id, (el) => rebindInstance(newDef, el, def.name) ?? el);
    const f = state.fields.find((x) => x.name === u.field);
    if (f?.subtype === def.id && newDef.slots.length === 1
      && JSON.stringify(next) === JSON.stringify(tree)) {
      // tag-only legacy column (no stamp to carry a map): the single-slot
      // identity re-bake, same shape as the replace-and-push save
      const key = newDef.slots[0].key;
      next = toColumnFormatter(bindComponent(newDef, { [key]: key }), key);
    }
    state.columnRefs[u.field] = next;
  };

  const pinUsage = (u: ComponentUsage, variantId: string): void => {
    if (u.kind === 'view') {
      const el = state.nodeAt(u.path);
      if (el?._component?.id === def.id) el._component = { ...el._component, id: variantId };
      return;
    }
    const tree = Object.hasOwn(state.columnRefs, u.field) ? state.columnRefs[u.field] : undefined;
    if (tree) state.columnRefs[u.field] = restampIn(tree, def.id, variantId);
    const f = state.fields.find((x) => x.name === u.field);
    if (f?.subtype === def.id) f.subtype = variantId; // tags ride snapState → undoable
  };

  const saveAndApply = (): void => {
    const now = new Date();
    const newDef: ComponentDef = { ...stagedPlain(), id: def.id };
    let list = readCustom();
    list = list.some((c) => c.id === def.id)
      ? list.map((c) => (c.id === def.id ? newDef : c))
      : addComponent(list, newDef);
    const pinnedList = usages.filter((_, i) => pinned.has(i));
    const unpinnedList = usages.filter((_, i) => !pinned.has(i));
    let variant: ComponentDef | null = null;
    if (pinnedList.length) {
      variant = createVariant(def, componentId(now), list.map((c) => c.name), now);
      list = addComponent(list, variant);
    }
    if (!writeCustom(list)) {
      onToast('Could not save the component — browser storage is full or blocked');
      return;
    }
    // the WHOLE apply — doc subtree replacements + registry re-bakes + tag
    // restamps — is ONE undoable step (batchProjectUpdate wraps one snapshot)
    const touched = [...new Set(usages.flatMap((u) => (u.kind === 'column' ? [u.field] : [])))];
    state.batchProjectUpdate(touched, () => {
      for (const u of unpinnedList) applyUsage(u, newDef);
      if (variant) for (const u of pinnedList) pinUsage(u, variant.id);
    });
    dirty = false;
    close();
    onSaved();
    const parts = [`Replaced “${newDef.name}”`];
    if (unpinnedList.length) parts.push(`updated ${unpinnedList.length} place${unpinnedList.length === 1 ? '' : 's'}`);
    if (variant) parts.push(`kept ${pinnedList.length} as-found via “${variant.name}”`);
    onToast(`${parts.join(', ')}${usages.length ? ' — one Ctrl+Z reverts the whole apply' : ''}`);
  };

  const saveReplaceOnly = (): void => {
    const newDef: ComponentDef = { ...stagedPlain(), id: def.id };
    const list = readCustom();
    const next = list.some((c) => c.id === def.id)
      ? list.map((c) => (c.id === def.id ? newDef : c))
      : addComponent(list, newDef);
    if (!writeCustom(next)) {
      onToast('Could not save the component — browser storage is full or blocked');
      return;
    }
    dirty = false;
    close();
    onSaved();
    onToast(`Saved “${newDef.name}” — it's not used anywhere yet, so nothing on the canvas changed`);
  };

  // ── footer ──
  const foot = document.createElement('div');
  foot.className = 'wb-ce-foot';
  panel.appendChild(foot);
  const refreshFoot = (): void => {
    foot.replaceChildren();
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', confirmClose);
    foot.appendChild(cancel);
    const saveNew = document.createElement('button');
    saveNew.type = 'button';
    saveNew.className = 'wb-ce-savenew' + (def.builtin ? ' wb-ce-save' : '');
    saveNew.textContent = 'Save as new component';
    saveNew.title = def.builtin
      ? 'Built-ins can\'t be overwritten — this saves your edited copy to the library'
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
  renderStruct();
  renderStylePanel();
  refreshFoot();
  place();
  document.body.appendChild(overlay);
  panel.querySelector<HTMLElement>('.wb-ce-name')?.focus();
}
