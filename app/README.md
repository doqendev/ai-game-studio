# Milestone 1: Read-Only Project Cockpit

This Electron application is the Milestone 1 product slice. It selects one trusted Godot project, reads a conservative subset of its files and settings, and presents three areas: Studio, Project, and Builds.

It does not run Godot, execute project code, infer builds, modify the selected project, or include Codex integration.

## Architecture

- `src/main/`: folder selection, app-data state, scanner, controller, and validated IPC handlers.
- `src/preload/`: seven purpose-specific bridge methods; `ipcRenderer` is not exposed.
- `src/renderer/`: the Studio, Project, and Builds interface.
- `src/shared/`: typed projections shared across the process boundary.
- `test/`: scanner and state-store tests plus controlled fixtures.
- `acceptance/`: owner-visible Electron flows for a fixture and a real project.
- `scripts/`: read-only scan and whole-tree integrity evidence tools.

The BrowserWindow uses context isolation, disables Node integration, enables renderer sandboxing and web security, denies permission requests, loads only the packaged local renderer, rejects navigation and new windows, and validates IPC sender, frame, and origin.

## Commands

Run these from this directory with Node 22.22.2:

```powershell
npm ci
npm run check
npm test
npm run build
npm run dev
```

Additional verification:

```powershell
npm run test:acceptance
npm run scan -- "C:\absolute\GodotProject" "C:\outside-project\scan.json"
npm run integrity -- "C:\absolute\GodotProject" "C:\outside-project\integrity.json"
```

`npm run test:acceptance` is portable: it uses only the controlled fixture, a temporary Electron profile, and temporary Playwright artifacts.

Owner-specific evidence is deliberately separate. Supply all paths explicitly:

```powershell
$env:STUDIO_OWNER_PROJECT="C:\absolute\GodotProject"
$env:STUDIO_OWNER_APP_DATA="C:\outside-project\clean-evidence-profile"
$env:STUDIO_EVIDENCE_ROOT="C:\outside-project\evidence"
npm run test:owner-evidence
```

Without those three variables, the owner-evidence suite exits successfully with an explicit skipped-test message. It is never part of the portable acceptance result.

`npm run dev` builds the local renderer and launches Electron. It does not start a local HTTP server.

## Application data

The functional state is `studio-state.json` under Electron's `userData` directory. It contains the selected-project pointer, canonical project identity, trust timestamp, game brief, and current objective. Electron also creates its normal Chromium profile, cache, preference, and session files in that directory.

No application state or scan cache is written into the selected Godot project. The controller rejects an application-data directory that overlaps the project root.

## Scanner boundary

The scanner reports confirmed facts, warnings, heuristics, and limitations separately. It uses canonical paths, `lstat`-based no-follow traversal, explicit depth/file/text/list limits, and cancellation checkpoints. It skips `.git`, `.godot`, and `.import` directories.

Observed files are classified as project source, tooling, generated/output, ignored by Godot, or unknown. Confirmed Godot Android Gradle output and directories beneath `.gdignore` remain visible in origin totals but do not inflate source-level scenes, scripts, capabilities, large/unsupported files, or missing dependencies.

Missing dependency warnings are limited to supported structured resource fields and literal `load()`/`preload()` calls. Formatting templates, directories, output targets, arbitrary quoted paths, dynamic loads, and generated copies are not presented as confirmed missing files. `uid://` main-scene values are preserved but not resolved in Milestone 1.

The parser intentionally covers only directly observable settings and supported static dependencies. It does not instantiate scenes, validate gameplay, or establish quality or performance.
