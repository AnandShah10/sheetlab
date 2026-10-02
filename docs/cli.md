# SheetLab CLI

Local / CI verification without the VS Code UI.

## Build

```bash
npm run build
```

Produces `dist/cli.js`. Optionally:

```bash
npm link   # exposes `sheetlab` on PATH from this package
```

## Commands

```bash
# Lint (exit 1 if any error-severity diagnostics)
node dist/cli.js lint path/to/workbook.xlsx

# Tests from .sheetlab/tests/*.json next to the file, or --tests
node dist/cli.js test path/to/workbook.xlsx
node dist/cli.js test path/to/workbook.xlsx --tests ./my-tests

# Profile (JSON to stdout)
node dist/cli.js profile path/to/workbook.xlsx

# Data-quality rules
node dist/cli.js validate path/to/workbook.xlsx
node dist/cli.js validate path/to/workbook.xlsx --rules .sheetlab/rules/default.json
```

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success (no failures) |
| 1 | Lint errors, failed tests, or validation issues |
| 2 | Usage error or file/load failure |

## CI example

```yaml
- run: npm ci && npm run build
- run: node dist/cli.js lint ./data/report.xlsx
- run: node dist/cli.js test ./data/report.xlsx --tests ./.sheetlab/tests
```

Supported inputs: `.xlsx`, `.xlsm`, `.xls`, `.ods`, `.csv`, `.tsv`.
