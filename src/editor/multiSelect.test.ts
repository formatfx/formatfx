import { describe, it, expect } from 'vitest';
import type { SPElement } from '../core/types';
import {
  unify, unifyBy, valuesEqual, unionStyleProps, unionAttrs, styleAcross, txtContentAcross,
} from './multiSelect';

describe('valuesEqual', () => {
  it('compares primitives and AST objects structurally', () => {
    expect(valuesEqual('a', 'a')).toBe(true);
    expect(valuesEqual(1, 1)).toBe(true);
    expect(valuesEqual({ operator: '+', operands: ['a'] }, { operator: '+', operands: ['a'] })).toBe(true);
    expect(valuesEqual('a', 'b')).toBe(false);
    expect(valuesEqual(undefined, undefined)).toBe(true);
    expect(valuesEqual(undefined, 'a')).toBe(false);
  });
});

describe('unify / unifyBy', () => {
  it('reports uniform when all values match', () => {
    expect(unify(['red', 'red', 'red'])).toEqual({ uniform: true, value: 'red' });
  });
  it('reports divergent with all values when they differ', () => {
    expect(unify(['red', 'blue'])).toEqual({ uniform: false, values: ['red', 'blue'] });
  });
  it('a single value is trivially uniform', () => {
    expect(unify(['red'])).toEqual({ uniform: true, value: 'red' });
  });
  it('unifyBy reads then unifies', () => {
    const nodes: SPElement[] = [
      { elmType: 'div', style: { color: 'red' } },
      { elmType: 'span', style: { color: 'red' } },
    ];
    expect(unifyBy(nodes, (n) => n.style?.color)).toEqual({ uniform: true, value: 'red' });
  });
});

describe('union of properties across a selection', () => {
  const nodes: SPElement[] = [
    { elmType: 'div', style: { color: 'red', padding: '4px' }, attributes: { class: 'a' } },
    { elmType: 'span', style: { color: 'blue', 'font-size': '12px' }, attributes: { title: 't' } },
  ];
  it('unionStyleProps merges keys in first-seen order, dropping undefined', () => {
    expect(unionStyleProps(nodes)).toEqual(['color', 'padding', 'font-size']);
    const withUndef: SPElement[] = [{ elmType: 'div', style: { color: undefined, width: '10px' } }];
    expect(unionStyleProps(withUndef)).toEqual(['width']);
  });
  it('unionAttrs merges attribute keys', () => {
    expect(unionAttrs(nodes)).toEqual(['class', 'title']);
  });
  it('styleAcross detects divergence', () => {
    expect(styleAcross(nodes, 'color')).toEqual({ uniform: false, values: ['red', 'blue'] });
    expect(styleAcross(nodes, 'padding')).toEqual({ uniform: false, values: ['4px', undefined] });
  });
  it('txtContentAcross unifies shared content', () => {
    const same: SPElement[] = [
      { elmType: 'div', txtContent: '[$Title]' },
      { elmType: 'div', txtContent: '[$Title]' },
    ];
    expect(txtContentAcross(same)).toEqual({ uniform: true, value: '[$Title]' });
  });
});
