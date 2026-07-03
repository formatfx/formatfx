/**
 * editor/components.ts — the component brain: a COMPONENT is a package of
 * formatting without a column to call home. Where a column formatter belongs
 * to one column (violet §) and the view formatter to one view (blue), a
 * component is UNBOUND — it declares typed SLOTS ("needs a person column, a
 * date column") and binds to a real schema only when a maker adds it and maps
 * their columns in. Pure and node-testable (no DOM/state imports), like
 * gridScaffold/areas/cfr/snapshots.
 *
 * The definition convention: `root` is written against the slot KEYS as field
 * names — `[$Due]` in the tree ⇄ the slot with key 'Due'. Binding = rewriting
 * every `[$Key]` / `[!Key]` reference to the mapped column (the same
 * boundary-aware remap presets.ts uses for schema-aware drop; exported here as
 * `remapFieldRefs` so both share one implementation).
 *
 * Save-as-component derives slots FROM a tree: every referenced field becomes
 * a slot typed by the current schema (widened to its single/multi sibling).
 * Components must be self-contained — a subtree carrying a
 * columnFormatterReference is refused (that content lives in the registry,
 * not the subtree; detach from the style first).
 *
 * Storage: 'wb-components.v1' (ADDITIVE key — the frozen project/prefs keys
 * stay frozen). Built-ins ship in code and are never persisted.
 */

import type { SPElement, MockField, FieldType, FormatterDocument } from '../core/types';
import { inlineColumnFormatter } from './cfr';

export interface ComponentSlot {
  /** The author-side field name used inside `root` (e.g. 'Due' ⇄ `[$Due]`). */
  key: string;
  /** The human ask shown in the mapping dialog, e.g. "The deadline to track". */
  label: string;
  /** Acceptable column types, preference order — the mapping UX filters by these. */
  types: FieldType[];
  description?: string;
}

export interface ComponentDef {
  id: string;
  name: string;
  description: string;
  slots: ComponentSlot[];
  /** The element tree, written against the slot keys as field names. */
  root: SPElement;
  /** 'element' (default) drops INTO a view; 'row' IS the whole row layout —
   *  applying one replaces the view body (applyRowTemplate semantics). */
  kind?: 'element' | 'row';
  /** Row components: the zebra/extra row class the layout shipped with. */
  additionalRowClass?: string;
  /** Ships in code; not persisted, not deletable. */
  builtin?: boolean;
}

/** The kind, defaulted — most components are element-scoped. */
export function componentKind(def: ComponentDef): 'element' | 'row' {
  return def.kind === 'row' ? 'row' : 'element';
}

/** ADDITIVE localStorage key — see the frozen-keys rule in docs/HANDOFF.md §1. */
export const COMPONENTS_KEY = 'wb-components.v1';

/** How many custom components the store keeps (oldest evicted past this). */
export const COMPONENT_CAP = 50;

// ─── field-reference plumbing ────────────────────────────────────────────────

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Deep-clone `fragment`, rewriting every `[$From]` / `[$From.prop]` /
 * `[!From…]` reference per `replacements` (from-name → to-name). The
 * lookahead keeps boundaries honest: `[$Due]` never matches `[$DueDate]`.
 * Shared by component binding AND presets' schema-aware drop.
 */
export function remapFieldRefs(fragment: SPElement, replacements: Map<string, string>): SPElement {
  if (replacements.size === 0) return JSON.parse(JSON.stringify(fragment)) as SPElement;
  // ONE pass with a name-alternation lookup — sequential per-entry replaces
  // would cascade when a target equals another key ({Start→End, End→Finish}
  // must not turn [$Start] into [$Finish]; swaps {A→B, B→A} must work too)
  const names = [...replacements.keys()].map(escapeRe).join('|');
  const re = new RegExp(`\\[(\\$|!)(${names})(?=[\\].])`, 'g');
  const remapString = (s: string): string =>
    s.replace(re, (_m, sigil: string, name: string) => `[${sigil}${replacements.get(name)}`);
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') return remapString(node);
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) out[k] = walk(v);
      return out;
    }
    return node;
  };
  return walk(JSON.parse(JSON.stringify(fragment))) as SPElement;
}

