import { strict as assert } from 'assert';
import { Workbook } from '../../src/types/workbook';
import { runQuery } from '../../src/query/queryEngine';

function makeWorkbook(): Workbook {
  return {
    meta: { sourceKind: 'csv', sourcePath: '', sheetOrder: ['Sheet1'] },
    sheets: {
      Sheet1: {
        name: 'Sheet1',
        rowCount: 4,
        colCount: 3,
        rows: {
          0: {
            0: { raw: 'Department', value: 'Department', type: 'string' },
            1: { raw: 'Sales', value: 'Sales', type: 'string' },
            2: { raw: 'Country', value: 'Country', type: 'string' },
          },
          1: {
            0: { raw: 'Eng', value: 'Eng', type: 'string' },
            1: { raw: '1200', value: 1200, type: 'number' },
            2: { raw: 'India', value: 'India', type: 'string' },
          },
          2: {
            0: { raw: 'Sales', value: 'Sales', type: 'string' },
            1: { raw: '800', value: 800, type: 'number' },
            2: { raw: 'USA', value: 'USA', type: 'string' },
          },
          3: {
            0: { raw: 'Eng', value: 'Eng', type: 'string' },
            1: { raw: '400', value: 400, type: 'number' },
            2: { raw: 'India', value: 'India', type: 'string' },
          },
        },
        columns: {},
        rowMeta: {},
      },
    },
  };
}

describe('runQuery', () => {
  it('runs a plain SELECT with WHERE filter', () => {
    const result = runQuery(makeWorkbook(), "SELECT * FROM Sheet1 WHERE Country = 'India'", 1000);
    if ('message' in result) throw new Error('expected success, got: ' + result.message);
    assert.equal(result.rowCount, 2);
  });

  it('runs GROUP BY with SUM aggregation', () => {
    const result = runQuery(
      makeWorkbook(),
      'SELECT Department, SUM(Sales) AS TotalSales FROM Sheet1 GROUP BY Department ORDER BY TotalSales DESC',
      1000,
    );
    if ('message' in result) throw new Error('expected success, got: ' + result.message);
    assert.equal(result.columns.join(','), 'Department,TotalSales');
    assert.equal(result.rows[0][0], 'Eng');
    assert.equal(result.rows[0][1], 1600);
    assert.equal(result.rows[1][1], 800);
  });

  it('returns a structured error for an unknown column', () => {
    const result = runQuery(makeWorkbook(), 'SELECT Nope FROM Sheet1', 1000);
    if (!('message' in result)) throw new Error('expected an error result');
    assert.match(result.message, /Unknown column/);
  });

  it('returns a structured error for an unknown sheet', () => {
    const result = runQuery(makeWorkbook(), 'SELECT * FROM NoSuchSheet', 1000);
    if (!('message' in result)) throw new Error('expected an error result');
    assert.match(result.message, /Unknown sheet/);
  });

  it('never mutates the source workbook', () => {
    const wb = makeWorkbook();
    const before = JSON.stringify(wb);
    runQuery(wb, 'SELECT * FROM Sheet1', 1000);
    assert.equal(JSON.stringify(wb), before);
  });
});
