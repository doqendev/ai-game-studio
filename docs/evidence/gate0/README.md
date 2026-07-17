# Gate 0 sealed evidence

This directory preserves the exact sealed Gate 0 archives that informed the Internal Creator Prototype reset. The archives under `archives/` were copied byte-for-byte from their original `%LOCALAPPDATA%` locations on 2026-07-17. The originals were not opened for writing, moved, deleted, unpacked, normalized, or resealed.

The authoritative machine-readable inventory is [`index.json`](index.json). SHA-256 values were calculated independently on each source and copied file. Both packet manifests were then revalidated from the repository copies.

## Verification result

| Archive | Bytes | SHA-256 | Packet verification |
|---|---:|---|---|
| `AI_Game_Studio_Gate0_20260716_STOPPED_AT_GATE0B.zip` | 1,095,225 | `5c162e6afe33684e0469bd1a0e36058820bfaeac8d5b408826e68027cf206f90` | 930 entries, 0 mismatches |
| `AI_Game_Studio_Gate0B_LOOPBACK_FAILURE_20260716T224536Z.zip` | 205,675 | `21e1c3be4880d9d94395dcd2a45419c127378e3b38022c178e55ad5e9acce258` | 46 entries, 0 mismatches |
| `Gate0B_Loopback_PreRemediation_20260716T223432Z.zip` | 36,225 | `d625578d85e3c8ed55b2a75ef58c7b6a9179f04e77ce1def389bb7f5146f2356` | Exact embedded archive is covered by the 46-entry final packet manifest |

## Interpreting the evidence

- Gate 0A passed its pinned protocol, isolated-authentication, and process-supervision probes.
- Gate 0B snapshot/state probes passed.
- The required zero-network boundary failed: the final loopback matrix reached TCP and UDP sentinels over IPv4 and IPv6.
- Godot import/scenario/export, runtime selection, Gate 0C, and Builder-to-playable were not run.

These Git-tracked copies are content-addressed and tamper-evident, not physically write-once storage. Any future replacement or update must use a new filename and index entry; these archive bytes and hashes must not be rewritten.
