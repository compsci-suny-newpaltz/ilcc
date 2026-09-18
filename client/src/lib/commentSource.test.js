import { describe, expect, it } from 'vitest';
import { commentSource } from './commentSource';

describe('commentSource', () => {
  it('retains source indentation and blank lines with the default 32-column offset', () => {
    expect(commentSource('c0607.c', 'void f(int x)\n{\n   if (x < 10)\n\n      f(x + 1);\n}\n')).toEqual({
      name: 'c0607.a',
      content: '\t'.repeat(8) + '; void f(int x)\n'
        + '\t'.repeat(8) + '; {\n'
        + '\t'.repeat(8) + '   ; if (x < 10)\n\n'
        + '\t'.repeat(8) + '      ; f(x + 1);\n'
        + '\t'.repeat(8) + '; }\n',
    });
  });

  it('uses the current tab width and spaces for an incomplete tab stop', () => {
    expect(commentSource('source.txt', '\treturn 0;', { indent: 32, tabSize: 6 })).toEqual({
      name: 'source.a', content: '\t'.repeat(5) + '  \t; return 0;\n',
    });
    expect(commentSource('source', 'x', { indent: 0 }).content).toBe('; x\n');
  });

  it('normalizes line endings, removes a BOM and ensures a final newline', () => {
    expect(commentSource('lab.part.C', '\uFEFFx\r\n \t\r\ny\r').content)
      .toBe('\t'.repeat(8) + '; x\n\n' + '\t'.repeat(8) + '; y\n');
    expect(commentSource('empty.c', '').content).toBe('\n');
  });

  it('rejects invalid conversion settings', () => {
    expect(() => commentSource('x.c', 'x', { indent: -1 })).toThrow('Indentation');
    expect(() => commentSource('x.c', 'x', { tabSize: 0 })).toThrow('Tab size');
  });
});
