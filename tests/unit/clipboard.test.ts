import { strict as assert } from 'assert';
import { cellsToClipboardText, clipboardTextToMatrix } from '../../src/services/clipboardService';
import { Cell } from '../../src/types/workbook';

describe('clipboardService', () => {
  it('serializes a 2x2 range as tab/newline separated text', () => {
    const matrix: Cell[][] = [
      [{ raw: 'a', value: 'a', type: 'string' }, { raw: '1', value: 1, type: 'number' }],
      [{ raw: 'b', value: 'b', type: 'string' }, { raw: '2', value: 2, type: 'number' }],
    ];
    assert.equal(cellsToClipboardText(matrix), 'a\t1\nb\t2');
  });

  it('quotes values containing tabs or newlines', () => {
    const matrix: Cell[][] = [[{ raw: 'has\ttab', value: 'has\ttab', type: 'string' }]];
    const text = cellsToClipboardText(matrix);
    assert.ok(text.startsWith('"') && text.endsWith('"'));
  });

  it('parses pasted tab-separated text back into a matrix', () => {
    const matrix = clipboardTextToMatrix('a\t1\nb\t2');
    assert.deepEqual(matrix, [['a', '1'], ['b', '2']]);
  });

  it('round-trips a quoted cell containing an embedded newline', () => {
    const original: Cell[][] = [[{ raw: 'line1\nline2', value: 'line1\nline2', type: 'string' }]];
    const text = cellsToClipboardText(original);
    const parsed = clipboardTextToMatrix(text);
    assert.equal(parsed[0][0], 'line1\nline2');
  });
});
