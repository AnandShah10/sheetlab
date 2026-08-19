import { strict as assert } from 'assert';
import { Worksheet } from '../../src/types/workbook';
import { setColumnHidden, setRowHidden, showAllColumns, showAllRows } from '../../src/data/visibility';
import { createTable, removeTable, findTableAt } from '../../src/data/tables';

function makeSheet(): Worksheet {
  return { name: 'S', rowCount: 5, colCount: 5, rows: {}, columns: {}, rowMeta: {} };
}

describe('visibility', () => {
  it('hides and shows a column', () => {
    const sheet = makeSheet();
    setColumnHidden(sheet, 2, true);
    assert.equal(sheet.columns[2].hidden, true);
    showAllColumns(sheet);
    assert.equal(sheet.columns[2].hidden, false);
  });

  it('hides and shows a row, preserving an existing height', () => {
    const sheet = makeSheet();
    sheet.rowMeta[1] = { height: 40 };
    setRowHidden(sheet, 1, true);
    assert.equal(sheet.rowMeta[1].height, 40);
    assert.equal(sheet.rowMeta[1].hidden, true);
    showAllRows(sheet);
    assert.equal(sheet.rowMeta[1].hidden, false);
  });
});

describe('tables', () => {
  it('creates a table and finds it by cell coordinate', () => {
    const sheet = makeSheet();
    createTable(sheet, { startRow: 0, startCol: 0, endRow: 3, endCol: 2 }, 'MyTable', true);
    const found = findTableAt(sheet, 2, 1);
    assert.equal(found?.name, 'MyTable');
    assert.equal(findTableAt(sheet, 4, 4), undefined);
  });

  it('rejects a duplicate table name', () => {
    const sheet = makeSheet();
    createTable(sheet, { startRow: 0, startCol: 0, endRow: 1, endCol: 1 }, 'T1', true);
    assert.throws(() => createTable(sheet, { startRow: 2, startCol: 2, endRow: 3, endCol: 3 }, 'T1', true));
  });

  it('rejects an overlapping table', () => {
    const sheet = makeSheet();
    createTable(sheet, { startRow: 0, startCol: 0, endRow: 3, endCol: 3 }, 'T1', true);
    assert.throws(() => createTable(sheet, { startRow: 2, startCol: 2, endRow: 4, endCol: 4 }, 'T2', true));
  });

  it('removes a table by name', () => {
    const sheet = makeSheet();
    createTable(sheet, { startRow: 0, startCol: 0, endRow: 1, endCol: 1 }, 'T1', true);
    removeTable(sheet, 'T1');
    assert.equal(findTableAt(sheet, 0, 0), undefined);
  });

  it('defaults hasTotalsRow to false when not specified', () => {
    const sheet = makeSheet();
    createTable(sheet, { startRow: 0, startCol: 0, endRow: 1, endCol: 1 }, 'T1', true);
    assert.equal(findTableAt(sheet, 0, 0)?.hasTotalsRow, false);
  });

  it('stores hasTotalsRow when explicitly set', () => {
    const sheet = makeSheet();
    createTable(sheet, { startRow: 0, startCol: 0, endRow: 1, endCol: 1 }, 'T1', true, true);
    assert.equal(findTableAt(sheet, 0, 0)?.hasTotalsRow, true);
  });
});
