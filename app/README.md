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

`npm run dev` builds the local renderer and launches Electron. It does not start a local HTTP server.

## Application data

The functional state is `studio-state.json` under Electron's `userData` directory. It contains the selected-project pointer, canonical project identity, trust timestamp, game brief, and current objective. Electron also creates its normal Chromium profile, cache, preference, and session files in that directory.

No application state or scan cache is written into the selected Godot project. The controller rejects an application-data directory that overlaps the project root.

## Scanner boundary

The scanner reports confirmed facts, warnings, heuristics, and limitations separately. It uses canonical paths, `lstat`-based no-follow traversal, explicit depth/file/text/list limits, and cancellation checkpoints. It skips `.git`, `.godot`, and `.import` directories.

Its parser intentionally covers only directly observable settings and quoted local references. It does not resolve dynamic loads, instantiate scenes, validate gameplay, or establish quality or performance.
