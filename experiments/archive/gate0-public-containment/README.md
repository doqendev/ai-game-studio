# Gate 0 feasibility runner

This directory contains disposable, UI-independent feasibility probes only. It is not product implementation.

Execution is staged:

1. Gate 0A: pinned Codex App Server protocol, matching generated schemas, isolated authentication, and Windows process-tree supervision.
2. Gate 0B: snapshots, crash-state mechanics, Builder containment, and contained Godot import/scenario/export.
3. Gate 0C: native-versus-Web review comparison, exactly one selected runtime, one real Builder-to-playable result, and the full fault matrix.

A hard failure stops later stages. Runtime state and evidence are written under `%LOCALAPPDATA%\AI Game Studio\Gate0`, never into the source tree.

