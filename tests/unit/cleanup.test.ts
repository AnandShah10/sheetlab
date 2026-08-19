import { strict as assert } from 'assert';
import { Worksheet } from '../../src/types/workbook';
import { applyCleanup } from '../../src/data/cleanup';

function cell(v: string) {
  return { raw: v, value: v, type: 'string' as const };
}

describe('applyCleanup', () => {
  it('trims whitespace within a range', () => {
    const sheet: Worksheet = {
      name: 'S', rowCount: 1, colCount: 1,
      rows: { 0: { 0: cell('  hello  ') } },
      columns: {}, rowMeta: {},
    };
    const result = applyCleanup(sheet, { startRow: 0, startCol: 0, endRow: 0, endCol: 0 }, { kind: 'trimWhitespace' });
    assert.equal(result.rows[0][0].value, 'hello');
  });

  it('removes duplicate rows within a range', () => {
    const sheet: Worksheet = {
      name: 'S', rowCount: 3, colCount: 1,
      rows: { 0: { 0: cell('a') }, 1: { 0: cell('a') }, 2: { 0: cell('b') } },
      columns: {}, rowMeta: {},
    };
    const result = applyCleanup(sheet, { startRow: 0, startCol: 0, endRow: 2, endCol: 0 }, { kind: 'removeDuplicateRows' });
    assert.equal(Object.keys(result.rows).length, 2);
    assert.equal(result.rows[0][0].value, 'a');
    assert.equal(result.rows[1][0].value, 'b');
  });

  it('does not mutate the original worksheet object', () => {
    const sheet: Worksheet = {
      name: 'S', rowCount: 1, colCount: 1,
      rows: { 0: { 0: cell('  x  ') } },
      columns: {}, rowMeta: {},
    };
    applyCleanup(sheet, { startRow: 0, startCol: 0, endRow: 0, endCol: 0 }, { kind: 'trimWhitespace' });
    assert.equal(sheet.rows[0][0].value, '  x  '); // original untouched
  });

  it('fills down over blanks', () => {
    const sheet: Worksheet = {
      name: 'S', rowCount: 3, colCount: 1,
      rows: { 0: { 0: cell('X') }, 2: { 0: cell('Y') } },
      columns: {}, rowMeta: {},
    };
    const result = applyCleanup(sheet, { startRow: 0, startCol: 0, endRow: 2, endCol: 0 }, { kind: 'fillDown' });
    assert.equal(result.rows[1][0].value, 'X');
    assert.equal(result.rows[2][0].value, 'Y'); // explicit value preserved, not overwritten
  });
});
