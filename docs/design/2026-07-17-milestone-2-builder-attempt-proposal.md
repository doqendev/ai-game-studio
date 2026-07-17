# Milestone 2 — Supervised Builder Attempt Design Proposal

**Date:** 2026-07-17  
**Repository:** `doqendev/ai-game-studio`  
**Branch:** `internal-creator-prototype`  
**Status:** Design only; M2-A through M2-E are not authorized or implemented

## Executive position

Milestone 2 is technically coherent if it remains one owner-confirmed task, one application-owned attempt, one supervised Codex turn, and one factual result. The owner project must never be writable by Codex. The selected attempt mechanism is a manifest-driven verified copy of authoritative project content. The selected process topology is one App Server process per Builder assignment.

The largest risk is not task framing or copying. It is coupling an Electron application to the experimental Codex App Server protocol on Windows while preserving exact process ownership and unambiguous restart behavior. The design therefore pins one locally verified Codex build, generates matching protocol types, exposes a small allowlist, journals every externally consequential request before sending it, and blocks rather than guessing after ambiguous outcomes.

## Evidence and certainty labels

- **Officially confirmed:** current Codex documentation or generated types from the pinned binary establish the capability.
- **Locally verified:** observed on the development machine on 2026-07-17.
- **Design choice:** the proposed application behavior; it still needs implementation tests.
- **Hypothesis:** plausible behavior that M2-B must prove before owner-project use.

