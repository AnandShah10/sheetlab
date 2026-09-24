import { Workbook } from '../types/workbook';
import { DependencyGraph } from './dependencyGraph';
import { runLinter } from './diagnostics';
import { WorkbookProfile } from './types';

export function profileWorkbook(workbook: Workbook, graph?: DependencyGraph): WorkbookProfile {
  const g = graph ?? DependencyGraph.build(workbook);
  const diagnostics = runLinter(workbook, g);
  const sheets: WorkbookProfile['sheets'] = [];
  let totalPopulated = 0;
  let totalFormula = 0;
  let totalError = 0;
  let tableCount = 0;

  for (const name of workbook.meta.sheetOrder) {
    const sheet = workbook.sheets[name];
    if (!sheet) continue;
    let populated = 0;
    let formulas = 0;
    let errors = 0;
    for (const row of Object.values(sheet.rows)) {
      for (const cell of Object.values(row)) {
        if (cell.type === 'blank') continue;
        populated++;
        if (cell.type === 'formula') formulas++;
        if (cell.type === 'error') errors++;
      }
    }
    const hiddenRows = Object.values(sheet.rowMeta).filter((m) => m.hidden).length;
    const hiddenCols = Object.values(sheet.columns).filter((c) => c.hidden).length;
    const tables = sheet.tables?.length ?? 0;
    tableCount += tables;
    totalPopulated += populated;
    totalFormula += formulas;
    totalError += errors;
    sheets.push({
      name,
      rowCount: sheet.rowCount,
      colCount: sheet.colCount,
      populatedCells: populated,
      formulaCells: formulas,
      errorCells: errors,
      tables,
      hiddenRows,
      hiddenCols,
    });
  }

  const summary = { error: 0, warning: 0, info: 0 };
  for (const d of diagnostics) {
    if (d.severity === 'error') summary.error++;
    else if (d.severity === 'warning') summary.warning++;
    else summary.info++;
  }

  const cycles = g.findCycles(50);

  return {
    sheetCount: workbook.meta.sheetOrder.length,
    sheets,
    totalPopulatedCells: totalPopulated,
    totalFormulaCells: totalFormula,
    totalErrorCells: totalError,
    tableCount,
    namedRangeCount: workbook.meta.namedRanges?.length ?? 0,
    cycleCount: cycles.length,
    diagnosticSummary: summary,
    topConnectedCells: g.topConnected(10),
    analyzedAt: new Date().toISOString(),
    partial: g.partial,
    notes: g.notes.slice(),
  };
}
