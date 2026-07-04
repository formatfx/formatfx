import { describe, it, expect } from 'vitest';
import {
  composeRowStyle, buildKebab, defaultConfigFor, buildTemplateView, buildZone,
  addZone, insertZone, newZone, zoneAt, nodeAt, pruneZones,
  addItemAt, removeNode, moveNode, patchZoneAt, patchItemAt,
  newFieldItem, newComponentItem, wireframeById,
  childSlotOrder, applyBlocker, configFromView, WIREFRAMES, ZEBRA_ROW_CLASS,
  type RowTemplateConfig, type KebabConfig, type ZoneConfig, type ZoneItem, type WireframeId,
} from './rowTemplates';
import type { ComponentDef } from './components';
import { themePalette } from '../core/theme';
import type { MockField } from '../core/types';

const PAL = themePalette('light');
const base = (over: Partial<RowTemplateConfig> = {}): RowTemplateConfig => ({
  wireframeId: 'equal', target: 'row', rowStyle: 'flat', density: 'roomy',
  zebraStriping: false, hoverHighlight: false, hoverToken: 'themeLighter',
  borderStyle: 'none', borderColor: 'neutralQuaternaryAlt', leftStripe: 'none',
  zones: [], kebab: { enabled: false, behavior: 'custom', position: 'right',
    actions: { defaultClick: false, editProps: false, share: false, delete: false, executeFlow: false, setValue: false } },
  ...over,
});

describe('composeRowStyle — conflict precedence + exclusion', () => {
  it('card disables generic border and zebra, with reasons (card keeps its own border)', () => {
    const c = composeRowStyle(base({ rowStyle: 'card', borderStyle: 'solid', borderColor: 'red', zebraStriping: true }), PAL);
    expect(c.disabled.border).toBe('Card style manages its own border');
    expect(c.disabled.zebra).toBe('Card fill covers row striping');
    // the user-chosen generic border is suppressed (its color class does not leak)…
    expect(c.rootClass).not.toContain('sp-css-borderColor-red');
    expect(c.wrapperAdditionalRowClass).toBeUndefined();
    // …while the card paints its own surface: white fill, rounded, bordered, shadowed
    expect(c.rootClass).toContain('ms-bgColor-white');
    expect(c.rootClass).toContain('sp-css-borderColor-neutralQuaternaryAlt');
    expect(c.rootStyle['border-radius']).toBe('4px');
  });

  it('zebra emits a wrapper additionalRowClass, never a root background', () => {
    const c = composeRowStyle(base({ zebraStriping: true }), PAL);
    expect(c.wrapperAdditionalRowClass).toBe("=if(@rowIndex % 2 == 0,'ms-bgColor-themeLighter','')");
    expect(c.rootStyle['background-color']).toBeUndefined();
  });

  it('hover highlight is a named --hover class, never a :hover style', () => {
    const c = composeRowStyle(base({ hoverHighlight: true, hoverToken: 'themeLighter' }), PAL);
    expect(c.rootClass).toContain('ms-bgColor-themeLighter--hover');
    expect(JSON.stringify(c.rootStyle)).not.toMatch(/:hover/);
  });

  it('leftStripe wins border-left over a flat generic border', () => {
    const c = composeRowStyle(base({ borderStyle: 'solid', leftStripe: 'neutral' }), PAL);
    expect(c.rootStyle['border-left']).toBe(`3px solid ${PAL.themePrimary}`);
  });

  it('minimalist disables generic border but allows leftStripe', () => {
    const c = composeRowStyle(base({ rowStyle: 'minimalist', borderStyle: 'solid', leftStripe: 'neutral' }), PAL);
    expect(c.disabled.border).toBe('Minimalist uses only a bottom separator');
    expect(c.rootStyle['border-bottom-style']).toBe('solid');
    expect(c.rootStyle['border-left']).toBe(`3px solid ${PAL.themePrimary}`);
  });

  it('every emitted style key is on the SP allow-list', async () => {
    const { ALLOWED_STYLES } = await import('../core/schema');
    const c = composeRowStyle(base({ rowStyle: 'card', leftStripe: 'neutral', hoverHighlight: true }), PAL);
    for (const k of Object.keys(c.rootStyle)) expect(ALLOWED_STYLES.has(k)).toBe(true);
  });
});

const kebab = (over: Partial<KebabConfig> = {}): KebabConfig => ({
  enabled: true, behavior: 'custom', position: 'right',
  actions: { defaultClick: false, editProps: false, share: false, delete: false, executeFlow: false, setValue: false },
  ...over,
});

