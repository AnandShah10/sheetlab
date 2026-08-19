import { strict as assert } from 'assert';
import { Worksheet } from '../../src/types/workbook';
import { resolveStructuredReferences } from '../../src/formula/structuredReferences';

function cell(v: string | number) {
  const type = typeof v === 'number' ? ('number' as const) : ('string' as const);
  return { raw: String(v), value: v, type };
}

function makeSheetWithTable(): Worksheet {
  return {
    name: 'Sheet1',
    rowCount: 4,
    colCount: 2,
    rows: {
      0: { 0: cell('Product'), 1: cell('Amount') },
      1: { 0: cell('Widget'), 1: cell(10) },
      2: { 0: cell('Gadget'), 1: cell(20) },
      3: { 0: cell('Gizmo'), 1: cell(30) },
    },
    columns: {},
    rowMeta: {},
    tables: [{ name: 'SalesTable', range: { startRow: 0, startCol: 0, endRow: 3, endCol: 1 }, hasHeaderRow: true }],
  };
}

/** 3-column table (Product, Amount, Region), 3 data rows, plus a totals row -- for exercising multi-column and #Totals forms. */
function makeSheetWithWideTable(): Worksheet {
  return {
    name: 'Sheet1',
    rowCount: 5,
    colCount: 3,
    rows: {
      0: { 0: cell('Product'), 1: cell('Amount'), 2: cell('Region') },
      1: { 0: cell('Widget'), 1: cell(10), 2: cell('East') },
      2: { 0: cell('Gadget'), 1: cell(20), 2: cell('West') },
      3: { 0: cell('Gizmo'), 1: cell(30), 2: cell('East') },
      4: { 0: cell('Total'), 1: cell(60), 2: cell('') },
    },
    columns: {},
    rowMeta: {},
    tables: [
      {
        name: 'WideTable',
        range: { startRow: 0, startCol: 0, endRow: 4, endCol: 2 },
        hasHeaderRow: true,
        hasTotalsRow: true,
      },
    ],
  };
}

describe('resolveStructuredReferences (existing forms)', () => {
  it('resolves a whole-column reference to a data-row range', () => {
    const sheets = { Sheet1: makeSheetWithTable() };
    const result = resolveStructuredReferences('SUM(SalesTable[Amount])', 'Sheet1', 1, sheets);
    assert.equal(result, 'SUM(B2:B4)');
  });

  it('resolves an @-prefixed "this row" reference to a single cell', () => {
    const sheets = { Sheet1: makeSheetWithTable() };
    const result = resolveStructuredReferences('SalesTable[@Amount]*2', 'Sheet1', 2, sheets);
    assert.equal(result, 'B3*2');
  });

  it('matches column names case-insensitively and trims whitespace', () => {
    const sheets = { Sheet1: makeSheetWithTable() };
    const result = resolveStructuredReferences('SUM(SalesTable[ amount ])', 'Sheet1', 1, sheets);
    assert.equal(result, 'SUM(B2:B4)');
  });

  it('adds a sheet-qualified prefix when the table lives on a different sheet', () => {
    const sheets = { Data: makeSheetWithTable() };
    const result = resolveStructuredReferences('SUM(SalesTable[Amount])', 'Summary', 0, sheets);
    assert.equal(result, "SUM('Data'!B2:B4)");
  });

  it('leaves an unknown table name untouched', () => {
    const sheets = { Sheet1: makeSheetWithTable() };
    const result = resolveStructuredReferences('SUM(NoSuchTable[Amount])', 'Sheet1', 1, sheets);
    assert.equal(result, 'SUM(NoSuchTable[Amount])');
  });

  it('leaves an unknown column name untouched', () => {
    const sheets = { Sheet1: makeSheetWithTable() };
    const result = resolveStructuredReferences('SUM(SalesTable[NoSuchColumn])', 'Sheet1', 1, sheets);
    assert.equal(result, 'SUM(SalesTable[NoSuchColumn])');
  });

  it('leaves an @-reference untouched when the current row is outside the table body', () => {
    const sheets = { Sheet1: makeSheetWithTable() };
    const result = resolveStructuredReferences('SalesTable[@Amount]', 'Sheet1', 10, sheets);
    assert.equal(result, 'SalesTable[@Amount]');
  });

  it('resolves multiple structured references in one formula', () => {
    const sheets = { Sheet1: makeSheetWithTable() };
    const result = resolveStructuredReferences('SUM(SalesTable[Amount])/COUNT(SalesTable[Amount])', 'Sheet1', 1, sheets);
    assert.equal(result, 'SUM(B2:B4)/COUNT(B2:B4)');
  });

  it('leaves formulas with no structured references untouched', () => {
    const sheets = { Sheet1: makeSheetWithTable() };
    const result = resolveStructuredReferences('SUM(A1:A10)', 'Sheet1', 1, sheets);
    assert.equal(result, 'SUM(A1:A10)');
  });
});

