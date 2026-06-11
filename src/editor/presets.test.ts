/**
 * Schema-aware preset binding: default field refs remap to the user's
 * best-matching columns by type when the defaults don't exist.
 */
import { describe, it, expect } from 'vitest';
import { bindFragmentToSchema, PALETTE, instantiate } from './presets';
import type { MockField, SPElement } from '../core/types';

const customSchema: MockField[] = [
  { name: 'ID', type: 'number', protected: true },
  { name: 'TaskName', type: 'text' },
  { name: 'Phase', type: 'choice', choices: ['Plan', 'Build'] },
  { name: 'Deadline', type: 'date' },
  { name: 'Pct', type: 'number' },
  { name: 'Team', type: 'personMulti' },
  { name: 'Parent', type: 'lookup', lookup: { list: 'Epics', column: 'Title' } },
];

describe('bindFragmentToSchema', () => {
  it('remaps default refs by field type, skipping protected columns', () => {
    const fragment: SPElement = {
      elmType: 'div',
      txtContent: "=if([$Status]=='Done','x',[$Status])",
      style: { 'width': "=[$Progress]+'%'" },
      children: [
        { elmType: 'span', forEach: '_p in [$AssignedTo]', txtContent: '=[$_p.title]' },
        { elmType: 'span', txtContent: '[$Project.lookupValue]' },
      ],
    };
    const bound = bindFragmentToSchema(fragment, customSchema);
    expect(bound.txtContent).toBe("=if([$Phase]=='Done','x',[$Phase])");
    // Pct is the first non-protected number — ID must not be chosen
    expect(bound.style?.['width']).toBe("=[$Pct]+'%'");
    expect(bound.children?.[0].forEach).toBe('_p in [$Team]');
    expect(bound.children?.[1].txtContent).toBe('[$Parent.lookupValue]');
  });

  it('leaves refs alone when the user has the same column names', () => {
    const fragment: SPElement = { elmType: 'span', txtContent: '=[$Status]' };
    const bound = bindFragmentToSchema(fragment, [{ name: 'Status', type: 'choice' }]);
    expect(bound.txtContent).toBe('=[$Status]');
  });

  it('does not mutate its input', () => {
    const fragment: SPElement = { elmType: 'span', txtContent: '=[$Status]' };
    bindFragmentToSchema(fragment, customSchema);
    expect(fragment.txtContent).toBe('=[$Status]');
  });

  it('binds every palette preset without throwing', () => {
    for (const item of PALETTE) {
      expect(() => instantiate(item, customSchema)).not.toThrow();
    }
  });
});