describe('buildKebab — trigger shape + refuse-and-teach', () => {
  it('custom trigger is a button with DIRECT txtContent and NO children (no card-trigger gotcha)', () => {
    const el = buildKebab(kebab({ actions: { defaultClick: false, editProps: true, share: false, delete: false, executeFlow: false, setValue: false } }))!;
    expect(el.elmType).toBe('button');
    expect(el.txtContent).toBe('⋯');
    expect(el.children).toBeUndefined();               // trigger has no children
    expect(el.customCardProps!.formatter.children!.length).toBe(1); // flyout has the action
  });

  it('refuses executeFlow with a blank flow id (no dead action emitted)', () => {
    const el = buildKebab(kebab({ actions: { defaultClick: false, editProps: false, share: false, delete: false, executeFlow: true, setValue: false }, flowId: '   ' }));
    expect(el).toBeNull();                              // nothing else enabled → whole kebab refused
  });

  it('emits executeFlow only when a flow id is present, as a JSON-string actionParams', () => {
    const el = buildKebab(kebab({ actions: { defaultClick: false, editProps: false, share: false, delete: false, executeFlow: true, setValue: false }, flowId: 'abc-123' }))!;
    const action = el.customCardProps!.formatter.children![0].customRowAction!;
    expect(action.action).toBe('executeFlow');
    expect(action.actionParams).toBe('{"id":"abc-123"}');
  });

  it('emits setValue only with field+value, keyed by the internal name', () => {
    const el = buildKebab(kebab({ actions: { defaultClick: false, editProps: false, share: false, delete: false, executeFlow: false, setValue: true }, setValueField: 'Status', setValueVal: 'Done' }))!;
    const action = el.customCardProps!.formatter.children![0].customRowAction!;
    expect(action.action).toBe('setValue');
    expect(action.actionInput).toEqual({ Status: 'Done' });
  });

  it('native behavior is a button carrying openContextMenu (direct glyph, no children)', () => {
    const el = buildKebab(kebab({ behavior: 'native' }))!;
    expect(el.elmType).toBe('button');
    expect(el.children).toBeUndefined();
    expect(el.customRowAction!.action).toBe('openContextMenu');
  });
});

const FIELDS: MockField[] = [
  { name: 'Title', type: 'text' }, { name: 'Status', type: 'choice' },
  { name: 'Due', type: 'date' }, { name: 'Owner', type: 'person' },
];

const CHIP: ComponentDef = {
  id: 'test-chip', name: 'Test chip', description: 'test', builtin: true,
  slots: [{ key: 'Due', label: 'The date', types: ['date'] }],
  root: { elmType: 'div', txtContent: '=[$Due]', style: { 'display': 'inline-flex' } },
};

describe('wireframe seeding (defaultConfigFor)', () => {
  it('every wireframe id seeds without throwing and keeps its zone shape', () => {
    for (const wf of WIREFRAMES) {
      const c = defaultConfigFor(wf.id, FIELDS);
      expect(c.zones.length).toBe(wf.zones.length);
      expect(c.zones.map((z) => z.size)).toEqual(wf.zones.map((z) => z.size));
      expect(c.zones.map((z) => z.flow)).toEqual(wf.zones.map((z) => z.flow));
    }
  });

  it('avatar-card puts the person in the hug zone and the text in the stack zone', () => {
    const c = defaultConfigFor('avatar-card', FIELDS);
    expect(c.zones[0].items[0]).toMatchObject({ kind: 'field', fieldName: 'Owner', width: 'natural' });
    expect(c.zones[1].items[0]).toMatchObject({ kind: 'field', fieldName: 'Title', width: 'fill' });
  });

  it('a field is never seeded twice across zones', () => {
    const c = defaultConfigFor('dashboard', FIELDS);
    const names = c.zones.flatMap((z) => z.items).map((it) => it.kind === 'field' ? it.fieldName : '');
    expect(new Set(names).size).toBe(names.length);
  });

  it('a want-slot with no matching column seeds nothing (never guesses)', () => {
    const c = defaultConfigFor('dashboard', FIELDS); // schema has no number column
    const progress = c.zones.find((z) => z.label === 'Progress')!;
    expect(progress.items.length).toBe(0);
  });

  it('blank seeds one empty wrap zone… unless the schema would leave the whole row empty elsewhere', () => {
    const c = defaultConfigFor('blank', FIELDS);
    // blank has a single zone, so the never-fully-empty rule seeds the first field
    expect(c.zones.length).toBe(1);
    expect(c.zones[0].flow).toBe('wrap');
    expect(c.zones[0].items[0]).toMatchObject({ kind: 'field', fieldName: 'Title' });
  });
});

