# Corrective Milestone 1 Evidence Packet

This packet records the corrected read-only Project Cockpit. The correction separates authored project source from tooling, generated output, and Godot-ignored content; narrows missing-dependency findings to supported concrete dependency syntax; makes scan cancellation generation-safe; handles `uid://` main scenes honestly; and makes the normal acceptance suite portable.

It contains no Milestone 2 functionality: no Codex, Godot execution, build, snapshot, restore, version promotion, daemon, database, MCP, workflow engine, or agent-role orchestration.

## Verification result

- Type checks: passed.
- Scanner, state-store, and controller tests: 28 of 28 passed across 3 files.
- Portable Electron acceptance: 1 of 1 passed using only the controlled fixture and a temporary application-data profile.
- Explicit owner evidence flow: 2 of 2 passed for the controlled fixture and Bakery Sort.
- Production build: passed as part of each Electron evidence command.
- Dependency audit: 0 vulnerabilities reported.
- Renderer boundary remains narrow: no unrestricted filesystem, Node, process, or arbitrary IPC API is exposed.

The exact command record is in `test-results.json`.

## Controlled fixture

`controlled-fixture-scan.json` records a complete schema-2 scan of `app/test/fixtures/comprehensive`:

- 23 observed files across 19 directories.
- 13 project-source files, 1 tooling file, 7 generated/output files, and 2 Godot-ignored files.
- Main scene `scenes/main.tscn` found.
- Source inventory: 2 scenes, 2 GDScript files, 1 image, 1 audio file, and 1 font.
- 1 autoload, 2 input actions, 1 enabled editor plugin, and 1 separate plugin declaration.
- 1 source GDExtension declaration, 1 native library, and 1 executable/command file.
- 1 deliberately absent concrete dependency from a static `load()`/supported structured field.
- 7 confirmed facts, 7 warnings, 0 heuristics, and 5 limitations.

The fixture deliberately includes `.gdignore` content and a marker-confirmed Android generated tree containing copied scenes, scripts, native content, and executable content. Those copies remain visible in origin totals but do not inflate source-level counts or findings.

## Real owner project

The explicit owner-evidence target was `E:\doqendev\GameDev\bakery-sort`.

`real-project-scan.json` records a complete conservative scan:

- Project name `Bakery Sort`; main scene `scenes/main.tscn` found.
- 2,928 observed files across 717 observed directories.
- 1,630 project-source files, 1 tooling file, 1,294 generated/output files, and 3 Godot-ignored files.
- Source inventory: 3 scenes, 24 GDScript files, 787 images, 129 audio files, and 1 font.
- 1 autoload, 1 enabled editor plugin, and 1 separate plugin declaration.
- 1 source GDExtension declaration, 2 native libraries, and 4 executable/command files.
- 0 confirmed missing local file dependencies; the previous 13 dynamic, directory, output, and generated-copy false positives are gone.
- 5 large source files and 25 unsupported source files.
- 7 confirmed facts, 7 warnings, 0 heuristics, and 6 limitations.

These warnings identify directly observed capabilities or conditions; they do not establish defects or project health.

## Portable and owner commands

The repository acceptance suite has no owner-specific path:

```powershell
cd app
npm run test:acceptance
```

The owner evidence flow is deliberately separate and receives every machine-specific location explicitly:

```powershell
$env:STUDIO_OWNER_PROJECT='E:\doqendev\GameDev\bakery-sort'
$env:STUDIO_OWNER_APP_DATA='C:\Users\Marcos\AppData\Local\AI Game Studio\Milestone1CorrectiveAcceptanceFinal'
$env:STUDIO_EVIDENCE_ROOT='E:\doqendev\AI Game Studio\docs\evidence\milestone1'
npm run test:owner-evidence
```

Without those variables, `npm run test:owner-evidence` reports two explicit skips rather than pretending owner evidence ran.

## Byte-for-byte no-write proof

`real-project-before.json` and `real-project-after.json` bracket the explicit owner evidence trial. Both record:

- 5,928 files.
- 2,682,293,420 bytes.
- No runtime-observed symlinks or junctions and no unreadable paths in the integrity walk.
- Tree SHA-256 `5b72fca64e47268a94bf970a0c9a1a54ca570ae94612327d5c1f5601c0bb0bde`.

The integrity algorithm hashes every regular file path, size, and SHA-256 in canonical sorted order without following runtime-observed links. Matching records establish that Bakery Sort remained byte-for-byte unchanged during the final owner evidence trial.

## Application data written

The explicit evidence profiles are under `C:\Users\Marcos\AppData\Local\AI Game Studio\Milestone1CorrectiveAcceptanceFinal\`:

- `controlled-fixture\studio-state.json`
- `owner-project\studio-state.json`

They hold trust and owner-note state. Electron also wrote normal Chromium profile/cache entries within each profile. `app-data-inventory.json` records the exact state-file sizes and hashes. Nothing was written into either selected project.

## Screenshots

- `screenshots/studio-controlled-fixture.png`
- `screenshots/project-controlled-fixture.png`
- `screenshots/builds-controlled-fixture.png`
- `screenshots/studio-bakery-sort.png`
- `screenshots/project-bakery-sort.png`

## Corrected scanner boundary and known limitations

- Source-level lists exclude confirmed tooling, Android generated/output copies, and descendants of `.gdignore` roots. Origin totals preserve their observed presence.
- Android generated trees are reclassified only when the expected deterministic markers are present; directories are not ignored merely because they are named `build`.
- Confirmed missing dependencies are limited to supported structured resource fields and literal GDScript `load()`/`preload()` calls. Templates, wildcards, directories, output targets, arbitrary quoted strings, and generated copies are excluded.
- `uid://` main-scene values are preserved and reported as currently unresolvable rather than falsely missing.
- The line-oriented `project.godot` reader is not a complete Godot configuration parser.
- Computed and runtime-created relationships may be invisible.
- File types and active/native content are classified conservatively from extensions and directly visible declarations, not binary analysis.
- `.git`, `.godot`, and `.import` roots are excluded and reported without claiming descendant counts.
- Display lists are capped at 300 items per group; UI filtering explicitly searches only the displayed subset.
- Unreadable-file handling is tested through injected filesystem behavior because reproducible Windows ACL denial is environment-dependent.
- The scanner does not run Godot or establish imports, gameplay behavior, performance, fun, feel, balance, quality, or visual coherence.

## Accessibility correction

The trust confirmation now receives focus on open, traps Tab and Shift+Tab, closes with Escape, and restores focus to its invoking control. Owner-note fields expose their maximum lengths and live character counts before save.
