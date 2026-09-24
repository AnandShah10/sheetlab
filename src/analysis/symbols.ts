/**
 * Workbook symbol index for Go to Symbol / navigation.
 */

import { Workbook } from '../types/workbook';
import { toA1, rangeToA1 } from '../utils/cellRef';

export type SymbolKind = 'sheet' | 'table' | 'namedRange' | 'formula';

export interface WorkbookSymbol {
  kind: SymbolKind;
  name: string;
  sheetName: string;
  row?: number;
  col?: number;
  endRow?: number;
  endCol?: number;
  detail?: string;
}

export function buildSymbolIndex(workbook: Workbook, maxFormulas = 200): WorkbookSymbol[] {
  const symbols: WorkbookSymbol[] = [];

  for (const name of workbook.meta.sheetOrder) {
    symbols.push({
      kind: 'sheet',
      name,
      sheetName: name,
      row: 0,
      col: 0,
      detail: 'Sheet',
    });
    const sheet = workbook.sheets[name];
    if (!sheet) continue;

    for (const table of sheet.tables ?? []) {
      symbols.push({
        kind: 'table',
        name: table.name,
        sheetName: name,
        row: table.range.startRow,
        col: table.range.startCol,
        endRow: table.range.endRow,
        endCol: table.range.endCol,
        detail: `Table ${rangeToA1(table.range)}`,
      });
    }
  }

  for (const nr of workbook.meta.namedRanges ?? []) {
    symbols.push({
      kind: 'namedRange',
      name: nr.name,
      sheetName: nr.sheetName,
      row: nr.range.startRow,
      col: nr.range.startCol,
      endRow: nr.range.endRow,
      endCol: nr.range.endCol,
      detail: `Named range ${rangeToA1(nr.range)}`,
    });
  }

  // Sample formula cells for discoverability (capped)
  let formulaCount = 0;
  outer: for (const name of workbook.meta.sheetOrder) {
    const sheet = workbook.sheets[name];
    if (!sheet) continue;
    for (const [rowStr, row] of Object.entries(sheet.rows)) {
      for (const [colStr, cell] of Object.entries(row)) {
        if (cell.type !== 'formula') continue;
        formulaCount++;
        if (formulaCount > maxFormulas) break outer;
        const row = Number(rowStr);
        const col = Number(colStr);
        const label = cell.formula ? `=${cell.formula}` : String(cell.raw ?? '');
        symbols.push({
          kind: 'formula',
          name: `${name}!${toA1(row, col)}`,
          sheetName: name,
          row,
          col,
          detail: label.length > 60 ? `${label.slice(0, 60)}…` : label,
        });
      }
    }
  }

  return symbols;
}
