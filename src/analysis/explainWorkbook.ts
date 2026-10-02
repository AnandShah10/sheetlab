/**
 * Deterministic workbook overview — structure and hotspots only, no invented business meaning.
 */

import { Workbook } from '../types/workbook';
import { DependencyGraph } from './dependencyGraph';
import { profileWorkbook } from './profiler';
import { runLinter } from './diagnostics';

export function explainWorkbook(workbook: Workbook): string {
  const graph = DependencyGraph.build(workbook);
  const profile = profileWorkbook(workbook, graph);
  const diags = runLinter(workbook, graph);
  const lines: string[] = [];

  lines.push('Workbook overview (inferred from structure, not business intent)');
  lines.push('────────────────────────────────────────────');
  lines.push(`Sheets (${profile.sheetCount}): ${workbook.meta.sheetOrder.join(', ')}`);
  lines.push(
    `Cells: ${profile.totalPopulatedCells} populated · ${profile.totalFormulaCells} formulas · ${profile.totalErrorCells} errors`,
  );
  lines.push(`Tables: ${profile.tableCount} · Named ranges: ${profile.namedRangeCount} · Cycles: ${profile.cycleCount}`);
  lines.push('');

  lines.push('Per sheet');
  for (const s of profile.sheets) {
    lines.push(
      `  • ${s.name}: ${s.populatedCells} cells, ${s.formulaCells} formulas, ${s.errorCells} errors, ${s.tables} tables`,
    );
  }
  lines.push('');

  if (profile.topConnectedCells.length) {
    lines.push('Most connected cells (dependency degree)');
    for (const c of profile.topConnectedCells.slice(0, 8)) {
      lines.push(`  • ${c.address} (degree ${c.degree})`);
    }
    lines.push('');
  }

  const errN = diags.filter((d) => d.severity === 'error').length;
  const warnN = diags.filter((d) => d.severity === 'warning').length;
  lines.push(`Diagnostics: ${errN} errors, ${warnN} warnings (${diags.length} total)`);
  for (const d of diags.filter((x) => x.severity === 'error').slice(0, 5)) {
    const loc = d.sheetName && d.row != null ? `${d.sheetName} row ${d.row + 1}` : d.sheetName ?? '';
    lines.push(`  • [error] ${d.ruleId}${loc ? ' @ ' + loc : ''}: ${d.message}`);
  }

  if (profile.partial) {
    lines.push('');
    lines.push('Note: analysis was partial (scan limits applied).');
  }
  lines.push('');
  lines.push('This summary does not invent business purpose; use sheet names and formulas as ground truth.');

  return lines.join('\n');
}
