import { strict as assert } from 'assert';
import { runPivot } from '../../src/analysis/pivot';
import { Worksheet } from '../../src/types/workbook';

function sheet(): Worksheet {
  return {
    name: 'S',
    rowCount: 5,
    colCount: 3,
    rows: {
      0: {
        0: { raw: 'Region', value: 'Region', type: 'string' },
        1: { raw: 'Product', value: 'Product', type: 'string' },
        2: { raw: 'Sales', value: 'Sales', type: 'string' },
      },
      1: {
        0: { raw: 'East', value: 'East', type: 'string' },
        1: { raw: 'A', value: 'A', type: 'string' },
        2: { raw: '10', value: 10, type: 'number' },
      },
      2: {
        0: { raw: 'East', value: 'East', type: 'string' },
        1: { raw: 'B', value: 'B', type: 'string' },
        2: { raw: '20', value: 20, type: 'number' },
      },
      3: {
        0: { raw: 'West', value: 'West', type: 'string' },
        1: { raw: 'A', value: 'A', type: 'string' },
        2: { raw: '30', value: 30, type: 'number' },
      },
      4: {
        0: { raw: 'West', value: 'West', type: 'string' },
        1: { raw: 'A', value: 'A', type: 'string' },
        2: { raw: '5', value: 5, type: 'number' },
      },
    },
    columns: {},
    rowMeta: {},
  };
}

describe('runPivot', () => {
  it('pivots region rows with sum of sales', () => {
    const r = runPivot(sheet(), {
      sheetName: 'S',
      headerRow: 0,
      rowFields: [0],
      colFields: [],
      values: [{ col: 2, agg: 'sum' }],
    });
    assert.ok(r.rows.length >= 2);
    const east = r.rows.find((row) => row[0] === 'East');
    assert.ok(east);
    assert.equal(east![1], 30);
  });

  it('pivots with column field', () => {
    const r = runPivot(sheet(), {
      sheetName: 'S',
      headerRow: 0,
      rowFields: [0],
      colFields: [1],
      values: [{ col: 2, agg: 'sum' }],
    });
    assert.ok(r.columns.length > 2);
    assert.ok(r.rows.length >= 2);
  });
});
