# Decision 0002: Milestone 2 requires a complete bounded source index

**Status:** Accepted for Milestone 2 design

**Date:** 2026-07-17

## Decision

Milestone 2 must not use the renderer's truncated file lists as the authoritative project index. Task context and file selection must query a complete bounded project-source index owned by Electron main.

The renderer may continue to display bounded lists and filter only the displayed subset when that limitation is explicit. Generated/output content and content ignored by Godot remain separately classified and are not project-source task context by default.

No database, embedding store, or vector index is justified at this stage. Begin with an in-memory or application-owned bounded index, exact path/filename matching, supported static relationships, and bounded source-text search.

If owner-defined root exclusions are introduced later, they must be stored in application data, remain visible to the owner, and never be written into the selected Godot project.

## Consequence

Milestone 1 does not add full-inventory search. Milestone 2 design and implementation must establish the complete main-process query boundary before constructing Builder task context.