describe('resolveStructuredReferences (#All / #Headers / #Totals / #Data)', () => {
  it('resolves [#Headers] to the header row across all table columns', () => {
    const sheets = { Sheet1: makeSheetWithTable() };
    const result = resolveStructuredReferences('SalesTable[#Headers]', 'Sheet1', 0, sheets);
    assert.equal(result, 'A1:B1');
  });

  it('resolves [#All] to the entire table extent', () => {
    const sheets = { Sheet1: makeSheetWithTable() };
    const result = resolveStructuredReferences('SalesTable[#All]', 'Sheet1', 0, sheets);
    assert.equal(result, 'A1:B4');
  });

  it('resolves [#Data] to the data body across all columns', () => {
    const sheets = { Sheet1: makeSheetWithTable() };
    const result = resolveStructuredReferences('SalesTable[#Data]', 'Sheet1', 0, sheets);
    assert.equal(result, 'A2:B4');
  });

  it('resolves [#Totals] to the totals row when the table has one', () => {
    const sheets = { Sheet1: makeSheetWithWideTable() };
    const result = resolveStructuredReferences('WideTable[#Totals]', 'Sheet1', 0, sheets);
    assert.equal(result, 'A5:C5');
  });

  it('leaves [#Totals] unresolved when the table has no totals row', () => {
    const sheets = { Sheet1: makeSheetWithTable() };
    const result = resolveStructuredReferences('SalesTable[#Totals]', 'Sheet1', 0, sheets);
    assert.equal(result, 'SalesTable[#Totals]');
  });

  it('excludes the totals row from [#Data] and the bare column form when hasTotalsRow is true', () => {
    const sheets = { Sheet1: makeSheetWithWideTable() };
    const result = resolveStructuredReferences('SUM(WideTable[Amount])', 'Sheet1', 1, sheets);
    assert.equal(result, 'SUM(B2:B4)'); // rows 1-3 (0-indexed), NOT including row 4 (the totals row)
  });

  it('leaves an unknown item keyword untouched', () => {
    const sheets = { Sheet1: makeSheetWithTable() };
    const result = resolveStructuredReferences('SalesTable[#Bogus]', 'Sheet1', 0, sheets);
    assert.equal(result, 'SalesTable[#Bogus]');
  });
});

describe('resolveStructuredReferences (multi-column selectors)', () => {
  it('resolves a bracketed column range to a multi-column data-body range', () => {
    const sheets = { Sheet1: makeSheetWithWideTable() };
    const result = resolveStructuredReferences('SUM(WideTable[[Product]:[Amount]])', 'Sheet1', 1, sheets);
    assert.equal(result, 'SUM(A2:B4)');
  });

  it('resolves a column range regardless of the order the columns are given in', () => {
    const sheets = { Sheet1: makeSheetWithWideTable() };
    const result = resolveStructuredReferences('SUM(WideTable[[Amount]:[Product]])', 'Sheet1', 1, sheets);
    assert.equal(result, 'SUM(A2:B4)');
  });

  it('resolves an item specifier combined with a column range', () => {
    const sheets = { Sheet1: makeSheetWithWideTable() };
    const result = resolveStructuredReferences('WideTable[[#Headers],[Amount]:[Region]]', 'Sheet1', 0, sheets);
    assert.equal(result, 'B1:C1');
  });

  it('resolves [#All] combined with a single bracketed column', () => {
    const sheets = { Sheet1: makeSheetWithWideTable() };
    const result = resolveStructuredReferences('WideTable[[#All],[Region]]', 'Sheet1', 0, sheets);
    assert.equal(result, 'C1:C5');
  });

  it('leaves a multi-column reference with an unknown column untouched', () => {
    const sheets = { Sheet1: makeSheetWithWideTable() };
    const result = resolveStructuredReferences('WideTable[[Amount]:[NoSuchColumn]]', 'Sheet1', 1, sheets);
    assert.equal(result, 'WideTable[[Amount]:[NoSuchColumn]]');
  });
});