/** Unique field names a tree references via `[$X]` / `[!X]` (dotted included). */
export function fieldRefsIn(tree: SPElement): string[] {
  const found = new Set<string>();
  const scan = (s: string): void => {
    for (const m of s.matchAll(/\[[$!]([A-Za-z0-9_]+)(?:\.[^\]]+)?\]/g)) found.add(m[1]);
  };
  const walk = (node: unknown): void => {
    if (typeof node === 'string') { scan(node); return; }
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node && typeof node === 'object') Object.values(node).forEach(walk);
  };
  walk(tree);
  return [...found];
}

/** Whether a subtree carries a columnFormatterReference anywhere. */
export function containsCfr(tree: SPElement): boolean {
  if (tree.columnFormatterReference) return true;
  if (tree.children?.some(containsCfr)) return true;
  if (tree.customCardProps?.formatter) return containsCfr(tree.customCardProps.formatter);
  return false;
}

// ─── slots: derivation, best-guess mapping, binding ──────────────────────────

/** A type widened to its single/multi sibling — a component asking for a
 *  person column should also accept multi-person, and vice versa. */
const TYPE_SIBLINGS: Partial<Record<FieldType, FieldType[]>> = {
  person: ['person', 'personMulti'], personMulti: ['personMulti', 'person'],
  lookup: ['lookup', 'lookupMulti'], lookupMulti: ['lookupMulti', 'lookup'],
  choice: ['choice', 'choiceMulti'], choiceMulti: ['choiceMulti', 'choice'],
  text: ['text', 'note'], note: ['note', 'text'],
};
export function widenType(t: FieldType): FieldType[] {
  return TYPE_SIBLINGS[t] ?? [t];
}

/** Every field type — the slot typing for references we can't infer (foreign
 *  JSON built against a schema we never saw). The mapping picker then offers
 *  every column rather than guessing wrong and hiding the right one. */
export const ALL_FIELD_TYPES: FieldType[] = [
  'text', 'note', 'number', 'currency', 'choice', 'choiceMulti',
  'date', 'person', 'personMulti', 'boolean', 'hyperlink', 'lookup', 'lookupMulti',
];

/** Derive slots from a tree: every referenced field, typed by the schema it
 *  was built against; `unknownTypes` types the names that schema doesn't know
 *  (text-ish for workspace saves, EVERY type for foreign JSON imports). */
export function deriveSlots(
  tree: SPElement,
  fields: MockField[],
  unknownTypes: FieldType[] = widenType('text'),
): ComponentSlot[] {
  return fieldRefsIn(tree).map((name) => {
    const type = fields.find((f) => f.name === name)?.type;
    return { key: name, label: name, types: type ? widenType(type) : unknownTypes };
  });
}

/**
 * Convert an imported formatter document (the pnp/List-Formatting bridge —
 * paste any column or view formatter JSON) into a component. Throws
 * teaching errors on shapes that can't be self-contained components:
 * tile formatters (not yet supported) and CFR-carrying trees (that content
 * lives in a registry the component can't carry).
 */
export function componentFromFormatterDoc(
  doc: FormatterDocument,
  name: string,
  fields: MockField[],
  id: string,
): ComponentDef {
  if (doc.kind === 'tile') {
    throw new Error('Tile formatters aren\'t supported as components yet — import it via the JSON pane to edit it as a view instead.');
  }
  if (containsCfr(doc.root)) {
    throw new Error('This formatter references another column\'s formatter (columnFormatterReference) — components must be self-contained. Inline that content first, then import.');
  }
  if (doc.kind === 'column') {
    // column recipes speak @currentField — make it an explicit slot reference
    const root = inlineColumnFormatter(doc.root, 'Column');
    const refsColumn = fieldRefsIn(root).includes('Column');
    const slots = deriveSlots(root, fields, ALL_FIELD_TYPES).map((s) =>
      // the @currentField slot could be ANY type — the author's intent is unknowable from JSON
      s.key === 'Column' && refsColumn ? { ...s, label: 'The column to format', types: ALL_FIELD_TYPES } : s);
    return { id, name, description: 'Imported from formatter JSON.', slots, root };
  }
  // row (grid imports also detect as 'row'): the whole row layout
  return {
    id,
    name,
    description: 'Imported from formatter JSON — a whole-row layout.',
    kind: 'row',
    slots: deriveSlots(doc.root, fields, ALL_FIELD_TYPES),
    root: JSON.parse(JSON.stringify(doc.root)) as SPElement,
    ...(typeof doc.viewExtras?.additionalRowClass === 'string'
      ? { additionalRowClass: doc.viewExtras.additionalRowClass }
      : {}),
  };
}

