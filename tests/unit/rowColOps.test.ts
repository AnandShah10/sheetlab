import { strict as assert } from 'assert';
import { Worksheet } from '../../src/types/workbook';
import { insertRow, deleteRow, insertColumn, deleteColumn, formatRange } from '../../src/data/rowColOps';

function cell(v: string) {
  return { raw: v, value: v, type: 'string' as const };
}

function makeSheet(): Worksheet {
  return {
    name: 'S',
    rowCount: 3,
    colCount: 2,
    rows: {
      0: { 0: cell('a0'), 1: cell('b0') },
      1: { 0: cell('a1'), 1: cell('b1') },
      2: { 0: cell('a2'), 1: cell('b2') },
    },
    columns: {},
    rowMeta: {},
  };
}

describe('rowColOps', () => {
  it('insertRow shifts subsequent rows down and leaves the new row blank', () => {
    const sheet = makeSheet();
    insertRow(sheet, 1);
    assert.equal(sheet.rows[0][0].value, 'a0');
    assert.equal(sheet.rows[1], undefined); // new blank row has no stored cells
    assert.equal(sheet.rows[2][0].value, 'a1');
    assert.equal(sheet.rows[3][0].value, 'a2');
    assert.equal(sheet.rowCount, 4);
  });

  it('deleteRow removes the row and shifts subsequent rows up', () => {
    const sheet = makeSheet();
    deleteRow(sheet, 1);
    assert.equal(sheet.rows[0][0].value, 'a0');
    assert.equal(sheet.rows[1][0].value, 'a2');
    assert.equal(sheet.rows[2], undefined);
    assert.equal(sheet.rowCount, 2);
  });

  it('insertColumn shifts subsequent columns right', () => {
    const sheet = makeSheet();
    insertColumn(sheet, 1);
    assert.equal(sheet.rows[0][0].value, 'a0');
    assert.equal(sheet.rows[0][1], undefined);
    assert.equal(sheet.rows[0][2].value, 'b0');
    assert.equal(sheet.colCount, 3);
  });

  it('deleteColumn removes the column and shifts subsequent columns left', () => {
    const sheet = makeSheet();
    deleteColumn(sheet, 0);
    assert.equal(sheet.rows[0][0].value, 'b0');
    assert.equal(sheet.colCount, 1);
  });

  it('insertRow then deleteRow at the same index is a round trip for untouched rows', () => {
    const sheet = makeSheet();
    insertRow(sheet, 1);
    deleteRow(sheet, 1);
    assert.equal(sheet.rows[0][0].value, 'a0');
    assert.equal(sheet.rows[1][0].value, 'a1');
    assert.equal(sheet.rows[2][0].value, 'a2');
    assert.equal(sheet.rowCount, 3);
  });

  it('formatRange merges format onto every cell without clobbering existing format keys', () => {
    const sheet = makeSheet();
    sheet.rows[0][0].format = { italic: true };
    formatRange(sheet, { startRow: 0, startCol: 0, endRow: 0, endCol: 0 }, { bold: true });
    assert.equal(sheet.rows[0][0].format?.bold, true);
    assert.equal(sheet.rows[0][0].format?.italic, true);
  });

  it('formatRange creates a blank cell with format when applied to an empty position', () => {
    const sheet = makeSheet();
    formatRange(sheet, { startRow: 5, startCol: 5, endRow: 5, endCol: 5 }, { backgroundColor: '#ff0000' });
    assert.equal(sheet.rows[5][5].format?.backgroundColor, '#ff0000');
    assert.equal(sheet.rows[5][5].type, 'blank');
  });
});
