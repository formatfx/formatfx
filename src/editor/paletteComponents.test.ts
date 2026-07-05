/**
 * Palette-derived components (owner brief 2026-07-05) — canonical trees,
 * slots typed by AUTHORED INTENT, and the same definitely-renders bar as the
 * hand-written built-ins (components.test.ts): every offered preset
 * best-guess binds to the default schema and renders every mock row through
 * the real engine with zero runtime issues, and never carries a standalone `!`.
 */
import { describe, it, expect } from 'vitest';
import { paletteComponents, paletteComponentId } from './paletteComponents';
import { bestGuessMapping, mappingComplete, bindComponent } from './components';
import { defaultFields, defaultRows } from './state';
import { renderElement, type RenderIssue } from '../core/renderer';
import type { EvalContext } from '../core/expressions';

const ctx = (rowIndex: number): EvalContext => ({
  row: defaultRows()[rowIndex],
  rowIndex,
  currentFieldName: 'Status',
  me: { title: 'Sandbox User', email: 'me@contoso.com' },
  iterators: {},
  iteratorIndex: {},
  displayNames: {},
  now: new Date(),
});

describe('paletteComponents: derivation', () => {
  it('offers the field-bound looks, not the primitives or layout shells', () => {
    const defs = paletteComponents();
    expect(defs.length).toBeGreaterThan(0);
    const ids = defs.map((d) => d.id);
    expect(ids).toContain(paletteComponentId('status-pill'));
    expect(ids).toContain(paletteComponentId('facepile'));
    expect(ids).not.toContain(paletteComponentId('div'));       // Primitives → draw toolbar
    expect(ids).not.toContain(paletteComponentId('text'));
    expect(ids).not.toContain(paletteComponentId('row-card'));  // Layout Shells → builder
    for (const def of defs) {
      expect(def.builtin).toBe(true);      // never persisted, never deletable
      expect(def.slots.length).toBeGreaterThan(0);
      expect(def.name).toBeTruthy();
    }
  });

  it('slots carry the AUTHORED intent — a due-date badge asks for a date column, schema-independent', () => {
    const defs = paletteComponents();
    const badge = defs.find((d) => d.id === paletteComponentId('date-badge'))!;
    expect(badge.slots.find((s) => s.key === 'DueDate')!.types).toEqual(['date']);
    const pill = defs.find((d) => d.id === paletteComponentId('status-pill'))!;
    const statusTypes = pill.slots.find((s) => s.key === 'Status')!.types;
    expect(statusTypes).toContain('choice'); // the authored preference…
    expect(statusTypes).toContain('text');   // …and its authored fallback, widened
    const faces = defs.find((d) => d.id === paletteComponentId('facepile'))!;
    expect(faces.slots.find((s) => s.key === 'AssignedTo')!.types).toEqual(['personMulti', 'person']);
  });

  it('memoized pure constants — two calls return the same defs', () => {
    expect(paletteComponents()).toBe(paletteComponents());
  });
});

describe('paletteComponents definitely render (the generated-formatter bar)', () => {
  for (const def of paletteComponents()) {
    it(`${def.name}: best-guess binds to the default schema and renders every mock row cleanly`, () => {
      const mapping = bestGuessMapping(def, defaultFields());
      expect(mappingComplete(def, mapping)).toBe(true);
      const bound = bindComponent(def, mapping);
      for (let i = 0; i < defaultRows().length; i++) {
        const issues: RenderIssue[] = [];
        const el = renderElement(bound, ctx(i), { issues });
        expect(el).toBeTruthy();
        expect(issues).toEqual([]); // definitely-works: not one runtime complaint
      }
    });

    it(`${def.name}: never emits a standalone ! (no logical NOT in SP)`, () => {
      const json = JSON.stringify(def.root);
      // `!=` is fine; a bare `!` (prefix negation) must never appear
      expect(json.replace(/!=/g, '').replace(/\[!/g, '')).not.toContain('!');
    });
  }
});