describe('buildZone — the flex behavior contract', () => {
  const zone = (over: Partial<ZoneConfig>): ZoneConfig =>
    ({ label: 'Z', size: 'normal', flow: 'side', align: 'left', items: [], ...over });

  it('hug zones take only their content (no grow, no min-width:0)', () => {
    const el = buildZone(zone({ size: 'hug' }), FIELDS, {}, []);
    expect(el.style!['flex']).toBe('0 0 auto');
    expect(el.style!['min-width']).toBeUndefined();
  });

  it('fill zones reuse the conflict-free area weights and may shrink', () => {
    expect(buildZone(zone({ size: 'wide' }), FIELDS, {}, []).style!['flex']).toBe('2');
    expect(buildZone(zone({ size: 'widest' }), FIELDS, {}, []).style!['min-width']).toBe('0');
  });

  it('wrap flow sets flex-wrap so squeezed items move beneath their neighbor', () => {
    const el = buildZone(zone({ flow: 'wrap' }), FIELDS, {}, []);
    expect(el.style!['flex-wrap']).toBe('wrap');
    expect(el.style!['flex-direction']).toBeUndefined();
  });

  it('stack flow is a column and never wraps', () => {
    const el = buildZone(zone({ flow: 'stack' }), FIELDS, {}, []);
    expect(el.style!['flex-direction']).toBe('column');
    expect(el.style!['flex-wrap']).toBeUndefined();
  });

  it('wrap-flow fill items keep their natural minimum (no min-width:0) so they wrap instead of crushing', () => {
    const z = zone({ flow: 'wrap' });
    z.items = [newFieldItem('Title', z), newFieldItem('Status', z)];
    const el = buildZone(z, FIELDS, {}, []);
    for (const item of el.children!) {
      expect(item.style!['flex']).toBe('1 1 auto');
      expect(item.style!['min-width']).toBeUndefined();
    }
  });

  it('side-flow fill items share the line and may truncate (flex 1 1 0% + min-width:0)', () => {
    const z = zone({ flow: 'side' });
    z.items = [newFieldItem('Title', z)];
    const el = buildZone(z, FIELDS, {}, []);
    expect(el.children![0].style!['flex']).toBe('1 1 0%');
    expect(el.children![0].style!['min-width']).toBe('0');
    expect(el.children![0].style!['text-overflow']).toBe('ellipsis');
  });

  it('natural items hug their content in every flow', () => {
    const z = zone({ flow: 'wrap' });
    z.items = [{ ...newFieldItem('Status', z), width: 'natural' }];
    const el = buildZone(z, FIELDS, {}, []);
    expect(el.children![0].style!['flex']).toBe('0 0 auto');
    expect(el.children![0].style!['max-width']).toBe('100%');
  });

  it('a component item is bound via its map AND stamped as an instance', () => {
    const z = zone({});
    z.items = [newComponentItem(CHIP.id, { Due: 'Due' })];
    const el = buildZone(z, FIELDS, {}, [CHIP]);
    expect(el.children![0].txtContent).toBe('=[$Due]');
    expect(el.children![0]._component).toEqual({ id: 'test-chip', map: { Due: 'Due' } });
  });

  it('a component item remaps slot keys to the mapped column', () => {
    const z = zone({});
    z.items = [newComponentItem(CHIP.id, { Due: 'Status' })];
    const el = buildZone(z, FIELDS, {}, [CHIP]);
    expect(el.children![0].txtContent).toBe('=[$Status]');
  });

  it('a deleted component renders an honest placeholder, never a guess', () => {
    const z = zone({});
    z.items = [newComponentItem('gone', {})];
    const el = buildZone(z, FIELDS, {}, [CHIP]);
    expect(el.children![0].txtContent).toContain('missing component');
  });

  it('every zone + item style key is on the SP allow-list', async () => {
    const { ALLOWED_STYLES } = await import('../core/schema');
    for (const flow of ['side', 'wrap', 'stack'] as const) {
      for (const align of ['left', 'center', 'right'] as const) {
        const z = zone({ flow, align, size: flow === 'stack' ? 'hug' : 'wide' });
        z.items = [newFieldItem('Title', z), { ...newFieldItem('Status', z), width: 'natural' }];
        const el = buildZone(z, FIELDS, {}, []);
        for (const k of Object.keys(el.style!)) expect(ALLOWED_STYLES.has(k), `zone ${k}`).toBe(true);
        for (const item of el.children!) {
          for (const k of Object.keys(item.style!)) expect(ALLOWED_STYLES.has(k), `item ${k}`).toBe(true);
        }
      }
    }
  });
});

describe('buildTemplateView over zones', () => {
  it('renders one child per zone (plus nothing else) with zone names', () => {
    const c = defaultConfigFor('avatar-card', FIELDS);
    const { root } = buildTemplateView(c, FIELDS, {}, PAL);
    expect(root.children!.length).toBe(3);
    expect(root.children![0]._elmName).toBe('Who zone');
  });

  it('prune drops empty zones on Apply builds only', () => {
    const c = defaultConfigFor('dashboard', FIELDS); // Progress zone is empty (no number col)
    const kept = buildTemplateView(c, FIELDS, {}, PAL).root.children!.length;
    const pruned = buildTemplateView(c, FIELDS, {}, PAL, [], { prune: true }).root.children!.length;
    expect(kept).toBe(4);
    expect(pruned).toBe(3);
  });

  it('zebra lands on the returned additionalRowClass, never on root style', () => {
    const c = defaultConfigFor('equal', FIELDS);
    c.zebraStriping = true;
    const { root, additionalRowClass } = buildTemplateView(c, FIELDS, {}, PAL);
    expect(additionalRowClass).toBe("=if(@rowIndex % 2 == 0,'ms-bgColor-themeLighter','')");
    expect(root.style!['background-color']).toBeUndefined();
  });

  it('hover-positioned kebab puts showOnHoverParent on the row and showOnHoverChild on the kebab', () => {
    const c = defaultConfigFor('equal', FIELDS);
    c.kebab = { enabled: true, behavior: 'custom', position: 'hover',
      actions: { defaultClick: true, editProps: false, share: false, delete: false, executeFlow: false, setValue: false } };
    const { root } = buildTemplateView(c, FIELDS, {}, PAL);
    expect((root.attributes!.class as string)).toContain('sp-card-showOnHoverParent');
    const keb = root.children![root.children!.length - 1];
    expect((keb.attributes!.class as string)).toContain('sp-card-showOnHoverChild');
  });

  it('a CFR-registered field still lands as a reference cell inside its zone', () => {
    const c = defaultConfigFor('equal', FIELDS);
    const refs: Record<string, import('../core/types').SPElement> = { Title: { elmType: 'div' } };
    const { root } = buildTemplateView(c, FIELDS, refs, PAL);
    const items = root.children!.flatMap((z) => z.children ?? []);
    expect(items.some((it) => it.columnFormatterReference)).toBe(true);
  });
});

