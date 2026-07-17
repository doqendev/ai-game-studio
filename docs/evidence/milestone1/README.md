# Milestone 1 Evidence Packet

Milestone 1 answers its product question positively: the owner can select and trust a Godot project, understand a conservative inventory, edit app-owned notes, and see the truthful empty build state without opening Godot, Codex, Git, or a terminal.

This packet records the implemented read-only cockpit only. It contains no Codex, Godot execution, build, snapshot, version-promotion, daemon, database, MCP, workflow-engine, or containment implementation.

## Verification result

- Type checks: passed.
- Scanner and state tests: 16 of 16 passed across 2 test files.
- Production build: passed.
- Electron acceptance flows: 2 of 2 passed.
- Dependency audit: 0 vulnerabilities reported.
- Renderer boundary asserted: no `require` or `process` global; exactly seven purpose-specific preload methods.

The detailed command record is in `test-results.json`.

## Controlled fixture

`controlled-fixture-scan.json` records a complete scan of `app/test/fixtures/comprehensive`:

- 13 files and 12 directories.
- Main scene `scenes/main.tscn` found.
- 2 scenes, 2 GDScript files, 1 image, 1 audio file, and 1 font.
- 1 autoload, 2 input actions, and selected display/render settings.
- 7 warnings deliberately exercised: enabled plugin, GDExtension, native library, executable content, active content markers, missing quoted local reference, and unsupported extension.
- 3 confirmed facts, 0 heuristics, and 5 limitations.

Unit tests additionally cover a minimal valid project, missing `project.godot`, missing main scene, malformed config, multiple scenes/scripts, passive assets, large files, injected unreadable-file behavior, junction no-follow behavior, deep traversal, cancellation, rescan after change, and no-write integrity.

## Real owner project

The real-project acceptance target was `E:\doqendev\GameDev\bakery-sort`.

`real-project-scan.json` records a complete conservative scan:

- Project name `Bakery Sort`; main scene `scenes/main.tscn` found.
- 2,928 observed files and 717 directories after intentionally skipping generated metadata directories.
- 4 scenes, 29 GDScript files, 788 images, 129 audio files, and 1 font.
- 1 autoload, 1 enabled plugin, 3 GDExtension declarations, 22 native libraries, and 6 executable/command files.
- 8 warnings, including 13 directly quoted local references not matched in the observed inventory, 17 large files, and 312 unsupported files.
- 3 confirmed facts, 0 heuristics, and 6 limitations.

These warning counts identify observed conditions; they do not prove defects. Missing-reference checks are limited to directly quoted `res://` paths, and unsupported files are files the scanner intentionally does not interpret.

## Byte-for-byte no-write proof

`real-project-before.json` and `real-project-after.json` bracket the final Electron acceptance trial. Both record:

- 5,928 files.
- 2,682,295,957 bytes.
- No reparse points or unreadable paths in the integrity walk.
- Tree SHA-256 `fc5114c819a8f9e5c090ecdcf2aa17bcd4335136c9674e3b7cac64c1829852ad`.

The integrity algorithm hashes every regular file path, size, and SHA-256 in canonical sorted order without following reparse points. Matching before/after records establish that the selected project remained byte-for-byte unchanged during the final trial.

## Application data written

The acceptance profiles are under `C:\Users\Marcos\AppData\Local\AI Game Studio\Milestone1Acceptance\`.

- `fixture\studio-state.json`
- `bakery-sort\studio-state.json`

Those two files hold the functional trust and owner-note state. Electron also wrote its standard Chromium profile/cache entries; `app-data-inventory.json` records the exact top-level categories and state-file hashes. None is inside either selected project.

## Screenshots

- `screenshots/studio-controlled-fixture.png`
- `screenshots/project-controlled-fixture.png`
- `screenshots/builds-controlled-fixture.png`
- `screenshots/studio-bakery-sort.png`

## Known limitations

- The line-oriented `project.godot` reader handles only the selected assignments needed by this milestone; it is not a complete Godot configuration parser.
- Direct quoted local references are checked; computed, runtime, and dynamically loaded paths may be invisible.
- File types and native/executable content are classified conservatively by extension and directly visible declarations, not by binary analysis.
- `.git`, `.godot`, and `.import` directories are intentionally excluded from the project inventory.
- Display lists are capped at 300 items per group while retaining total counts.
- Unreadable-file handling is deterministically tested through injected filesystem behavior because reproducible Windows ACL denial is environment-dependent.
- The scanner does not run Godot, instantiate scenes, observe runtime relationships, validate gameplay, or assess quality, performance, fun, feel, balance, or visual coherence.

## Electron boundary basis

The implementation follows Electron's current security guidance for context isolation, sandboxing, no Node integration, restricted navigation/new windows, permission denial, and narrow context-bridge APIs. The acceptance suite tests the renderer-visible part of that boundary; it is not a claim that a future code-executing milestone is contained.
