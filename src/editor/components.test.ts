/**
 * components.ts is the contract for "formatting without a column to call
 * home": boundary-aware slot binding, slot derivation from a subtree, the
 * best-guess mapping, store round-trips, and — most load-bearing — that every
 * BUILT-IN component binds to the default schema and renders through the real
 * engine without a single runtime issue (built-ins must definitely-work, the
 * same bar as generated formatters).
 */
import { describe, it, expect } from 'vitest';
import {
  remapFieldRefs, fieldRefsIn, containsCfr, deriveSlots, widenType,
  bestGuessMapping, mappingComplete, bindComponent, bindComponentInstance,
  componentInsertTarget, isSingleColumnComponent,
  loadComponents, serializeComponents, addComponent, removeComponent, componentId,
  componentKind, componentFromFormatterDoc, ALL_FIELD_TYPES,
  BUILTIN_COMPONENTS, COMPONENT_CAP,
  uniqueName, variantName, createVariant, rebindInstance, replaceStampedIn, restampIn,
  type ComponentDef,
} from './components';
import { scanComponentUsages, mainUsageLabel } from './componentUsage';
import { importJson } from '../core/serializer';
import { bindFragmentToSchema } from './presets';
import { renderElement, type RenderIssue } from '../core/renderer';
import { defaultFields, defaultRows, state } from './state';
import type { SPElement, MockField } from '../core/types';
import type { EvalContext } from '../core/expressions';

const DEF: ComponentDef = {
  id: 'c-test', name: 'Test comp', description: 't', slots: [
    { key: 'Due', label: 'Due', types: ['date'] },
    { key: 'Person', label: 'Person', types: ['person', 'personMulti'] },
  ],
  root: {
    elmType: 'div',
    txtContent: "=if([$Due]<@now,'late','ok')",
    style: { color: '=[$Person.title]' },
    children: [{ elmType: 'span', txtContent: '[$Due]' }],
  },
};

describe('field-ref remap + scan', () => {
  it('remaps [$X]/[!X] with honest boundaries ([$Due] never matches [$DueDate])', () => {
    const tree: SPElement = {
      elmType: 'div',
      txtContent: "=[$Due]+' '+[$DueDate]+' '+[!Due.DisplayName]",
      attributes: { title: '=[$Due.prop]' },
      forEach: '_x in [$Due]',
    };
    const out = remapFieldRefs(tree, new Map([['Due', 'Deadline']]));
    expect(out.txtContent).toBe("=[$Deadline]+' '+[$DueDate]+' '+[!Deadline.DisplayName]");
    expect(out.attributes?.title).toBe('=[$Deadline.prop]');
    expect(out.forEach).toBe('_x in [$Deadline]');
    // the input tree is untouched (deep-clone contract)
    expect(tree.txtContent).toContain('[$Due]');
  });

  it('never cascades: chains ({Start→End, End→Finish}) and swaps ({A→B, B→A}) rewrite each ref once', () => {
    const chain = remapFieldRefs(
      { elmType: 'div', txtContent: '=[$Start]+[$End]' },
      new Map([['Start', 'End'], ['End', 'Finish']]),
    );
    expect(chain.txtContent).toBe('=[$End]+[$Finish]'); // Start→End stops there
    const swap = remapFieldRefs(
      { elmType: 'div', txtContent: '=[$A]+[$B]' },
      new Map([['A', 'B'], ['B', 'A']]),
    );
    expect(swap.txtContent).toBe('=[$B]+[$A]');
  });

  it('collects unique referenced fields, dotted and bang forms included', () => {
    expect(fieldRefsIn(DEF.root).sort()).toEqual(['Due', 'Person']);
  });

  it('spots a columnFormatterReference anywhere in a subtree', () => {
    expect(containsCfr(DEF.root)).toBe(false);
    expect(containsCfr({
      elmType: 'div',
      children: [{ elmType: 'div', columnFormatterReference: '[$Status]' }],
    })).toBe(true);
  });
});