// ─── free-form zone/item ops + the editor's children→zone mapping ────────────

const NATIVE_ACTIONS = { defaultClick: false, editProps: false, share: false, delete: false, executeFlow: false, setValue: false };

describe('zone + item ops (pure, immutable)', () => {
  const cfg = (): RowTemplateConfig => defaultConfigFor('avatar-card', FIELDS);

  it('addZone appends an empty wrap zone without mutating the source', () => {
    const a = cfg();
    const n0 = a.zones.length;
    const b = addZone(a);
    expect(b).not.toBe(a);
    expect(a.zones.length).toBe(n0);                 // source untouched
    expect(b.zones.length).toBe(n0 + 1);
    expect(b.zones.at(-1)?.items).toEqual([]);
    expect(b.zones.at(-1)?.flow).toBe('wrap');       // graceful-shrink default
  });

  it('removeNode splices a root zone by path', () => {
    const a = cfg();
    expect(removeNode(a, [1]).zones.length).toBe(a.zones.length - 1);
    expect(removeNode(a, [9])).toBe(a);
  });

  it('moveNode reorders root zones; out-of-range/NaN is a no-op (same ref)', () => {
    const a = cfg();
    const first = a.zones[0].label;
    expect(moveNode(a, [0], [], 2).zones[2].label).toBe(first);
    expect(moveNode(a, [9], [], 1)).toBe(a);
    expect(moveNode(a, [Number.NaN], [], 1)).toBe(a);
  });

  it('patchZoneAt updates one zone immutably', () => {
    const a = cfg();
    expect(patchZoneAt(a, [0], { size: 'widest', flow: 'wrap' }).zones[0]).toMatchObject({ size: 'widest', flow: 'wrap' });
    expect(a.zones[0].size).toBe('hug');             // source untouched
    expect(patchZoneAt(a, [9], { size: 'hug' })).toBe(a);
  });

  it('addItemAt/removeNode work on one zone by path', () => {
    const a = cfg();
    const b = addItemAt(a, [0], newFieldItem('Due', a.zones[0]));
    expect(b.zones[0].items.length).toBe(a.zones[0].items.length + 1);
    expect(removeNode(b, [0, 0]).zones[0].items.length).toBe(a.zones[0].items.length);
  });

  it('addItemAt inserts at an index (between-items drop), clamped', () => {
    const a = cfg(); // avatar-card: Main zone = [Title, Status]
    const names = (c: RowTemplateConfig): string[] =>
      c.zones[1].items.map((it) => (it.kind === 'field' ? it.fieldName : ''));
    expect(names(addItemAt(a, [1], newFieldItem('Due', a.zones[1]), 0))).toEqual(['Due', 'Title', 'Status']);
    expect(names(addItemAt(a, [1], newFieldItem('Due', a.zones[1]), 1))).toEqual(['Title', 'Due', 'Status']);
    expect(names(addItemAt(a, [1], newFieldItem('Due', a.zones[1]), 99))).toEqual(['Title', 'Status', 'Due']);
  });

  it('insertZone spawns a zone between zones (a between-zones drop), clamped', () => {
    const a = cfg();
    const b = insertZone(a, 1, newZone('Spawned'));
    expect(b.zones.map((z) => z.label)).toEqual(['Who', 'Spawned', 'Main', 'When']);
    expect(insertZone(a, 99, newZone('End')).zones.at(-1)?.label).toBe('End');
    expect(insertZone(a, Number.NaN)).toBe(a);
  });

  it('moveNode moves an item across zones (and clamps the target index)', () => {
    const a = cfg();
    const moved = moveNode(a, [1, 0], [2], 99); // Main's title → end of When
    expect(moved.zones[1].items.length).toBe(a.zones[1].items.length - 1);
    expect(moved.zones[2].items.length).toBe(a.zones[2].items.length + 1);
    expect(moved.zones[2].items.at(-1)).toMatchObject({ fieldName: 'Title' });
    expect(a.zones[1].items.length).toBe(2);         // source untouched
  });

  it('moveNode reorders within a zone', () => {
    const a = cfg();
    const b = moveNode(a, [1, 0], [1], 1);
    expect(b.zones[1].items.map((it) => (it.kind === 'field' ? it.fieldName : ''))).toEqual(['Status', 'Title']);
  });

  it('patchItemAt updates one item immutably', () => {
    const a = cfg();
    const b = patchItemAt(a, [1, 0], { width: 'natural', text: 'wrap' });
    expect(b.zones[1].items[0]).toMatchObject({ width: 'natural', text: 'wrap' });
    expect(a.zones[1].items[0]).toMatchObject({ width: 'fill' });
  });

});

