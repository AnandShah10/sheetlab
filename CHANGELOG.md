# Changelog

All notable changes to SheetLab will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.5]

### Fixed
- **Save / "No custom document found"**: keep a strong document registry so Ctrl+S always resolves the open workbook; safer save path with live document rebinding
- **Sheet tab menu clipped at bottom**: menu opens **upward** with viewport clamping so Rename / Duplicate / Delete are fully visible
- **Context menus & command popups**: max-height + `overflow-y: auto` so long option lists scroll instead of being cut off
- Toolbar and side panels use contained scrolling within the webview

## [0.1.4]

### Fixed
- Unit tests: CSV reader no longer counts PapaParse trailing-newline empty row toward truncation/round-trip
- Webview sandbox: replaced all `prompt()`/`confirm()`/`alert()` with VS Code host dialogs (new sheet, rename, delete, export, go-to-cell, create table)
- Toolbar **Export** now opens the host export QuickPick (`requestExport`)
- Query **Copy Result** shows temporary "Copied!" feedback
- Create Table captures selection range before the dialog so focus loss cannot clear it
- Ctrl+S / custom editor save: only clears dirty state on success; ODS/XLS save via SheetJS
- `npm test` points at `tests/runTest.js` (unit harness; no missing `dist/tests/runTest.js`)

## [0.1.3]

### Added
- Find **and Replace** (Replace / Replace All) in the search panel
- Query language supports trailing `;` statement terminators
- Duplicate row / duplicate column in grid context menus
- Unfreeze panes command and toolbar button
- Export toolbar action with format picker (xlsx, xlsm, xls, ods, csv, tsv)
- ODS open + export support
- Visible sheet-tab menu (▾) for rename / duplicate / delete
- Create-table prompt shows the selected range (A1) so selection is verifiable

### Fixed
- "Open as Spreadsheet" no longer appears when already in spreadsheet mode for CSV/TSV
- New worksheet (+) and rename sheet reliably update sheet tabs via host broadcast
- New worksheet from query result populates data in the same create handler

## [0.1.2]

### Added
- Initial marketplace optimization and documentation updates

### Changed
- Enhanced README for VS Code Marketplace

## [0.1.1] - 2024-10-01

### Added
- Full Excel-like spreadsheet viewing and editing for XLSX, XLSM, XLS
- Opt-in CSV/TSV spreadsheet view that preserves original text editor
- Formula evaluation with HyperFormula
- SQL-like query engine
- Data cleaning tools
- Cell formatting, tables, freeze panes, undo/redo
- Multi-worksheet support
- Comprehensive configuration options

### Fixed
- Various stability and performance improvements for large files

## [0.1.0] - 2024-09

### Added
- Initial prototype and core functionality

---

**Made with ❤️ by Anand Shah for the developer community**

For more details, see the [GitHub releases](https://github.com/AnandShah10/sheetlab/releases).