describe('slots: derive, best-guess, bind', () => {
  it('derives typed slots from a tree against a schema, widened to single/multi siblings', () => {
    const slots = deriveSlots(
      { elmType: 'div', txtContent: '=[$Owner.title]+[$Mystery]' },
      defaultFields(),
    );
    const owner = slots.find((s) => s.key === 'Owner')!;
    expect(owner.types).toEqual(['person', 'personMulti']);
    // a name the schema doesn't know falls back to text
    expect(slots.find((s) => s.key === 'Mystery')!.types).toEqual(['text', 'note']);
    expect(widenType('date')).toEqual(['date']);
  });

  it('best-guess prefers an exact name match, then unclaimed fields of the right type', () => {
    const mapping = bestGuessMapping(DEF, defaultFields());
    expect(mapping['Due']).toBe('DueDate');    // only date column
    expect(mapping['Person']).toBe('AssignedTo'); // first person-typed, Owner left for later slots
    expect(mappingComplete(DEF, mapping)).toBe(true);
    // no acceptable column → '' and incomplete
    const noDates = defaultFields().filter((f) => f.type !== 'date');
    const m2 = bestGuessMapping(DEF, noDates);
    expect(m2['Due']).toBe('');
    expect(mappingComplete(DEF, m2)).toBe(false);
  });

  it('bind rewrites every slot to its mapped column and stamps the name', () => {
    const bound = bindComponent(DEF, { Due: 'DueDate', Person: 'Owner' });
    expect(bound.txtContent).toBe("=if([$DueDate]<@now,'late','ok')");
    expect(bound.style?.color).toBe('=[$Owner.title]');
    expect(bound.children?.[0].txtContent).toBe('[$DueDate]');
    expect(bound._elmName).toBe('Test comp');
  });

  it('presets schema-aware drop still rides the same remap (shared implementation)', () => {
    const fields = defaultFields().filter((f) => f.name !== 'Status')
      .concat([{ name: 'Phase', type: 'choice', choices: ['A'] }]);
    const bound = bindFragmentToSchema({ elmType: 'div', txtContent: '=[$Status]' }, fields);
    expect(bound.txtContent).toBe('=[$Phase]');
  });
});

describe('store round trip', () => {
  it('serializes custom components only, tolerates corrupt raw, evicts past the cap', () => {
    let list = loadComponents(null);
    list = addComponent(list, { ...DEF, id: componentId(new Date()) });
    const raw = serializeComponents([...list, { ...BUILTIN_COMPONENTS[0] }]);
    const back = loadComponents(raw);
    expect(back).toHaveLength(1); // the builtin was not persisted
    expect(back[0].name).toBe('Test comp');
    expect(loadComponents('{nope').length).toBe(0);
    expect(loadComponents(JSON.stringify({ version: 1, components: [{ junk: 1 }] })).length).toBe(0);
    // cap: oldest evicted
    let many: ComponentDef[] = [];
    for (let i = 0; i < COMPONENT_CAP + 3; i++) many = addComponent(many, { ...DEF, id: `c-${i}` });
    expect(many).toHaveLength(COMPONENT_CAP);
    expect(many[0].id).toBe('c-3');
    expect(removeComponent(many, 'c-3')).toHaveLength(COMPONENT_CAP - 1);
  });
});