describe('nested zones — the recursive model', () => {
  /** avatar-card + a nested wrap zone inside Main holding Status + Due. */
  const nested = (): RowTemplateConfig => {
    let c = defaultConfigFor('avatar-card', FIELDS); // Who[Owner] Main[Title,Status] When[Due]
    c = addItemAt(c, [1], { kind: 'zone', zone: { ...newZone('Badges'), size: 'hug' } });
    c = moveNode(c, [1, 1], [1, 2], 0);  // Status → into Badges (which is now Main.items[2])
    return c;
  };

  it('a zone nests inside a zone and resolves by path', () => {
    const c = nested();
    expect(zoneAt(c, [1, 1])?.label).toBe('Badges');
    expect(zoneAt(c, [1, 1])?.items.length).toBe(1);
    expect(nodeAt(c, [1, 1, 0])).toMatchObject({ kind: 'field', fieldName: 'Status' });
  });

  it('zoneAt is zone-first: a path naming a nested zone returns the ZONE', () => {
    const c = nested();
    const node = nodeAt(c, [1, 1]);
    expect(node && 'items' in node).toBe(true);
  });

  it('buildZone renders nested zones as real flex containers inside their parent', () => {
    const c = nested();
    const el = buildZone(c.zones[1], FIELDS, {}, []);
    const inner = el.children![1];
    expect(inner._elmName).toBe('Badges zone');
    expect(inner.style!['display']).toBe('flex');
    expect(inner.style!['flex']).toBe('0 0 auto'); // hug governs its sizing in the parent
    expect(inner.children!.length).toBe(1);
  });

  it('moveNode refuses a drop into the moved zone\'s own subtree', () => {
    const c = nested();
    expect(moveNode(c, [1], [1, 1], 0)).toBe(c);   // Main into Badges (its child) — refused
    expect(moveNode(c, [1, 1], [1, 1], 0)).toBe(c); // into itself — refused
  });

  it('moveNode un-nests: a nested zone dropped on the root row becomes a root zone', () => {
    const c = nested();
    const out = moveNode(c, [1, 1], [], 1);
    expect(out.zones.length).toBe(4);
    expect(out.zones[1].label).toBe('Badges');
    expect(zoneAt(out, [2, 1])).toBeNull();          // gone from Main
  });

  it('moveNode nests: a root zone dropped into a zone becomes a nested item', () => {
    const c = defaultConfigFor('avatar-card', FIELDS);
    const out = moveNode(c, [2], [1], 99);           // When → into Main
    expect(out.zones.length).toBe(2);
    const last = out.zones[1].items.at(-1);
    expect(last?.kind).toBe('zone');
    expect(last?.kind === 'zone' && last.zone.label).toBe('When');
  });

  it('moveNode wraps a leaf dropped on the root row in a zone of its own', () => {
    const c = defaultConfigFor('avatar-card', FIELDS);
    const out = moveNode(c, [1, 0], [], 3);          // Title item → root end
    expect(out.zones.length).toBe(4);
    expect(out.zones[3].items[0]).toMatchObject({ kind: 'field', fieldName: 'Title' });
  });

  it('deep patches work through nested paths', () => {
    const c = nested();
    const out = patchItemAt(patchZoneAt(c, [1, 1], { flow: 'stack' }), [1, 1, 0], { text: 'wrap' });
    expect(zoneAt(out, [1, 1])?.flow).toBe('stack');
    expect(out.zones[1].items[1]).toMatchObject({ kind: 'zone' });
    expect(nodeAt(out, [1, 1, 0])).toMatchObject({ text: 'wrap' });
  });

  it('pruneZones drops empty zones at every depth', () => {
    let c = nested();
    c = removeNode(c, [1, 1, 0]);                    // empty out Badges
    const pruned = pruneZones(c.zones);
    expect(pruned[1].items.every((it: ZoneItem) => it.kind !== 'zone')).toBe(true);
  });

  it('applyBlocker sees unmapped components inside nested zones', () => {
    let c = nested();
    c = addItemAt(c, [1, 1], newComponentItem(CHIP.id, { Due: '' }));
    expect(applyBlocker(c, [CHIP])).toContain('Test chip');
  });

  it('nested zones round-trip through apply → reopen (parser recursion)', () => {
    const c = nested();
    const { root, additionalRowClass } = buildTemplateView(c, FIELDS, {}, PAL, [CHIP], { prune: true });
    const parsed = configFromView(root, additionalRowClass, FIELDS, {}, [CHIP]);
    expect(parsed).not.toBeNull();
    expect(zoneAt(parsed!, [1, 1])?.label).toBe('Badges');
    expect(nodeAt(parsed!, [1, 1, 0])).toMatchObject({ kind: 'field', fieldName: 'Status' });
  });
});

