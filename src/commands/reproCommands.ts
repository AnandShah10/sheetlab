import * as vscode from 'vscode';
import { transformationRecorder } from '../pipelines/recorder';
import { savePipeline, listPipelines, loadPipeline } from '../pipelines/pipelineStore';
import { saveQuery, listQueries, loadQuery } from '../pipelines/queryStore';
import { runValidation, ValidationConfig } from '../validation/rules';
import { activePanelRegistry } from '../services/activePanelRegistry';
import { compareWorkbookToHead, openNativeGitDiff } from '../analysis/gitCompare';
import { parseCsv } from '../csv/csvReader';
import { postDiffsToActivePanel, clearDiffHighlights } from '../services/diffHighlightPost';
import { compareTwoWorkbooks } from '../analysis/fileCompare';
import { execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);
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
      if (!activePanelRegistry.hasActive()) {
        void vscode.window.showWarningMessage('Open a spreadsheet in SheetLab first.');
        return;
      }
      // Apply inside the editor so undo is a single composite step + webview resyncs
      const ok = activePanelRegistry.postRaw({
        type: 'applyPipeline',
        label: pipeline.name,
        steps: pipeline.steps.map((s) => ({
          sheetName: s.sheetName,
          range: s.range,
          operation: s.operation,
        })),
      });
      if (!ok) {
        void vscode.window.showWarningMessage('Could not reach the SheetLab editor to apply the pipeline.');
      }
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
      activePanelRegistry.send('openQuery');
      activePanelRegistry.postRaw({ type: 'loadQuerySql', sql: q.sql, name: q.name });
      void vscode.window.showInformationMessage(`Loaded query "${q.name}" into the query panel.`);
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

    vscode.commands.registerCommand('sheetlab.compareTwoCommits', async () => {
      const pair = activePanelRegistry.getActiveWorkbookAndSheet();
      const wb = pair?.workbook;
      if (!wb?.meta.sourcePath) {
        void vscode.window.showWarningMessage('Open a spreadsheet in SheetLab first.');
        return;
      }
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!folder) {
        void vscode.window.showWarningMessage('Open a workspace folder (Git repo).');
        return;
      }
      let relative = wb.meta.sourcePath;
      try {
        const { stdout: root } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: folder });
        const top = root.trim().replace(/\\/g, '/');
        const full = wb.meta.sourcePath.replace(/\\/g, '/');
        relative = full.startsWith(top) ? full.slice(top.length).replace(/^\//, '') : wb.meta.sourcePath;
      } catch {
        void vscode.window.showWarningMessage('Not a Git repository.');
        return;
      }
      let lines: string[];
      try {
        const { stdout } = await execFileAsync(
          'git',
          ['log', '-30', '--pretty=format:%h%x09%s', '--', relative],
          { cwd: folder },
        );
        lines = stdout.split('\n').filter(Boolean);
      } catch {
        void vscode.window.showWarningMessage('Could not read git log.');
        return;
      }
      if (lines.length < 2) {
        void vscode.window.showInformationMessage('Need at least two commits for this file.');
        return;
      }
      const items = lines.map((line) => {
        const [hash, ...rest] = line.split('\t');
        return { label: hash, description: rest.join(' '), hash };
      });
      const older = await vscode.window.showQuickPick(items, { placeHolder: 'Older commit (before)…' });
      if (!older) return;
      const newer = await vscode.window.showQuickPick(
        items.filter((i) => i.hash !== older.hash),
        { placeHolder: 'Newer commit (after)…' },
      );
      if (!newer) return;
      try {
        const load = async (hash: string) => {
          const { stdout } = await execFileAsync('git', ['show', `${hash}:${relative}`], {
            cwd: folder,
            encoding: 'buffer',
            maxBuffer: 64 * 1024 * 1024,
          });
          const buf = Buffer.from(stdout);
          const ext = path.extname(relative).toLowerCase();
          if (ext === '.xls') return readLegacyXls(buf, wb.meta.sourcePath, 500000).workbook;
          return (await readXlsxWorkbook(buf, wb.meta.sourcePath, ext === '.xlsm' ? 'xlsm' : 'xlsx', { maxRows: 500000 })).workbook;
        };
        const before = await load(older.hash);
        const after = await load(newer.hash);
        const result = compareTwoWorkbooks(before, after, `${older.hash} → ${newer.hash}`);
        activePanelRegistry.postRaw({ type: 'analysisGitDiff', note: result.note, diffs: result.diffs });
        activePanelRegistry.send('openTools');
        void vscode.window.showInformationMessage(result.note + ' — see Tools panel');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`Compare commits failed: ${msg}`);
      }
    }),

    vscode.commands.registerCommand('sheetlab.compareWithCommit', async () => {
      const pair = activePanelRegistry.getActiveWorkbookAndSheet();
      const wb = pair?.workbook;
      if (!wb?.meta.sourcePath) {
        void vscode.window.showWarningMessage('Open a spreadsheet in SheetLab first.');
        return;
      }
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!folder) {
        void vscode.window.showWarningMessage('Open a workspace folder (Git repo).');
        return;
      }
      let relative = wb.meta.sourcePath;
      try {
        const { stdout: root } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: folder });
        const top = root.trim().replace(/\\/g, '/');
        const full = wb.meta.sourcePath.replace(/\\/g, '/');
        relative = full.startsWith(top) ? full.slice(top.length).replace(/^\//, '') : wb.meta.sourcePath;
      } catch {
        void vscode.window.showWarningMessage('Not a Git repository.');
        return;
      }
      let logOut: string;
      try {
        const { stdout } = await execFileAsync(
          'git',
          ['log', '-20', '--pretty=format:%h%x09%s', '--', relative],
          { cwd: folder },
        );
        logOut = stdout;
      } catch {
        void vscode.window.showWarningMessage('Could not read git log for this file.');
        return;
      }
      const lines = logOut.split('\n').filter(Boolean);
      if (!lines.length) {
        void vscode.window.showInformationMessage('No commits found for this file.');
        return;
      }
      const pick = await vscode.window.showQuickPick(
        lines.map((line) => {
          const [hash, ...rest] = line.split('\t');
          return { label: hash, description: rest.join(' '), hash };
        }),
        { placeHolder: 'Compare working tree with commit…' },
      );
      if (!pick) return;
      try {
        const { stdout } = await execFileAsync('git', ['show', `${pick.hash}:${relative}`], {
          cwd: folder,
          encoding: 'buffer',
          maxBuffer: 64 * 1024 * 1024,
        });
        const buf = Buffer.from(stdout);
        const ext = path.extname(relative).toLowerCase();
        const other =
          ext === '.xls'
            ? readLegacyXls(buf, wb.meta.sourcePath, 500000).workbook
            : (await readXlsxWorkbook(buf, wb.meta.sourcePath, ext === '.xlsm' ? 'xlsm' : 'xlsx', { maxRows: 500000 })).workbook;
        const result = compareTwoWorkbooks(other, wb, `vs ${pick.hash}`);
        activePanelRegistry.postRaw({ type: 'analysisGitDiff', note: result.note, diffs: result.diffs });
        activePanelRegistry.send('openTools');
        void vscode.window.showInformationMessage(result.note + ' — see Tools panel');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`Compare with commit failed: ${msg}`);
      }
    }),

    vscode.commands.registerCommand('sheetlab.compareWithFile', async () => {
      const pair = activePanelRegistry.getActiveWorkbookAndSheet();
      const wb = pair?.workbook;
      if (!wb) {
        void vscode.window.showWarningMessage('Open a spreadsheet in SheetLab first.');
        return;
      }
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { Spreadsheets: ['xlsx', 'xlsm', 'xls', 'ods', 'csv', 'tsv'] },
        title: 'Compare current workbook with…',
      });
      if (!picked?.[0]) return;
      const otherPath = picked[0].fsPath;
      const buf = await vscode.workspace.fs.readFile(picked[0]);
      const nodeBuf = Buffer.from(buf);
      const ext = path.extname(otherPath).toLowerCase();
      let other;
      if (ext === '.xls') {
        other = readLegacyXls(nodeBuf, otherPath, 500000).workbook;
      } else if (ext === '.csv' || ext === '.tsv') {
        void vscode.window.showWarningMessage('CSV/TSV file compare via this dialog is limited; prefer xlsx for Git-style compare.');
        return;
      } else {
        other = (await readXlsxWorkbook(nodeBuf, otherPath, ext === '.xlsm' ? 'xlsm' : 'xlsx', { maxRows: 500000 })).workbook;
      }
      const result = compareTwoWorkbooks(other, wb, `file vs ${path.basename(otherPath)}`);
      activePanelRegistry.postRaw({ type: 'analysisGitDiff', note: result.note, diffs: result.diffs });
      activePanelRegistry.send('openTools');
      void vscode.window.showInformationMessage(result.note + ' — see Tools panel');
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
      const loader = async (buf: Buffer, p: string) => {
        const ext = path.extname(p).toLowerCase();
        if (ext === '.xls') return readLegacyXls(buf, p, 500000).workbook;
        if (ext === '.csv' || ext === '.tsv') {
          const { worksheet } = parseCsv(buf, ext === '.tsv' ? 'tsv' : 'csv', { maxRows: 500000 });
          return {
            meta: {
              sourceKind: (ext === '.tsv' ? 'tsv' : 'csv') as 'csv' | 'tsv',
              sourcePath: p,
              sheetOrder: [worksheet.name],
            },
            sheets: { [worksheet.name]: worksheet },
          };
        }
        return (await readXlsxWorkbook(buf, p, ext === '.xlsm' ? 'xlsm' : 'xlsx', { maxRows: 500000 })).workbook;
      };
      const result = await compareWorkbookToHead(wb, filePath, loader);
      if (!result) return;
      postDiffsToActivePanel(result.note, result.diffs);
      activePanelRegistry.send('openTools');
      void vscode.window.showInformationMessage(
        result.note + (result.diffs.length ? ' — cells highlighted in the grid' : ''),
      );
    }),

    vscode.commands.registerCommand('sheetlab.highlightGitChanges', async () => {
      // Same as compare, but focus on grid highlights (Tools still updated)
      await vscode.commands.executeCommand('sheetlab.compareWithHead');
    }),

    vscode.commands.registerCommand('sheetlab.clearDiffHighlights', async () => {
      clearDiffHighlights();
      void vscode.window.showInformationMessage('Cleared cell diff highlights.');
    }),

    vscode.commands.registerCommand('sheetlab.openNativeGitDiff', async () => {
      const pair = activePanelRegistry.getActiveWorkbookAndSheet();
      const filePath = pair?.workbook?.meta?.sourcePath;
      if (!filePath) {
        void vscode.window.showWarningMessage('Open a spreadsheet in SheetLab first.');
        return;
      }
      await openNativeGitDiff(filePath);
    }),
  ];
}
