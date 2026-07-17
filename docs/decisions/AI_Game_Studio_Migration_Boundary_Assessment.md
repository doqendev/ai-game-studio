# AI Game Studio — Migration Boundary Assessment

**Date:** 2026-07-17  
**Scope:** Repository assessment only; no product, Electron, Hyper-V, containment, Codex-orchestration, or Milestone implementation was performed.

## Executive position

The Internal Creator Prototype is a coherent next product test, but the repository contains much less reusable product implementation than the reframing document provisionally suggests. There is no product application to disentangle from VM or public-containment architecture. The repository contains one architecture document and a disposable Gate 0 runner. Its few reusable mechanisms should be extracted later, individually, after review; the Gate 0 runner must not become the product foundation by default.

The same repository is therefore the cleaner home for the prototype. A new repository would separate evidence from the decisions it supports without removing meaningful technical coupling. One setup correction is required: this directory is **not currently a valid Git repository**. The root `.git` and `gate0/.git` directories are empty placeholders, and `git rev-parse` fails. The authorized controlled reset must first establish a real archival baseline commit, then create the clean `internal-creator-prototype` branch. That operation has not been performed.

## 1. Current repository inventory

### Product code

**None.** There is no Electron package, renderer, preload bridge, application main process, project cockpit, database, daemon, MCP server, workflow engine, Godot build adapter, or production Codex orchestration code.

### Documentation

- `AI_Game_Studio_Critical_Technical_Response_and_Gate_0_Feasibility_Design.md` — original public-product feasibility/containment design; 82,902 bytes; SHA-256 `9b3ee9923d3d22c874ce713fb0975e0eb8998835a2ffa698e8a4ec26435b85f5`.
- `E:/downloads_new/AI_Game_Studio_Internal_Creator_Prototype_Reframing.md` — current reframing input, presently **outside** the repository; 24,476 bytes; SHA-256 `77b048e2377150b321df7e50bd94c98cf4161140c19185d32fb0f13c7754bef0`.
- `gate0/README.md` — correctly labels the directory as disposable, UI-independent probes rather than product implementation.

### Gate 0 and containment experiment code

The authored experiment is `gate0/`:

- Runtime/protocol probes: `src/app-server-client.ts`, `src/run-protocol-probes.ts`, `src/run-authentication-probes.ts`, `src/run-process-supervision-probes.ts`.
- Snapshot/recovery probes: `src/snapshot-store.ts`, `src/run-snapshot-state-probes.ts`, `src/evidence.ts`.
- Windows sandbox/network probes: `src/query-windows-sandbox-readiness.ts`, `src/run-windows-sandbox-setup.ts`, `src/run-sandbox-containment-probes.ts`, `src/run-sandbox-containment-repeat.ts`, `src/run-sandbox-identity-diagnostic.ts`, `src/run-loopback-network-matrix.ts`.
- Native process helper: `native/JobSupervisor.cs`.
- Godot fixture: `fixtures/godot-collect-one/project.godot`, `export_presets.cfg`, `scenes/main.tscn`, `scripts/game.gd`, and `tests/scenario_runner.gd`.
- Fault fixtures: `fixtures/fake-app-server.mjs`, `hostile-sandbox-probe.mjs`, `loopback-network-probe.mjs`, `owner-proxy.mjs`, `process-tree.mjs`, `resource-exhaustion.mjs`, and `sandbox-identity-probe.mjs`.
- Evidence/setup scripts: all ten files under `gate0/scripts/`.
- Reproduction metadata: `gate0/package.json`, `package-lock.json`, and `tsconfig.json`.

The authored sources are small: 13 TypeScript files (124,621 bytes), ten PowerShell files (75,564 bytes), 12 fixture files (15,007 bytes), and one C# file (15,376 bytes).

### Generated or disposable material

- `gate0/node_modules/` — 442,552,950 bytes; installed dependencies, not source or evidence.
- `gate0/dist/` — 39 generated TypeScript outputs, 248,516 bytes.
- `gate0/build/native/JobSupervisor.exe` — generated helper binary, 12,288 bytes.
- Empty `.agents/`, `.codex/`, `.git/`, `gate0/.agents/`, and `gate0/.git/` directories — no usable metadata or implementation.

### What the experiment actually proved

