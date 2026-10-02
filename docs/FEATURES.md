# SheetLab feature map (v0.5.x)

Developer-first spreadsheet environment for VS Code.

## Core grid
- XLSX / XLSM / XLS / ODS view & edit
- CSV / TSV spreadsheet view, text view, preview (separate open modes)
- Virtualized grid, formula bar, freeze/unfreeze, tables, sort/filter
- Export (csv, tsv, xlsx, …)

## Analysis (Tools panel)
- Trace precedents / dependents, lineage (formula + pipeline + queries + sheet origin)
- Lint → Tools + VS Code Problems
- Profile, Explain cell, Explain workbook
- Fix column (multi-cell formula outliers, preview + apply, composite undo)
- Resizable Tools panel

## Reproducibility
- Record / save / run clean-data pipelines (`.sheetlab/pipelines/`)
- Pipeline run = **one composite undo**
- Saved queries (`.sheetlab/queries/`)
- Materialize query → sheet with lineage + **undo removes sheet**
- Lineage sidecar: `.sheetlab/lineage/<workbook>.json`

## Quality & CI
- Data validation rules
- Workbook tests (equals, uniqueColumn, rangeNoErrors, …)
- CLI: `node dist/cli.js lint|test|profile|validate` (exit 0/1/2)

## Git
- vs HEAD, vs file, vs commit, two commits
- Diff list with Prev/Next and kind filter

## Navigation
- Go to Symbol, Peek Cell, Go to Cell
