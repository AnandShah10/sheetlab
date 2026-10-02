import { strict as assert } from 'assert';
import { runWorkbookTests } from '../../src/testing/testRunner';
import { Workbook } from '../../src/types/workbook';

function sample(): Workbook {
  return {
    meta: { sourceKind: 'xlsx', sourcePath: '', sheetOrder: ['Sheet1'] },
    sheets: {
      Sheet1: {
        name: 'Sheet1',
        rowCount: 4,
        colCount: 1,
        rows: {
          0: { 0: { raw: 'id', value: 'id', type: 'string' } },
          1: { 0: { raw: 'a', value: 'a', type: 'string' } },
          2: { 0: { raw: 'b', value: 'b', type: 'string' } },
          3: { 0: { raw: 'a', value: 'a', type: 'string' } },
        },
        columns: {},
        rowMeta: {},
      },
    },
  };
}

describe('testRunner', () => {
  it('passes equals and fails mismatch', () => {
    const wb: Workbook = {
      meta: { sourceKind: 'xlsx', sourcePath: '', sheetOrder: ['Sheet1'] },
      sheets: {
        Sheet1: {
          name: 'Sheet1',
          rowCount: 2,
          colCount: 1,
          rows: {
            0: { 0: { raw: '100', value: 100, type: 'number' } },
          },
          columns: {},
          rowMeta: {},
        },
      },
    };
    const results = runWorkbookTests(wb, {
      version: 1,
      name: 'sample',
      tests: [
        { id: '1', name: 'ok', cell: 'Sheet1!A1', equals: 100 },
        { id: '2', name: 'bad', cell: 'Sheet1!A1', equals: 99 },
      ],
    });
    assert.equal(results[0].passed, true);
    assert.equal(results[1].passed, false);
  });

  it('detects duplicate column values', () => {
    const results = runWorkbookTests(sample(), {
      version: 1,
      name: 'uniq',
      tests: [{ id: 'u1', name: 'ids unique', uniqueColumn: 'id' }],
    });
    assert.equal(results[0].passed, false);
    assert.ok(results[0].message.includes('Duplicate'));
  });
});