- Gate 0A passed 9 protocol, 5 authentication, and 6 process-supervision probes.
- Gate 0B snapshot/state mechanics passed 8 probes.
- The final sandbox identity was the intended `CodexSandboxOffline` identity and file containment improved, but the loopback matrix reached TCP/IPv4, TCP/IPv6, UDP/IPv4, and UDP/IPv6 sentinels. The required zero-network guarantee failed.
- Godot import, scenario execution, export, native/Web comparison, and Gate 0C were not run. There is no Builder-to-playable proof.

The repository therefore contains **Godot fixture knowledge**, not a proven Godot execution or review-build implementation.

## 2. Repository recommendation

Use the current directory as one repository, after creating a real Git baseline, because:

1. no product code is coupled to Hyper-V, VMs, VHDX, gateway services, or public containment;
2. the Gate 0 material is already explicitly separated under `gate0/`;
3. the sealed packets are small enough to preserve alongside their decision record;
4. a new repository would create cross-repository evidence and provenance work without reducing implementation risk.

The clean branch must begin from an archival commit containing the two governing documents, exact sealed evidence archives, an evidence index, the supersession record, and the authored Gate 0 source relocated under `experiments/archive/`. Generated dependencies and builds must not seed the product lane.

## 3. Migration classification

### Preserve unchanged

- `AI_Game_Studio_Critical_Technical_Response_and_Gate_0_Feasibility_Design.md`, relocated under `docs/archive/public-product-containment/` without changing its bytes.
- `AI_Game_Studio_Internal_Creator_Prototype_Reframing.md`, copied from `E:/downloads_new/` into `docs/decisions/source/` without changing its bytes.
- The three sealed evidence ZIPs identified in section 5, copied byte-for-byte into `docs/evidence/gate0/archives/`.
- `gate0/package.json`, `gate0/package-lock.json`, `gate0/tsconfig.json`, and `gate0/README.md` as part of the archived experiment's reproduction record.

### Reuse after review — not during Milestone 0 or 1

- `gate0/src/app-server-client.ts`: extract the binary pin check, bounded NDJSON transport, request timeout, method allowlist concept, and bounded transcript concept for Milestone 2. Replace Gate 0 identity strings, untyped responses, ad hoc redaction, and its direct dependency on a Gate 0 supervisor CLI.
- `gate0/native/JobSupervisor.cs`: retain the Windows Job Object mechanism for later supervised Codex/Godot processes. Review command-line quoting, environment inheritance, diagnostics, exit semantics, and packaging before product use.
- `gate0/src/snapshot-store.ts`: extract only manifest hashing, manifest comparison, changed-path evaluation, and durable-write ideas. The extension allowlist, 200-file/64-MiB limits, copy behavior, A/B current pointer, and attempt record are Gate 0 policies, not a suitable existing-project model.
- `gate0/fixtures/godot-collect-one/` (all five files): retain as a future deterministic test fixture. It is not a product starter project and must remain labelled unproven until an authorized Godot adapter executes it.

### Archive

Archive the entire authored `gate0/` tree under `experiments/archive/gate0-public-containment/`, including:

- probe/state support: `gate0/src/evidence.ts`, `gate0/src/query-windows-sandbox-readiness.ts`;
- probe runners: `gate0/src/run-authentication-probes.ts`, `run-loopback-network-matrix.ts`, `run-process-supervision-probes.ts`, `run-protocol-probes.ts`, `run-sandbox-containment-probes.ts`, `run-sandbox-containment-repeat.ts`, `run-sandbox-identity-diagnostic.ts`, `run-snapshot-state-probes.ts`, and `run-windows-sandbox-setup.ts`;
- scripts: `gate0/scripts/Capture-Gate0AEnvironment.ps1`, `Capture-LoopbackFirewallState.ps1`, `Capture-WfpElevated.ps1`, `Finalize-Gate0A.ps1`, `Finalize-Gate0BFailure.ps1`, `Finalize-Gate0BLoopbackFailure.ps1`, `Gate0-Evidence.ps1`, `Generate-Gate0AProtocol.ps1`, `Initialize-Gate0A.ps1`, and `Seal-Gate0BLoopbackEvidence.ps1`;
- fault/containment fixtures: `gate0/fixtures/fake-app-server.mjs`, `hostile-sandbox-probe.mjs`, `loopback-network-probe.mjs`, `owner-proxy.mjs`, `process-tree.mjs`, `resource-exhaustion.mjs`, and `sandbox-identity-probe.mjs`;
- the reusable-candidate source files above, which remain the provenance copy even if selected code is later reimplemented in product modules.

