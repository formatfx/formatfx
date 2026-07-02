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
    source.viewName = 'Quarterly view';
    source.rows[0].Title = 'Zürich rollout 🚀';
    const original = source.serializeProject();

    const frag = await encodeShareFragment(original);
    const decoded = await decodeShareFragment(parseShareHash(`#${frag}`)!);

    const target = new EditorState();
    target.loadProject(normalizeSharedPayload(decoded));
    expect(target.serializeProject()).toBe(original);
  });

  it('a w1 link with FUTURE additive project keys still loads (the SHARE-URL.md stability promise)', async () => {
    const project = JSON.parse(new EditorState().serializeProject());
    project.futureFeatureNobodyHasBuiltYet = { knobs: [1, 2, 3] };
    const decoded = await decodeShareFragment(parseShareHash(`#${await encodeShareFragment(JSON.stringify(project))}`)!);
    const target = new EditorState();
    target.loadProject(normalizeSharedPayload(decoded)); // must not throw
    expect(target.viewName).toBe(project.viewName);
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

  it('wraps a raw column formatter (a PnP sample) in a default workspace', () => {
    const sample = JSON.stringify({
      elmType: 'div',
      txtContent: '@currentField',
      style: { 'background-color': "=if([$Approval]=='Rejected','#d13438','')" },
    });
    const s = new EditorState();
    s.loadProject(normalizeSharedPayload(sample));
    expect(s.doc.kind).toBe('column');
    // referenced-but-unknown fields get text stubs so the sample renders
    expect(s.fields.some((f) => f.name === 'Approval')).toBe(true);
    expect(s.rows.length).toBeGreaterThan(0);
    expect(s.viewName).toBe('Shared formatter');
  });

  it('wraps a rowFormatter wrapper as a row document', () => {
    const sample = JSON.stringify({ rowFormatter: { elmType: 'div', txtContent: '[$Title]' } });
    const s = new EditorState();
    s.loadProject(normalizeSharedPayload(sample));
    expect(s.doc.kind).toBe('row');
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
