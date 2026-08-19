# SheetLab — Excel Viewer & Query

An Excel-like spreadsheet experience inside VS Code, for `.xlsx` / `.xlsm` /
`.xls` workbooks — plus an **opt-in** spreadsheet view for `.csv` / `.tsv`
that never takes over VS Code's normal text editor.

## The one thing to know

> **CSV and TSV files open as normal text files by default.** SheetLab does
> not intercept them. Use **"Open as Spreadsheet"** (editor title bar icon,
> right-click in Explorer, or Command Palette) when you want the grid,
> formulas, sorting/filtering, data cleaning, and query tools. Use **"Open
> as Text"** to go back at any time.

The spreadsheet view is a *different way to look at the same file*, not a
conversion. Nothing is written to disk until you explicitly edit and save,
and the file stays a `.csv`/`.tsv` — SheetLab never silently turns it into
an `.xlsx`.

## Features

- Virtualized spreadsheet grid (row numbers, column letters, resizable
  columns, freeze panes, gridlines toggle) that stays responsive at
  hundreds of thousands of rows because it only renders the rows currently
  on screen
- Formula bar and name box (`A1`, `B25`, `A1:F20` navigation)
- Multi-worksheet support for Excel workbooks: switch/create/rename/
  delete/reorder sheets
- Real formula evaluation (HyperFormula) — SUM/SUMIF/SUMIFS, COUNT family,
  AVERAGE/MIN/MAX, ROUND family, IF/IFS/AND/OR/NOT/IFERROR, text functions,
  date basics, VLOOKUP/HLOOKUP/INDEX/MATCH, and more. Formulas HyperFormula
  can't parse show as `#UNSUPPORTED!` rather than a guessed value, and the
  original formula text is preserved on save either way.
- Sort (multi-key, row-integrity preserving), filter, search/find-replace
  (regex, case-sensitive, whole-cell, workbook-wide)
- Data cleaning: trim, remove empty rows/columns, remove duplicates, case
  normalization, find/replace, text↔number conversion, fill down/right,
  split/merge columns — all undoable
- Row/column insert and delete, with cell indices shifted correctly
  (right-click context menu, or the toolbar/commands)
- Hide/show rows and columns, with "Show All Hidden Rows/Columns" to
  restore visibility in bulk
- Cell formatting (bold/italic/underline, font color, background color,
  borders, and number format — presets plus a free-text custom code)
  from the toolbar, applied to the current selection and rendered in the
  grid
- Excel Tables: create/remove a named table over a selection (optionally
  marking a totals row), with visual boundary borders and header-row
  styling in the grid, plus structured reference support in formulas —
  `Table1[Column]`, `Table1[@Column]`, `Table1[#All]`, `Table1[#Headers]`,
  `Table1[#Totals]`, `Table1[#Data]`, and multi-column selectors like
  `Table1[[Col1]:[Col2]]` — see Limitations for the exact scope
- Freeze panes with real visual pinning in the grid, including the
  row-number gutter for frozen rows and drag-to-select across the
  frozen/unfrozen boundary: frozen rows/columns stay on screen while the
  rest of the sheet scrolls
- Row resizing (drag the row-header bottom edge), matching the existing
  column resize
- Column and row header interactions: click a header to select the whole
  column/row; right-click for a header-specific menu (insert/delete/hide,
  and — for columns — sort the sheet by that column)
- A right-click context menu on the grid: cut/copy/paste, clear contents,
  insert/delete row, insert/delete column, hide row/column, show all
  hidden, create/remove table
- A small SQL-like query language (see below) with a non-destructive result
  grid you can copy or push into a new worksheet
