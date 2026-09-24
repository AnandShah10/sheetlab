/**
 * Entry point for `npm test`.
 * Runs the zero-dependency unit harness (no VS Code Electron required).
 * For extension integration tests against a real VS Code instance, use
 * @vscode/test-electron separately.
 */
'use strict';
const path = require('path');
const { spawnSync } = require('child_process');

const harness = path.join(__dirname, '_harness', 'runAllNoDeps.ts');
const tsNode = path.join(__dirname, '..', 'node_modules', '.bin', process.platform === 'win32' ? 'ts-node.cmd' : 'ts-node');

const result = spawnSync(tsNode, [harness], {
  stdio: 'inherit',
  cwd: path.join(__dirname, '..'),
  env: process.env,
  shell: process.platform === 'win32',
});

process.exit(result.status == null ? 1 : result.status);
