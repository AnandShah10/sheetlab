import { strict as assert } from 'assert';
import { runWorkbookTests } from '../../src/testing/testRunner';
import { Workbook } from '../../src/types/workbook';

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
});