- Application-level undo/redo (not just the browser's), working alongside
  VS Code's own text-document undo for CSV
- Copy/paste compatible with Excel/Sheets clipboard format (tab-separated,
  quote-escaped, embedded-newline-safe)
- Dark/light/high-contrast theming via VS Code's own CSS variables
- Strict Webview CSP, no network access, no telemetry by default

## Supported file types

| Type   | Read | Write | Notes |
|--------|------|-------|-------|
| `.xlsx`| Yes  | Yes   | Full read/write via ExcelJS |
| `.xlsm`| Yes  | Yes*  | *Requires confirmation if the file has a VBA project — see [XLSM safety](#xlsm-safety) |
| `.xls` | Yes  | No    | Legacy binary format — view/query/copy only; **Save** offers "Export as XLSX" instead of in-place overwrite |
| `.csv` | Yes  | Yes   | Opt-in spreadsheet view; stays a normal text file otherwise |
| `.tsv` | Yes  | Yes   | Same as CSV, tab-delimited |

ODS is not supported in this version — it was left out rather than added
half-working; see [Limitations](#known-limitations).

## Opening CSV as a spreadsheet

1. Open `data.csv` — it's a normal VS Code text editor, as always.
2. Click **Open as Spreadsheet** (or run the command). SheetLab opens a
   grid view of the *same file*.
3. Sort, filter, search, clean, query, edit.
4. Save (`Ctrl+S` / `Cmd+S`) — writes back to `data.csv`, preserving the
   detected delimiter, quoting, line endings, and encoding.
5. **Open as Text** any time to return to the plain editor — it shows
   exactly what you just edited, because both views share the same
   `vscode.TextDocument`.

### Why this works cleanly (architecture note)

The CSV spreadsheet editor is a `vscode.CustomTextEditorProvider`, not a
from-scratch file reader. `resolveCustomTextEditor` is handed the *same*
`TextDocument` VS Code already opened for the plain-text view. That single
choice means SheetLab gets, for free, from VS Code itself:

- one shared dirty/save/revert lifecycle (no separate "spreadsheet dirty
  state" to reconcile)
- VS Code's own undo stack for every edit we make via `WorkspaceEdit`
- automatic propagation to any other open editor of the same file
- VS Code's existing external-modification and save-conflict handling

Excel files (`.xlsx`/`.xlsm`/`.xls`) use a `CustomEditorProvider` backed by
`CustomDocument` instead, since there's no meaningful "plain text" view of
a binary workbook to share — that provider implements its own dirty
state, save/revert/backup, and file-watcher-based external-change
detection (see `src/services/conflictService.ts`).

## Query syntax (SheetLab Query Language)

A deliberately small SQL-like subset — **not** full SQL:

```sql
SELECT Department, SUM(Sales) AS TotalSales
FROM Sheet1
WHERE Sales > 1000
GROUP BY Department
ORDER BY TotalSales DESC
LIMIT 100
```

```sql
SELECT * FROM Sheet1 WHERE Country = 'India'

SELECT Product, AVG(Price) FROM Sheet1 GROUP BY Product
```

Supported: `SELECT` (columns, `*`, `SUM`/`COUNT`/`AVG`/`MIN`/`MAX` with
`AS` aliases), `FROM <sheet>`, `WHERE` with `=,!=,<>,<,<=,>,>=` chained by
`AND`/`OR` (left-to-right, no parentheses), `GROUP BY`, `ORDER BY ASC|DESC`,
`LIMIT`.

**Not supported** (by design, to avoid overclaiming): `JOIN`, subqueries,
`HAVING`, `CASE`, string concatenation, arithmetic expressions in `SELECT`,
operator precedence/parentheses in `WHERE`. Attempting these produces a
clear parse error naming the problem, not a silently wrong result.

Queries never modify the source data. Turning a result into real data is a
separate, explicit action: **Copy Result** or **New Worksheet From
Result**.

## Formula support

See the table in [Features](#features) above for the function list.
HyperFormula (Apache-2.0) is the evaluation engine — a real formula
engine, not string-matching. Its function coverage is large but not
identical to Excel's (no array formulas, limited volatile-function
support, and a handful of newer Excel functions are absent). A formula
HyperFormula can't evaluate becomes `#UNSUPPORTED!` in the cell, and the
original formula text always survives a save untouched.

Excel Table structured references (`Table1[Column]`, `Table1[@Column]`)
are supported by rewriting them into equivalent A1/range references
before the formula reaches HyperFormula — see
`src/formula/structuredReferences.ts` and the Excel Tables entry under
[Limitations](#known-limitations) for exactly what's covered.

## Data cleaning, sorting, filtering

All destructive operations (trim, dedupe, fill, split/merge, etc.)
participate in undo/redo. Sort keeps entire rows together and warns if a
formula inside the sorted range references a cell *outside* it (a sharp
edge inherited from how sorting inherently works, not something SheetLab
can silently "fix"). Filtering hides rows in the UI; it never deletes
data.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+F` / `Cmd+F` | Search Workbook |
| `Ctrl+G` / `Cmd+G` | Go To Cell |
| `Ctrl+S` / `Cmd+S` | Save |
| `Enter` / `F2` | Edit active cell |
| `Tab` / `Shift+Tab` | Commit edit, move right/left |
| `Arrow keys` (+`Shift`) | Move / extend selection |
| `Delete` / `Backspace` | Clear selection |

All are scoped to `when: activeCustomEditorId == sheetlab.excelEditor ||
activeCustomEditorId == sheetlab.csvSpreadsheetEditor` so they never
shadow VS Code's normal bindings elsewhere.

## Settings

All under `sheetlab.*` — see `package.json` → `contributes.configuration`
for the full list and defaults: CSV delimiter/encoding/quote/header
detection, grid theme/font/row-height/column-width/gridlines, formula
calculation toggle, performance caps (`maxRowsInMemory`, `chunkSize`,
`query.maxResultRows`), and an opt-in, off-by-default telemetry flag.
**Telemetry, if ever enabled, never includes workbook or CSV contents —
SheetLab makes no network requests at all.**

## Known limitations

Stated plainly, per the project's own "no false claims" rule:

- **Not full Excel compatibility.** Charts, pivot tables, most data
  validation, and conditional-formatting beyond basic cases are not
  read or written.
- **`.xlsm` macros are not guaranteed to survive a save.** SheetLab warns
  and requires explicit confirmation before saving a macro-containing
  workbook — see below.
- **`.xls` is read-only** in this version (legacy binary format, no
  reliable open-source writer). Use Export as XLSX to save changes.
- **The query language is a small subset of SQL**, not SQL itself — see
  above.
- **ODS is not supported.**
- Very large files are capped by `sheetlab.performance.maxRowsInMemory`
  (default 500,000); rows beyond the cap are dropped with a visible
  warning, not silently discarded.
- **Freeze panes**: the grid visually pins frozen rows/columns while
  scrolling, including the row-number gutter for frozen rows (all
  implemented as overlay layers that counter-translate against the scroll
  container). Drag-to-select works across the frozen/unfrozen boundary;
  click-to-select and double-click-to-edit work normally on frozen cells,
  including their row/column headers (right-click for the same header
  menu as any other row/column).
- **Excel Tables** (spec section 23): create/remove/detect and visual
  boundary rendering are implemented. Structured references are resolved
  by rewriting them into plain A1/range references before handing the
  formula to HyperFormula — see `src/formula/structuredReferences.ts`.
  Supported forms: `Table1[Column]` (whole data column), `Table1[@Column]`
  ("this row"), `Table1[#All]`, `Table1[#Headers]`, `Table1[#Totals]`
  (requires the table's totals-row flag to be set — SheetLab's own
  "Create Table" prompt asks about this, and it's read best-effort from
  an existing `.xlsx`'s table definition), `Table1[#Data]`, multi-column
  selectors (`Table1[[Col1]:[Col2]]`), and an item specifier combined
  with a column range (`Table1[[#Headers],[Col1]:[Col2]]`). NOT
  supported: `[#This Row]` as a standalone item outside `@` syntax. An
  unresolvable reference (unknown table/column name, an `@` reference
  from a formula that isn't actually inside that table's rows, or
  `[#Totals]` on a table with no totals row) is left as literal text,
  which HyperFormula then reports as its own parse/name error rather than
  SheetLab guessing a value. Reading table definitions from an existing
  `.xlsx` is done defensively against ExcelJS's `tables` API (whose exact
  shape has varied across versions); an unrecognized shape degrades to
  "no tables detected" rather than a crash, and cell data is read
  independently either way. Writing a table back out registers it via
  ExcelJS's `addTable` on a best-effort basis *after* all cell values are
  already written, and deliberately omits the `rows` parameter that call
  accepts, specifically so a failure there can never corrupt
  already-written cell data — worst case, the table isn't registered as
  a native Excel Table but the data is untouched.
- Cell formatting UI covers bold/italic/underline, font color, background
  color, borders (uniform add/remove on the current selection), and
  number formats — a preset dropdown of common codes plus a free-text
  field for any other format code. The renderer (`webview/src/grid/numberFormat.ts`)
  handles semicolon-separated positive/negative/zero sections, percent,
  thousands separators, a literal currency-symbol prefix/suffix (so
  parentheses-style negatives like `#,##0;(#,##0)` render correctly),
  decimal precision derived from the digit pattern, `[Red]`/`[Blue]`/etc.
  conditional color sections (the resolved color is applied to the cell's
  text, taking precedence over a static font color for that value — see
  `getNumberFormatColor`), `[$SYMBOL-LCID]` locale-currency tokens (the
  literal symbol is used; the locale ID itself isn't consulted, since
  SheetLab has no locale table to resolve it against — a bare `[$-409]`
  with no symbol falls back to `$`), and common date/time tokens (with a
  correct Excel-serial-date epoch conversion, not a naive "treat the
  number as milliseconds" shortcut). It is intentionally not a full
  implementation of Excel's number-format mini-language — no indexed
  palette colors (`[Color 12]` is recognized and stripped so it doesn't
  pollute the output, but resolves to no color since we have no access
  to the workbook's actual palette), and date-token recognition covers
  common orderings rather than every token combination. A format with no
  recognizable digit placeholder (`0` or `#`) at all falls back to the
  plain numeric value rather than treating arbitrary text as a currency
  prefix.
- Column widths, row heights, hidden rows/columns, table definitions, and
  freeze-pane position work within a session for CSV/TSV too, but — since
  CSV/TSV is plain text with nowhere to store that metadata — none of it
  survives closing and reopening the file (unlike `.xlsx`/`.xlsm`, which
  persist all of it through save/load).

### XLSM safety

ExcelJS's writer does not guarantee round-tripping a VBA project binary.
SheetLab treats this as a data-integrity issue: saving an `.xlsm` that
had macros always prompts for explicit confirmation
("Save Anyway (cell data only)" / "Cancel") before writing anything, and
a cancelled save never touches the original file.

## Architecture

```
src/
  extension.ts                  activation entry point
  commands/                     thin command-palette wrappers
  editors/
    excelCustomEditor/          CustomEditorProvider for xlsx/xlsm/xls
    csvSpreadsheetEditor/       CustomTextEditorProvider for csv/tsv
    shared/                     CSP-locked webview HTML shell
  workbook/                     in-memory model + mutation helpers
  excel/                        ExcelJS reader/writer, legacy .xls reader, XLSM safety gate
  csv/                          delimiter detection, PapaParse reader/writer, TextDocument sync
  query/                        SLQL tokenizer/parser + execution engine
  formula/                      HyperFormula wrapper
  data/                         sort, filter, cleanup, aggregation
  services/                     undo stack, save (atomic rename), conflict watcher,
                                 clipboard, search, settings, active-panel registry
  types/                        shared Cell/Worksheet/Workbook model + webview message protocol
  utils/                        A1 reference parsing

webview/src/
  app/            entry point, VS Code API wrapper, cell-ref helpers
  grid/           virtualized grid + clipboard
  formulaBar/ nameBox/ sheetTabs/ toolbar/   UI chrome
  search/ query/ dataCleaning/ contextMenu/  feature panels
  state/          observable app state store

tests/
  unit/           dependency-light logic tests (csv, sort, filter, cleanup,
                   query parser/engine, undo stack, clipboard, aggregation, cell refs)
  integration/    VS Code Extension Host scenarios (see tests/integration/README.md)
  performance/    real, runnable benchmark against 10k/100k/500k-row CSVs
  fixtures/       generated at benchmark time (not checked in)
```

The webview is plain TypeScript (no React/framework) bundled via esbuild
to two IIFE/CJS outputs — kept deliberately small and dependency-light
since it runs inside a sandboxed Webview.

## Development

```bash
npm install
npm run watch      # esbuild watch mode (extension host + webview)
```

Press `F5` in VS Code (with this folder open) to launch an Extension
Development Host with SheetLab loaded.

### Testing

```bash
npm run test:unit   # mocha + ts-node, dependency-light logic tests
npm run test        # full VS Code Extension Host integration suite
npm run test:perf   # real benchmark against generated 10k/100k/500k-row CSVs
```

`npm run test:unit` needs `mocha`/`ts-node` from `devDependencies`
(`npm install` first). This repository's build sandbox had no network
access to run `npm install`, so those 104 unit tests were instead verified
here with a minimal `describe`/`it` shim
(`tests/_harness/`) against `ts-node --transpile-only` — all 104 pass, and
the entire webview module tree plus every dependency-free `src/` module
passes a full `tsc --strict` typecheck. The tests that exercise
`papaparse`/`exceljs`/`hyperformula` directly need those packages
installed to run at all; run `npm run test:unit` after `npm install` to
execute the complete suite including those.

### Linting / formatting

```bash
npm run lint
npm run format
```

### Packaging

```bash
npm run build
npx vsce package
```

Produces `sheetlab-<version>.vsix`, installable via
**Extensions: Install from VSIX...** in VS Code.

## Privacy & security

- No network requests, ever. No workbook/CSV contents, formulas, or query
  results are sent anywhere.
- Telemetry is off by default and, if enabled, never includes file
  contents (`sheetlab.telemetry.enabled`).
- Webview runs under a strict Content-Security-Policy (`default-src
  'none'`, nonce'd scripts only, no remote origins, no `eval`).
- No macro/VBA execution. No formula is ever run as JavaScript — formula
  evaluation goes through HyperFormula's dedicated engine, not `eval`.

## License

MIT — see `LICENSE`.
