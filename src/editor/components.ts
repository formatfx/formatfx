/**
 * editor/components.ts — the component brain: a COMPONENT is the one unit of
 * packaged formatting (COLUMNS-COMPONENTS-VIEWS model B). Where a column is
 * just data and a view is just layout, a component is UNBOUND formatting — it
 * declares typed SLOTS ("needs a person column, a date column") and binds to
 * a real schema only when a maker adds it and maps their columns in. Pure and
 * node-testable (no DOM/state imports), like gridScaffold/areas/lookDialect.
 *
 * The definition convention: `root` is written against the slot KEYS as field
 * names — `[$Due]` in the tree ⇄ the slot with key 'Due'. Binding = rewriting
 * every `[$Key]` / `[!Key]` reference to the mapped column (the same
 * boundary-aware remap presets.ts uses for schema-aware drop; exported here as
 * `remapFieldRefs` so both share one implementation).
 *
 * Save-as-component derives slots FROM a tree: every referenced field becomes
 * a slot typed by the current schema (widened to its single/multi sibling).
 * Components must be self-contained — imported JSON carrying a
 * columnFormatterReference is refused (§ left the document model; nothing
 * resolves a reference anymore — that content has to be inlined first).
 *
 * Storage: 'wb-components.v1' (ADDITIVE key — the frozen project/prefs keys
 * stay frozen). Built-ins ship in code and are never persisted.
 */

import type { SPElement, MockField, FieldType, FormatterDocument, DocumentKind } from '../core/types';
import { inlineColumnFormatter } from './lookDialect';

export interface ComponentSlot {
  /** The author-side field name used inside `root` (e.g. 'Due' ⇄ `[$Due]`). */
  key: string;
  /** The human ask shown in the mapping dialog, e.g. "The deadline to track". */
  label: string;
  /** Acceptable column types, preference order — the mapping UX filters by these. */
  types: FieldType[];
  description?: string;
}

/**
 * One embedded child component (#225 — composition at the definition layer).
 * The parent def's tree carries a `_embed: ns` placeholder node per record;
 * flattenComponent resolves it against the live library at bind/apply time.
 */
