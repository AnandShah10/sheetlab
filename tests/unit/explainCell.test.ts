import { strict as assert } from 'assert';
import { explainCell } from '../../src/analysis/explainCell';
import { Workbook } from '../../src/types/workbook';

describe('explainCell', () => {
  it('flags inconsistent neighbor formula patterns', () => {
    const wb: Workbook = {
      meta: { sourceKind: 'xlsx', sourcePath: '', sheetOrder: ['Sheet1'] },
      sheets: {
        Sheet1: {
          name: 'Sheet1',
          rowCount: 5,
          colCount: 3,
          rows: {
            0: { 0: { raw: '1', value: 1, type: 'number' }, 1: { raw: '2', value: 2, type: 'number' } },
            1: {
              0: { raw: '2', value: 2, type: 'number' },
              1: { raw: '3', value: 3, type: 'number' },
              2: { raw: '=A2*B2', value: 6, type: 'formula', formula: 'A2*B2' },
            },
            2: {
              0: { raw: '3', value: 3, type: 'number' },
              1: { raw: '4', value: 4, type: 'number' },
              2: { raw: '=A3*B4', value: 12, type: 'formula', formula: 'A3*B4' },
            },
          },
          columns: {},
          rowMeta: {},
        },
      },
    };
    const ex = explainCell(wb, 'Sheet1', 2, 2);
    assert.ok(ex.findings.some((f) => f.title.includes('inconsistent') || f.detail.includes('differs')));
  });
});
