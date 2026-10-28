# SheetLab feature map (v0.5.21)

Developer-first spreadsheet environment for VS Code.

## Core grid
- **Conditional formatting (SheetLab rules):** highlight selection if value &gt; / &lt; 0 or blank; clear rules on sheet
- XLSX / XLSM / XLS / ODS view & edit
- CSV / TSV: **Spreadsheet view** and **Preview** (split text + grid) via separate open commands
- Virtualized grid, formula bar, freeze/unfreeze, tables, sort/filter
- Export (csv, tsv, xlsx, ods, …)

## Query (SLQL)
- SELECT, FROM, WHERE, GROUP BY, HAVING, ORDER BY, LIMIT
- Aggregates: SUM, COUNT, AVG, MIN, MAX
- **JOIN**: INNER / LEFT / RIGHT / FULL with table aliases
- Multi-key ON: `ON a.x = b.x AND a.y = b.y`
- Same-workbook sheets only (not cross-file workbooks)
- Materialize result → new sheet with lineage
- Query panel JOIN templates

## Pivot (toolbar **Pivot**)
- Excel-style rows / columns / values (sum, count, avg, min, max, count unique)
- Optional second value field and filter column
- Materialize pivot grid to a new sheet

## Charts (toolbar **Charts**)
- Full-size modal (not Tools): form left, graph + table right
- Types: bar, stacked bar, line, area, pie, donut, scatter, histogram
- Category, measures + aggregations, optional series, filters, sort
- **Sample chart**, **Export SVG**, **Export PNG**, **Materialize to sheet**
- Config saved in localStorage; validation messages on bad setup

## Analysis (Tools panel)
- Trace precedents / dependents, lineage
- Lint → Tools + VS Code Problems
- Profile, Explain cell, Explain workbook
- Column stats, fix column proposals
- Resizable from all edges

## Reproducibility
- Record / save / run clean-data pipelines (`.sheetlab/pipelines/`)
- Saved queries (`.sheetlab/queries/`)
- Lineage sidecar: `.sheetlab/lineage/<workbook>.json`

## Quality & CI
- Data validation rules
- Workbook tests (equals, uniqueColumn, rangeNoErrors, …)
- CLI: `node dist/cli.js lint|test|profile|validate`

## Git
- vs HEAD / commit / file; cell highlights; Diff banner; revert
- In-app changes list (native VS Code split does not color SheetLab cells)

## Navigation
- Go to Symbol, Peek Cell, Go to Cell

## Build
- `npm run build` always rebuilds `dist/extension.js`, `dist/cli.js`, and **`media/webview.js`**
- `npm run package` runs build first (`prepackage` + explicit build)
- `npm run verify:webview` fails if webview bundle is missing
