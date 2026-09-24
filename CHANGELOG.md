# Changelog

All notable changes to SheetLab will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.3]

### Changed
- Removed **Lint / Analyze / Trace** from the editor **title bar** (navbar) to free space — use toolbar or Command Palette instead

### Added
- **Go to Symbol** (`Ctrl+Shift+O`): sheets, tables, named ranges, sample formulas
- **Peek Cell**: inspect value/formula with Open / Precedents / Dependents
- **Semantic workbook snapshot** + self-diff (foundation for Git-aware diff)
- **Analyze Snapshot** command (stability check + profile summary)

## [0.2.2]

### Fixed
- **`command 'sheetlab.runLinter' not found`** (and other analysis commands): `sheetlab.exportWorkbook` was registered twice during activate; the second `registerCommand` threw and aborted registration of every command listed after it (Trace, Lint, Profile, Explain)
- Activation is more resilient: editor/export vs UI command registration are isolated
- Explicit `onCommand:` activation events for analysis commands

## [0.2.1]

### Fixed
- Command Palette actions work after focus leaves the webview (keeps last active SheetLab panel)
- Analysis actions no longer require right-click (selection was lost on context menu)

### Added
- Toolbar buttons: **Precedents**, **Dependents**, **Lint**, **Profile**, **Explain**, **Analysis**
- Editor title actions for Lint / Analyze / Trace Precedents
- Keybindings: `Ctrl+Shift+[` precedents, `Ctrl+Shift+]` dependents, `Ctrl+Shift+;` lint

### Note
- VS Code **Ctrl+P** is Quick Open (files), not the Command Palette — use **Ctrl+Shift+P** (Cmd+Shift+P on Mac) and type `SheetLab:`

## [0.2.0]

### Added — Spreadsheet engineering (Phase 1 core)
- **Analysis core**: formula reference extraction, dependency graph, diagnostics framework, workbook profiler
- **Trace Precedents / Trace Dependents** (command palette + cell context menu) with navigable tree panel
- **Run Linter**: circular refs, formula errors, broken sheet refs, inconsistent formula patterns, duplicate headers, unused sheets
- **Analyze Workbook** profile (sheet stats, formula density, cycles, hotspots)
- **Explain Cell**: precedents + cell-scoped diagnostics
- Settings: `sheetlab.analysis.enabled`, `sheetlab.lint.maxDiagnostics`, `sheetlab.dependencies.maxTraversalDepth`
- Unit tests for formula refs, pattern normalization, dependency graph cycles

## [0.1.8]

### Fixed
- **Open as Spreadsheet / Open with Text Preview** now always apply the chosen mode for that file
- Preference is stored **per URI**; switching from text back to the other command no longer keeps the previous view
- If the custom editor panel was already open (`retainContextWhenHidden`), the host pushes `forceViewMode` so the webview updates immediately

## [0.1.7]

### Changed
- **Two separate CSV/TSV open options** (not one combined control):
  - **Open as Spreadsheet** — grid only
  - **Open with Text Preview** — side-by-side text + grid
- Toolbar shows **Spreadsheet** and **Preview** as two distinct buttons (CSV/TSV only)

## [0.1.6]

### Added
- **CSV/TSV side-by-side text + grid preview**: Split view shows source text on the left and spreadsheet on the right
- Toolbar **Grid / Split / Text** toggles (CSV/TSV only); default for CSV/TSV is Split
- Text pane is editable; changes apply back to the same VS Code TextDocument (stays in sync with grid edits and external text changes)

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