describe('catalog fit + legacy subtype migration', () => {
  it('isSingleColumnComponent: one slot of the right type; multi-slot never fits a column', () => {
    const single: ComponentDef = { ...DEF, slots: [{ key: 'Due', label: 'Due', types: ['date'] }] };
    expect(isSingleColumnComponent(single, 'date')).toBe(true);
    expect(isSingleColumnComponent(single, 'text')).toBe(false);
    expect(isSingleColumnComponent(DEF, 'date')).toBe(false); // two slots
  });

  it('customComponents() swallows legacy wb-subtypes customs as single-slot components (once)', async () => {
    const { customComponents } = await import('./componentLibrary');
    localStorage.clear();
    localStorage.setItem('wb-subtypes', JSON.stringify({
      version: 1,
      subtypes: [{
        id: 'legacy-1', name: 'My Due Look', origin: 'custom', baseTypes: ['date'],
        formatter: { elmType: 'div', txtContent: '=toLocaleDateString(@currentField)' },
        knobs: [], vocab: { refs: ['@currentField'], values: [] },
      }],
    }));
    const migrated = customComponents();
    expect(migrated).toHaveLength(1);
    expect(migrated[0].name).toBe('My Due Look');
    expect(migrated[0].slots).toEqual([{ key: 'Column', label: 'The column to format', types: ['date'] }]);
    // @currentField became the slot reference, so binding works like any component
    expect(migrated[0].root.txtContent).toBe('=toLocaleDateString([$Column])');
    // the legacy key is untouched (rollback path); re-reads don't duplicate
    expect(localStorage.getItem('wb-subtypes')).toContain('legacy-1');
    expect(customComponents()).toHaveLength(1);
    localStorage.clear();
  });
});

describe('row components + the formatter-JSON import bridge', () => {
  it('a column formatter JSON becomes an element component: @currentField → an any-type Column slot', () => {
    const doc = importJson(JSON.stringify({
      elmType: 'div',
      txtContent: "=if(@currentField>50,'hi','lo')",
      style: { color: '=[$Owner.title]' },
    }));
    const def = componentFromFormatterDoc(doc, 'Imported look', defaultFields(), 'c-x');
    expect(componentKind(def)).toBe('element');
    expect(def.root.txtContent).toBe("=if([$Column]>50,'hi','lo')");
    const col = def.slots.find((s) => s.key === 'Column')!;
    expect(col.types).toEqual(ALL_FIELD_TYPES); // author's intent unknowable from JSON
    // a secondary ref the CURRENT schema knows gets typed from it
    expect(def.slots.find((s) => s.key === 'Owner')!.types).toEqual(['person', 'personMulti']);
  });

  it('a rowFormatter JSON becomes a row component, keeping additionalRowClass', () => {
    const doc = importJson(JSON.stringify({
      rowFormatter: { elmType: 'div', children: [{ elmType: 'span', txtContent: '[$Mystery]' }] },
      additionalRowClass: "=if(@rowIndex%2==0,'ms-bgColor-neutralLighter','')",
    }));
    const def = componentFromFormatterDoc(doc, 'Row shape', defaultFields(), 'c-y');
    expect(componentKind(def)).toBe('row');
    expect(def.additionalRowClass).toContain('@rowIndex');
    // a ref no schema knows gets the every-type slot (map anything in)
    expect(def.slots[0]).toMatchObject({ key: 'Mystery', types: ALL_FIELD_TYPES });
    // row components never qualify for the one-click column catalog
    expect(isSingleColumnComponent(def, 'text')).toBe(false);
  });

  it('refuses tiles and CFR-carrying trees with teaching errors', () => {
    const tile = importJson(JSON.stringify({ formatter: { elmType: 'div' }, width: 254 }));
    expect(() => componentFromFormatterDoc(tile, 'T', defaultFields(), 'c-t')).toThrow(/Tile formatters/);
    const cfr = importJson(JSON.stringify({
      rowFormatter: { elmType: 'div', children: [{ elmType: 'div', columnFormatterReference: '[$Status]' }] },
    }));
    expect(() => componentFromFormatterDoc(cfr, 'C', defaultFields(), 'c-c')).toThrow(/self-contained/);
  });

  it('row kind round-trips the store; invalid kinds are dropped', () => {
    const doc = importJson(JSON.stringify({ rowFormatter: { elmType: 'div' } }));
    const def = componentFromFormatterDoc(doc, 'R', defaultFields(), 'c-r');
    const back = loadComponents(serializeComponents([def]));
    expect(back).toHaveLength(1);
    expect(componentKind(back[0])).toBe('row');
    const bad = JSON.stringify({ version: 1, components: [{ ...def, kind: 'galaxy' }] });
    expect(loadComponents(bad)).toHaveLength(0);
  });

  it('strips a corrupt or misplaced additionalRowClass instead of applying it', () => {
    const doc = importJson(JSON.stringify({ rowFormatter: { elmType: 'div' } }));
    const row = componentFromFormatterDoc(doc, 'R', defaultFields(), 'c-r2');
    // corrupt value on a row component → stripped, entry kept
    const corrupt = loadComponents(JSON.stringify({
      version: 1, components: [{ ...row, additionalRowClass: { evil: true } }],
    }));
    expect(corrupt).toHaveLength(1);
    expect(corrupt[0].additionalRowClass).toBeUndefined();
    // a string value on a NON-row component makes no sense → stripped too
    const misplaced = loadComponents(JSON.stringify({
      version: 1, components: [{ ...DEF, id: 'c-e', additionalRowClass: 'zebra' }],
    }));
    expect(misplaced[0].additionalRowClass).toBeUndefined();
    // a legitimate string on a row component survives
    const good = loadComponents(JSON.stringify({
      version: 1, components: [{ ...row, additionalRowClass: 'zebra' }],
    }));
    expect(good[0].additionalRowClass).toBe('zebra');
  });
});