`gate0/src/evidence.ts` should not be copied into the product: it hard-codes the Gate 0 AppData layout and run schema, and its event append path rereads the entire journal on each event. A small product journal should be designed for product state when needed.

### Leave unused

The prototype product must not import or invoke:

- `query-windows-sandbox-readiness.ts`;
- `run-windows-sandbox-setup.ts`;
- `run-sandbox-containment-probes.ts`;
- `run-sandbox-containment-repeat.ts`;
- `run-sandbox-identity-diagnostic.ts`;
- `run-loopback-network-matrix.ts`;
- `Capture-LoopbackFirewallState.ps1`;
- `Capture-WfpElevated.ps1`;
- `Finalize-Gate0BLoopbackFailure.ps1`;
- `Seal-Gate0BLoopbackEvidence.ps1`;
- the hostile, sandbox-identity, loopback, and owner-proxy fixtures.

They remain research evidence for a future public-product phase only.

### Remove from the product implementation path

- `gate0/node_modules/`, `gate0/dist/`, and `gate0/build/`; they are reproducible generated material and should not be copied into the product directories or committed as product source.
- The empty `.git`, `gate0/.git`, `.agents`, `.codex`, `gate0/.agents` placeholders after their emptiness is recorded. A real root Git repository must replace the empty root `.git` directory during the authorized reset.
- The Gate 0 package as an active workspace package. It remains archived and non-buildable by default; it is not a dependency of the Electron app.

Important absences: matching generated App Server types exist only inside the sealed evidence packet, not as repository modules. Application authentication, Godot executable discovery, app-owned Godot command construction, and production log redaction do not exist. They must not be described as migrated implementation.

## 4. Coupling assessment

| Candidate | Coupling found | Migration decision |
|---|---|---|
| `app-server-client.ts` | No Hyper-V, VM/disk, or zero-network dependency. It is coupled to `JobSupervisor.exe`, a managed `CODEX_HOME`, Gate 0 client identity, a fixed method set, Gate 0 limits, and weakly typed protocol payloads. Its key-name redactor is not sufficient as a product secret boundary. | Extract a reviewed adapter later; do not copy wholesale. Regenerate matching types from the newly pinned Codex version. |
| `JobSupervisor.cs` | No Hyper-V, VM/disk, or network assumption. It is a Windows-only, on-demand helper—not a daemon. It carries `GATE0_JOB` diagnostics and inherits the supervisor environment unless the parent sanitizes it. | Strongest reuse candidate, after refactor and product tests. Keep kill-on-job-close, owner-death, wall-time, and memory controls. |
| `snapshot-store.ts` manifest/diff functions | No Hyper-V, VM/disk, or network dependency. The traversal allowlist and tiny limits express the former trusted-fixture/public-containment boundary. | Reuse algorithms after separating neutral traversal from policy. Existing trusted projects need inventory and warnings, not blanket rejection of every unfamiliar extension. |
| `snapshot-store.ts` current/attempt state | Directly coupled to a Gate 0 A/B slot model and generic `externalOperation` ambiguity record. It does not model working, review, and human-selected current builds. | Do not reuse the state model. Preserve the checksum/durable-write and no-blind-replay principles in a new explicit product journal. |
| `run-authentication-probes.ts` | No Hyper-V/VM dependency, but assumes a pre-existing global ChatGPT login, constructs and deletes a run-specific auth home, opens a browser, and writes Gate 0 evidence. | Archive as proof/test knowledge. It is not application-managed authentication code. |
| `evidence.ts` | Hard-coupled to `%LOCALAPPDATA%/AI Game Studio/Gate0/runs`, `run.json`, and Gate 0 statuses. | Archive; reimplement only the minimal atomic JSON/journal behavior demanded by product state. |
| `godot-collect-one/` | No VM, network, Hyper-V, or Gate 0 state dependency. The scenario deliberately uses `FileAccess` to write its report. | Keep as a future test fixture only. No Godot process ever executed it in Gate 0. |
| sandbox/network modules | Coupled to the discarded zero-network hard gate, Windows sandbox identity, firewall/WFP diagnostics, and public-grade containment assumptions. | Do not reuse in the internal product. Preserve only as archived public-product research. |

