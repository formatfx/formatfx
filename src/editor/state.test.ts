/**
 * Editor state: customCardProps content is addressable via the CARD_SEGMENT
 * path segment, so the tree/inspector/palette can edit card formatters.
 */
import { describe, it, expect } from 'vitest';
import { EditorState, CARD_SEGMENT } from './state';

function withCard(): EditorState {
  const s = new EditorState();
  s.doc.root.children = [{
    elmType: 'button',
    txtContent: 'Open',
    customCardProps: {
      openOnEvent: 'click',
      formatter: { elmType: 'div', children: [{ elmType: 'span', txtContent: 'inside' }] },
    },
  }];
  return s;
}

describe('card-segment paths', () => {
  it('nodeAt descends into customCardProps.formatter', () => {
    const s = withCard();
    expect(s.nodeAt([0, CARD_SEGMENT])?.elmType).toBe('div');
    expect(s.nodeAt([0, CARD_SEGMENT, 0])?.txtContent).toBe('inside');
  });

  it('insertNode targets containers inside the card', () => {
    const s = withCard();
    const path = s.insertNode({ elmType: 'span', txtContent: 'new' }, [0, CARD_SEGMENT]);
    expect(path).toEqual([0, CARD_SEGMENT, 1]);
    expect(s.nodeAt(path)?.txtContent).toBe('new');
  });

  it('removeNode works on card children; card root itself is protected', () => {
    const s = withCard();
    s.removeNode([0, CARD_SEGMENT, 0]);
    expect(s.nodeAt([0, CARD_SEGMENT])?.children).toHaveLength(0);
    s.removeNode([0, CARD_SEGMENT]); // no-op — no sibling list to splice
    expect(s.nodeAt([0, CARD_SEGMENT])).not.toBeNull();
  });

  it('mainDocLabel describes the document, even while a ref is open', () => {
    const s = withCard();
    expect(s.mainDocLabel()).toBe('View formatter — grid'); // grid-first showcase default
    s.doc.kind = 'column';
    expect(s.mainDocLabel()).toContain('Column formatter on [$Status]');
    s.doc.kind = 'row';
    s.columnRefs['StatusUI'] = { elmType: 'span', txtContent: '[$Status]' };
    s.openColumnRef('StatusUI');
    expect(s.mainDocLabel()).toBe('View formatter — row layout'); // still describes MAIN
  });

  it('referencedColumns finds CFRs in children and inside customCardProps', () => {
    const s = withCard();
    s.doc.root.children!.push({ elmType: 'div', columnFormatterReference: '[$StatusUI]' });
    s.doc.root.children![0].customCardProps!.formatter.children!.push(
      { elmType: 'div', columnFormatterReference: '[$ProgressUI]' },
    );
    const refs = s.referencedColumns();
    expect(refs.has('StatusUI')).toBe(true);
    expect(refs.has('ProgressUI')).toBe(true);
    // scans the MAIN doc even while a column formatter is open
    s.columnRefs['StatusUI'] = { elmType: 'span', txtContent: 'x' };
    s.openColumnRef('StatusUI');
    expect(s.referencedColumns().has('StatusUI')).toBe(true);
  });

  it('workspace switching: edit a column formatter, CFR registry updates live, main is restored', () => {
    const s = withCard();
    s.columnRefs['StatusUI'] = { elmType: 'span', txtContent: '[$Status]' };
    const mainRoot = s.doc.root;

    s.openColumnRef('StatusUI');
    expect(s.activeDocKey).toBe('StatusUI');
    expect(s.doc.kind).toBe('column');
    expect(s.doc.root.txtContent).toBe('[$Status]');

    // edit while open — registry must reflect it immediately
    s.mutateDocument(() => { s.doc.root.txtContent = '=toUpperCase([$Status])'; });
    expect(s.columnRefs['StatusUI'].txtContent).toBe('=toUpperCase([$Status])');

    s.openMain();
    expect(s.activeDocKey).toBe('main');
    expect(s.doc.root).toBe(mainRoot);
    expect(s.columnRefs['StatusUI'].txtContent).toBe('=toUpperCase([$Status])');
  });

  it('serializeProject stores the MAIN doc even while a column formatter is open', () => {
    const s = withCard();
    s.columnRefs['StatusUI'] = { elmType: 'span', txtContent: '[$Status]' };
    s.openColumnRef('StatusUI');
    const p = JSON.parse(s.serializeProject());
    expect(p.doc.root.children[0].elmType).toBe('button'); // main tree, not the ref
    expect(p.columnRefs.StatusUI.txtContent).toBe('[$Status]');
  });

  it('wrapNode adds a parent — including around the root and card roots', () => {
    const s = withCard();
    const oldRoot = s.doc.root;
    s.wrapNode([]);
    expect(s.doc.root.children?.[0]).toBe(oldRoot);
    expect(s.doc.root.style?.display).toBe('flex');
    // wrap a card formatter root
    const cardRoot = s.nodeAt([0, 0, CARD_SEGMENT]);
    s.wrapNode([0, 0, CARD_SEGMENT]);
    expect(s.nodeAt([0, 0, CARD_SEGMENT])?.children?.[0]).toBe(cardRoot);
  });

  it('project save/load round-trips columnRefs', () => {
    const s = withCard();
    s.columnRefs['StatusUI'] = { elmType: 'span', txtContent: '[$Status]' };
    const text = s.serializeProject();
    const s2 = new EditorState();
    s2.loadProject(text);
    expect(s2.columnRefs['StatusUI'].txtContent).toBe('[$Status]');
  });
});