/**
 * Best-guess mapping for a schema: per slot, an exact name match wins, then
 * the first acceptable-typed field not already taken, then any acceptable
 * type. Slots with no acceptable column map to '' (the dialog demands a pick).
 */
export function bestGuessMapping(def: ComponentDef, fields: MockField[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const taken = new Set<string>();
  for (const slot of def.slots) {
    const exact = fields.find((f) => !f.protected && f.name.toLowerCase() === slot.key.toLowerCase()
      && slot.types.includes(f.type));
    const fresh = fields.find((f) => !f.protected && slot.types.includes(f.type) && !taken.has(f.name));
    const any = fields.find((f) => !f.protected && slot.types.includes(f.type));
    const pick = exact ?? fresh ?? any;
    mapping[slot.key] = pick?.name ?? '';
    if (pick) taken.add(pick.name);
  }
  return mapping;
}

/** Every slot mapped to a non-empty column name? */
export function mappingComplete(def: ComponentDef, mapping: Record<string, string>): boolean {
  return def.slots.every((s) => Boolean(mapping[s.key]));
}

/** A component the "Format this column" catalog can offer for a `type` column:
 *  element-scoped, exactly one slot, and that slot accepts the type.
 *  (Multi-slot components need the mapping dialog; row components replace the
 *  whole view — both live in the ⬡ library.) */
export function isSingleColumnComponent(def: ComponentDef, type: FieldType): boolean {
  return componentKind(def) === 'element' && def.slots.length === 1 && def.slots[0].types.includes(type);
}

/** Bind a component to real columns: rewrite each slot key to its mapped
 *  column and stamp the component's name on the root (the tree reads as
 *  "Deadline countdown", not "div"). */
export function bindComponent(def: ComponentDef, mapping: Record<string, string>): SPElement {
  const replacements = new Map<string, string>();
  for (const slot of def.slots) {
    const to = mapping[slot.key];
    if (to && to !== slot.key) replacements.set(slot.key, to);
  }
  const bound = remapFieldRefs(def.root, replacements);
  bound._elmName = bound._elmName ?? def.name;
  return bound;
}

// ─── persistence (caller owns localStorage, same split as snapshots) ─────────

function isValidSlot(s: unknown): s is ComponentSlot {
  return Boolean(s && typeof s === 'object'
    && typeof (s as ComponentSlot).key === 'string' && (s as ComponentSlot).key.length > 0
    && typeof (s as ComponentSlot).label === 'string'
    && Array.isArray((s as ComponentSlot).types) && (s as ComponentSlot).types.length > 0);
}

function isValidDef(c: unknown): c is ComponentDef {
  const kind = (c as ComponentDef)?.kind;
  return Boolean(c && typeof c === 'object'
    && typeof (c as ComponentDef).id === 'string'
    && typeof (c as ComponentDef).name === 'string' && (c as ComponentDef).name.length > 0
    && (kind === undefined || kind === 'element' || kind === 'row')
    && Array.isArray((c as ComponentDef).slots) && (c as ComponentDef).slots.every(isValidSlot)
    && (c as ComponentDef).root && typeof (c as ComponentDef).root === 'object'
    && typeof ((c as ComponentDef).root as SPElement).elmType === 'string');
}

/** Parse the persisted custom components; corrupt/foreign entries are dropped. */
export function loadComponents(raw: string | null): ComponentDef[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || !Array.isArray(parsed.components)) return [];
    return (parsed.components as unknown[]).filter(isValidDef).map((c) => ({ ...c, builtin: false }));
  } catch {
    return [];
  }
}

export function serializeComponents(components: ComponentDef[]): string {
  return JSON.stringify({ version: 1, components: components.filter((c) => !c.builtin) });
}

