#!/usr/bin/env node
/**
 * SheetLab CLI for CI / local verification (no VS Code UI).
 *
 * Exit codes:
 *   0 — success (no failures)
 *   1 — lint / test / validation failures
 *   2 — usage or execution error
 *
 * Commands:
 *   sheetlab lint <file>
 *   sheetlab test <file> [--tests <dir|file>]
 *   sheetlab profile <file>
 *   sheetlab validate <file> [--rules <file>]
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadWorkbookFromFile } from './loadWorkbook';
import { DependencyGraph } from '../analysis/dependencyGraph';
import { runLinter } from '../analysis/diagnostics';
import { profileWorkbook } from '../analysis/profiler';
import { runWorkbookTests } from '../testing/testRunner';
import { WorkbookTestFile } from '../testing/types';
import { runValidation, ValidationConfig } from '../validation/rules';

const EXIT_OK = 0;
const EXIT_FAIL = 1;
const EXIT_ERROR = 2;

async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === '-h' || args[0] === '--help') {
    printHelp();
    return args.length === 0 ? EXIT_ERROR : EXIT_OK;
  }

  const cmd = args[0];
  try {
    switch (cmd) {
      case 'lint':
        return await cmdLint(args.slice(1));
      case 'test':
        return await cmdTest(args.slice(1));
      case 'profile':
        return await cmdProfile(args.slice(1));
      case 'validate':
        return await cmdValidate(args.slice(1));
      case 'version':
      case '--version':
      case '-v':
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          console.log(require('../package.json').version ?? '0.5.0');
        } catch {
          console.log('0.5.0');
        }
        return EXIT_OK;
      default:
        console.error(`Unknown command: ${cmd}`);
        printHelp();
        return EXIT_ERROR;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`sheetlab: ${msg}`);
    return EXIT_ERROR;
  }
}

function printHelp(): void {
  console.log(`SheetLab CLI — spreadsheet lint / test / profile for CI

Usage:
  sheetlab lint <workbook>              Run spreadsheet linter
  sheetlab test <workbook> [--tests p]  Run .sheetlab/tests JSON (or --tests path)
  sheetlab profile <workbook>           Print workbook profile
  sheetlab validate <workbook> [--rules f]  Data-quality rules

Exit codes:
  0  success
  1  lint/test/validation failures
  2  usage or execution error

Supported files: .xlsx .xlsm .xls .ods .csv .tsv
`);
}

function requireFile(args: string[]): string {
  if (!args[0] || args[0].startsWith('-')) {
    throw new Error('Missing workbook path');
  }
  return args[0];
}

function flagValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i >= 0 && args[i + 1]) return args[i + 1];
  return undefined;
}

async function cmdLint(args: string[]): Promise<number> {
  const file = requireFile(args);
  const { workbook, truncated } = await loadWorkbookFromFile(file);
  if (truncated) console.warn('warning: workbook was truncated by max row limit');
  const graph = DependencyGraph.build(workbook);
  const diags = runLinter(workbook, graph);
  const errors = diags.filter((d) => d.severity === 'error');
  const warnings = diags.filter((d) => d.severity === 'warning');

  console.log(`Lint: ${file}`);
  console.log(`  ${diags.length} diagnostic(s) (${errors.length} error, ${warnings.length} warning)`);
  for (const d of diags.slice(0, 100)) {
    const loc =
      d.sheetName != null && d.row != null && d.col != null
        ? `${d.sheetName}!${colLetter(d.col)}${d.row + 1}`
        : d.sheetName ?? '';
    console.log(`  [${d.severity}] ${d.ruleId}${loc ? ' @ ' + loc : ''}: ${d.message}`);
  }
  if (diags.length > 100) console.log(`  …and ${diags.length - 100} more`);
  return errors.length > 0 ? EXIT_FAIL : EXIT_OK;
}

async function cmdTest(args: string[]): Promise<number> {
  const file = requireFile(args);
  const { workbook } = await loadWorkbookFromFile(file);
  const testsPath =
    flagValue(args, '--tests') ??
    path.join(path.dirname(path.resolve(file)), '.sheetlab', 'tests');

  const files = collectTestFiles(testsPath);
  if (!files.length) {
    console.error(`No test files found at ${testsPath}`);
    console.error('Create JSON under .sheetlab/tests/ or pass --tests <file|dir>');
    return EXIT_ERROR;
  }

  let failed = 0;
  let total = 0;
  for (const tf of files) {
    const raw = fs.readFileSync(tf, 'utf8');
    const suite = JSON.parse(raw) as WorkbookTestFile;
    const results = runWorkbookTests(workbook, suite);
    total += results.length;
    console.log(`\n${suite.name || path.basename(tf)} (${tf})`);
    for (const r of results) {
      const mark = r.passed ? '✓' : '✗';
      console.log(`  ${mark} ${r.name}${r.passed ? '' : ' — ' + r.message}`);
      if (!r.passed) failed++;
    }
  }
  console.log(`\n${total - failed}/${total} passed`);
  return failed > 0 ? EXIT_FAIL : EXIT_OK;
}

async function cmdProfile(args: string[]): Promise<number> {
  const file = requireFile(args);
  const { workbook, truncated } = await loadWorkbookFromFile(file);
  if (truncated) console.warn('warning: workbook was truncated by max row limit');
  const profile = profileWorkbook(workbook);
  console.log(JSON.stringify(profile, null, 2));
  return EXIT_OK;
}

async function cmdValidate(args: string[]): Promise<number> {
  const file = requireFile(args);
  const { workbook } = await loadWorkbookFromFile(file);
  const rulesPath =
    flagValue(args, '--rules') ??
    path.join(path.dirname(path.resolve(file)), '.sheetlab', 'rules', 'default.json');

  if (!fs.existsSync(rulesPath)) {
    console.error(`Rules file not found: ${rulesPath}`);
    console.error('Pass --rules <file> or add .sheetlab/rules/default.json');
    return EXIT_ERROR;
  }
  const config = JSON.parse(fs.readFileSync(rulesPath, 'utf8')) as ValidationConfig;
  const diags = runValidation(workbook, config);
  console.log(`Validate: ${file} (rules: ${rulesPath})`);
  console.log(`  ${diags.length} issue(s)`);
  for (const d of diags.slice(0, 100)) {
    const loc =
      d.sheetName != null && d.row != null && d.col != null
        ? `${d.sheetName}!${colLetter(d.col)}${d.row + 1}`
        : '';
    console.log(`  [${d.severity}] ${d.ruleId}${loc ? ' @ ' + loc : ''}: ${d.message}`);
  }
  return diags.length > 0 ? EXIT_FAIL : EXIT_OK;
}

function collectTestFiles(p: string): string[] {
  const abs = path.resolve(p);
  if (!fs.existsSync(abs)) return [];
  const st = fs.statSync(abs);
  if (st.isFile()) return abs.endsWith('.json') ? [abs] : [];
  return fs
    .readdirSync(abs)
    .filter((n) => n.endsWith('.json'))
    .map((n) => path.join(abs, n))
    .sort();
}

function colLetter(col: number): string {
  let n = col + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

main(process.argv).then((code) => process.exit(code));