The [official Codex App Server documentation](https://learn.chatgpt.com/docs/app-server.md) describes a JSON-RPC-like protocol over JSONL/stdin/stdout, version-specific schema generation, initialization, threads, turns, notifications, and interruption. It also labels App Server experimental and subject to change. The [official authentication documentation](https://learn.chatgpt.com/docs/auth.md) and [configuration documentation](https://learn.chatgpt.com/docs/config-file/config-advanced) define the account and sandbox boundaries used here. These sources confirm interfaces; they do not prove this product's recovery or Windows containment behavior.

## 1. Exact owner journey

1. In Studio, the owner selects **Create a Builder task**.
2. The task composer shows the existing game brief, current objective, scan age, and current capability warnings.
3. The owner enters an ordinary-language request. The application preserves it verbatim as the objective. It does not claim semantic understanding.
4. The application presents editable fields: Included, Excluded, Suggested project areas, Protected areas, Completion evidence, and Known uncertainty. Suggestions come from deterministic path/text search. Meaningful choices are not preselected.
5. The owner edits and explicitly confirms the task contract.
6. The application records the current project identity, performs a fresh read-only manifest, checks available disk space, creates an attempt, and verifies the attempt manifest before Codex starts.
7. If authentication is unavailable, the application offers **Sign in to Codex**. The sign-in page opens in the system browser; the Studio never displays or stores a token.
8. The owner selects **Start Builder**. The application starts one supervised App Server process and one turn against the attempt root.
9. Studio shows normalized activity and a persistent **Stop Builder** action. Technical details are secondary.
10. The terminal screen separates the Builder's claims from application-observed facts: report, actual changed paths, scope result, capability changes, and what was not checked.
11. The owner may keep the attempt, discard it, create a separate follow-up task, inspect details, or return to Studio. There is no merge, promotion, build, play, or current-version action.

## 2. Selected attempt mechanism

### Choice

Use a **manifest-driven verified project-content copy** for the first implementation.

The copy includes project source, tooling, Godot-ignored content, and unknown owner content. It deterministically excludes only:

- `.git/`;
- `.godot/` and legacy `.import/` import caches;
- scanner-confirmed generated output such as the current Android build tree.

Reparse points are never followed. Their presence in a required source location blocks attempt creation. Every included path is canonicalized beneath the selected root. The destination is an application-owned directory outside the owner project. Copy verification compares relative path, byte length, and SHA-256 for every included file.

### Measurement

**Locally verified against Bakery Sort:** the project was a clean Git repository at `0aea5bb71b8c5e069b7202b129e6867c1b288be2`, but the chosen copy policy did not depend on Git. It copied 1,634 files and 1,151,450,851 bytes (1.072 GiB) on the same `E:` volume in 1.367 seconds. Full source/destination content verification took approximately 6.3 seconds. Both manifests produced SHA-256 `a0996881d85d606d7cdafddd0b8bf43a602b4b1b6dcd07906bedb78b8b86ef11`. This is one warm-machine measurement, not an SLA.

The observed scanner inventory was 2,928 files and 2,309,504,417 bytes: 1,630 project-source files, 1 tooling file, 1,294 generated files, and 3 Godot-ignored files. Omitting regenerated output cut attempt storage roughly in half while retaining all authoritative and owner-authored content.

### Why not a Git worktree

A worktree is faster and more space-efficient, but it couples correctness to Git state, modifies Git administrative metadata in the owner repository, and does not naturally include ignored or untracked owner content. It also introduces branch/worktree recovery concepts that the owner should not need to understand. The verified copy works for Git and non-Git projects, is independently discardable, and makes the original-project invariant easier to prove.

### Copy limits

- Maximum included baseline: 25,000 files and 8 GiB.
- Disk preflight: included bytes plus the greater of 25% growth or 512 MiB.
- Maximum changed paths: 500.
- Maximum new or modified individual file: 64 MiB.
- Maximum attempt growth: the smaller of 25% of baseline bytes or 512 MiB.
- Manifest/copy/verification cancellation preserves a diagnostic record and deletes only an incomplete app-owned destination after exact-root validation.

These limits are prototype policy, not claims about the largest Godot project the later product could support.

## 3. App Server version, configuration, and authentication

### Version boundary

**Locally verified:** `codex-cli 0.143.0` is installed through the WinGet link at `%LOCALAPPDATA%\Microsoft\WinGet\Links\codex.exe`. The resolved executable SHA-256 is `5728e3ddf1480103bad235560e95cf7764ea3069f06029f9b2f39eb74a8066f6`. It supports `codex app-server`, stdio transport, `generate-ts`, `generate-json-schema`, and strict configuration.

M2-B supports exactly version `0.143.0` and the recorded known-good executable hash for the owner trial. It generates and commits matching stable TypeScript schemas from that binary. It starts without experimental protocol types and initializes with `experimentalApi: false`. A version, hash, or required-method mismatch produces **Unsupported Codex version** and blocks execution. There is no `codex exec` fallback.

Binary discovery is intentionally narrow: use the stored, owner-confirmed absolute binary path; on first use, offer the canonical WinGet link if present, otherwise require the owner to select `codex.exe`. Canonical path, version, and hash are displayed and stored in app data.

### Configuration boundary

- Transport: stdio JSONL only; no websocket or local HTTP listener.
- Working directory: exact attempt root.
- Approval policy: `never`.
- Sandbox policy: `workspaceWrite`, writable roots containing only the attempt root, network access `false`, automatic temp-root additions excluded.
- `TEMP` and `TMP`: an application-created directory inside the attempt root.
- Process user: current normal user; never elevated.
- Environment: explicit allowlist for required Windows/Codex variables; project secrets and unrelated application variables removed.
- Unexpected command, file-change, permission, tool-input, MCP elicitation, or dynamic-tool approval requests fail closed. Milestone 2 has no generic permission UI.

**Important limitation:** these Codex policy fields are proportional controls, not a sealed Windows security boundary. Network-disabled policy must be tested, but VM-grade zero-network containment is not a Milestone 2 gate.

### Authentication

Use a dedicated persistent application-owned `CODEX_HOME` and `CODEX_SQLITE_HOME` under Electron app data. Never read or copy the user's global Codex credential file.

The one supported first-login path is stable `account/login/start` with ChatGPT browser login. Electron opens the returned authentication URL in the external system browser and records only the login ID and non-secret status. Cancellation uses the exact login ID. Completion must match that ID. On restart, the application starts the pinned server and calls `account/read`; it does not repeat login automatically. Logout calls `account/logout`, then reconciles with `account/read`. `account/rateLimits/read` and update notifications feed a plain-language unavailable/capacity state.

Authentication URLs, API keys, bearer tokens, cookies, authorization headers, and credential-file content are redacted from logs. Enterprise access-token automation and device-code fallback are not part of the first implementation. If browser login is unavailable, M2-B fails rather than broadening authentication.

## 4. Process topology

| Option | Benefit | Cost/risk | Decision |
|---|---|---|---|
| One App Server per application boot | Less startup overhead; one account connection | Ambiguous ownership across tasks, broader event/flood impact, harder crash and stale-thread reconciliation | Rejected |
| One App Server per Builder assignment | Exact process/run ownership, bounded logs, clean termination, simpler restart classification | Small startup/login-state read overhead | Selected |

Electron main launches one normal-user App Server child for the confirmed assignment and assigns its entire descendant tree to a Windows Job Object with kill-on-close. Gate 0's archived Job Object code is evidence, not automatically reusable implementation; M2-B must review it and extract only the minimal compatible adapter if authorized. There is no daemon. Closing the application or exceeding a hard limit closes the job after evidence is flushed.

Only one Builder run and one turn may be active. Authentication state persists in the dedicated profile; the process does not. A new process after restart performs reconciliation before any new turn.

## 5. Exact protocol allowlist

The renderer receives purpose-specific operations, never method names or raw JSON-RPC.

### Client requests/notification

- `initialize`, followed once by `initialized` on each connection;
- `account/read`;
- `account/login/start`;
- `account/login/cancel`;
- `account/logout`;
- `account/rateLimits/read`;
- `thread/start`;
- `thread/list` only to reconcile a lost `thread/start` response, filtered to the unique attempt cwd and creation window;
- `thread/read` with `includeTurns: true`;
- `thread/resume` only for a known thread during restart reconciliation;
- `turn/start` with a unique `clientUserMessageId` and required `outputSchema`;
- `turn/interrupt` with exact thread and turn IDs.

There is no stable `turn/read` method in the generated `0.143.0` schema; turn state is read through `thread/read`. No command-exec, filesystem, MCP, plugin, configuration-write, review, fork, rollback, shell-command, or generic passthrough method is allowed.

### Consumed notifications

- account: `account/login/completed`, `account/updated`, `account/rateLimits/updated`;
- lifecycle: `thread/started`, `thread/status/changed`, `turn/started`, `turn/completed`;
- factual activity: `item/started`, `item/completed`, command/file-change output and patch updates, `turn/diff/updated`;
- diagnostics: `error`, `warning`, `deprecationNotice`, configuration and Windows sandbox warnings.

Agent-message deltas may be bounded and retained for report reconstruction, but hidden reasoning and token streams are never the primary UI. Unknown notifications are counted and redacted, not forwarded to the renderer. A required semantic change in a known notification fails compatibility tests.

## 6. Run, journal, and ambiguity model

### Lifecycle

`draft → confirmed → preparing-attempt → attempt-ready → starting-server → reconciling-auth → starting-thread → starting-turn → running → stop-requested → reconciling → terminal`

Terminal classifications are: `completed`, `interrupted`, `failed`, or `ambiguous`. Attempt disposition is separate: `preserved`, `retained`, or `discarded`.

A run is completed only when a matching terminal turn is observed, the process output is closed or quiescent, the final attempt manifest is captured, and the structured report is either valid or explicitly marked unavailable. A sent interruption request is never itself a safe-stop claim.

### Persistence

Use atomic JSON snapshots for task, attempt, and run state plus one bounded append-only external-operation journal. The journal exists only to prevent duplicate external calls; it is not a generic event-sourcing system. Before each consequential request it stores request ID, method, identity keys, payload hash, and state `prepared`; immediately before writing bytes it records `sending`; a matching response/notification records `confirmed`.

### Replay classification

| Class | Operations | Rule |
|---|---|---|
| Safe replay | `initialize` on a new connection, `account/read`, `account/rateLimits/read`, `thread/list`, `thread/read`, local manifests | May retry within fixed read limits |
| Idempotent by exact identity | None assumed for write/start operations | Do not infer idempotency from request IDs |
| Reconcile before retry | login cancel/logout, `thread/resume`, `turn/interrupt` | Read account/thread state first; retry only if the exact pending action remains meaningful |
| Never automatically retry | `account/login/start`, `thread/start`, `turn/start` | Lost response becomes reconciliation or ambiguity; never issue a duplicate automatically |

For a lost `thread/start` response, query threads for the unique attempt cwd and request time window. Exactly one matching new thread may be adopted; zero or multiple is ambiguous. For a lost `turn/start` response, compare the known thread's pre-request turns with `thread/read`; exactly one new turn may be adopted. Otherwise the result remains ambiguous. `clientUserMessageId` is recorded for correlation but is not treated as a documented idempotency key.

## 7. Task-context selection

The application sends a bounded, inspectable context package:

- game brief and current objective;
- owner-confirmed objective, included outcomes, exclusions, allowed/protected paths, and completion evidence;
- selected settings and scanner warnings relevant to the task;
- exact selected source excerpts and their hashes;
- task-specific owner notes;
- Builder constraints and the JSON report schema.

The package is capped at 256 KiB, with at most 20 initial files and 192 KiB of source text. The Builder may read additional files inside the attempt using Codex's normal bounded tools. The package excludes generated output, raw evidence, unrelated transcripts, secrets, unlimited logs, and unrelated owner files.

Task interpretation is deliberately honest in M2-A: the original request is preserved verbatim; deterministic path/text matches are labelled suggestions; the owner supplies or confirms scope fields. M2-A does not make an unannounced model call merely to appear intelligent.

## 8. Complete source index

Electron main owns a complete bounded index; the renderer's 300-item projections are never authoritative. The index covers every scanner-classified project-source path and stores canonical relative path, category, byte size, modification identity, and content hash where already available. Generated, ignored, tooling, and unknown content remain separately queryable.

Selection uses exact owner choices, filename/path tokens, supported scene/resource relationships, and bounded literal text search. Text search reads only allowlisted text extensions, at most 2 MiB per file and 64 MiB per query, returning at most 100 ranked matches. No embeddings, vector database, semantic graph, or persistent database is justified. Owner exclusions live in app data, affect results visibly, and never silently alter the scanner's factual inventory.

## 9. Minimal contracts

### `BuilderTask`

Task ID; project identity; verbatim request; objective; included outcomes; excluded outcomes; allowed paths; protected paths; context references with hashes; maximum duration; required report fields; confirmation timestamp.

### `BuilderRun`

Run ID; task ID; attempt identity; App Server version/hash and process identity; thread ID; turn ID; client message ID; lifecycle state; start/stop timestamps; last confirmed external operation; ambiguity reason; terminal classification.

### `BuilderReport`

Completed-work claim; incomplete work; assumptions; known problems; claimed changed areas; checks claimed by Builder; confidence. The UI always labels this as the Builder's report, not application proof.

### `AttemptDiff`

Baseline identity; final identity; added, modified, and deleted paths; unexpected paths; capability changes; allowed/protected scope result; limit breaches. It is computed from app-owned manifests, never Git or the Builder's claims.

## 10. Normalized activity vocabulary

The primary feed uses only:

- Preparing task
- Copying protected attempt
- Verifying attempt
- Starting Builder
- Checking Codex account
- Reading project context
- Editing the attempt
- Reviewing changed paths
- Blocked by task boundary
- Stop requested
- Reconciling result
- Interrupted
- Completed work reported
- Failed
- Needs recovery

Thread/turn IDs, bounded protocol events, commands, file changes, and redacted logs appear under **Technical details**. Hidden reasoning is not shown or implied.

## 11. Stop behavior and resource limits

**Stop Builder** is visible for every non-terminal run. The application atomically records the stop request, disables new work, sends `turn/interrupt` only when exact IDs are known, and waits up to 10 seconds for matching terminal evidence. It then closes the App Server job tree. If terminal evidence or final-manifest reconciliation is incomplete, the result is **Needs recovery / ambiguous**, not safely stopped. The attempt is preserved; the original remains unchanged; no turn is replayed.

Limits for the first implementation:

- 20-minute run duration;
- 3 minutes without meaningful lifecycle, item, file-change, or bounded command progress;
- 10 MiB combined stored stdout/stderr/protocol diagnostic output;
- 64 KiB structured Builder report;
- event flood threshold of 200 events/second sustained for 10 seconds or 2,000 events/minute;
- the copy, file-count, file-size, changed-path, and growth limits in section 2.

A breach stops the job tree, records the breached limit, captures the manifest if safely possible, preserves evidence and the attempt, and never starts another turn automatically.

## 12. Capability-diff rules

Baseline and final manifests plus conservative static scanning identify added, removed, or modified:

- `@tool` scripts;
- enabled editor plugins and plugin declarations;
- `.gdextension`, `.gdnlib`, and referenced native libraries;
- executable/command content (`.exe`, `.dll`, `.so`, `.dylib`, `.cmd`, `.bat`, `.ps1`, `.sh`, `.msi`, `.apk`, `.aab`);
- literal `OS.execute` and `OS.create_process` use;
- known network-capable Godot API references;
- autoload declarations;
- `project.godot` and export presets;
- reparse points, path escapes, or files outside the expected root.

Static matches are warnings, not proof that an API executes. Reparse points or path escapes make the attempt unsafe/ineligible. Protected-file changes and capability additions are never hidden by a successful Builder report. Milestone 2 has no promotion path, so no result can alter the original regardless of owner preference.

## 13. Original-project integrity

Immediately before attempt creation, capture a complete no-follow source-root integrity manifest of path, type, bytes, and SHA-256. After the terminal or interrupted run, capture it again before offering disposition. Matching manifests prove byte-for-byte file-tree stability within the scanner's readable, non-reparse scope. Any difference is a critical invariant failure: preserve all evidence, block further tasks, and show the exact changed paths. The attempt manifest is separate and cannot substitute for this proof.

The application never initializes Git, writes `.studio`, updates imports, invokes Godot, or places caches in the selected project.

## 14. Fault, restart, and ambiguity matrix

| Case | Owner-facing result | Attempt | Original | Recovery |
|---|---|---|---|---|
| Supported Codex, allowed edit, valid report | Completed work reported | Retain/discard | Verified unchanged | Inspect result |
| Unsupported version/hash/schema | Builder unavailable | Not created or preserved pre-run | Unchanged | Install/select supported binary |
| Login unavailable/cancelled/rate-limited | Sign-in unavailable/cancelled/capacity limited | Preserved if created | Unchanged | Sign in/retry only by owner |
| Task confirmation cancelled | Task not started | Not created | Unchanged | Edit task |
| Copy, disk, manifest, or verification failure | Attempt preparation failed | Incomplete copy quarantined then safely removable | Rechecked | Resolve named cause |
| Allowed-file edit, report invalid/missing | Work exists; report unavailable | Preserved | Verified unchanged | Inspect diff; create new task only after decision |
| Protected/out-of-scope write | Scope boundary changed | Preserved and flagged | Verified unchanged | Discard or inspect; no automatic repair |
| Native/executable/capability addition | Capability warning | Preserved and ineligible for later use | Verified unchanged | Inspect/discard |
| Reparse point/path escape | Unsafe attempt | Preserved without traversal | Verified unchanged | Discard; fix source policy |
| Output/event/file/time/no-progress limit | Builder stopped by limit | Preserved; evidence bounded | Verified unchanged | Revise task/limit deliberately |
| Stop before edit | Interrupted or ambiguous | Preserved, usually unchanged | Verified unchanged | Retain/discard |
| Stop after edit | Interrupted; partial work exists | Preserved with exact diff | Verified unchanged | Inspect/retain/discard |
| Interruption acknowledged and terminal observed | Interrupted | Preserved | Verified unchanged | Owner decides disposition |
| Interruption response/terminal unknown | Needs recovery | Preserved | Verified unchanged | Reconcile after restart; never replay |
| App Server exits during turn | Failed or ambiguous depending on terminal evidence | Preserved | Verified unchanged | New server reconciles known thread |
| Electron closes/machine restarts | Run interrupted; reconciliation required | Preserved | Checked on restart | Read journal/thread/manifest before any new task |
| Lost `thread/start` response | Reconciling Builder start | Preserved | Unchanged | Adopt exactly one cwd/time match; else ambiguous |
| Lost `turn/start` response | Reconciling work start | Preserved | Unchanged | Adopt exactly one new turn; else ambiguous |
| Lost terminal notification | Reconciling result | Preserved | Checked | `thread/read`; do not start another turn |
| Attempt changed, report unavailable | Partial work found | Preserved | Verified unchanged | Show factual diff and unknown report |
| Stale PID/thread identity | Needs recovery | Preserved | Checked | Ignore PID reuse; validate process handle and thread read |
| Repeated failure | Builder paused after bounded attempt | Preserved | Verified unchanged | Owner revises task; no automatic loop |

## 15. Implementation gates

### M2-A — Task framing and complete source index

No Codex. Add the complete main-process source index, bounded search, task composer, explicit scope fields, contracts, and owner confirmation. Exit evidence: the owner can define and confirm one precise task and see why each suggested path was selected.

### M2-B — Codex bootstrap and authentication

No owner-project writes. Add exact binary/hash/schema compatibility, dedicated profile, login/logout/rate-limit states, per-assignment App Server process, process-tree supervision, operation journal, fixture-only thread/turn, Stop, flood/output limits, and ambiguity probes. Hard failure stops M2-C.

### M2-C — Protected fixture attempt

Implement verified copy, baseline/final manifests, one fixture edit, structured report, actual diff, scope and capability validation, Stop cases, and original-fixture integrity. Hard failure stops owner-project work.

### M2-D — Real owner-project trial

Run one small owner-confirmed Bakery Sort task against an attempt only. Capture activity, report, exact diff, warnings, limits, retain/discard behavior, and before/after original integrity. No Godot execution or transfer back to the original.

### M2-E — Recovery and evidence

Run the complete fault matrix, app/process restart reconciliation, lost-response simulations, no-duplicate-turn proof, timeout/flood/out-of-scope tests, and final owner trial. Produce an immutable evidence index and one milestone recommendation. No Milestone 3 work.

Each gate produces a commit, test record, known limitations, and go/no-go decision. Failure narrows or repeats the named gate; it does not add a daemon, database, generic workflow engine, or VM automatically.

## 16. Test and evidence plan

- Contract/unit tests: task validation, path policy, index completeness, limits, report schema, capability classifications, lifecycle transitions, and replay classification.
- Fixture integration: fake App Server for every protocol ordering/failure and real pinned App Server for supported happy/stop/restart paths.
- Windows supervision: descendant cleanup, unresponsive child, app exit, PID reuse, stdout flood, and Job Object closure.
- Attempt tests: copy cancellation, disk shortage, manifest mismatch, reparse point, source mutation during copy, exact diff, protected write, large/new file, attempt growth, and discard root validation.
- Authentication tests: first login, cancel, persisted restart state, logout, redaction, unavailable account, and rate limit.
- Ambiguity tests: lost responses/notifications and proof that `thread/start`/`turn/start` are not duplicated.
- Owner evidence: exact task contract; Codex version/hash/schema hash; process/run IDs; bounded journal; baseline/final attempt manifests; app-computed diff; capability report; original before/after manifests; screenshots of framing, activity, stop, and result; retained/discarded disposition.

Evidence is written continuously under an app-owned run ID, hashed at terminal handoff, copied into `docs/evidence/milestone2/` only after redaction, and indexed with SHA-256. Secrets, auth URLs, raw tokens, hidden reasoning, and unrelated project content are excluded.

## 17. Explicit non-goals

No Godot import, validation, execution, tests, export, build, play, screenshots of gameplay, version promotion, restore/merge into the original, Git workflow, Producer, Designer, Reviewer, Playtester, autonomous next task, repair loop, parallel agent, MCP server, daemon, local HTTP API, database, workflow engine, plugin framework, cloud service, Hyper-V, public containment, asset generation, mobile deployment, or semantic understanding of the complete game.

## 18. Complexity and dominant risks

Overall complexity is **large**, despite the narrow owner journey. The copy, task form, and diff are medium-sized work. The dominant risk is the experimental App Server's version-specific behavior combined with Windows process-tree and restart ambiguity.

Secondary risks are false confidence in sandbox/network policy, oversized protocol output, stale authentication/account state, a task contract that is too vague to constrain edits, and capability scanners being mistaken for execution proof. The mitigations are exact pinning, generated schemas, fail-closed compatibility, per-assignment processes, factual UI wording, strict limits, and independent manifests. None of these justify a daemon, database, MCP server, generic scheduler, or VM in Milestone 2.

## 19. Recommendation

**Authorize the proposed Milestone 2 implementation.**