export interface ComponentEmbed {
  /** Slot namespace, unique per parent — the child's unbound slot `Key`
   *  surfaces on the parent as `${ns}_${Key}` (the field-ref grammar has no
   *  dots inside names, so `_` joins the segments). */
  ns: string;
  /** The child def's id, looked up in the library at flatten time. */
  of: string;
  /** The child's name when it was embedded — drives labels and teaching copy
   *  even after the child is renamed or deleted. */
  name: string;
  /** Compose-time bindings: child slot key → a parent-side reference (one of
   *  the parent's own slot keys, or a column name). Bound child slots stay
   *  bound through flatten; UNBOUND ones surface on the parent, namespaced. */
  map?: Record<string, string>;
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
  /** Lineage of an as-found one-off: the parent def this variant was frozen
   *  from ("keep as-found" in the component editor). ADDITIVE — absent on
   *  every pre-variant store (schema stays version 1), and a dangling id
   *  (parent deleted) just renders as a normal top-level card. */
  variantOf?: string;
  /** Components this def EMBEDS (issue #225 — a component reusing another
   *  component). ADDITIVE like variantOf — the store stays version 1 under
   *  the frozen key, pre-nesting builds simply never read it, and a dangling
   *  reference degrades to nothing at flatten time (never an error). */
  embeds?: ComponentEmbed[];
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

/** Whether parsed formatter JSON carries a `columnFormatterReference` key
 *  anywhere. § left the document model, so SPElement can't carry it — but
 *  IMPORTS arrive as arbitrary parsed JSON claiming to be an SPElement, so
 *  the check walks raw objects/arrays for the property key itself. */
export function containsCfr(tree: unknown): boolean {
  if (Array.isArray(tree)) return tree.some(containsCfr);
  if (tree && typeof tree === 'object') {
    if ('columnFormatterReference' in tree) return true;
    return Object.values(tree).some(containsCfr);
  }
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

/** A component the column-apply pickers can offer a `type` column outright:
 *  element-scoped, exactly one slot, and that slot accepts the type.
 *  (Multi-slot components go through the mapping dialog; row components
 *  replace the whole view — both live in the ⬡ library.) */
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

/** The provenance stamp a bound INSTANCE carries on its root (`_component`):
 *  which def it came from and the slot→column mapping it was bound with. The
 *  usage scan (componentUsage.ts) and the component editor both read it. */
export interface ComponentInstanceTag {
  id: string;
  map: Record<string, string>;
}

/** Bind AND stamp: bindComponent plus the `_component: { id, map }` instance
 *  tag the ⬡ inventory scans for. INSERTIONS go through this; previews stay
 *  on plain bindComponent so a rendered preview never reads as a usage. */
export function bindComponentInstance(def: ComponentDef, mapping: Record<string, string>): SPElement {
  const bound = bindComponent(def, mapping);
  bound._component = { id: def.id, map: { ...mapping } };
  return bound;
}

// ─── nesting (issue #225): a component can EMBED another component ──────────
// Composition at the DEFINITION layer. The stored parent keeps a live-ish
// reference (embeds[] + a `_embed` placeholder node in its tree); resolution
// is INLINE-FLATTEN (snapshot): flattenComponent expands the whole nested
// tree into ONE plain, self-contained def at bind/apply time, so what bakes
// onto a column or view — and what ships to SharePoint — is ordinary
// schema-valid JSON with zero runtime dependency. Editing a child updates
// every parent's NEXT bake AND re-bakes their already-applied canvas instances
// LIVE on save (componentEditor's cascadeToEmbedders, keyed on
// transitiveEmbedders — the whole chain, D→A→B, in one undo step). What can't
// be reached is a formatter already exported to a SharePoint list: that's a
// dead copy, not a live link — a CFR-backed LIVE reference (the parent pointing
// at a child column formatter ON THE TENANT via columnFormatterReference) is
// deliberately future work; the owner's call on #225 is snapshot-only there.
//
// Cycle protection replays the CFR registry's author-time pattern: refuse
// A→B→A when the maker tries it (embedRefusal, teaching message), and even a
// hand-corrupted store can never bake a cycle (flattenComponent hard-stops).

/** Nesting guardrail IN ADDITION to cycle detection — a runaway/sanity net, not
 *  a real design limit: deep chains flatten fine (the cycle guard alone already
 *  guarantees termination), so this is set generously far past any hand-built
 *  design. Past it, embedRefusal teaches rather than silently exploding a bake.
 *  (Owner call 2026-07-07: 5 → 20 — "multiple layers, absolutely".) */
export const MAX_COMPONENT_DEPTH = 20;

/** Namespace candidate from a child's name — field-ref-safe ([A-Za-z0-9_])
 *  and deduped against the parent's existing namespaces ("Pill", "Pill2"…). */
export function embedNamespace(childName: string, taken: string[]): string {
  const base = childName.replace(/[^A-Za-z0-9_]/g, '') || 'Part';
  if (!taken.includes(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}${i}`;
    if (!taken.includes(candidate)) return candidate;
  }
}

/** Every def id reachable from `def` through embeds (transitive). The walk
 *  never revisits an id, so even a cyclic (corrupt) store terminates. */
export function embedClosure(def: ComponentDef, defs: ComponentDef[]): Set<string> {
  const seen = new Set<string>();
  const walk = (d: ComponentDef): void => {
    for (const e of d.embeds ?? []) {
      if (seen.has(e.of)) continue;
      seen.add(e.of);
      const child = defs.find((x) => x.id === e.of);
      if (child) walk(child);
    }
  };
  walk(def);
  return seen;
}

/** Nesting depth: 1 for a plain component, 1 + the deepest child chain
 *  otherwise. Cycle-guarded and dangling-tolerant (both stop the walk —
 *  flattenComponent refuses to expand them anyway). */
export function componentDepth(
  def: ComponentDef,
  defs: ComponentDef[],
  seen: ReadonlySet<string> = new Set([def.id]),
): number {
  let depth = 1;
  for (const e of def.embeds ?? []) {
    const child = defs.find((d) => d.id === e.of);
    if (!child || seen.has(child.id)) continue;
    depth = Math.max(depth, 1 + componentDepth(child, defs, new Set([...seen, child.id])));
  }
  return depth;
}

/**
 * Refuse-and-teach gate for embedding `child` into `parent` — null means go.
 * Checked at AUTHOR time (the workshop's Embed button), so a cycle is never
 * even stored; the depth cap is a second, independent guardrail.
 */
export function embedRefusal(parent: ComponentDef, child: ComponentDef, defs: ComponentDef[]): string | null {
  if (parent.id === child.id) {
    return `“${child.name}” can't be embedded inside itself — a component containing itself would expand forever. Save a copy under a new name first if you want a variant to build on.`;
  }
  if (embedClosure(child, defs).has(parent.id)) {
    return `Embedding “${child.name}” here would create a loop — “${child.name}” already uses “${parent.name}” (directly or through another component), so each would expand the other forever. Unwind one side first.`;
  }
  const depth = 1 + componentDepth(child, defs);
  if (depth > MAX_COMPONENT_DEPTH) {
    return `That would nest components ${depth} levels deep — the cap is ${MAX_COMPONENT_DEPTH}, so designs stay readable and bakes stay predictable. Flatten a level first: save the combined design as its own component, then embed that.`;
  }
  return null;
}

/** Embed `child` into `parent` (pure): records the reference and appends the
 *  placeholder node to the parent root's children. Callers gate through
 *  embedRefusal FIRST — this helper trusts them and never re-checks. */
export function withEmbed(parent: ComponentDef, child: ComponentDef): ComponentDef {
  const out = JSON.parse(JSON.stringify(parent)) as ComponentDef;
  const ns = embedNamespace(child.name, (out.embeds ?? []).map((e) => e.ns));
  out.embeds = [...(out.embeds ?? []), { ns, of: child.id, name: child.name }];
  out.root.children = [...(out.root.children ?? []), { elmType: 'div', _embed: ns }];
  return out;
}

/** Remove the `ns` embed from `parent` (pure): the reference record and its
 *  placeholder node(s) both. */
export function withoutEmbed(parent: ComponentDef, ns: string): ComponentDef {
  const out = JSON.parse(JSON.stringify(parent)) as ComponentDef;
  out.embeds = (out.embeds ?? []).filter((e) => e.ns !== ns);
  if (!out.embeds.length) delete out.embeds;
  const strip = (el: SPElement): void => {
    if (el.children) {
      el.children = el.children.filter((c) => c._embed !== ns);
      if (el.children.length) el.children.forEach(strip);
      else delete el.children;
    }
    if (el.customCardProps?.formatter) strip(el.customCardProps.formatter);
  };
  strip(out.root);
  return out;
}

/** The defs whose embeds reference `id` directly — the "used by N components"
 *  blast radius (the CFR subsystem's precedent, kept minimal). */
export function componentsEmbedding(id: string, defs: ComponentDef[]): ComponentDef[] {
  return defs.filter((d) => d.id !== id && (d.embeds ?? []).some((e) => e.of === id));
}

/** Every def that reaches `id` through embeds TRANSITIVELY, self excluded —
 *  the full in-app blast radius a child edit must re-bake (D→A→B: saving B
 *  refreshes A's AND D's live instances, not just A's). `componentsEmbedding`
 *  is the direct-only sibling (delete guard, "used by N" line); this follows
 *  the whole chain. Leans on embedClosure, which is cycle- and dangling-safe,
 *  so it terminates on any store — including a hand-corrupted cyclic one.
 *  O(N·(N+E)) by reusing embedClosure per def, but N is hard-bounded by
 *  COMPONENT_CAP (50) and this runs once per save gesture, so a reverse-graph
 *  walk isn't worth trading the one-liner's obvious correctness for. */
export function transitiveEmbedders(id: string, defs: ComponentDef[]): ComponentDef[] {
  return defs.filter((d) => d.id !== id && embedClosure(d, defs).has(id));
}

/**
 * INLINE-FLATTEN a def: expand every embedded child (recursively) into ONE
 * plain self-contained def — the shape everything downstream already speaks
 * (bestGuessMapping / bindComponent / the mapper / the usage scan). A def
 * without embeds returns AS-IS (identity), so pre-nesting behavior is
 * bit-identical.
 *
 * Per embed: the child is flattened first, its BOUND slots (embed.map)
 * rewrite straight to their parent-side target, its UNBOUND slots surface on
 * the parent as `${ns}_${key}` (auto-namespaced — collision-proof even for
 * two embeds of the same child), and the remapped tree replaces the `_embed`
 * placeholder. Defense in depth: a cyclic, over-deep or dangling reference
 * (only a hand-edited store can hold one — embedRefusal blocks them at
 * author time) is NEVER expanded; its placeholder simply drops out, so a
 * cycle cannot bake and the output is always schema-valid.
 */
export function flattenComponent(def: ComponentDef, defs: ComponentDef[]): ComponentDef {
  return flattenInto(def, defs, new Set([def.id]), 1);
}

function flattenInto(
  def: ComponentDef,
  defs: ComponentDef[],
  stack: ReadonlySet<string>,
  depth: number,
): ComponentDef {
  if (!def.embeds?.length) return def;
  const slots = def.slots.map((s) => ({ ...s }));
  const grafts = new Map<string, SPElement>();
  for (const embed of def.embeds) {
    const child = defs.find((d) => d.id === embed.of);
    // never expand a cycle, past the cap, or a deleted child — the
    // placeholder drops out below and everything else still bakes
    if (!child || stack.has(child.id) || depth >= MAX_COMPONENT_DEPTH) continue;
    const flat = flattenInto(child, defs, new Set([...stack, child.id]), depth + 1);
    const replacements = new Map<string, string>();
    for (const s of flat.slots) {
      const bound = embed.map?.[s.key];
      if (bound) {
        // bound child slots stay bound — no surfaced slot, just the rewrite
        if (bound !== s.key) replacements.set(s.key, bound);
        continue;
      }
      const key = `${embed.ns}_${s.key}`;
      if (key !== s.key) replacements.set(s.key, key);
      slots.push({ ...s, key, label: `${embed.name} · ${s.label}` });
    }
    const graft = remapFieldRefs(flat.root, replacements);
    graft._elmName = graft._elmName ?? embed.name;
    grafts.set(embed.ns, graft);
  }
  const walk = (el: SPElement): SPElement | null => {
    if (el._embed !== undefined) {
      const graft = grafts.get(el._embed);
      return graft ? (JSON.parse(JSON.stringify(graft)) as SPElement) : null;
    }
    const out: SPElement = { ...el };
    if (el.children) {
      out.children = el.children.map(walk).filter((c): c is SPElement => c !== null);
    }
    if (el.customCardProps?.formatter) {
      const inner = walk(el.customCardProps.formatter);
      out.customCardProps = { ...el.customCardProps, formatter: inner ?? { elmType: 'div' } };
    }
    return out;
  };
  const root = walk(JSON.parse(JSON.stringify(def.root)) as SPElement) ?? { elmType: 'div' };
  const out: ComponentDef = { ...def, slots, root };
  delete out.embeds;
  return out;
}

// ─── context-aware insertion (where does "Add" land?) ────────────────────────

/**
 * The destination for an element-component insert: always the ACTIVE VIEW —
 * on the grid it arrives as a new root column, elsewhere at the selection.
 * (Applying a component TO a column is a different gesture entirely:
 * state.applyComponentToColumn, via the mapper's applyToColumn mode.)
 * Pure so the dialog copy and the insert itself share one truth.
 */
export function componentInsertTarget(docKind: DocumentKind): { grid: boolean } {
  return { grid: docKind === 'grid' };
}

// ─── persistence (caller owns localStorage, same split as snapshots) ─────────

function isValidSlot(s: unknown): s is ComponentSlot {
  return Boolean(s && typeof s === 'object'
    && typeof (s as ComponentSlot).key === 'string' && (s as ComponentSlot).key.length > 0
    && typeof (s as ComponentSlot).label === 'string'
    && Array.isArray((s as ComponentSlot).types) && (s as ComponentSlot).types.length > 0);
}

function isValidEmbed(e: unknown): e is ComponentEmbed {
  if (!e || typeof e !== 'object') return false;
  const o = e as ComponentEmbed;
  return typeof o.ns === 'string' && /^[A-Za-z0-9_]+$/.test(o.ns)
    && typeof o.of === 'string' && o.of.length > 0
    && typeof o.name === 'string'
    && (o.map === undefined || (!!o.map && typeof o.map === 'object' && !Array.isArray(o.map)
      && Object.values(o.map).every((v) => typeof v === 'string')));
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

/** Parse the persisted custom components; corrupt/foreign entries are dropped,
 *  and a corrupt OPTIONAL field (a non-string additionalRowClass, or one on a
 *  non-row component) is stripped rather than sinking the whole entry — it
 *  would otherwise flow into viewExtras on apply. */
export function loadComponents(raw: string | null): ComponentDef[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || !Array.isArray(parsed.components)) return [];
    return (parsed.components as unknown[]).filter(isValidDef).map((c) => {
      const def: ComponentDef = { ...c, builtin: false };
      if (def.additionalRowClass !== undefined
        && (typeof def.additionalRowClass !== 'string' || componentKind(def) !== 'row')) {
        delete def.additionalRowClass;
      }
      // variantOf is optional lineage — strip a corrupt (non-string) value
      // rather than sinking the entry; pre-variant stores simply lack it
      if (def.variantOf !== undefined && typeof def.variantOf !== 'string') {
        delete def.variantOf;
      }
      // embeds (#225) is optional nesting — ADDITIVE like variantOf. Corrupt
      // records drop one by one (an orphaned placeholder just falls out at
      // flatten time); a non-array field strips whole. Pre-nesting stores
      // simply lack it and load exactly as before.
      if (def.embeds !== undefined) {
        if (Array.isArray(def.embeds)) {
          def.embeds = (def.embeds as unknown[]).filter(isValidEmbed);
          if (!def.embeds.length) delete def.embeds;
        } else {
          delete def.embeds;
        }
      }
      return def;
    });
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

// ─── the component editor brain: variants, re-binding, restamping ───────────
// Pure helpers behind componentEditor.ts's Save-and-apply: freeze the OLD
// recipe as a one-off variant for pinned ("keep as-found") usages, re-bind
// every unpinned instance with its OWN stored slot map, and restamp pinned
// instances onto the variant — all composed into ONE undoable state step by
// state.batchProjectUpdate.

/** `base`, made unique against `taken` (case-insensitive) with " 2", " 3", … */
export function uniqueName(base: string, taken: string[]): string {
  const has = (n: string): boolean => taken.some((t) => t.toLowerCase() === n.toLowerCase());
  if (!has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base} ${i}`;
    if (!has(candidate)) return candidate;
  }
}

/** The dated as-found name: `"<Name> (as-found 2026-07-03)"`, counter-deduped. */
export function variantName(base: string, taken: string[], now: Date): string {
  return uniqueName(`${base} (as-found ${now.toISOString().slice(0, 10)})`, taken);
}

/** Freeze `oldDef`'s CURRENT recipe as a one-off variant (the "keep as-found"
 *  flow): a normal custom def carrying `variantOf` lineage. Pure — deep-clones,
 *  never mutates `oldDef`. */
export function createVariant(oldDef: ComponentDef, id: string, takenNames: string[], now: Date): ComponentDef {
  const clone = JSON.parse(JSON.stringify(oldDef)) as ComponentDef;
  delete clone.builtin;
  return { ...clone, id, name: variantName(oldDef.name, takenNames, now), variantOf: oldDef.id };
}

/**
 * Re-bind a stamped INSTANCE to a (new) recipe using ITS OWN stored slot map —
 * the save-and-apply re-bake. Preserves the maker's rename (an `_elmName` that
 * differs from the name the old def gave it) and the instance's grid-layout
 * artifacts (flex/min-width — the grid-cell convention). Returns null for an
 * unstamped element (nothing to re-bind). Pure.
 */
export function rebindInstance(def: ComponentDef, el: SPElement, oldDefName: string): SPElement | null {
  const tag = el._component;
  if (!tag) return null;
  const next = bindComponentInstance(def, tag.map);
  if (el._elmName && el._elmName !== oldDefName) next._elmName = el._elmName;
  for (const prop of ['flex', 'min-width']) {
    const v = el.style?.[prop];
    if (v !== undefined && next.style?.[prop] === undefined) {
      next.style = { ...next.style, [prop]: v };
    }
  }
  return next;
}

/** Deep-map a tree, substituting every subtree stamped with `id` via `make`
 *  (children and card content included; substitutes aren't re-walked — a fresh
 *  bind carries no nested stamps). Pure — returns a new tree. */
export function replaceStampedIn(tree: SPElement, id: string, make: (el: SPElement) => SPElement): SPElement {
  const walk = (el: SPElement): SPElement => {
    if (el._component?.id === id) return make(el);
    const out: SPElement = { ...el };
    if (el.children) out.children = el.children.map(walk);
    if (el.customCardProps?.formatter) {
      out.customCardProps = { ...el.customCardProps, formatter: walk(el.customCardProps.formatter) };
    }
    return out;
  };
  return walk(JSON.parse(JSON.stringify(tree)) as SPElement);
}

/** Restamp every `_component.id` `from` → `to` in a tree (pinning instances
 *  onto their as-found variant). Pure — returns a new tree. */
export function restampIn(tree: SPElement, from: string, to: string): SPElement {
  const clone = JSON.parse(JSON.stringify(tree)) as SPElement;
  const walk = (el: SPElement): void => {
    if (el._component?.id === from) el._component = { ...el._component, id: to };
    el.children?.forEach(walk);
    if (el.customCardProps?.formatter) walk(el.customCardProps.formatter);
  };
  walk(clone);
  return clone;
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