describe('applyBlocker — refuse-and-teach before Apply', () => {
  it('blocks an all-empty layout', () => {
    const c = base({ zones: [newZone()] });
    expect(applyBlocker(c, [])).toContain('at least one');
  });

  it('blocks an unmapped component slot, naming the component', () => {
    let c = base({ zones: [newZone()] });
    c = addItemAt(c, [0], newComponentItem(CHIP.id, { Due: '' }));
    expect(applyBlocker(c, [CHIP])).toContain('Test chip');
  });

  it('passes a mapped layout', () => {
    let c = base({ zones: [newZone()] });
    c = addItemAt(c, [0], newComponentItem(CHIP.id, { Due: 'Due' }));
    expect(applyBlocker(c, [CHIP])).toBeNull();
  });
});

describe('configFromView — the lossless round trip (reopen as zones)', () => {
  /** Apply-then-reopen: build pruned (what Apply writes), parse it back. */
  const reopen = (
    config: RowTemplateConfig,
    columnRefs: Record<string, import('../core/types').SPElement> = {},
  ): RowTemplateConfig | null => {
    const { root, additionalRowClass } = buildTemplateView(config, FIELDS, columnRefs, PAL, [CHIP], { prune: true });
    return configFromView(root, additionalRowClass, FIELDS, columnRefs, [CHIP], config.target);
  };

  it('every wireframe seed survives apply → reopen with zones intact', () => {
    for (const wf of WIREFRAMES) {
      const seeded = defaultConfigFor(wf.id, FIELDS);
      const parsed = reopen(seeded);
      expect(parsed, wf.id).not.toBeNull();
      const kept = seeded.zones.filter((z) => z.items.length > 0); // Apply prunes empties
      expect(parsed!.zones, wf.id).toEqual(kept);
    }
  });

  it('row styling round-trips: card + hover + compact', () => {
    const c = { ...defaultConfigFor('equal', FIELDS), rowStyle: 'card' as const, density: 'compact' as const,
      hoverHighlight: true };
    const parsed = reopen(c)!;
    expect(parsed).toMatchObject({ rowStyle: 'card', density: 'compact', hoverHighlight: true });
  });

  it('zebra round-trips on a flat row (card suppresses it at build time)', () => {
    const flat = { ...defaultConfigFor('equal', FIELDS), zebraStriping: true };
    expect(reopen(flat)!.zebraStriping).toBe(true);
    const card = { ...flat, rowStyle: 'card' as const };
    expect(reopen(card)!.zebraStriping).toBe(false); // what actually painted
  });

  it('a dashed flat border and the left accent stripe round-trip', () => {
    const c = { ...defaultConfigFor('equal', FIELDS), borderStyle: 'dashed' as const,
      borderColor: 'themePrimary', leftStripe: 'neutral' as const };
    const parsed = reopen(c)!;
    expect(parsed).toMatchObject({ borderStyle: 'dashed', borderColor: 'themePrimary', leftStripe: 'neutral' });
  });

  it('a custom kebab with flow + setValue params round-trips', () => {
    const c = defaultConfigFor('equal', FIELDS);
    c.kebab = { enabled: true, behavior: 'custom', position: 'title',
      actions: { defaultClick: true, editProps: false, share: false, delete: true, executeFlow: true, setValue: true },
      flowId: 'flow-9', setValueField: 'Status', setValueVal: 'Done' };
    const parsed = reopen(c)!;
    expect(parsed.kebab).toMatchObject({ enabled: true, behavior: 'custom', position: 'title',
      flowId: 'flow-9', setValueField: 'Status', setValueVal: 'Done' });
    expect(parsed.kebab.actions).toEqual(c.kebab.actions);
  });

  it('zone behavior + item knobs round-trip (stack fill, wrap natural, text wrap)', () => {
    let c = patchZoneAt(defaultConfigFor('avatar-card', FIELDS), [1], { align: 'center' });
    c = patchItemAt(c, [1, 0], { width: 'fill', text: 'wrap' });
    const parsed = reopen(c)!;
    expect(parsed.zones[1]).toMatchObject({ flow: 'stack', align: 'center' });
    expect(parsed.zones[1].items[0]).toMatchObject({ width: 'fill', text: 'wrap' });
  });

  it('component items round-trip with their slot map and width', () => {
    let c = defaultConfigFor('blank', FIELDS);
    c = addItemAt(c, [0], { ...newComponentItem(CHIP.id, { Due: 'Due' }), width: 'fill' });
    const parsed = reopen(c)!;
    expect(parsed.zones[0].items.at(-1)).toEqual({ kind: 'component', componentId: CHIP.id, map: { Due: 'Due' }, width: 'fill' });
  });

  it('CFR cells parse back to their field (the derived-mapping rule)', () => {
    const refs = { Title: { elmType: 'div' as const } };
    const parsed = reopen(defaultConfigFor('equal', FIELDS), refs)!;
    expect(parsed.zones.flatMap((z) => z.items)).toContainEqual(
      expect.objectContaining({ kind: 'field', fieldName: 'Title' }));
  });

  it('refuses a root hand-styled beyond the builder vocabulary', () => {
    const { root } = buildTemplateView(defaultConfigFor('equal', FIELDS), FIELDS, {}, PAL, [], { prune: true });
    root.style!['background-color'] = '#ff0000';
    expect(configFromView(root, undefined, FIELDS, {}, [])).toBeNull();
  });

  it('refuses a hand-styled item (the rebuild-verify gate, not key-by-key checks)', () => {
    const { root } = buildTemplateView(defaultConfigFor('equal', FIELDS), FIELDS, {}, PAL, [], { prune: true });
    root.children![0].children![0].style!['padding'] = '9px';
    expect(configFromView(root, undefined, FIELDS, {}, [])).toBeNull();
  });

  it('refuses a foreign additionalRowClass (only the builder zebra is known)', () => {
    const { root } = buildTemplateView({ ...defaultConfigFor('equal', FIELDS), zebraStriping: true }, FIELDS, {}, PAL, [], { prune: true });
    expect(configFromView(root, ZEBRA_ROW_CLASS, FIELDS, {}, [])).not.toBeNull();
    expect(configFromView(root, "=if([$Status]=='Done','ms-bgColor-green','')", FIELDS, {}, [])).toBeNull();
  });

  it('refuses a hand-built multi-field cell and a non-flex child', () => {
    const { root } = buildTemplateView(defaultConfigFor('equal', FIELDS), FIELDS, {}, PAL, [], { prune: true });
    root.children![0].children![0] = { elmType: 'div', txtContent: '=[$Title]+[$Status]' };
    expect(configFromView(root, undefined, FIELDS, {}, [])).toBeNull();
    const { root: root2 } = buildTemplateView(defaultConfigFor('equal', FIELDS), FIELDS, {}, PAL, [], { prune: true });
    root2.children!.push({ elmType: 'div', txtContent: 'hand-made' });
    expect(configFromView(root2, undefined, FIELDS, {}, [])).toBeNull();
  });

  it('a theme flip between Apply and reopen still round-trips the stripe', () => {
    const c = { ...defaultConfigFor('equal', FIELDS), leftStripe: 'neutral' as const };
    const { root } = buildTemplateView(c, FIELDS, {}, themePalette('dark'), [], { prune: true });
    // reopened under the light palette — the baked dark stripe color must not refuse
    expect(configFromView(root, undefined, FIELDS, {}, [])).not.toBeNull();
  });
});

