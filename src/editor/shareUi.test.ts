/**
 * The share round trip and the boot-safety plumbing:
 *   - a workspace → link → workspace round trip is byte-for-byte through
 *     serializeProject/loadProject (the W1 acceptance contract)
 *   - a bare formatter JSON payload (a raw pnp/List-Formatting sample) opens
 *     as a synthesized workspace — the docs-runtime bridge
 *   - autosave pausing really keeps the recipient's key untouched
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { EditorState } from './state';
import { normalizeSharedPayload } from './shareUi';
import { encodeShareFragment, decodeShareFragment, parseShareHash } from '../core/share';

beforeEach(() => {
  localStorage.clear();
});

describe('workspace round trip through the codec', () => {
  it('serializeProject → encode → decode → loadProject is byte-for-byte', async () => {
    const source = new EditorState();
    source.createView({ kind: 'row', root: { elmType: 'div', txtContent: '[$Title]' } }, 'Quarterly view');
    source.rows[0].Title = 'Zürich rollout 🚀';
    const original = source.serializeProject();

    const frag = await encodeShareFragment(original);
    const decoded = await decodeShareFragment(parseShareHash(`#${frag}`)!);

    const target = new EditorState();
    target.loadProject(normalizeSharedPayload(decoded));
    expect(target.serializeProject()).toBe(original);
  });

  it('a w1 link with FUTURE additive project keys still loads', async () => {
    const project = JSON.parse(new EditorState().serializeProject());
    project.futureFeatureNobodyHasBuiltYet = { knobs: [1, 2, 3] };
    const decoded = await decodeShareFragment(parseShareHash(`#${await encodeShareFragment(JSON.stringify(project))}`)!);
    const target = new EditorState();
    target.loadProject(normalizeSharedPayload(decoded)); // must not throw
    expect(target.floorDoc.kind).toBe('grid');
  });

  it('a PRE-Stage-1 payload is refused by the load guard — no migration path exists', async () => {
    const legacy = JSON.stringify({
      version: 1,
      doc: { kind: 'grid', root: { elmType: 'div' } },
      fields: [], rows: [], columnRefs: {}, viewName: 'View 1',
    });
    const decoded = await decodeShareFragment(parseShareHash(`#${await encodeShareFragment(legacy)}`)!);
    // normalize can't read it as a workspace, and it's no bare formatter either
    expect(() => new EditorState().loadProject(normalizeSharedPayload(decoded)))
      .toThrow();
  });

  it('a minified payload (what the Share dialog actually sends) round-trips identically', async () => {
    const source = new EditorState();
    const original = source.serializeProject();
    const minified = JSON.stringify(JSON.parse(original));

    const decoded = await decodeShareFragment(parseShareHash(`#${await encodeShareFragment(minified)}`)!);
    const target = new EditorState();
    target.loadProject(normalizeSharedPayload(decoded));
    expect(target.serializeProject()).toBe(original);
  });
});

describe('normalizeSharedPayload — bare formatter JSON becomes a live workspace', () => {
  it('passes real project files through untouched', () => {
    const json = new EditorState().serializeProject();
    expect(normalizeSharedPayload(json)).toBe(json);
  });

  it('wraps a raw column formatter (a PnP sample): seeded as the current field\'s LOOK, embedded by the floor', () => {
    const sample = JSON.stringify({
      elmType: 'div',
      txtContent: '@currentField',
      style: { 'background-color': "=if([$Approval]=='Rejected','#d13438','')" },
    });
    const normalized = normalizeSharedPayload(sample);
    // the synthesized workspace is a version-3 payload seeding columnLooks
    // with the inlined (explicit-dialect, unstamped) look for the field
    const payload = JSON.parse(normalized);
    expect(payload.version).toBe(3);
    expect(Object.keys(payload.columnLooks)).toEqual(['Status']);
    expect(payload.columnLooks.Status.txtContent).toBe('[$Status]');
    expect(payload.columnLooks.Status._component).toBeUndefined();

    const s = new EditorState();
    s.loadProject(normalized);
    expect(s.onFloor).toBe(true);
    expect(s.doc.kind).toBe('grid');
    expect(s.columnLooks[s.currentFieldName].txtContent).toBe(`[$${s.currentFieldName}]`);
    // the floor's cell for that field EMBEDS a clone of the look (no
    // reference element), wearing the cell's grid-layout styles
    const cell = s.floorDoc.root.children!.find((c) => c._field === s.currentFieldName)!;
    expect(cell.txtContent).toBe(`[$${s.currentFieldName}]`);
    expect(cell.style?.['background-color']).toBe("=if([$Approval]=='Rejected','#d13438','')");
    expect(cell.style?.['flex']).toBe('1');
    // referenced-but-unknown fields get text stubs so the sample renders
    expect(s.fields.some((f) => f.name === 'Approval')).toBe(true);
    expect(s.rows.length).toBeGreaterThan(0);
  });

  it('a rowFormatter share seeds NO looks — columnLooks arrives empty', () => {
    const payload = JSON.parse(normalizeSharedPayload(
      JSON.stringify({ rowFormatter: { elmType: 'div', txtContent: '[$Title]' } }),
    ));
    expect(payload.version).toBe(3);
    expect(payload.columnLooks).toEqual({});
  });

  it('wraps a rowFormatter wrapper as a named view over a default floor', () => {
    const sample = JSON.stringify({ rowFormatter: { elmType: 'div', txtContent: '[$Title]' } });
    const s = new EditorState();
    s.loadProject(normalizeSharedPayload(sample));
    expect(s.doc.kind).toBe('row');
    expect(s.views).toHaveLength(1);
    expect(s.views[0].name).toBe('Shared formatter');
    expect(s.floorDoc.kind).toBe('grid');
  });

  it('refuses anything that is neither a project nor a formatter', () => {
    expect(() => normalizeSharedPayload('{"hello":"world"}')).toThrow(/Unrecognized formatter shape/);
  });
});

describe('autosave pausing — the never-clobber guarantee', () => {
  it('a paused state writes nothing, even on flush; resume(true) writes', () => {
    const s = new EditorState();
    s.pauseAutosave();
    s.loadProject(new EditorState().serializeProject()); // emits → schedules
    s.flushAutosave();
    expect(localStorage.getItem(EditorState.STORAGE_KEY)).toBeNull();

    s.resumeAutosave(true);
    expect(localStorage.getItem(EditorState.STORAGE_KEY)).not.toBeNull();
  });

  it('pausing does not disturb an existing autosave from someone’s own work', () => {
    localStorage.setItem(EditorState.STORAGE_KEY, '{"their":"work"}');
    const s = new EditorState();
    s.pauseAutosave();
    s.loadProject(new EditorState().serializeProject());
    s.flushAutosave();
    expect(localStorage.getItem(EditorState.STORAGE_KEY)).toBe('{"their":"work"}');
  });
});
