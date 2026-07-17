# Decision 0001: Internal Creator Prototype supersedes public-grade containment for the current phase

**Status:** Accepted for Milestone 0  
**Date:** 2026-07-17

## Decision

AI Game Studio will first be developed as a single-owner Internal Creator Prototype for existing Godot projects the owner explicitly trusts. The former public-product containment design is preserved, but it is not the implementation architecture for this phase. This decision does not authorize arbitrary or untrusted projects and does not establish a sandbox or public security guarantee.

## What Gate 0 proved

Gate 0A demonstrated, for the pinned Codex CLI 0.144.5 environment that was tested:

- 9/9 protocol compatibility and bounded-transport probes passed;
- 5/5 isolated authentication probes passed;
- 6/6 Windows Job Object process-supervision probes passed.

Gate 0B demonstrated:

- 8/8 snapshot, manifest, interruption, current-pointer, and conservative restart-state probes passed;
- the later Windows sandbox attempt ran as the intended `CodexSandboxOffline` identity;
- useful filesystem-containment, evidence-capture, process-cleanup, bounded-output, and no-blind-replay lessons were produced.

These are evidence about the exact tested versions and conditions, not permanent guarantees for later product versions.

## What Gate 0 did not prove

Gate 0B did not satisfy its zero-network requirement. Despite the intended sandbox identity and active rules, a bounded matrix reached all four local sentinels: TCP/IPv4, TCP/IPv6, UDP/IPv4, and UDP/IPv6.

Godot import, deterministic scenario execution, export, native-versus-Web review-runtime comparison, Gate 0C, and a real Builder-to-playable flow were not run. Gate 0 did not prove safe execution of arbitrary Godot projects, complete recovery, product usability, or the viability of the end-to-end MVP.

## Why the public-grade direction is paused

A credible public or arbitrary-project boundary would require reopening VM-class isolation or an equivalently proven boundary. Hyper-V topology, guest images, network gateways, virtual-disk exchange, host/guest protocols, maintenance, and a much larger evidence matrix would dominate the work before the owner-facing product experience had been validated.

The current question is narrower: can a project cockpit help its owner understand and improve a trusted game with less coordination overhead? The public-grade containment architecture is disproportionate to that experiment, so it is paused rather than implemented incrementally by default.

## Why zero-network is deferred, not passed

The recorded loopback test failed. The requirement has not been weakened into a passing result. It is removed as a current-phase hard gate only because the Internal Creator Prototype has a different trust model: one owner, one explicitly trusted existing project, normal desktop permissions, no public users, and no claim that generated code is contained from the machine.

The internal prototype must still keep normal-user execution, project backups or isolated work copies before later writes, app-owned commands, process-tree cleanup, limits, secret hygiene, changed-path review, explicit current-version selection, and conservative handling of ambiguous operations.

## When this evidence becomes relevant again

The containment evidence becomes an active architectural constraint again before any of the following:

- importing arbitrary or untrusted projects;
- distributing project execution to public users;
- claiming that Builder or Godot code cannot reach the host or network;
- executing third-party native extensions without an owner-trust boundary;
- supporting multi-user, multi-tenant, or cloud execution.

At that point the project must treat zero-network as failed under the recorded Windows sandbox design, select a new boundary, and authorize a new evidence gate. The sealed packets remain authoritative historical evidence and are indexed in [`../evidence/gate0/README.md`](../evidence/gate0/README.md).
