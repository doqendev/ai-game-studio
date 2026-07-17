# AI Game Studio — Internal Creator Prototype Reframing and Implementation Plan

**Date:** 2026-07-17  
**Status:** Proposed owner direction for developer review  
**Supersedes for the current phase:** Public-product containment gates, VM-class isolation proposals, and zero-network hard blocking  
**Does not invalidate:** The evidence gathered by Gate 0A/0B or the documented risks of executing AI-edited Godot projects  
**Authorization:** This document authorizes planning and implementation of the Internal Creator Prototype only after the developer confirms the migration boundary described below.

---

## 1. Owner decision

The immediate objective is no longer to prove a generally safe product for arbitrary nontechnical users and untrusted projects.

The immediate objective is:

> **Build an internal, single-user game-production cockpit that helps the owner understand a trusted Godot project, coordinate Codex roles, run builds and reviews, and decide the next step.**

The prototype is:

- for one owner;
- on the owner's own Windows computer;
- against projects owned and trusted by the owner;
- experimental;
- not distributed to the public;
- not advertised as a security boundary;
- not intended to execute hostile or unknown third-party projects;
- not required to provide VM-grade network or filesystem isolation.

The Gate 0B network-containment failure remains valid evidence. It proves that the tested Codex Windows sandbox does not provide the zero-network guarantee previously required. It does **not** prove that the central product idea is unusable for an internal trusted workflow.

The previous security contract was appropriate for a future public product. It was disproportionate as the blocker for the internal prototype.

---

## 2. Product definition

### Working description

> **AI Game Studio is a local production cockpit for games built with Codex. It shows the real state of a Godot project, coordinates bounded AI work, runs builds and reviews, and turns results into clear next actions.**

### Product promise

> **See the whole game. Direct the next step. Let Codex handle the implementation work.**

### The problem it solves

Codex can write code, but the owner still has to:

- remember the game's direction;
- reconstruct context across conversations;
- decide what should happen next;
- coordinate Builder, Reviewer, and Playtester work;
- inspect files and assets manually;
- run builds and tests;
- interpret technical output;
- track what has and has not actually been completed;
- turn playtest feedback into the next task.

The application should reduce that production-management burden.

The value is not “another Codex chat.” The value is:

- persistent game context;
- a visual project state;
- structured agent coordination;
- build and review history;
- playtest findings;
- clear next-step recommendations;
- one place to direct the work.

---

## 3. Target user and trust model

### Initial user

The only required user is the owner of the application.

The owner:

- selects projects they created or explicitly trust;
- understands that the prototype executes AI-edited code;
- can inspect technical details when needed;
- accepts the experimental nature of the tool;
- keeps important source repositories backed up;
- does not expect protection from deliberately malicious projects.

### Accepted risk statement

The prototype may use operating-system and Codex sandbox controls as useful safeguards, but it must not claim that they provide complete isolation.

The owner accepts that AI-generated or AI-edited code may, through error:

- modify unintended files;
- start a process;
- attempt a network connection;
- consume excessive CPU, memory, or disk;
- break the project;
- leave partial work.

The prototype must reduce the likelihood and impact of those mistakes. It is not required to resist a determined hostile program.

### Prohibited trust cases

The Internal Creator Prototype must not be used for:

- unknown repositories downloaded from the Internet;
- projects supplied by untrusted users;
- plugins or native libraries from unknown sources;
- multi-user or multi-tenant execution;
- public “upload a project and let AI run it” workflows;
- security claims to third parties.

A future public product must reopen containment architecture and may require VM-class or managed remote isolation.

---

## 4. Restart or reuse decision

### Recommendation

> **Do not throw away the existing repository or evidence. Do not continue the Hyper-V/VM design as the main implementation. Start a clean Internal Creator Prototype implementation lane and selectively reuse only proven, relevant modules.**

This is a **controlled reset**, not a total restart and not a continuation of the overcomplicated architecture.

### Why

The previous architecture work produced useful facts:

- App Server compatibility and schema handling;
- authentication observations;
- process-lifecycle findings;
- snapshot and manifest concepts;
- Godot command and fixture knowledge;
- the definitive network-containment failure;
- clear warnings about ambiguous retries.

