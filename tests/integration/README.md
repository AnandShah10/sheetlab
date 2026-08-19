# Integration tests

These exercise the actual `vscode.*` Custom Editor APIs (opening XLSX,
opening a CSV as text vs. spreadsheet, editing, saving, external-change
conflicts, search, query, export) and therefore must run inside the real VS
Code Extension Host via `@vscode/test-electron`, not plain Node/ts-node.

They are not runnable in this sandbox (no network access to download the
Extension Host binary), so they're checked in as scaffolding plus the
scenario list below rather than fabricated "passing" output. On a machine
with normal network access:

```
npm install
npm run build
npm run test        # launches @vscode/test-electron, runs suite/*.test.ts
```

## Planned scenarios (suite/*.test.ts)

- `openXlsx.test.ts` — open a fixture .xlsx, assert sheet names/cell values
  match what ExcelJS reports directly.
- `csvTextByDefault.test.ts` — open a .csv, assert the resolved editor is
  the built-in text editor (`viewType === 'default'`), not SheetLab's.
- `openCsvAsSpreadsheet.test.ts` — run `sheetlab.openCsvAsSpreadsheet`,
  assert the CSV custom editor resolves against the SAME `TextDocument`
  instance as a plain `vscode.window.showTextDocument` open of the file.
- `csvEditRoundTrip.test.ts` — edit a cell via the spreadsheet webview
  message protocol, save, assert the on-disk bytes match the expected CSV
  with delimiter/quoting/line-endings preserved.
- `csvExternalChange.test.ts` — modify the file on disk while the
  spreadsheet editor is open with unsaved edits, assert the conflict
  prompt fires and "keep mine" / "reload" both behave correctly.
- `switchBackToText.test.ts` — run `sheetlab.openAsText` after spreadsheet
  edits, assert the plain text editor immediately reflects those edits
  (same TextDocument, no reload needed).
- `exportXlsxFromCsv.test.ts` — export a CSV workbook to XLSX, assert the
  user-facing "this creates a new file" prompt fires.
- `searchAndQuery.test.ts` — run a search and a SLQL query through the full
  message round trip (webview -> extension host -> webview).
