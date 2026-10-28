
import { strict as assert } from 'assert';
import { parseQuery } from '../../src/query/queryParser';
import { runQuery } from '../../src/query/queryEngine';
import { Workbook } from '../../src/types/workbook';

function makeJoinWorkbook(): Workbook {
  return {
    meta: { sourceKind: 'xlsx', sourcePath: '', sheetOrder: ['Orders', 'Products'] },
    sheets: {
      Orders: {
        name: 'Orders',
        rowCount: 4,
        colCount: 2,
        rows: {
          0: { 0: { raw: 'Id', value: 'Id', type: 'string' }, 1: { raw: 'ProductId', value: 'ProductId', type: 'string' } },
          1: { 0: { raw: '1', value: 1, type: 'number' }, 1: { raw: '10', value: 10, type: 'number' } },
          2: { 0: { raw: '2', value: 2, type: 'number' }, 1: { raw: '20', value: 20, type: 'number' } },
          3: { 0: { raw: '3', value: 3, type: 'number' }, 1: { raw: '99', value: 99, type: 'number' } },
        },
        columns: {},
        rowMeta: {},
      },
      Products: {
        name: 'Products',
        rowCount: 3,
        colCount: 2,
        rows: {
          0: { 0: { raw: 'Id', value: 'Id', type: 'string' }, 1: { raw: 'Name', value: 'Name', type: 'string' } },
          1: { 0: { raw: '10', value: 10, type: 'number' }, 1: { raw: 'Widget', value: 'Widget', type: 'string' } },
          2: { 0: { raw: '20', value: 20, type: 'number' }, 1: { raw: 'Gadget', value: 'Gadget', type: 'string' } },
        },
        columns: {},
        rowMeta: {},
      },
    },
  };
}

describe('JOIN parse', () => {
  it('parses INNER JOIN with aliases', () => {
    const q = parseQuery('SELECT a.Id, b.Name FROM Orders a INNER JOIN Products b ON a.ProductId = b.Id');
    assert.equal(q.from, 'Orders');
    assert.equal(q.fromAlias, 'a');
    assert.equal(q.joins.length, 1);
    assert.equal(q.joins[0].type, 'INNER');
    assert.equal(q.joins[0].sheet, 'Products');
    assert.equal(q.joins[0].alias, 'b');
    assert.equal(q.joins[0].on[0].left.column, 'ProductId');
    assert.equal(q.joins[0].on[0].right.column, 'Id');
  });

  it('parses multi-key ON with AND', () => {
    const q = parseQuery(
      'SELECT * FROM Orders a INNER JOIN Products b ON a.ProductId = b.Id AND a.Id = b.Id',
    );
    assert.equal(q.joins[0].on.length, 2);
    assert.equal(q.joins[0].on[1].left.column, 'Id');
  });

  it('parses LEFT JOIN', () => {
    const q = parseQuery('SELECT * FROM Orders a LEFT JOIN Products b ON a.ProductId = b.Id');
    assert.equal(q.joins[0].type, 'LEFT');
  });
});

describe('JOIN execute', () => {
  it('INNER JOIN matches keys', () => {
    const result = runQuery(
      makeJoinWorkbook(),
      'SELECT a.Id, b.Name FROM Orders a INNER JOIN Products b ON a.ProductId = b.Id',
      1000,
    );
    if ('message' in result) throw new Error(result.message);
    assert.equal(result.rowCount, 2);
    assert.ok(result.rows.some((r) => r[1] === 'Widget'));
    assert.ok(result.rows.some((r) => r[1] === 'Gadget'));
  });

  it('LEFT JOIN keeps unmatched left rows', () => {
    const result = runQuery(
      makeJoinWorkbook(),
      'SELECT a.Id, b.Name FROM Orders a LEFT JOIN Products b ON a.ProductId = b.Id',
      1000,
    );
    if ('message' in result) throw new Error(result.message);
    assert.equal(result.rowCount, 3);
    assert.ok(result.rows.some((r) => r[0] === 3 && (r[1] === null || r[1] === undefined || r[1] === '')));
  });
});