describe('tile target — the same zones on a vertical canvas', () => {
  const NUMFIELDS: MockField[] = [...FIELDS, { name: 'Progress', type: 'number' }];
  const tileCfg = (): RowTemplateConfig => defaultConfigFor('tile-headline', NUMFIELDS);

  it('tile wireframes seed a tile config carrying the stock tile box', () => {
    const c = tileCfg();
    expect(c.target).toBe('tile');
    expect(c.tileWidth).toBe(254);
    expect(c.tileHeight).toBe(220);
    // row wireframes stay row and carry no tile box
    const r = defaultConfigFor('equal', NUMFIELDS);
    expect(r.target).toBe('row');
    expect(r.tileWidth).toBeUndefined();
  });

  it('the wireframeById fallback stays the ROW blank — tile is an explicit pick', () => {
    expect(wireframeById('never-such-id' as WireframeId).id).toBe('blank');
  });

  it('builds a vertical stack that fills the tile box, allow-listed styles only', async () => {
    const { root, additionalRowClass } = buildTemplateView(tileCfg(), NUMFIELDS, {}, PAL);
    expect(root._elmName).toBe('Tile layout');
    expect(root.style!['flex-direction']).toBe('column');
    expect(root.style!['height']).toBe('100%');
    expect(root.style!['box-sizing']).toBe('border-box');
    expect(additionalRowClass).toBeUndefined();
    const { ALLOWED_STYLES } = await import('../core/schema');
    for (const k of Object.keys(root.style!)) expect(ALLOWED_STYLES.has(k), k).toBe(true);
  });

  it('zebra is disabled for tiles with a reason and never reaches the wrapper', () => {
    const c = { ...tileCfg(), zebraStriping: true };
    expect(composeRowStyle(c, PAL).disabled.zebra).toContain('tiles sit in a grid');
    expect(buildTemplateView(c, NUMFIELDS, {}, PAL).additionalRowClass).toBeUndefined();
  });

  it('the kebab never lands in a tile — buildTemplateView and childSlotOrder agree', () => {
    const c: RowTemplateConfig = { ...tileCfg(), kebab: { enabled: true, behavior: 'native', position: 'right', actions: { ...NATIVE_ACTIONS } } };
    const { root } = buildTemplateView(c, NUMFIELDS, {}, PAL);
    expect(root.children!.every((k) => k.elmType === 'div')).toBe(true); // zones only, no ⋯ button
    expect(childSlotOrder(c)).toEqual(c.zones.map((_, i) => i));
  });

  it('card + hover styling composes on the tile root exactly like a row', () => {
    const c = { ...tileCfg(), rowStyle: 'card' as const, hoverHighlight: true };
    const { root } = buildTemplateView(c, NUMFIELDS, {}, PAL);
    expect(String(root.attributes!.class)).toContain('ms-bgColor-white');
    expect(String(root.attributes!.class)).toContain('ms-bgColor-themeLighter--hover');
    expect(root.style!['border-radius']).toBe('4px');
  });

  it('every tile wireframe survives apply → reopen as a TILE config (the round trip)', () => {
    for (const wf of WIREFRAMES.filter((w) => w.target === 'tile')) {
      const seeded = defaultConfigFor(wf.id, NUMFIELDS);
      const { root, additionalRowClass } = buildTemplateView(seeded, NUMFIELDS, {}, PAL, [CHIP], { prune: true });
      expect(additionalRowClass, wf.id).toBeUndefined();
      const parsed = configFromView(root, undefined, NUMFIELDS, {}, [CHIP], 'tile');
      expect(parsed, wf.id).not.toBeNull();
      expect(parsed!.target).toBe('tile');
      expect(parsed!.zones, wf.id).toEqual(seeded.zones.filter((z) => z.items.length > 0));
    }
  });

  it('a tile tree refuses to parse as a row, and a row tree as a tile (the rebuild gate)', () => {
    const t = buildTemplateView(tileCfg(), NUMFIELDS, {}, PAL, [], { prune: true });
    expect(configFromView(t.root, undefined, NUMFIELDS, {}, [], 'row')).toBeNull();
    const r = buildTemplateView(defaultConfigFor('equal', NUMFIELDS), NUMFIELDS, {}, PAL, [], { prune: true });
    expect(configFromView(r.root, undefined, NUMFIELDS, {}, [], 'tile')).toBeNull();
  });

  it('a tile arriving with an additionalRowClass is foreign by definition', () => {
    const t = buildTemplateView(tileCfg(), NUMFIELDS, {}, PAL, [], { prune: true });
    expect(configFromView(t.root, ZEBRA_ROW_CLASS, NUMFIELDS, {}, [], 'tile')).toBeNull();
  });

  it('tile styling + zone knobs round-trip (card, compact, centered stack)', () => {
    let c: RowTemplateConfig = { ...tileCfg(), rowStyle: 'card', density: 'compact', hoverHighlight: true };
    c = patchZoneAt(c, [1], { flow: 'stack', align: 'center' });
    const { root } = buildTemplateView(c, NUMFIELDS, {}, PAL, [CHIP], { prune: true });
    const parsed = configFromView(root, undefined, NUMFIELDS, {}, [CHIP], 'tile')!;
    expect(parsed).toMatchObject({ target: 'tile', rowStyle: 'card', density: 'compact', hoverHighlight: true });
    expect(parsed.zones[1]).toMatchObject({ flow: 'stack', align: 'center' });
  });
});

