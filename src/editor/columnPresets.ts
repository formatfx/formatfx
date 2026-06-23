/**
 * editor/columnPresets.ts — "Format this column" → a type-aware preset picker.
 *
 * When a maker formats a column, the system should think for them: a people
 * column offers Facepile, a number offers a data bar, a choice offers a status
 * pill — then "format manually" as the escape hatch. This module is the pure,
 * node-tested brain (no DOM/state): it maps a field type to the palette presets
 * that fit it, and turns a chosen preset into a real COLUMN formatter
 * (primary field → @currentField), bound to the actual column.
 */

import type { SPElement, MockField, FieldType } from '../core/types';
import { paletteItemById } from './palette';
import { toColumnFormatter } from './cfr';
import { fieldLabel } from './gridScaffold';

/** A palette preset that fits a field type, plus the default field it's authored against. */
interface PresetRef { id: string; primaryField: string; }

/**
 * Confident type → preset matches only (refuse-don't-guess: a preset shows up
 * for a column ONLY if it genuinely fits, so a misclick can't produce a broken
 * formatter). Presets are authored against the default showcase fields; the
 * primaryField is the one rebound to the chosen column and folded into
 * @currentField.
 */
const BY_TYPE: Partial<Record<FieldType, PresetRef[]>> = {
  person: [{ id: 'persona', primaryField: 'Owner' }],
  personMulti: [
    { id: 'facepile', primaryField: 'AssignedTo' },
    { id: 'member-count', primaryField: 'AssignedTo' },
  ],
  choice: [
    { id: 'status-pill', primaryField: 'Status' },
    { id: 'traffic-light', primaryField: 'Status' },
    { id: 'severity-class', primaryField: 'Status' },
  ],
  number: [
    { id: 'data-bar', primaryField: 'Progress' },
    { id: 'progress-ring', primaryField: 'Progress' },
    { id: 'star-rating', primaryField: 'Progress' },
  ],
  currency: [{ id: 'data-bar', primaryField: 'Progress' }],
  date: [
    { id: 'date-badge', primaryField: 'DueDate' },
    { id: 'day-counter', primaryField: 'DueDate' },
  ],
  lookup: [{ id: 'lookup-chip', primaryField: 'Project' }],
  lookupMulti: [{ id: 'lookup-chip', primaryField: 'Project' }],
  hyperlink: [{ id: 'link', primaryField: 'Link' }],
};

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Deep-clone a tree, rewriting every string value with `fn`. */
function mapStrings(tree: SPElement, fn: (s: string) => string): SPElement {
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') return fn(node);
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) out[k] = walk(v);
      return out;
    }
    return node;
  };
  return walk(JSON.parse(JSON.stringify(tree))) as SPElement;
}

/** Rebind a preset's primary default field to the chosen column (boundary-safe,
 *  matching [$Field] / [$Field.prop] / [!Field.DisplayName] like presets.ts). */
function rebindField(tree: SPElement, from: string, to: string): SPElement {
  if (from === to) return tree;
  const re = new RegExp(`\\[(\\$|!)${escapeRegExp(from)}(?=[\\].])`, 'g');
  return mapStrings(tree, (s) => s.replace(re, `[$1${to}`));
}

/**
 * Build a COLUMN formatter for `field` from a palette preset: rebind the
 * preset's primary field to this column, then fold that field into
 * @currentField (toColumnFormatter), and name it. Returns null for an unknown
 * preset / type mismatch. Secondary field references (e.g. the date badge's
 * [$Status] highlight) are left intact — valid in a column formatter.
 */
export function buildColumnPreset(presetId: string, field: MockField): SPElement | null {
  const ref = (BY_TYPE[field.type] ?? []).find((r) => r.id === presetId);
  const item = paletteItemById(presetId);
  if (!ref || !item) return null;
  const rebound = rebindField(item.create(), ref.primaryField, field.name);
  const tree = toColumnFormatter(rebound, field.name);
  tree._elmName = `${fieldLabel(field)} — ${item.label}`;
  return tree;
}

/** A built-in subtype seed derived from a palette column preset. */
export interface PresetSeed {
  id: string;
  label: string;
  baseTypes: FieldType[];
  formatter: SPElement;
}

/**
 * The palette column presets re-expressed as built-in subtype seeds — the
 * source of the built-in seed catalog (editor/subtypes wraps these into
 * `Subtype`s). BY_TYPE is inverted: each preset becomes ONE @currentField
 * column formatter tagged with the full set of field types it fits, built
 * against its natural representative field so the fold-to-@currentField is a
 * no-op rebind. Each preset appears once even when it fits several types.
 */
export function presetSeeds(): PresetSeed[] {
  const acc = new Map<string, { baseTypes: FieldType[]; type: FieldType; primaryField: string }>();
  for (const [type, refs] of Object.entries(BY_TYPE) as [FieldType, PresetRef[] | undefined][]) {
    for (const ref of refs ?? []) {
      const cur = acc.get(ref.id);
      if (cur) { if (!cur.baseTypes.includes(type)) cur.baseTypes.push(type); }
      else acc.set(ref.id, { baseTypes: [type], type, primaryField: ref.primaryField });
    }
  }
  const seeds: PresetSeed[] = [];
  for (const [id, info] of acc) {
    const item = paletteItemById(id);
    const formatter = buildColumnPreset(id, { name: info.primaryField, type: info.type });
    if (!item || !formatter) continue;
    formatter._elmName = item.label; // generic seed name; apply re-names per column
    seeds.push({ id, label: item.label, baseTypes: info.baseTypes, formatter });
  }
  return seeds;
}
