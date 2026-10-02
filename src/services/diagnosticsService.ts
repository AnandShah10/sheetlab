/**
 * Publishes SheetLab workbook diagnostics into VS Code's Problems panel.
 */

import * as vscode from 'vscode';
import { WorkbookDiagnostic } from '../analysis/types';

let collection: vscode.DiagnosticCollection | undefined;

export function getDiagnosticCollection(): vscode.DiagnosticCollection {
  if (!collection) {
    collection = vscode.languages.createDiagnosticCollection('sheetlab');
  }
  return collection;
}

export function disposeDiagnosticCollection(): void {
  collection?.dispose();
  collection = undefined;
}

export function publishDiagnostics(uri: vscode.Uri | undefined, diags: WorkbookDiagnostic[]): void {
  const col = getDiagnosticCollection();
  if (!uri) {
    col.clear();
    return;
  }
  const mapped: vscode.Diagnostic[] = diags.map((d) => {
    const severity =
      d.severity === 'error'
        ? vscode.DiagnosticSeverity.Error
        : d.severity === 'warning'
          ? vscode.DiagnosticSeverity.Warning
          : d.severity === 'hint'
            ? vscode.DiagnosticSeverity.Hint
            : vscode.DiagnosticSeverity.Information;
    const line = d.row ?? 0;
    const colIdx = d.col ?? 0;
    const range = new vscode.Range(line, colIdx, d.endRow ?? line, (d.endCol ?? colIdx) + 1);
    const vs = new vscode.Diagnostic(range, d.message, severity);
    vs.source = 'SheetLab';
    vs.code = d.ruleId;
    if (d.detail) vs.relatedInformation = [
      new vscode.DiagnosticRelatedInformation(new vscode.Location(uri, range), d.detail),
    ];
    return vs;
  });
  col.set(uri, mapped);
}