Those findings should be preserved.

However, the public-grade hardening path would dominate the product:

- several VMs;
- gateway networking;
- virtual disk exchange;
- custom host/guest protocol;
- image maintenance;
- Hyper-V edition and hardware requirements;
- a large evidence and fault-test burden.

That path would delay the product experience that must first be validated.

### Repository strategy

If the current repository contains primarily documents and Gate 0 probes:

1. Keep the same repository.
2. Create a branch named similar to:
   - `internal-creator-prototype`
3. Archive public-hardening work under:
   - `docs/archive/public-product-containment/`
   - `experiments/archive/gate0-public-containment/`
4. Keep the Gate 0A/0B evidence immutable.
5. Add a short supersession record explaining why zero-network containment is no longer a current-phase hard gate.
6. Start the product implementation in clean application directories.

If the current code has already been deeply shaped around VMs, gateway services, virtual disks, or security protocols:

1. Preserve that repository as the research/evidence repository.
2. Create a new product repository for the Internal Creator Prototype.
3. Copy or package only the proven modules listed below.
4. Link back to the archived evidence by document and commit identity.

### Reuse candidates

Reuse only after a small code review confirms that they are independent of the discarded architecture:

- pinned Codex App Server adapter;
- generated protocol types and compatibility checks;
- application-managed Codex authentication code;
- process start, Stop, and timeout utilities;
- no-blind-retry rules for ambiguous App Server operations;
- project-copy and snapshot utilities;
- file manifests and changed-path comparison;
- current-version pointer or equivalent version-selection logic;
- Godot executable discovery;
- app-owned Godot command construction;
- log collection and redaction;
- the small Godot fixture and scenario harness.

### Do not carry into the prototype

- Hyper-V topology;
- Control, Gateway, or Execution VMs;
- VHDX/ISO transfer protocol;
- Hyper-V Socket protocol;
- zero-network hard-gate matrix;
- public-user security claims;
- multi-tenant assumptions;
- generic security framework;
- custom WFP service;
- separate daemon without a reproduced product need;
- database without a reproduced product need;
- generic workflow engine;
- broad evidence bureaucracy;
- 52-step feasibility gate as a prerequisite to showing UI value.

---

## 5. Internal prototype safety baseline

The change in scope does not mean “no safety.”

The following safeguards remain mandatory because they protect the owner's work without becoming a security platform.

### 5.1 Trusted project confirmation

When opening a project for the first time, show:

> **Only open a project you created or trust. AI-edited project code may be executed during builds and playtests.**

The owner explicitly confirms trust for that local project.

### 5.2 Never work directly on the only copy

Before a Builder assignment:

- create a full attempt copy or a Git-backed working branch;
- record the source version;
- preserve the prior selected current version;
- never overwrite the only known-good state.

For the first implementation, choose whichever is simpler and reliable:

- a complete project copy for small projects; or
- a hidden Git branch/worktree if the project is already a valid Git repository and the implementation is demonstrably simpler.

Do not build a general Git governance system.

### 5.3 No administrator execution

- Do not launch Codex, Godot, or the application as Administrator.
- Detect elevation and warn or block normal work.
- Use normal-user permissions.

### 5.4 Secrets

- Do not place API keys, passwords, private certificates, personal documents, or unrelated secrets in the project workspace.
- Sanitize the environment passed to Codex and Godot where practical.
- Do not log authentication tokens.
- Keep Codex authentication outside the project repository.

### 5.5 App-owned operations

The application owns a small allowlist of standard operations:

- inspect project;
- import/check Godot project;
- run configured tests;
- export review build;
- launch review build;
- capture logs;
- stop the process.

Role output must not supply arbitrary shell commands for automatic execution.

An Expert action may display and request explicit confirmation for a nonstandard command later. It is not required for the first prototype.

### 5.6 Capability warnings or blocks

For the first supported workflow, detect and prominently warn or block unexpected additions involving:

- `@tool`;
- editor plugins;
- GDExtension or native libraries;
- new executables;
- `OS.execute`;
- `OS.create_process`;
- external shell commands;
- unexpected network APIs;
- paths outside the project;
- symlinks, junctions, or reparse-point escapes.

