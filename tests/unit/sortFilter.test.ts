import { strict as assert } from 'assert';
import { Worksheet } from '../../src/types/workbook';
import { sortRange } from '../../src/data/sort';
import { evaluateFilter, distinctColumnValues } from '../../src/data/filter';

function makeSheet(): Worksheet {
  return {
    name: 'Sheet1',
    rowCount: 4,
    colCount: 2,
    rows: {
      0: { 0: { raw: 'Name', value: 'Name', type: 'string' }, 1: { raw: 'Age', value: 'Age', type: 'string' } },
      1: { 0: { raw: 'Charlie', value: 'Charlie', type: 'string' }, 1: { raw: '35', value: 35, type: 'number' } },
      2: { 0: { raw: 'Alice', value: 'Alice', type: 'string' }, 1: { raw: '30', value: 30, type: 'number' } },
      3: { 0: { raw: 'Bob', value: 'Bob', type: 'string' }, 1: { raw: '25', value: 25, type: 'number' } },
    },
    columns: {},
    rowMeta: {},
  };
}

describe('sortRange', () => {
  it('sorts ascending by a numeric column, keeping rows intact', () => {
    const sheet = makeSheet();
    sortRange(sheet, { startRow: 0, startCol: 0, endRow: 3, endCol: 1 }, [{ col: 1, direction: 'asc' }], true);
    assert.equal(sheet.rows[1][0].value, 'Bob');
    assert.equal(sheet.rows[1][1].value, 25);
    assert.equal(sheet.rows[2][0].value, 'Alice');
    assert.equal(sheet.rows[3][0].value, 'Charlie');
    // Header untouched
    assert.equal(sheet.rows[0][0].value, 'Name');
  });

  it('sorts descending and keeps name/age pairs aligned', () => {
    const sheet = makeSheet();
    sortRange(sheet, { startRow: 0, startCol: 0, endRow: 3, endCol: 1 }, [{ col: 1, direction: 'desc' }], true);
    assert.equal(sheet.rows[1][0].value, 'Charlie');
    assert.equal(sheet.rows[1][1].value, 35);
    assert.equal(sheet.rows[3][0].value, 'Bob');
  });
});

describe('evaluateFilter', () => {
  it('matches rows with numberRange condition', () => {
    const sheet = makeSheet();
    const matches = evaluateFilter(sheet, 1, { kind: 'numberRange', min: 28 }, 0);
    assert.deepEqual(Array.from(matches).sort(), [1, 2]); // Charlie(35), Alice(30)
  });

  it('matches rows with textContains condition case-insensitively', () => {
    const sheet = makeSheet();
    const matches = evaluateFilter(sheet, 0, { kind: 'textContains', value: 'ali' }, 0);
    assert.deepEqual(Array.from(matches), [2]); // Alice
  });

  it('returns distinct column values excluding the header row', () => {
    const sheet = makeSheet();
    const values = distinctColumnValues(sheet, 0, 0);
    assert.deepEqual(values.sort(), ['Alice', 'Bob', 'Charlie']);
  });
});
