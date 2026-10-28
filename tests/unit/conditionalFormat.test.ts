import { strict as assert } from 'assert';
import { parseCellNumber, resolveConditionalStyle } from '../../src/data/conditionalFormat';
import { Worksheet, Cell } from '../../src/types/workbook';

function cell(value: string | number | null, type: Cell['type'] = 'number'): Cell {
  if (value === null) return { raw: null, value: null, type: 'blank' };
  return { raw: String(value), value, type };
}

describe('conditionalFormat', () => {
  it('parses currency and percent strings', () => {
    assert.equal(parseCellNumber(cell(12)), 12);
    assert.equal(parseCellNumber(cell('$1,200', 'string')), 1200);
    assert.equal(parseCellNumber(cell('50%', 'string')), 0.5);
    assert.equal(parseCellNumber(cell('(10)', 'string')), -10);
  });

  it('highlights cells > 0 and < 0', () => {
    const sheet: Worksheet = {
      name: 'S',
      rowCount: 3,
      colCount: 1,
      rows: {
        0: { 0: cell(5) },
        1: { 0: cell(-3) },
        2: { 0: cell(0) },
      },
      columns: {},
      rowMeta: {},
      conditionalFormats: [
        { id: '1', operator: 'gt', value: 0, style: { backgroundColor: '#c6efce' }, range: { startRow: 0, startCol: 0, endRow: 2, endCol: 0 } },
        { id: '2', operator: 'lt', value: 0, style: { backgroundColor: '#ffc7ce' }, range: { startRow: 0, startCol: 0, endRow: 2, endCol: 0 }, stopIfTrue: true },
      ],
    };
    // First matching rule wins when stopIfTrue (default)
    assert.equal(resolveConditionalStyle(sheet, 0, 0)?.backgroundColor, '#c6efce');
    // For -3, gt fails, lt matches if we only had lt - with both rules and stop on first match:
    // rule1 gt fails, rule2 lt matches
    assert.equal(resolveConditionalStyle(sheet, 1, 0)?.backgroundColor, '#ffc7ce');
    assert.equal(resolveConditionalStyle(sheet, 2, 0)?.backgroundColor, undefined);
  });
});