These scans are guardrails, not claims of complete security.

### 5.7 Limits

Include:

- one active coding turn at a time;
- prominent Stop;
- maximum role duration;
- maximum cycle duration;
- bounded retries;
- no-progress timeout;
- log-size limit;
- output-size limit;
- no automatic replay after an ambiguous non-idempotent operation;
- no endless autonomous cycles.

### 5.8 Current-version protection

A failed, interrupted, incomplete, or ambiguous attempt never silently becomes the current version.

The owner must explicitly choose a completed review candidate.

### 5.9 Backups

The prototype should:

- verify that the project has a recoverable baseline;
- create a snapshot before work;
- provide Restore prior version;
- preserve failed attempt information until the owner discards it.

---

## 6. Exact Internal Creator Prototype MVP

The MVP is not “generate an entire game autonomously.”

It is:

> **Open one trusted Godot project, understand its state, start one bounded Codex task, produce a build, review the result, record playtest feedback, and create the next task—all from one application.**

### 6.1 Open one trusted project

Support:

- one local Godot 4 project at a time;
- GDScript-first;
- projects owned or explicitly trusted by the owner;
- existing owner projects and application-created projects;
- no arbitrary public upload or remote project ingestion.

The app records:

- project name;
- repository path;
- Godot version;
- current game brief;
- selected current version;
- latest build.

### 6.2 Project scan

Read the project and present a useful, non-authoritative visual index:

- scenes;
- scripts;
- textures and images;
- audio assets;
- fonts;
- animations where statically discoverable;
- project settings;
- autoloads;
- input actions;
- tests;
- recent build information;
- parsing or import problems.

The scan should clearly distinguish:

- declared project structure;
- observed files;
- build/test results;
- AI summaries.

Do not claim that static scanning fully understands gameplay.

### 6.3 Game brief and current objective

Store a short durable brief:

- player promise;
- core loop;
- current phase;
- current objective;
- important constraints;
- non-goals;
- definition of success.

The owner can edit this directly.

The brief—not chat history—is the primary creative context.

### 6.4 Studio dashboard

The default screen answers:

1. What game is this?
2. What are we trying to achieve now?
3. What currently works?
4. What is incomplete or broken?
5. What are the agents doing?
6. What did the last build/playtest reveal?
7. What should happen next?
8. Does the owner need to decide anything?

Suggested sections:

- **Current objective**
- **What works**
- **In progress**
- **Needs attention**
- **Latest build**
- **Latest playtest findings**
- **Recommended next step**
- **Studio activity**

### 6.5 Codex work from inside the app

The owner can select or describe one bounded objective, for example:

> Improve combat hit feedback without changing damage values or enemy behavior.

The application:

1. shows its interpretation of the task;
2. lets the owner edit/confirm it;
3. creates a protected attempt copy;
4. prepares a minimal project-context package;
5. starts a Codex Builder assignment;
6. shows meaningful activity;
7. provides Stop;
8. records the result and changed paths.

The owner does not need to open Codex separately.

### 6.6 Sequential agent roles

The first prototype supports logical roles, one at a time:

- **Producer** — recommends the next bounded objective;
- **Builder** — implements the confirmed task;
- **Reviewer** — compares the result to the task and project constraints;
- **Playtest Analyst** — summarizes available test/runtime evidence and the owner's playtest feedback.

The first product slice may implement Builder first, then Reviewer, then Producer/Playtest Analyst.

No parallel writers are required.

### 6.7 App-owned build flow

The application can:

- run a Godot import/check;
- run configured project tests;
- export a review build;
- launch the review build;
- stop it;
- collect logs;
- associate results with the exact attempt.

For the internal prototype, the native build may run on the host after:

- the project is trusted;
- the owner is informed;
- forbidden/high-risk capability checks do not reveal an unexpected change;
- the owner confirms **Play this build**.

A Web preview may still be added as a convenience, but it is not a blocker.

### 6.8 Checkpoint and review

After a completed attempt, show:

#### What was requested
The confirmed task.

#### What changed
Player-facing and technical summaries, with changed files available under details.

#### What was checked
Build, tests, runtime observations, and failures.

#### Reviewer assessment
Likely issues, risks, and alignment.