No proposed module depends on implemented Hyper-V or virtual-disk infrastructure because neither exists in this repository.

## 5. Evidence preservation

The evidence is currently sealed and content-verifiable, but its AppData location is not physically immutable storage. The controlled reset should make it operationally immutable and discoverable as follows:

1. Never unpack, normalize, or reseal the original ZIPs.
2. Copy the exact bytes into `docs/evidence/gate0/archives/`; retain the original AppData copies.
3. Verify SHA-256 before and after copying; mark the archive copies read-only.
4. Add `docs/evidence/gate0/index.json` and `README.md` with source path, repository path, byte length, SHA-256, manifest-entry count, verification result, Gate result, and explicit unproved items.
5. Include the archives and index in the first archival Git commit. Link the supersession record to that commit and the hashes. Git makes later changes detectable; it is tamper-evident, not WORM storage.
6. Never rewrite those archive paths on the product branch. New evidence, if later authorized, receives a new content-addressed file and index entry.

Verified on 2026-07-17:

| Packet | Bytes | SHA-256 | Internal verification |
|---|---:|---|---|
| `AI_Game_Studio_Gate0_20260716_STOPPED_AT_GATE0B.zip` | 1,095,225 | `5c162e6afe33684e0469bd1a0e36058820bfaeac8d5b408826e68027cf206f90` | 930 manifested entries; 0 mismatches |
| `AI_Game_Studio_Gate0B_LOOPBACK_FAILURE_20260716T224536Z.zip` | 205,675 | `21e1c3be4880d9d94395dcd2a45419c127378e3b38022c178e55ad5e9acce258` | 46 manifested entries; 0 mismatches |
| `Gate0B_Loopback_PreRemediation_20260716T223432Z.zip` | 36,225 | `d625578d85e3c8ed55b2a75ef58c7b6a9179f04e77ce1def389bb7f5146f2356` | Its exact hash and bytes are also covered by the final packet manifest |

This preserves the reported final evidence hash `21e1c3be...acce258` and the prior sealed packet it references.

## 6. Supersession record

Create `docs/decisions/0001-internal-creator-prototype-supersession.md`, limited to roughly one page, with four statements:

1. **What Gate 0 proved:** exact counts for the passing Gate 0A protocol/auth/process tests and Gate 0B snapshot/state tests; successful Windows identity/filesystem observations; conservative interruption lessons.
2. **What it did not prove:** loopback isolation failed; Godot import/scenario/export, runtime choice, Gate 0C, and Builder-to-playable were not run.
3. **Why the public direction paused:** a VM-class boundary could address the public trust model, but its topology, maintenance, and evidence burden would overwhelm the immediate owner-value experiment.
4. **Why zero-network is not the current hard gate:** the owner-only prototype accepts trusted-project and ordinary desktop-process risk for this phase. The requirement is deferred, not passed or disproved as useful. The linked evidence remains authoritative if arbitrary projects or public distribution are reopened.

The record must avoid saying Gate 0 “passed” overall or that the internal prototype is sandboxed.

## 7. Minimal Milestone 0 repository structure

```text
/
  app/
    package.json
    src/
      main/
        project-open.ts
        project-scan.ts
        project-memory.ts
        ipc-contracts.ts
      preload/
        bridge.ts
      renderer/
        Studio.tsx
        Project.tsx
        Builds.tsx
    test/
      project-scan/
  docs/
    decisions/
      source/
    evidence/gate0/archives/
    archive/public-product-containment/
  experiments/archive/gate0-public-containment/
```

Component boundaries:

- Electron main owns path selection, trust records, filesystem reads, app-data state, and narrow IPC handlers.
- The preload exposes typed, purpose-specific intents and read-only projections; never raw filesystem or process APIs.
- The renderer displays Studio, Project, and Builds and has no direct Node access.
- `project-scan.ts` is a deterministic read-only scanner. It reports facts separately from warnings and heuristics.
- `project-memory.ts` stores only readable JSON/Markdown plus small app-data state. No database is justified.

