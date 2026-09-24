import { strict as assert } from 'assert';
import { createWorkbookSnapshot, diffSnapshots } from '../../src/analysis/snapshot';
import { buildSymbolIndex } from '../../src/analysis/symbols';
import { Workbook } from '../../src/types/workbook';

function sample(): Workbook {
  return {
    meta: { sourceKind: 'xlsx', sourcePath: '', sheetOrder: ['Sheet1', 'Data'] },
    sheets: {
      Sheet1: {
        name: 'Sheet1',
        rowCount: 3,
        colCount: 2,
        rows: {
          0: { 0: { raw: '1', value: 1, type: 'number' } },
          1: { 0: { raw: '=A1*2', value: 2, type: 'formula', formula: 'A1*2' } },
        },
        columns: {},
        rowMeta: {},
        tables: [{ name: 'T1', range: { startRow: 0, startCol: 0, endRow: 1, endCol: 0 }, hasHeaderRow: false }],
      },
      Data: {
        name: 'Data',
        rowCount: 1,
        colCount: 1,
        rows: { 0: { 0: { raw: 'x', value: 'x', type: 'string' } } },
        columns: {},
        rowMeta: {},
      },
    },
  };
}

describe('snapshot', () => {
  it('is deterministic for the same workbook', () => {
    const wb = sample();
    const a = createWorkbookSnapshot(wb);
    const b = createWorkbookSnapshot(wb);
    assert.equal(diffSnapshots(a, b).length, 0);
  });

  it('detects value changes', () => {
    const wb = sample();
    const a = createWorkbookSnapshot(wb);
    wb.sheets.Sheet1.rows[0][0].value = 99;
    const b = createWorkbookSnapshot(wb);
    const diff = diffSnapshots(a, b);
    assert.ok(diff.some((d) => d.kind === 'value'));
  });
});

describe('symbols', () => {
  it('indexes sheets and tables', () => {
    const symbols = buildSymbolIndex(sample());
    assert.ok(symbols.some((s) => s.kind === 'sheet' && s.name === 'Data'));
    assert.ok(symbols.some((s) => s.kind === 'table' && s.name === 'T1'));
  });
});