describe('the component editor brain: variants, re-binding, restamping', () => {
  const NOW = new Date('2026-07-03T12:00:00Z');

  it('uniqueName / variantName: dated as-found names, counter-deduped case-insensitively', () => {
    expect(uniqueName('X', ['Y'])).toBe('X');
    expect(uniqueName('X', ['x'])).toBe('X 2');
    expect(uniqueName('X', ['x', 'X 2'])).toBe('X 3');
    expect(variantName('Chip', [], NOW)).toBe('Chip (as-found 2026-07-03)');
    expect(variantName('Chip', ['Chip (as-found 2026-07-03)'], NOW)).toBe('Chip (as-found 2026-07-03) 2');
  });

  it('createVariant freezes the OLD recipe with lineage — pure, builtin stripped', () => {
    const parent: ComponentDef = { ...DEF, builtin: true };
    const v = createVariant(parent, 'c-v1', [], NOW);
    expect(v.variantOf).toBe('c-test');
    expect(v.id).toBe('c-v1');
    expect(v.name).toBe('Test comp (as-found 2026-07-03)');
    expect(v.builtin).toBeUndefined();
    expect(v.root).toEqual(DEF.root);
    // deep-cloned: mutating the variant never touches the parent recipe
    v.root.txtContent = 'MUTATED';
    expect(parent.root.txtContent).toBe(DEF.root.txtContent);
    expect(parent.builtin).toBe(true);
  });

  it('variantOf round-trips the store; a corrupt (non-string) value is stripped, old stores load unchanged', () => {
    const v = createVariant(DEF, 'c-v2', [], NOW);
    const back = loadComponents(serializeComponents([v]));
    expect(back[0].variantOf).toBe('c-test');
    // corrupt lineage strips without sinking the entry (schema stays v1)
    const corrupt = loadComponents(JSON.stringify({ version: 1, components: [{ ...v, variantOf: 7 }] }));
    expect(corrupt).toHaveLength(1);
    expect(corrupt[0].variantOf).toBeUndefined();
    // a pre-variant store (no variantOf anywhere) loads exactly as before
    const old = loadComponents(JSON.stringify({ version: 1, components: [DEF] }));
    expect(old).toHaveLength(1);
    expect(old[0].variantOf).toBeUndefined();
  });

  it('rebindInstance re-bakes with the instance\'s OWN map; preserves renames + grid layout artifacts', () => {
    const newDef: ComponentDef = {
      ...DEF,
      root: { elmType: 'div', txtContent: '=[$Due]', style: { 'font-weight': '600' } },
    };
    const instance: SPElement = {
      elmType: 'div',
      _elmName: 'Test comp', // NOT renamed (it wears the old def name)
      _component: { id: 'c-test', map: { Due: 'DueDate', Person: 'Owner' } },
      style: { 'flex': '2', 'min-width': '0', 'color': 'red' },
    };
    const out = rebindInstance(newDef, instance, 'Test comp')!;
    expect(out.txtContent).toBe('=[$DueDate]'); // bound with the stored map
    expect(out._component).toEqual({ id: 'c-test', map: { Due: 'DueDate', Person: 'Owner' } });
    expect(out._elmName).toBe('Test comp'); // un-renamed → the def's own naming
    // grid-layout artifacts survive; the OLD look (color) does not
    expect(out.style?.['flex']).toBe('2');
    expect(out.style?.['min-width']).toBe('0');
    expect(out.style?.['color']).toBeUndefined();
    // a maker's rename is preserved verbatim
    const renamed = rebindInstance(newDef, { ...instance, _elmName: 'My deadline' }, 'Test comp')!;
    expect(renamed._elmName).toBe('My deadline');
    // purity: the instance was not mutated
    expect(instance.txtContent).toBeUndefined();
    // unstamped elements have nothing to re-bind
    expect(rebindInstance(newDef, { elmType: 'div' }, 'Test comp')).toBeNull();
  });

  it('replaceStampedIn substitutes stamped subtrees (children + card content) and stays pure', () => {
    const stamped: SPElement = { elmType: 'div', _component: { id: 'c-test', map: {} } };
    const tree: SPElement = {
      elmType: 'div',
      children: [
        { elmType: 'span' },
        stamped,
        { elmType: 'div', customCardProps: { formatter: { ...stamped }, openOnEvent: 'hover' } },
      ],
    };
    const out = replaceStampedIn(tree, 'c-test', () => ({ elmType: 'span', txtContent: 'NEW' }));
    expect(out.children?.[1].txtContent).toBe('NEW');
    expect(out.children?.[2].customCardProps?.formatter.txtContent).toBe('NEW');
    expect(out.children?.[0].txtContent).toBeUndefined();
    expect(tree.children?.[1]._component?.id).toBe('c-test'); // input untouched
    // other ids untouched
    const other = replaceStampedIn(tree, 'c-else', () => ({ elmType: 'span' }));
    expect(other.children?.[1]._component?.id).toBe('c-test');
  });

  it('restampIn moves every matching stamp to the variant id (pinning), purely', () => {
    const tree: SPElement = {
      elmType: 'div',
      _component: { id: 'c-test', map: { Due: 'DueDate' } },
      children: [{ elmType: 'div', _component: { id: 'c-other', map: {} } }],
    };
    const out = restampIn(tree, 'c-test', 'c-variant');
    expect(out._component).toEqual({ id: 'c-variant', map: { Due: 'DueDate' } }); // map kept
    expect(out.children?.[0]._component?.id).toBe('c-other'); // foreign stamps untouched
    expect(tree._component?.id).toBe('c-test'); // input untouched
  });
});

