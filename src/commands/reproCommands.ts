import * as vscode from 'vscode';
import { transformationRecorder } from '../pipelines/recorder';
import { savePipeline, listPipelines, loadPipeline } from '../pipelines/pipelineStore';
import { saveQuery, listQueries, loadQuery } from '../pipelines/queryStore';
import { createEmptyPipeline } from '../pipelines/types';
import { runValidation, ValidationConfig, ColumnRule } from '../validation/rules';
import { activePanelRegistry } from '../services/activePanelRegistry';
import { applyCleanup } from '../data/cleanup';
import { getSheet } from '../workbook/workbookModel';
import { compareWorkbookToHead } from '../analysis/gitCompare';
import { readXlsxWorkbook } from '../excel/excelReader';
import { readLegacyXls } from '../excel/legacyXlsReader';
import * as path from 'path';

export function registerReproCommands(_context: vscode.ExtensionContext): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('sheetlab.startRecordingTransformations', async () => {
      const name = await vscode.window.showInputBox({
        prompt: 'Pipeline name',
        value: `cleanup-${new Date().toISOString().slice(0, 10)}`,
      });
      if (name === undefined) return;
      transformationRecorder.start(name || undefined);
      void vscode.window.showInformationMessage(
        `Recording transformations as "${transformationRecorder.getPipeline().name}". Clean-data ops will be captured.`,
      );
    }),

    vscode.commands.registerCommand('sheetlab.stopRecordingTransformations', async () => {
      if (!transformationRecorder.isRecording()) {
        void vscode.window.showInformationMessage('No transformation recording in progress.');
        return;
      }
      const pipeline = transformationRecorder.stop();
      const uri = await savePipeline(pipeline);
      void vscode.window.showInformationMessage(
        uri
          ? `Saved pipeline "${pipeline.name}" (${pipeline.steps.length} steps) → ${uri.fsPath}`
          : `Stopped recording "${pipeline.name}" (${pipeline.steps.length} steps). Open a workspace folder to save.`,
      );
    }),

    vscode.commands.registerCommand('sheetlab.viewPipeline', async () => {
      const listed = await listPipelines();
      const current = transformationRecorder.getPipeline();
      const picks = [
        ...(transformationRecorder.isRecording() || current.steps.length
          ? [{ label: `$(record) ${current.name} (session)`, description: `${current.steps.length} steps`, pipeline: current, uri: undefined as vscode.Uri | undefined }]
          : []),
        ...listed.map((p) => ({ label: p.name, description: 'saved', pipeline: undefined as undefined, uri: p.uri })),
      ];
      if (!picks.length) {
        void vscode.window.showInformationMessage('No pipelines yet. Start recording, then run Clean Data.');
        return;
      }
      const pick = await vscode.window.showQuickPick(picks, { placeHolder: 'View pipeline…' });
      if (!pick) return;
      const pipeline = pick.uri ? await loadPipeline(pick.uri) : pick.pipeline!;
      const lines = pipeline.steps.map(
        (s, i) =>
          `${i + 1}. [${s.sheetName}] ${s.operation.kind} @ R${s.range.startRow + 1}C${s.range.startCol + 1}`,
      );
      void vscode.window.showInformationMessage(
        [`Pipeline: ${pipeline.name}`, `${pipeline.steps.length} step(s)`, ...lines.slice(0, 12)].join('\n'),
        { modal: true },
      );
    }),

    vscode.commands.registerCommand('sheetlab.runPipeline', async () => {
      const listed = await listPipelines();
      if (!listed.length) {
        void vscode.window.showInformationMessage('No saved pipelines in .sheetlab/pipelines/');
        return;
      }
      const pick = await vscode.window.showQuickPick(
        listed.map((p) => ({ label: p.name, uri: p.uri })),
        { placeHolder: 'Run pipeline…' },
      );
      if (!pick) return;
      const pipeline = await loadPipeline(pick.uri);
      const pair = activePanelRegistry.getActiveWorkbookAndSheet();
      if (!pair) {
        void vscode.window.showWarningMessage('Open a spreadsheet in SheetLab first.');
        return;
      }
      let applied = 0;
      for (const step of pipeline.steps) {
        const sheet = pair.workbook.sheets[step.sheetName];
        if (!sheet) continue;
        const cleaned = applyCleanup(sheet, step.range, step.operation);
        pair.workbook.sheets[step.sheetName] = cleaned;
        applied++;
      }
      // Ask webview to refresh via linter path — profile forces analysis; use dirty via save path is heavy.
      // User should see data change after resync — post a mild ui refresh
      activePanelRegistry.send('runProfile');
      void vscode.window.showInformationMessage(
        `Applied ${applied}/${pipeline.steps.length} steps from "${pipeline.name}". Undo is per prior edits; reload file if needed to discard.`,
      );
    }),

    vscode.commands.registerCommand('sheetlab.saveQuery', async () => {
      const sql = await vscode.window.showInputBox({
        prompt: 'SQL query to save',
        placeHolder: 'SELECT * FROM Sheet1 LIMIT 100',
      });
      if (!sql) return;
      const name = await vscode.window.showInputBox({ prompt: 'Query name', value: 'my-query' });
      if (!name) return;
      const uri = await saveQuery({
        version: 1,
        name,
        sql,
        updatedAt: new Date().toISOString(),
      });
      void vscode.window.showInformationMessage(uri ? `Saved query → ${uri.fsPath}` : 'Could not save query.');
    }),

    vscode.commands.registerCommand('sheetlab.runSavedQuery', async () => {
      const listed = await listQueries();
      if (!listed.length) {
        void vscode.window.showInformationMessage('No saved queries in .sheetlab/queries/');
        return;
      }
      const pick = await vscode.window.showQuickPick(
        listed.map((q) => ({ label: q.name, uri: q.uri })),
        { placeHolder: 'Run saved query…' },
      );
      if (!pick) return;
      const q = await loadQuery(pick.uri);
      // Open query panel and rely on user run — or post runQuery if we add to protocol
      activePanelRegistry.send('openQuery');
      void vscode.window.showInformationMessage(`Query "${q.name}":\n${q.sql}`, { modal: true }, 'Copy SQL').then((c) => {
        if (c === 'Copy SQL') void vscode.env.clipboard.writeText(q.sql);
      });
    }),

    vscode.commands.registerCommand('sheetlab.runDataValidation', async () => {
      const wb = activePanelRegistry.getActiveWorkbook();
      if (!wb) {
        void vscode.window.showWarningMessage('Open a spreadsheet in SheetLab first.');
        return;
      }
      // Load .sheetlab/rules/default.json if present, else prompt for simple unique+required on col A
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
      let config: ValidationConfig = { version: 1, rules: [] };
      if (folder) {
        const rulesUri = vscode.Uri.joinPath(folder, '.sheetlab', 'rules', 'default.json');
        try {
          const bytes = await vscode.workspace.fs.readFile(rulesUri);
          config = JSON.parse(Buffer.from(bytes).toString('utf8')) as ValidationConfig;
        } catch {
          /* use interactive */
        }
      }
      if (!config.rules.length) {
        const col = await vscode.window.showInputBox({
          prompt: 'Header name or column index to require + unique-check',
          value: '0',
        });
        if (col === undefined) return;
        const asNum = /^\d+$/.test(col) ? parseInt(col, 10) : col;
        config.rules = [
          { column: asNum, kind: 'required' },
          { column: asNum, kind: 'unique' },
        ];
      }
      const diags = runValidation(wb, config);
      void vscode.window.showInformationMessage(
        diags.length ? `Data quality: ${diags.length} issue(s)` : 'Data quality: all checked rules passed',
      );
      // Surface via analysis panel diagnostics channel
      activePanelRegistry.send('runLinter');
    }),

    vscode.commands.registerCommand('sheetlab.compareWithHead', async () => {
      const pair = activePanelRegistry.getActiveWorkbookAndSheet();
      const wb = pair?.workbook;
      if (!wb) {
        void vscode.window.showWarningMessage('Open a spreadsheet in SheetLab first.');
        return;
      }
      const filePath = wb.meta.sourcePath;
      if (!filePath) {
        void vscode.window.showWarningMessage('Workbook has no source path to compare.');
        return;
      }
      const result = await compareWorkbookToHead(wb, filePath, async (buf, p) => {
        const ext = path.extname(p).toLowerCase();
        if (ext === '.xls') {
          return readLegacyXls(buf, p, 500000).workbook;
        }
        return (await readXlsxWorkbook(buf, p, ext === '.xlsm' ? 'xlsm' : 'xlsx', { maxRows: 500000 })).workbook;
      });
      if (!result) return;
      const sample = result.diffs
        .slice(0, 8)
        .map((d) => `${d.sheet}!${d.a1} ${d.kind}: ${d.before ?? '∅'} → ${d.after ?? '∅'}`)
        .join('\n');
      void vscode.window.showInformationMessage(
        [result.note, sample].filter(Boolean).join('\n\n'),
        { modal: true },
      );
    }),
  ];
}
