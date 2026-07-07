import { describe, it, expect } from 'vitest';
import type { SPElement } from '../core/types';
import {
  nodeToDeclarations, parseDeclarations, applyDeclarations, valueToText, textToValue,
} from './codeMode';

describe('valueToText / textToValue', () => {
  it('round-trips literal strings, formulas, numbers, AST', () => {
    expect(valueToText('10px 14px')).toBe('10px 14px');
    expect(valueToText("=if([$x]=='a','red','blue')")).toBe("=if([$x]=='a','red','blue')");
    expect(valueToText(600)).toBe('600');
    expect(valueToText({ operator: '+', operands: ['a', 'b'] })).toBe('{"operator":"+","operands":["a","b"]}');
  });
  it('textToValue keeps formulas and literals as strings, parses AST objects', () => {
    expect(textToValue('10px')).toBe('10px');
    expect(textToValue("=@currentField+'%'")).toBe("=@currentField+'%'");
    expect(textToValue('{"operator":"+","operands":["a","b"]}')).toEqual({ operator: '+', operands: ['a', 'b'] });
    // malformed JSON object falls back to the raw string (never throws)
    expect(textToValue('{not json')).toBe('{not json');
  });
});

describe('nodeToDeclarations', () => {
  it('serializes style, attributes and txtContent', () => {
    const node: SPElement = {
      elmType: 'div',
      txtContent: 'Title',
      style: { padding: '10px 14px', 'font-size': '11px', color: '#605e5c' },
      attributes: { class: 'sp-field-severity--good', href: '[$Link]' },
    };
    const text = nodeToDeclarations(node);
    expect(text).toContain('padding: 10px 14px;');
    expect(text).toContain('font-size: 11px;');
    expect(text).toContain('color: #605e5c;');
    expect(text).toContain('@txtContent: Title;');
    expect(text).toContain('@class: sp-field-severity--good;');
    expect(text).toContain('@href: [$Link];');
  });
  it('omits undefined style values and empty nodes', () => {
    expect(nodeToDeclarations({ elmType: 'span' })).toBe('');
    const node: SPElement = { elmType: 'div', style: { color: undefined, width: '10px' } };
    expect(nodeToDeclarations(node)).toBe('width: 10px;');
  });
});

describe('parseDeclarations', () => {
  it('parses style and @attribute lines', () => {
    const p = parseDeclarations('padding: 10px 14px;\nfont-size: 11px;\n@class: foo;\n@txtContent: Hi;');
    expect(p.style).toEqual({ padding: '10px 14px', 'font-size': '11px' });
    expect(p.attributes).toEqual({ class: 'foo' });
    expect(p.txtContent).toBe('Hi');
    expect(p.errors).toEqual([]);
  });
  it('keeps expression values verbatim', () => {
    const p = parseDeclarations("color: =if([$Status]=='Active','green','red');");
    expect(p.style.color).toBe("=if([$Status]=='Active','green','red')");
    expect(p.errors).toEqual([]);
  });
  it('tolerates missing trailing semicolons and blank/comment lines', () => {
    const p = parseDeclarations('\n// a comment\ncolor: red\n\nwidth: 10px;');
    expect(p.style).toEqual({ color: 'red', width: '10px' });
    expect(p.errors).toEqual([]);
  });
  it('collects errors for malformed lines without throwing', () => {
    const p = parseDeclarations('this has no colon\ncolor: red;');
    expect(p.style).toEqual({ color: 'red' });
    expect(p.errors).toHaveLength(1);
    expect(p.errors[0].line).toBe(1);
  });
  it('parses @forEach as a raw string', () => {
    const p = parseDeclarations('@forEach: Item in [$Items];');
    expect(p.forEach).toBe('Item in [$Items]');
  });
});

describe('applyDeclarations', () => {
  it('replaces the four owned fields and clears emptied ones', () => {
    const node: SPElement = {
      elmType: 'div',
      txtContent: 'old',
      style: { color: 'red' },
      attributes: { class: 'x' },
      forEach: 'a in [$b]',
    };
    applyDeclarations(node, parseDeclarations('width: 10px;'));
    expect(node.style).toEqual({ width: '10px' });
    expect(node.attributes).toBeUndefined();
    expect(node.txtContent).toBeUndefined();
    expect(node.forEach).toBeUndefined();
  });
  it('never touches children / superpower fields', () => {
    const child: SPElement = { elmType: 'span', txtContent: 'kid' };
    const node: SPElement = {
      elmType: 'div',
      children: [child],
      inlineEditField: '[$Status]',
      customRowAction: { action: 'defaultClick' },
      customCardProps: { formatter: { elmType: 'div' }, openOnEvent: 'hover' },
    };
    applyDeclarations(node, parseDeclarations('color: blue;'));
    expect(node.children).toEqual([child]);
    expect(node.inlineEditField).toBe('[$Status]');
    expect(node.customRowAction).toEqual({ action: 'defaultClick' });
    expect(node.customCardProps).toBeDefined();
    expect(node.style).toEqual({ color: 'blue' });
  });
  it('round-trips a node through serialize → parse → apply', () => {
    const original: SPElement = {
      elmType: 'div',
      txtContent: 'Title',
      style: { padding: '2px 10px', 'background-color': "=if([$Status]=='Done','#107c10','#737a7f')" },
      attributes: { class: 'sp-field-severity--good' },
    };
    const target: SPElement = { elmType: 'div' };
    applyDeclarations(target, parseDeclarations(nodeToDeclarations(original)));
    expect(target.style).toEqual(original.style);
    expect(target.attributes).toEqual(original.attributes);
    expect(target.txtContent).toBe(original.txtContent);
  });
});
