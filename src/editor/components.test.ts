/**
 * components.ts is the contract for the ONE unit of packaged formatting
 * (COLUMNS-COMPONENTS-VIEWS model B): boundary-aware slot binding, slot
 * derivation from a subtree, the best-guess mapping, store round-trips, the
 * usage scan over view stamps + column looks, and — most load-bearing — that
 * every BUILT-IN component binds to the default schema and renders through
 * the real engine without a single runtime issue (built-ins must
 * definitely-work, the same bar as generated formatters).
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
  MAX_COMPONENT_DEPTH, embedNamespace, embedClosure, componentDepth,
  embedRefusal, withEmbed, withoutEmbed, componentsEmbedding, transitiveEmbedders, flattenComponent,
  type ComponentDef,
} from './components';
import { scanComponentUsages, mainUsageLabel } from './componentUsage';
import { stylePlainValue, styleIsFormula } from './componentEditor';
import { importJson, exportJson } from '../core/serializer';
import { bindFragmentToSchema } from './presets';
import { renderElement, type RenderIssue } from '../core/renderer';
import { defaultFields, defaultRows, state } from './state';
import type { SPElement, SPExpr } from '../core/types';
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

  it('containsCfr scans RAW parsed JSON for the property KEY — § left the model, only imports can carry it', () => {
    expect(containsCfr(DEF.root)).toBe(false);
    expect(containsCfr({ elmType: 'div', columnFormatterReference: '[$Status]' })).toBe(true);
    // nested objects, arrays, and card content all hide the key equally well
    expect(containsCfr({
      elmType: 'div',
      children: [{ elmType: 'div', children: [{ columnFormatterReference: '[$X]' }] }],
    })).toBe(true);
    expect(containsCfr([{ ok: 1 }, { columnFormatterReference: '[$X]' }])).toBe(true);
    expect(containsCfr({
      elmType: 'div',
      customCardProps: { openOnEvent: 'hover', formatter: { elmType: 'div', columnFormatterReference: '[$Y]' } },
    })).toBe(true);
    // key PRESENCE is the offense — the value doesn't matter
    expect(containsCfr({ columnFormatterReference: null })).toBe(true);
    // strings and scalars aren't keys
    expect(containsCfr('columnFormatterReference')).toBe(false);
    expect(containsCfr(null)).toBe(false);
    expect(containsCfr(undefined)).toBe(false);
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

  it('refuses tiles and CFR-carrying imports with teaching errors', () => {
    const tile = importJson(JSON.stringify({ formatter: { elmType: 'div' }, width: 254 }));
    expect(() => componentFromFormatterDoc(tile, 'T', defaultFields(), 'c-t')).toThrow(/Tile formatters/);
    // the columnFormatterReference KEY anywhere in the parsed JSON refuses,
    // with the self-contained teaching error — nothing resolves it anymore
    const cfr = importJson(JSON.stringify({
      rowFormatter: { elmType: 'div', children: [{ elmType: 'div', columnFormatterReference: '[$Status]' }] },
    }));
    expect(() => componentFromFormatterDoc(cfr, 'C', defaultFields(), 'c-c')).toThrow(/self-contained/);
    // a column formatter hiding one under card content refuses the same way
    const inCard = importJson(JSON.stringify({
      elmType: 'div',
      txtContent: '@currentField',
      customCardProps: { openOnEvent: 'hover', formatter: { elmType: 'div', columnFormatterReference: '[$Notes]' } },
    }));
    expect(() => componentFromFormatterDoc(inCard, 'C2', defaultFields(), 'c-c2')).toThrow(/self-contained/);
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

describe('the editor style panel: SPExpr literal vs formula classification', () => {
  // number/boolean style values are STATIC LITERALS in this codebase
  // (opacity: 0.6, font-weight: 600) — only '='-strings and the AST object
  // form ({operator, operands}) are formula-driven
  const style: Record<string, SPExpr | undefined> = {
    'color': '#0078d4',
    'background-color': "=if([$Due]<@now,'#d13438','#107c10')",
    'opacity': 0.6,
    'font-weight': 600,
    'border': { operator: '+', operands: ['1px solid ', '#e1dfdd'] },
  };

  it('numbers and booleans read as their stringified literal, never as formulas', () => {
    expect(stylePlainValue(style, 'opacity')).toBe('0.6');
    expect(stylePlainValue(style, 'font-weight')).toBe('600');
    expect(styleIsFormula(style, 'opacity')).toBe(false);
    expect(styleIsFormula(style, 'font-weight')).toBe(false);
    expect(stylePlainValue({ 'x': true }, 'x')).toBe('true');
    expect(styleIsFormula({ 'x': true }, 'x')).toBe(false);
  });

  it("plain strings are literals; '='-strings and AST objects are formulas", () => {
    expect(stylePlainValue(style, 'color')).toBe('#0078d4');
    expect(styleIsFormula(style, 'color')).toBe(false);
    expect(stylePlainValue(style, 'background-color')).toBe('');
    expect(styleIsFormula(style, 'background-color')).toBe(true);
    expect(stylePlainValue(style, 'border')).toBe('');
    expect(styleIsFormula(style, 'border')).toBe(true);
  });

  it('unset props are neither a literal nor a formula', () => {
    expect(stylePlainValue(style, 'padding')).toBe('');
    expect(styleIsFormula(style, 'padding')).toBe(false);
    expect(stylePlainValue(undefined, 'color')).toBe('');
    expect(styleIsFormula(undefined, 'color')).toBe(false);
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
    const out = scanComponentUsages([DEF], main, {});
    expect(out.get('c-test')).toEqual([
      { kind: 'view', path: [1], label: 'Deadline chip' },
      // card content rides the CARD_SEGMENT (-1) path convention; the
      // label falls back to the def's name when the subtree is unnamed
      { kind: 'view', path: [2, -1], label: 'Test comp' },
    ]);
    // a row component IS the root — path [] is a usage too
    const asRoot = scanComponentUsages([DEF], stamp('My row'), {});
    expect(asRoot.get('c-test')).toEqual([{ kind: 'view', path: [], label: 'My row' }]);
  });

  it('column usages come from _component stamps in look trees, ONCE per (component, column)', () => {
    const looks: Record<string, SPElement> = {
      // the normal shape: the look's baked root IS the stamped instance
      Status: stamp(),
      // several stamps of the same component inside one look — still ONE usage
      DueDate: {
        elmType: 'div',
        children: [
          stamp(),
          { elmType: 'div', customCardProps: { formatter: stamp(), openOnEvent: 'hover' } },
        ],
      },
      // an imported look is UNSTAMPED (no def) — no usage row
      Title: { elmType: 'div', txtContent: '[$Title]' },
    };
    const out = scanComponentUsages([DEF], undefined, looks);
    expect(out.get('c-test')).toEqual([
      { kind: 'column', field: 'Status' },
      { kind: 'column', field: 'DueDate' },
    ]);
  });

  it('a look on a column AND an instance in the view report as separate usages', () => {
    const main: SPElement = { elmType: 'div', children: [stamp('Placed chip')] };
    const out = scanComponentUsages([DEF], main, { DueDate: stamp() });
    expect(out.get('c-test')).toEqual([
      { kind: 'view', path: [0], label: 'Placed chip' },
      { kind: 'column', field: 'DueDate' },
    ]);
  });

  it('a deleted component leaves no ghost rows; unused defs simply have no entry', () => {
    const main: SPElement = {
      elmType: 'div',
      children: [{ elmType: 'div', _component: { id: 'c-gone', map: {} } }],
    };
    const out = scanComponentUsages([DEF], main, {
      Status: { elmType: 'div', _component: { id: 'c-gone', map: {} } },
    });
    expect(out.get('c-gone')).toBeUndefined(); // no def carries that id
    expect(out.get('c-test')).toBeUndefined(); // nothing stamped for it anywhere
  });

  it('mainUsageLabel: the uniform "View — X" jump row (the main doc is always a view or the grid)', () => {
    expect(mainUsageLabel({ kind: 'view', path: [1], label: 'Deadline chip' })).toBe('View — Deadline chip');
  });

  it('componentInsertTarget: always the active view — the grid flag drives the arrives-as-a-column copy', () => {
    expect(componentInsertTarget('grid')).toEqual({ grid: true });
    expect(componentInsertTarget('row')).toEqual({ grid: false });
    expect(componentInsertTarget('tile')).toEqual({ grid: false });
  });
});

describe('component nesting (#225): embed, cycle refusal, depth cap, flatten', () => {
  // the classic pitch: a Status pill, reused inside a Task card
  const PILL: ComponentDef = {
    id: 'c-pill', name: 'Status pill', description: 'a pill',
    slots: [{ key: 'Status', label: 'The status', types: ['choice'] }],
    root: {
      elmType: 'div',
      _elmName: 'Status pill',
      txtContent: '[$Status]',
      style: { 'background-color': "=if([$Status]=='Done','#107c10','#0078d4')", 'color': '#ffffff' },
    },
  };
  const CARD_BASE: ComponentDef = {
    id: 'c-card', name: 'Task card', description: 'a card',
    slots: [{ key: 'Title', label: 'The task', types: ['text', 'note'] }],
    root: { elmType: 'div', children: [{ elmType: 'span', txtContent: '[$Title]' }] },
  };

  it('withEmbed records the reference and appends a placeholder node — pure', () => {
    const card = withEmbed(CARD_BASE, PILL);
    expect(card.embeds).toEqual([{ ns: 'Statuspill', of: 'c-pill', name: 'Status pill' }]);
    expect(card.root.children).toHaveLength(2);
    expect(card.root.children![1]).toEqual({ elmType: 'div', _embed: 'Statuspill' });
    // the input def is untouched (deep-clone contract)
    expect(CARD_BASE.embeds).toBeUndefined();
    expect(CARD_BASE.root.children).toHaveLength(1);
    // a second embed of the SAME child gets its own namespace
    const twice = withEmbed(card, PILL);
    expect(twice.embeds!.map((e) => e.ns)).toEqual(['Statuspill', 'Statuspill2']);
  });

  it('embedNamespace: field-ref-safe ([A-Za-z0-9_] only), deduped, never empty', () => {
    expect(embedNamespace('Status pill', [])).toBe('Statuspill');
    expect(embedNamespace('Status pill', ['Statuspill'])).toBe('Statuspill2');
    expect(embedNamespace('⬡ ✕ —', [])).toBe('Part');
    expect(embedNamespace('a_b9', [])).toBe('a_b9');
  });

  it('flattenComponent surfaces the child\'s unbound slots NAMESPACED and grafts its tree over the placeholder', () => {
    const card = withEmbed(CARD_BASE, PILL);
    const flat = flattenComponent(card, [PILL, card]);
    expect(flat.embeds).toBeUndefined();
    expect(flat.slots).toEqual([
      { key: 'Title', label: 'The task', types: ['text', 'note'] },
      // parent's slot set = own slots ∪ the child's unbound slots, namespaced
      { key: 'Statuspill_Status', label: 'Status pill · The status', types: ['choice'] },
    ]);
    const graft = flat.root.children![1];
    expect(graft._elmName).toBe('Status pill');
    expect(graft.txtContent).toBe('[$Statuspill_Status]');
    expect(graft.style?.['background-color']).toContain('[$Statuspill_Status]');
    // no placeholder survives a flatten — the tree is ONE plain document
    expect(JSON.stringify(flat)).not.toContain('_embed');
    // a def without embeds passes through AS-IS (identity — zero behavior
    // change for every pre-nesting component)
    expect(flattenComponent(PILL, [PILL])).toBe(PILL);
  });

  it('bound child slots stay bound (embed.map) — no surfaced slot, straight rewrite', () => {
    const card = withEmbed(CARD_BASE, PILL);
    card.embeds![0].map = { Status: 'Title' }; // pill shows the card's own Title slot
    const flat = flattenComponent(card, [PILL, card]);
    expect(flat.slots.map((s) => s.key)).toEqual(['Title']);
    expect(flat.root.children![1].txtContent).toBe('[$Title]');
    // binding the parent slot now rewrites the graft too — one mapping drives both
    const bound = bindComponent(flat, { Title: 'Status' });
    expect(bound.children![0].txtContent).toBe('[$Status]');
    expect(bound.children![1].txtContent).toBe('[$Status]');
  });

  it('the flattened + bound tree bakes to schema-valid, definitely-works SP JSON (the generated-formatter bar)', () => {
    const card = withEmbed(CARD_BASE, PILL);
    const flat = flattenComponent(card, [PILL, card]);
    const mapping = bestGuessMapping(flat, defaultFields());
    expect(mappingComplete(flat, mapping)).toBe(true);
    const bound = bindComponentInstance(flat, mapping);
    expect(bound._component).toEqual({ id: 'c-card', map: mapping }); // stamps keep the PARENT's id
    // every ref resolved to a real column — no leftover slot or namespaced keys
    const fields = new Set(defaultFields().map((f) => f.name));
    for (const ref of fieldRefsIn(bound)) expect(fields.has(ref)).toBe(true);
    // renders through the real engine without a single runtime complaint
    for (let i = 0; i < defaultRows().length; i++) {
      const issues: RenderIssue[] = [];
      const el = renderElement(bound, {
        row: defaultRows()[i], rowIndex: i, currentFieldName: 'Status', me: state.me,
        iterators: {}, iteratorIndex: {}, displayNames: {}, now: new Date(),
      }, { issues });
      expect(el).toBeTruthy();
      expect(issues).toEqual([]);
    }
    // schema-pristine export carries none of the meta family and no bare `!`
    const json = exportJson({ kind: 'row', root: bound }, { keepMeta: false });
    expect(json).not.toContain('_embed');
    expect(json).not.toContain('_component');
    expect(json.replace(/!=/g, '').replace(/\[!/g, '')).not.toContain('!');
  });

  it('recursion: a child\'s own embeds flatten too, namespacing all the way down', () => {
    const badge: ComponentDef = {
      id: 'c-badge', name: 'Badge', description: 'b', slots: [],
      root: { elmType: 'div', children: [] },
    };
    const mid = withEmbed(badge, PILL); // Badge embeds Status pill
    const outer = withEmbed(CARD_BASE, mid); // Task card embeds Badge
    const flat = flattenComponent(outer, [PILL, mid, outer]);
    expect(flat.slots.map((s) => s.key)).toEqual(['Title', 'Badge_Statuspill_Status']);
    expect(flat.slots[1].label).toBe('Badge · Status pill · The status');
    const graft = flat.root.children![1]; // the Badge graft
    expect(graft.children![0].txtContent).toBe('[$Badge_Statuspill_Status]');
    expect(JSON.stringify(flat)).not.toContain('_embed');
  });

  it('cycle refusal at author time: self, direct, and transitive — with teaching messages', () => {
    const a = withEmbed(CARD_BASE, PILL); // A(c-card) uses B(c-pill)
    const defs = [a, PILL];
    expect(embedRefusal(PILL, PILL, defs)).toMatch(/inside itself/);
    // B may not embed A back — A already uses B
    expect(embedRefusal(PILL, a, defs)).toMatch(/create a loop/);
    // transitive: A→B, B→C … C may not embed A
    const c: ComponentDef = { id: 'c-c', name: 'C', description: '', slots: [], root: { elmType: 'div' } };
    const b2 = withEmbed({ ...PILL }, c); // B uses C
    const defs2 = [a, b2, c];
    expect(embedRefusal(c, a, defs2)).toMatch(/create a loop/);
    // the happy path stays open
    expect(embedRefusal(a, c, defs2)).toBeNull();
    expect(embedClosure(a, defs2)).toEqual(new Set(['c-pill', 'c-c']));
  });

  it(`depth cap: chains refuse past ${MAX_COMPONENT_DEPTH} levels, in addition to cycle detection`, () => {
    // build a legal maximal chain: d1 ← d2 ← … ← d5
    const defs: ComponentDef[] = [];
    let prev: ComponentDef | null = null;
    for (let i = 1; i <= MAX_COMPONENT_DEPTH; i++) {
      const plain: ComponentDef = {
        id: `c-d${i}`, name: `D${i}`, description: '', slots: [],
        root: { elmType: 'div', children: [] },
      };
      const def: ComponentDef = prev ? withEmbed(plain, prev) : plain;
      defs.push(def);
      prev = def;
    }
    expect(componentDepth(prev!, defs)).toBe(MAX_COMPONENT_DEPTH);
    // one more level on top is refused with the teaching message…
    const roof: ComponentDef = { id: 'c-roof', name: 'Roof', description: '', slots: [], root: { elmType: 'div' } };
    expect(embedRefusal(roof, prev!, defs)).toMatch(/cap is 5/);
    // …while embedding the one-shorter chain is fine
    expect(embedRefusal(roof, defs[MAX_COMPONENT_DEPTH - 2], defs)).toBeNull();
  });

  it('flatten NEVER bakes a cycle or an over-deep chain — a hand-corrupted store degrades, not explodes', () => {
    // A↔B written straight into the store shape (author-time refusal bypassed)
    const a: ComponentDef = {
      id: 'c-a', name: 'A', description: '', slots: [],
      embeds: [{ ns: 'B', of: 'c-b', name: 'B' }],
      root: { elmType: 'div', children: [{ elmType: 'span', txtContent: 'a' }, { elmType: 'div', _embed: 'B' }] },
    };
    const b: ComponentDef = {
      id: 'c-b', name: 'B', description: '', slots: [],
      embeds: [{ ns: 'A', of: 'c-a', name: 'A' }],
      root: { elmType: 'div', children: [{ elmType: 'span', txtContent: 'b' }, { elmType: 'div', _embed: 'A' }] },
    };
    const flat = flattenComponent(a, [a, b]); // terminates — the cycle guard stops the walk
    const json = JSON.stringify(flat);
    expect(json).not.toContain('_embed'); // the cyclic placeholder dropped out
    expect(json).toContain('"b"'); // B expanded once…
    expect(json.match(/"a"/g)).toHaveLength(1); // …but never re-imported A
    // a dangling reference (child deleted) drops out the same way
    const dangling = flattenComponent(a, [a]);
    expect(JSON.stringify(dangling)).not.toContain('_embed');
    expect(dangling.slots).toEqual([]);
    expect(dangling.root.children).toHaveLength(1);
  });

  it('withoutEmbed removes the reference AND its placeholder — pure', () => {
    const card = withEmbed(CARD_BASE, PILL);
    const back = withoutEmbed(card, 'Statuspill');
    expect(back.embeds).toBeUndefined();
    expect(back.root.children).toHaveLength(1);
    expect(card.embeds).toHaveLength(1); // input untouched
    // removing an unknown ns is a no-op
    expect(withoutEmbed(card, 'Nope').embeds).toHaveLength(1);
  });

  it('componentsEmbedding: the "used by N components" blast radius, self excluded', () => {
    const card = withEmbed(CARD_BASE, PILL);
    expect(componentsEmbedding('c-pill', [PILL, card]).map((d) => d.id)).toEqual(['c-card']);
    expect(componentsEmbedding('c-card', [PILL, card])).toEqual([]);
  });

  it('transitiveEmbedders: the FULL re-bake blast radius — follows chains, self excluded, cycle-safe', () => {
    const card = withEmbed(CARD_BASE, PILL);                           // Task card → Status pill
    const badgePlain: ComponentDef = {
      id: 'c-badge', name: 'Badge', description: '', slots: [],
      root: { elmType: 'div', children: [] },
    };
    const badge = withEmbed(badgePlain, card);                         // Badge → Task card → Status pill
    const defs = [PILL, card, badge];
    // editing the pill must re-bake BOTH the card and the badge that wraps it —
    // componentsEmbedding (direct-only) would miss the badge
    expect(transitiveEmbedders('c-pill', defs).map((d) => d.id).sort()).toEqual(['c-badge', 'c-card']);
    expect(componentsEmbedding('c-pill', defs).map((d) => d.id)).toEqual(['c-card']); // contrast
    // editing the card re-bakes only the badge above it
    expect(transitiveEmbedders('c-card', defs).map((d) => d.id)).toEqual(['c-badge']);
    // a top component nobody embeds has an empty blast radius
    expect(transitiveEmbedders('c-badge', defs)).toEqual([]);
    // a hand-corrupted A↔B store terminates (embedClosure never revisits an id)
    const a: ComponentDef = {
      id: 'c-a', name: 'A', description: '', slots: [],
      embeds: [{ ns: 'B', of: 'c-b', name: 'B' }], root: { elmType: 'div', _embed: 'B' },
    };
    const b: ComponentDef = {
      id: 'c-b', name: 'B', description: '', slots: [],
      embeds: [{ ns: 'A', of: 'c-a', name: 'A' }], root: { elmType: 'div', _embed: 'A' },
    };
    expect(transitiveEmbedders('c-a', [a, b]).map((d) => d.id)).toEqual(['c-b']);
  });

  it('persistence: embeds round-trip the store; pre-nesting shapes load unchanged; corrupt embeds strip, not sink', () => {
    const card = withEmbed(CARD_BASE, PILL);
    card.embeds![0].map = { Status: 'Title' };
    const back = loadComponents(serializeComponents([card]));
    expect(back).toHaveLength(1);
    expect(back[0].embeds).toEqual([{ ns: 'Statuspill', of: 'c-pill', name: 'Status pill', map: { Status: 'Title' } }]);
    expect(back[0].root.children![1]._embed).toBe('Statuspill');
    // an OLD store (no embeds anywhere) loads exactly as before — additive field
    const old = loadComponents(JSON.stringify({ version: 1, components: [CARD_BASE] }));
    expect(old).toHaveLength(1);
    expect(old[0].embeds).toBeUndefined();
    // a non-array embeds field strips without sinking the entry
    const notArray = loadComponents(JSON.stringify({ version: 1, components: [{ ...CARD_BASE, embeds: 'nope' }] }));
    expect(notArray).toHaveLength(1);
    expect(notArray[0].embeds).toBeUndefined();
    // corrupt records drop one by one; valid siblings survive
    const mixed = loadComponents(JSON.stringify({
      version: 1,
      components: [{
        ...CARD_BASE,
        embeds: [
          { ns: 'Ok', of: 'c-pill', name: 'Status pill' },
          { ns: 'bad ns!', of: 'c-pill', name: 'x' }, // ns outside the field-ref grammar
          { ns: 'NoOf', name: 'x' }, // missing target
          { ns: 'BadMap', of: 'c-pill', name: 'x', map: { Status: 7 } }, // non-string binding
          'junk',
        ],
      }],
    }));
    expect(mixed).toHaveLength(1);
    expect(mixed[0].embeds).toEqual([{ ns: 'Ok', of: 'c-pill', name: 'Status pill' }]);
    // all-corrupt → the field disappears entirely (back to the plain shape)
    const allBad = loadComponents(JSON.stringify({
      version: 1, components: [{ ...CARD_BASE, embeds: [{ nope: 1 }] }],
    }));
    expect(allBad[0].embeds).toBeUndefined();
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