/** Add (newest last), evicting the oldest past the cap. Returns a new array. */
export function addComponent(components: ComponentDef[], def: ComponentDef, cap: number = COMPONENT_CAP): ComponentDef[] {
  const next = [...components, def];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

export function removeComponent(components: ComponentDef[], id: string): ComponentDef[] {
  return components.filter((c) => c.id !== id);
}

export function componentId(now: Date): string {
  return `c-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── built-ins ───────────────────────────────────────────────────────────────
// Multi-slot showcases — the value over single-field palette presets is the
// typed mapping. Expressions follow the codebase's verified blank-safe shapes
// (toString guards on dates, §3 semantics) and never emit a standalone `!`.

export const BUILTIN_COMPONENTS: ComponentDef[] = [
  {
    id: 'builtin-deadline-chip',
    name: 'Deadline chip',
    description: 'A due-date pill that turns red when overdue and grey when there is no date.',
    builtin: true,
    slots: [
      { key: 'Due', label: 'The deadline to track', types: ['date'], description: 'A date column' },
    ],
    root: {
      elmType: 'div',
      _elmName: 'Deadline chip',
      txtContent: "=if(toString([$Due])=='','No date',if([$Due]<@now,'Overdue: '+toLocaleDateString([$Due]),'Due '+toLocaleDateString([$Due])))",
      style: {
        'display': 'inline-flex', 'align-items': 'center',
        'border-radius': '12px', 'padding': '2px 10px',
        'font-size': '12px', 'font-weight': '600', 'color': '#ffffff',
        'background-color': "=if(toString([$Due])=='','#737a7f',if([$Due]<@now,'#d13438','#107c10'))",
      },
    },
  },
  {
    id: 'builtin-assignee-card',
    name: 'Assignee + deadline',
    description: 'Who owns it and when it is due — avatar, name, and a date line that reddens when overdue.',
    builtin: true,
    slots: [
      { key: 'Person', label: 'Who to show', types: ['person', 'personMulti'], description: 'A person column' },
      { key: 'Due', label: 'Their deadline', types: ['date'], description: 'A date column' },
    ],
    root: {
      elmType: 'div',
      _elmName: 'Assignee + deadline',
      style: { 'display': 'flex', 'align-items': 'center' },
      children: [
        {
          elmType: 'img',
          _elmName: 'Avatar',
          attributes: { src: "=getUserImage([$Person.email],'S')", title: '=[$Person.title]' },
          style: { 'width': '28px', 'height': '28px', 'border-radius': '50%', 'margin-right': '8px' },
        },
        {
          elmType: 'div',
          style: { 'display': 'flex', 'flex-direction': 'column' },
          children: [
            { elmType: 'span', _elmName: 'Name', txtContent: '[$Person.title]', style: { 'font-size': '13px', 'font-weight': '600' } },
            {
              elmType: 'span', _elmName: 'Due line',
              txtContent: "=if(toString([$Due])=='','no due date',toLocaleDateString([$Due]))",
              style: {
                'font-size': '11px',
                'color': "=if(toString([$Due])!=''&&[$Due]<@now,'#d13438','#605e5c')",
              },
            },
          ],
        },
      ],
    },
  },
  {
    id: 'builtin-progress-owner',
    name: 'Progress with owner',
    description: 'A progress bar with the owner’s avatar riding its end — pairs a number column with a person column.',
    builtin: true,
    slots: [
      { key: 'Progress', label: 'The percentage to chart', types: ['number'], description: 'A number column (0–100)' },
      { key: 'Person', label: 'Whose progress it is', types: ['person', 'personMulti'], description: 'A person column' },
    ],
    root: {
      elmType: 'div',
      _elmName: 'Progress with owner',
      style: { 'display': 'flex', 'align-items': 'center' },
      children: [
        {
          elmType: 'div',
          _elmName: 'Track',
          attributes: { class: 'ms-bgColor-neutralLighter' },
          style: { 'width': '110px', 'border-radius': '3px', 'overflow': 'hidden', 'margin-right': '6px' },
          children: [{
            elmType: 'div',
            _elmName: 'Fill',
            txtContent: "=[$Progress]+'%'",
            style: {
              'width': "=[$Progress]+'%'", 'min-width': '24px',
              'background-color': "=if([$Progress]>=100,'#107c10','#0078d4')",
              'color': '#ffffff', 'font-size': '11px', 'padding': '2px 4px', 'box-sizing': 'border-box',
            },
          }],
        },
        {
          elmType: 'img',
          _elmName: 'Owner avatar',
          attributes: { src: "=getUserImage([$Person.email],'S')", title: '=[$Person.title]' },
          style: { 'width': '22px', 'height': '22px', 'border-radius': '50%' },
        },
      ],
    },
  },
];
