import * as vscode from 'vscode';
import { GridSettings } from '../types/workbook';

export interface CsvSettings {
  delimiter: string; // 'auto' or a literal delimiter character
  encoding: 'utf8' | 'utf8bom' | 'latin1';
  quoteChar: string;
  hasHeaderRow: 'auto' | 'true' | 'false';
  maxRowsInMemory: number;
  chunkSize: number;
}

export function getCsvSettings(): CsvSettings {
  const cfg = vscode.workspace.getConfiguration('sheetlab');
  return {
    delimiter: cfg.get<string>('csv.delimiter', 'auto'),
    encoding: cfg.get<CsvSettings['encoding']>('csv.encoding', 'utf8'),
    quoteChar: cfg.get<string>('csv.quoteChar', '"'),
    hasHeaderRow: cfg.get<CsvSettings['hasHeaderRow']>('csv.hasHeaderRow', 'auto'),
    maxRowsInMemory: cfg.get<number>('performance.maxRowsInMemory', 500000),
    chunkSize: cfg.get<number>('performance.chunkSize', 5000),
  };
}

export function getGridSettings(): GridSettings {
  const cfg = vscode.workspace.getConfiguration('sheetlab');
  return {
    theme: cfg.get('grid.theme', 'auto'),
    fontSize: cfg.get<number>('grid.fontSize', 13),
    rowHeight: cfg.get<number>('grid.rowHeight', 24),
    defaultColumnWidth: cfg.get<number>('grid.defaultColumnWidth', 100),
    showGridlines: cfg.get<boolean>('grid.showGridlines', true),
    chunkSize: cfg.get<number>('performance.chunkSize', 5000),
  };
}

export function getMaxQueryResultRows(): number {
  return vscode.workspace.getConfiguration('sheetlab').get<number>('query.maxResultRows', 100000);
}

export function isCalculationEnabled(): boolean {
  return vscode.workspace.getConfiguration('sheetlab').get<boolean>('formula.enableCalculation', true);
}