#### What still needs the owner
Feel, fun, clarity, visual quality, and direction.

#### Actions
- **Play build**
- **Keep this result**
- **Request changes**
- **Create the next task**
- **Restore previous version**
- **Pause**

No generic Accept button.

### 6.9 Playtest feedback

After the owner plays:

- What felt good?
- What felt wrong?
- What should happen instead?

The application proposes a structured interpretation and asks the owner to confirm it.

That interpretation becomes:

- a finding;
- a constraint;
- or the next bounded task.

### 6.10 Build and version history

Show:

- screenshot where available;
- plain-language build summary;
- build/test result;
- review result;
- playtest notes;
- current-version status;
- Play;
- Restore.

Hide commit hashes and branch names by default.

---

## 7. UI boundary

Use three primary areas:

### Studio

The project cockpit:

- objective;
- status;
- activity;
- agents;
- latest build;
- playtest findings;
- recommended next action.

### Project

A visual view of:

- scenes;
- assets;
- scripts/systems;
- animations;
- issues;
- game brief;
- current plan.

The label may later be **Game** or **Project**, based on usability.

### Builds

- build history;
- test status;
- screenshots;
- playtest notes;
- current version;
- Play and Restore.

A small **Technical details** area may contain:

- paths;
- changed files;
- commands;
- logs;
- App Server identity;
- Git information.

Do not make technical details the normal workflow.

---

## 8. Simplified architecture

Recommended initial topology:

```text
Electron desktop application
        |
        +-- Studio/project state
        +-- Project scanner
        +-- Codex App Server adapter
        +-- Snapshot/version adapter
        +-- Godot build/launch adapter
        +-- Small local run journal
```

### Explicitly avoid initially

- separate daemon;
- local HTTP service;
- custom MCP server;
- general database;
- VM infrastructure;
- generic agent scheduler;
- plugin system;
- graph editor;
- cloud backend;
- collaboration;
- auto-update platform;
- public security claims.

### Persistence

Start with:

- readable Markdown/JSON project memory;
- run-scoped records;
- a small state file for active work;
- project-local or app-data artifact directories.

Add SQLite only after a real product requirement demonstrates that files are inadequate.

### Codex process

Start with one supervised App Server process:

- pinned/checked compatible version;
- stable methods only;
- one active assignment;
- separate thread per role/task;
- no blind retry of ambiguous turn creation;
- Stop and restart handling.

Do not make exact-once recovery a prerequisite for showing value. Preserve ambiguous work, explain it, and require a deliberate restart where necessary.

---

## 9. Delivery sequence

### Milestone 0 — Controlled reset

Deliver:

- archive/supersession record;
- retained-module inventory;
- clean implementation branch or repository;
- accepted internal trust model;
- reduced architecture;
- runnable application shell.

Exit condition:

The developer and owner agree on what is reused, archived, and removed.

### Milestone 1 — Project cockpit

Deliver:

- open/trust one Godot project;
- project scan;
- scenes/assets/scripts overview;
- game brief and current objective;
- Studio/Project/Builds navigation;
- latest build placeholder/state.

Exit condition:

The owner can understand the current project from the app without opening the Godot editor for inspection.

### Milestone 2 — One Codex Builder

Deliver:

- integrated Codex sign-in/runtime;
- confirm one bounded task;
- attempt snapshot/copy;
- one Builder assignment;
- meaningful progress;
- Stop;
- changed-path result;
- incomplete/ambiguous state handling.

Exit condition:

The owner can start and observe one useful coding task without opening Codex separately.

### Milestone 3 — Build and play

Deliver:

- app-owned Godot check/export;
- build result;
- native Play action with explicit trust confirmation;
- logs;
- current-version protection;
- Restore.

Exit condition:

The owner can produce, play, keep, or discard a review build without terminal commands.

### Milestone 4 — Review and playtest loop

Deliver:

- Reviewer assignment;
- checkpoint summary;
- human playtest feedback;
- interpreted-feedback confirmation;
- next-task proposal;
- build history.

Exit condition:

One completed task leads to a build, review, human feedback, and a clear next task.

### Milestone 5 — Internal daily-use hardening

Deliver only from reproduced needs:

