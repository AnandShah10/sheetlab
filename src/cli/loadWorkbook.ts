/**
 * Load a workbook from disk without VS Code APIs (for CLI / CI).
 */

import * as fs from 'fs';
import * as path from 'path';
import { Workbook } from '../types/workbook';
import { readXlsxWorkbook } from '../excel/excelReader';
import { readLegacyXls } from '../excel/legacyXlsReader';
import { parseCsv } from '../csv/csvReader';

const DEFAULT_MAX_ROWS = 500_000;

export async function loadWorkbookFromFile(
  filePath: string,
  maxRows = DEFAULT_MAX_ROWS,
): Promise<{ workbook: Workbook; truncated: boolean }> {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    throw new Error(`File not found: ${abs}`);
  }
  const buffer = fs.readFileSync(abs);
  const ext = path.extname(abs).toLowerCase();

  if (ext === '.xlsx' || ext === '.xlsm' || ext === '.ods') {
    // ODS goes through SheetJS path in extension; try ExcelJS first for xlsx/xlsm
    if (ext === '.ods') {
      // Fallback: use xlsx (SheetJS) via dynamic require pattern already in project
      const XLSX = require('xlsx') as typeof import('xlsx');
      const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
      const sheets: Workbook['sheets'] = {};
      const sheetOrder: string[] = [];
      for (const name of wb.SheetNames) {
        sheetOrder.push(name);
        const sheet = wb.Sheets[name];
        const rows: Workbook['sheets'][string]['rows'] = {};
        const ref = sheet['!ref'];
        let rowCount = 0;
        let colCount = 0;
        if (ref) {
          const range = XLSX.utils.decode_range(ref);
          rowCount = range.e.r + 1;
          colCount = range.e.c + 1;
          for (let r = range.s.r; r <= range.e.r && r < maxRows; r++) {
            for (let c = range.s.c; c <= range.e.c; c++) {
              const addr = XLSX.utils.encode_cell({ r, c });
              const cell = sheet[addr];
              if (!cell) continue;
              if (!rows[r]) rows[r] = {};
              if (cell.f) {
                rows[r][c] = {
                  raw: `=${cell.f}`,
                  value: cell.v ?? null,
                  type: 'formula',
                  formula: cell.f,
                };
              } else if (typeof cell.v === 'number') {
                rows[r][c] = { raw: String(cell.v), value: cell.v, type: 'number' };
              } else if (typeof cell.v === 'boolean') {
                rows[r][c] = { raw: String(cell.v), value: cell.v, type: 'boolean' };
              } else if (cell.v != null) {
                rows[r][c] = { raw: String(cell.v), value: String(cell.v), type: 'string' };
              }
            }
          }
        }
        sheets[name] = {
          name,
          rowCount,
          colCount,
          rows,
          columns: {},
          rowMeta: {},
        };
      }
      return {
        workbook: {
          meta: {
            sourceKind: 'ods',
            sourcePath: abs,
            sheetOrder,
          },
          sheets,
        },
        truncated: false,
      };
    }
    const kind = ext === '.xlsm' ? 'xlsm' : 'xlsx';
    const result = await readXlsxWorkbook(buffer, abs, kind, { maxRows });
    return { workbook: result.workbook, truncated: result.truncated };
  }

  if (ext === '.xls') {
    const result = readLegacyXls(buffer, abs, maxRows);
    return { workbook: result.workbook, truncated: result.truncated };
  }

  if (ext === '.csv' || ext === '.tsv') {
    const parsed = parseCsv(buffer, ext.slice(1), { maxRows });
    const name = path.basename(abs, ext) || 'Sheet1';
    parsed.worksheet.name = name;
    return {
      workbook: {
        meta: {
          sourceKind: ext === '.tsv' ? 'tsv' : 'csv',
          sourcePath: abs,
          sheetOrder: [name],
          csvDialect: parsed.dialect,
        },
        sheets: { [name]: parsed.worksheet },
      },
      truncated: parsed.truncated,
    };
  }

  throw new Error(`Unsupported file type: ${ext} (use .xlsx .xlsm .xls .ods .csv .tsv)`);
}