describe('instance provenance + the usage scan (the ⬡ inventory)', () => {
  it('bindComponentInstance stamps { id, map }; plain bindComponent stays clean for previews', () => {
    const inst = bindComponentInstance(DEF, { Due: 'DueDate', Person: 'Owner' });
    expect(inst._component).toEqual({ id: 'c-test', map: { Due: 'DueDate', Person: 'Owner' } });
    expect(inst.txtContent).toBe("=if([$DueDate]<@now,'late','ok')"); // still binds
    expect(inst._elmName).toBe('Test comp'); // still names
    expect(bindComponent(DEF, { Due: 'DueDate', Person: 'Owner' })._component).toBeUndefined();
  });

  const stamp = (label?: string): SPElement => ({
    elmType: 'div',
    _component: { id: 'c-test', map: { Due: 'DueDate' } },
    ...(label ? { _elmName: label } : {}),
  });

  it('finds stamped view usages by NodePath — a stamped root, children, and card content', () => {
    const main: SPElement = {
      elmType: 'div',
      children: [
        { elmType: 'span' },
        stamp('Deadline chip'),
        {
          elmType: 'div',
          customCardProps: { formatter: stamp(), openOnEvent: 'hover' },
        },
      ],
    };
    const out = scanComponentUsages([DEF], main, {}, []);
    expect(out.get('c-test')).toEqual([
      { kind: 'view', path: [1], label: 'Deadline chip' },
      // card content rides the CARD_SEGMENT (-1) path convention; the
      // label falls back to the def's name when the subtree is unnamed
      { kind: 'view', path: [2, -1], label: 'Test comp' },
    ]);
    // a row component IS the root — path [] is a usage too
    const asRoot = scanComponentUsages([DEF], stamp('My row'), {}, []);
    expect(asRoot.get('c-test')).toEqual([{ kind: 'view', path: [], label: 'My row' }]);
  });

  it('column usages: the subtype tag and a stamped subtree both count, ONCE per column, only when registered', () => {
    const fields: MockField[] = [
      { name: 'Status', type: 'choice', subtype: 'c-test' },
      { name: 'Ghost', type: 'text', subtype: 'c-test' }, // tagged but never registered
    ];
    const refs: Record<string, SPElement> = {
      // tag AND stamp agree → still one usage
      Status: stamp(),
      // no tag, but a stamped subtree deep in the registered tree
      DueDate: { elmType: 'div', children: [{ elmType: 'span' }, stamp()] },
    };
    const out = scanComponentUsages([DEF], undefined, refs, fields);
    expect(out.get('c-test')).toEqual([
      { kind: 'column', field: 'Status' },
      { kind: 'column', field: 'DueDate' },
    ]);
  });

  it('a deleted component leaves no ghost rows; unused defs simply have no entry', () => {
    const main: SPElement = {
      elmType: 'div',
      children: [{ elmType: 'div', _component: { id: 'c-gone', map: {} } }],
    };
    const out = scanComponentUsages([DEF], main, {}, []);
    expect(out.get('c-gone')).toBeUndefined(); // no def carries that id
    expect(out.get('c-test')).toBeUndefined(); // in the doc: nothing stamped for it
  });

  it('mainUsageLabel: "View — X" normally, the column-formatter noun when the MAIN doc is one', () => {
    const u = { kind: 'view' as const, path: [1], label: 'Deadline chip' };
    expect(mainUsageLabel(u, false, 'Status')).toBe('View — Deadline chip');
    // a JSON-tab-imported column formatter IS the main doc — the jump row
    // must agree with the insert copy ("Add to the X column formatter")
    expect(mainUsageLabel(u, true, 'Due date')).toBe('Due date column formatter — Deadline chip');
  });

  it('componentInsertTarget: an open column formatter wins; otherwise the view (grid flagged)', () => {
    expect(componentInsertTarget('main', 'grid', 'Status')).toEqual({ kind: 'view', grid: true });
    expect(componentInsertTarget('main', 'row', 'Status')).toEqual({ kind: 'view', grid: false });
    expect(componentInsertTarget('main', 'tile', 'Status')).toEqual({ kind: 'view', grid: false });
    expect(componentInsertTarget('DueDate', 'column', 'Status')).toEqual({ kind: 'column', field: 'DueDate' });
    // the MAIN doc itself can be a column formatter (a JSON-tab import)
    expect(componentInsertTarget('main', 'column', 'Status')).toEqual({ kind: 'column', field: 'Status' });
  });
});

describe('built-ins definitely render (the generated-formatter bar)', () => {
  const ctx = (rowIndex: number): EvalContext => ({
    row: defaultRows()[rowIndex],
    rowIndex,
    currentFieldName: 'Status',
    me: state.me,
    iterators: {},
    iteratorIndex: {},
    displayNames: {},
    now: new Date(),
  });

  for (const def of BUILTIN_COMPONENTS) {
    it(`${def.name}: best-guess binds to the default schema and renders every mock row cleanly`, () => {
      const mapping = bestGuessMapping(def, defaultFields());
      expect(mappingComplete(def, mapping)).toBe(true);
      const bound = bindComponent(def, mapping);
      // no leftover slot keys — every author-side ref was rewritten or is a real field
      const fields = new Set(defaultFields().map((f) => f.name));
      for (const ref of fieldRefsIn(bound)) expect(fields.has(ref)).toBe(true);
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