describe('childSlotOrder mirrors buildTemplateView child order (incl. spliced kebab)', () => {
  const len = (c: RowTemplateConfig): number =>
    buildTemplateView(c, FIELDS, {}, PAL).root.children?.length ?? 0;

  it('no kebab → one slot per zone, in order', () => {
    const c = defaultConfigFor('avatar-card', FIELDS);
    expect(childSlotOrder(c)).toEqual([0, 1, 2]);
    expect(childSlotOrder(c).length).toBe(len(c));
  });

  it('kebab right → appended last', () => {
    const c: RowTemplateConfig = { ...defaultConfigFor('avatar-card', FIELDS), kebab: { enabled: true, behavior: 'native', position: 'right', actions: { ...NATIVE_ACTIONS } } };
    expect(childSlotOrder(c)).toEqual([0, 1, 2, 'kebab']);
    expect(childSlotOrder(c).length).toBe(len(c));
  });

  it('kebab title → spliced after the first zone', () => {
    const c: RowTemplateConfig = { ...defaultConfigFor('avatar-card', FIELDS), kebab: { enabled: true, behavior: 'native', position: 'title', actions: { ...NATIVE_ACTIONS } } };
    expect(childSlotOrder(c)).toEqual([0, 'kebab', 1, 2]);
    expect(childSlotOrder(c).length).toBe(len(c));
  });

  it('a refused (all-blank custom) kebab leaves no slot', () => {
    const c: RowTemplateConfig = { ...defaultConfigFor('avatar-card', FIELDS), kebab: { enabled: true, behavior: 'custom', position: 'right', actions: { ...NATIVE_ACTIONS } } };
    expect(childSlotOrder(c)).toEqual([0, 1, 2]);     // buildKebab → null, not placed
    expect(childSlotOrder(c).length).toBe(len(c));
  });
});