- restart recovery;
- timeout tuning;
- resource limits;
- clearer errors;
- larger-project scan performance;
- optional hidden Git integration;
- usability improvements.

Exit condition:

The owner uses the application on a real project for repeated sessions and chooses to continue.

### Future public-product phase

Only after internal value is proven:

- define public threat model;
- choose VM or managed remote worker;
- packaging/signing/updating;
- untrusted project boundary;
- independent security review;
- novice onboarding;
- public support requirements.

---

## 10. Internal prototype non-goals

Do not implement during this phase:

- hostile-project containment;
- zero-network guarantee;
- Hyper-V orchestration;
- managed remote workers;
- arbitrary public uploads;
- multi-user accounts;
- cloud collaboration;
- parallel writing agents;
- general workflow engine;
- general permissions framework;
- automatic publishing;
- mobile-store deployment;
- art/music/voice generation;
- full autonomous game completion;
- support for every Godot feature;
- support for Unity/Unreal;
- claims that AI can determine fun;
- claims that the prototype is safe for public use.

---

## 11. Success criteria

The prototype succeeds when the owner can use one trusted Godot project and:

1. see its scenes, assets, scripts, objective, issues, and latest build;
2. understand what is currently being worked on;
3. start one bounded Codex task from the application;
4. observe useful progress without reading a transcript;
5. stop the work;
6. see what changed;
7. run checks and export a review build;
8. play the build;
9. read a clear Reviewer summary;
10. record playtest feedback;
11. turn feedback into the next task;
12. preserve or restore a known-good version;
13. complete the loop without opening Codex, Git, or a terminal in the normal path.

The prototype does not need to prove that an untrusted project cannot escape the machine.

---

## 12. Complexity budget

Any proposal adding one of the following requires a reproduced problem and written justification:

- separate persistent process;
- database;
- VM;
- custom network protocol;
- custom MCP;
- second simultaneous writer;
- generic graph;
- plugin system;
- public authentication;
- cloud service.

The developer must state:

1. the concrete failure;
2. the simplest rejected alternative;
3. the code and operational cost;
4. whether the addition is essential to the next owner-visible outcome.

No infrastructure-only milestone should replace visible product progress.

---

## 13. Required developer response

Before implementation, please provide a concise response covering:

1. Do you agree with the Internal Creator Prototype trust model?
2. Does the current repository contain enough VM/security architecture that a new repository is cleaner, or can a clean branch safely isolate the product work?
3. List the exact files/modules to:
   - preserve;
   - reuse;
   - archive;
   - delete or leave unused.
4. Confirm that Gate 0A/0B evidence remains immutable and linked.
5. Propose the minimal Milestone 0 repository structure.
6. Identify any safeguard in this document that is still disproportionate for internal use.
7. Identify any removed safeguard whose absence creates an unacceptable risk even for the owner-only workflow.
8. Propose the first owner-visible vertical slice for Milestone 1.
9. Estimate complexity in relative terms only:
   - small;
   - medium;
   - large;
   and identify the dominant risk.
10. Finish with one recommendation:
    - reuse the current repository with a clean branch;
    - create a new product repository and extract modules;
    - stop or revise the direction.

Do not continue the Hyper-V proposal unless the owner separately reopens public-product containment.

---

## 14. Immediate authorization boundary

After the developer returns the migration response above, the owner may authorize:

- Milestone 0 controlled reset;
- then Milestone 1 project cockpit.

Until that response is reviewed:

- product implementation remains paused;
- Hyper-V implementation remains paused;
- no additional public-security gates should be added;
- no current evidence should be deleted.

---

## 15. Final direction

The product should now optimize for:

> **Internal usefulness, clear project state, better agent coordination, and a repeatable build/review loop.**

It should not optimize yet for:

> **Running arbitrary untrusted AI-generated games for the public with a formal isolation guarantee.**

The previous work was not wasted. It identified where the public-product boundary becomes expensive and gave the project useful recovery and safety lessons.

The next test is no longer “Can we prove perfect containment?”

The next test is:

> **Does this cockpit materially help the owner understand a real game, coordinate Codex, and produce better iterations with less mental overhead?**

That is the product question the Internal Creator Prototype must answer.