Do not create Codex, snapshot, Godot-execution, agent, workflow, service, MCP, daemon, database, or security-framework directories until the milestone that needs them is authorized.

## 8. Safety review for owner-only use

### Still disproportionate

- **Blanket blocking of trusted projects because existing code contains `OS.execute`, network APIs, editor plugins, native extensions, or non-allowlisted file types.** Milestone 1 should surface these as prominent, factual capability warnings. Later Builder cycles may make a candidate ineligible when the cycle unexpectedly *adds* such capabilities. Refusing to inspect an explicitly trusted existing project would defeat the reframed product boundary without establishing real security.
- **A full physical copy before every future turn regardless of project size.** The invariant—never write to the only recoverable copy—is mandatory. The mechanism should be selected after measuring the project: a verified copy for small projects or a verified Git worktree/branch where simpler. Do not build both initially.
- **Applying Builder/process timeouts and recovery machinery to the read-only Milestone 1 slice.** Those controls belong when external processes and writes are introduced, not in the initial cockpit.

### Safeguards that remain mandatory

Even for a trusted owner workflow, removing any of these would create unacceptable risk:

- first-open trust confirmation and clear warning that project code may later execute;
- no Administrator execution;
- no writing to the sole known-good project state;
- reparse-point/junction awareness and canonical path-boundary checks;
- sanitized child environments and no credential/token logging;
- app-owned fixed Godot operations rather than model-supplied shell commands;
- Job Object process-tree cleanup, Stop, wall-time/memory/log/output bounds once Codex or Godot is introduced;
- explicit changed-path review and capability-diff warnings after AI edits;
- failed/ambiguous work never becoming current, no blind replay, and deliberate owner selection of a review build.

Dropping zero-network as a hard gate is acceptable only inside the stated trusted-project, single-owner phase. It must be reopened before accepting arbitrary projects or making a public containment claim.

## 9. First owner-visible vertical slice

Milestone 1 should be entirely read-only with respect to the selected Godot project:

1. Launch the desktop shell and choose one existing local folder.
2. Require `project.godot`, show the trust warning, and record the owner's trust decision in app data—not inside the project.
3. Scan and display:
   - project identity and `run/main_scene`;
   - `.tscn`/`.scn` scenes, `.gd` scripts, and assets grouped by passive/other type;
   - selected project settings such as autoloads, input actions, display/render settings, and enabled plugins/extensions;
   - deterministic issues: missing main scene, missing referenced local resources, unreadable/malformed files, reparse points, unexpectedly large files, native extensions/executables, active capabilities, and unsupported constructs;
   - a clear distinction between confirmed facts, warnings, and scan limitations.
4. Show **Studio**, **Project**, and **Builds** navigation.
5. Studio shows project identity, trust state, concise game brief, current objective, scan status, and known-issue count. The brief/objective may start empty and be owner-editable.
6. Project shows the scan inventory and warnings with paths.
7. Builds truthfully shows `No builds recorded` or a latest-build record only if app-owned state actually exists. It must not manufacture a review/current build.

No Codex call is essential. Adding even a read-only summary would mix App Server/auth/recovery risk into a slice whose purpose is to validate project understanding and navigation. Codex belongs in Milestone 2.

The owner-visible acceptance test is simple: the owner can open the app, trust one real project, identify its main scene/scripts/assets/settings/known issues, read or edit the brief and objective, navigate all three sections, and understand the current build state without opening Godot, Codex, Git, or a terminal.

## 10. Complexity assessment

- **Controlled reset: small.** It is repository initialization, byte-preserving archival, evidence indexing, supersession documentation, generated-file exclusion, and a clean branch. The absence of a real Git repository is a setup correction, not a reason for a second repository.
- **First owner-visible vertical slice: medium.** The Electron shell and three simple screens are straightforward; reliable Godot project inventory is not. Existing projects contain varied config syntax, imports, resource references, plugins, native artifacts, large trees, and reparse points.

**Dominant implementation risk:** building a fast, conservative Godot scanner and data model that is useful on a real project without silently missing important capabilities or presenting heuristic findings as facts. UI polish and Codex integration are not the dominant Milestone 1 risks.

## Final recommendation

**Reuse the existing repository with a clean branch.**
