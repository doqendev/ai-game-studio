import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { appendEvent, loadRun, relativeEvidencePath, writeJsonAtomic } from "./evidence.js";
import {
  buildSourceManifest,
  copySnapshot,
  diffManifests,
  evaluateChangedPaths,
  reconcileAttemptAfterRestart,
  recoverCurrent,
  writeAttemptState,
  writeInitialCurrent,
  type SourceManifest,
} from "./snapshot-store.js";

interface ProbeResult {
  id: string;
  name: string;
  startedAt: string;
  completedAt: string;
  pass: boolean;
  observation: unknown;
}

const runRoot = resolve(requiredArgument(2, "run root"));
loadRun(runRoot);
const gate0Root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixtureRoot = join(gate0Root, "fixtures", "godot-collect-one");
const evidenceRoot = join(runRoot, "gate0b", "snapshot-state");
const storeRoot = join(evidenceRoot, "project-store");
const versionsRoot = join(storeRoot, "versions");
const attemptsRoot = join(storeRoot, "attempts");
const quarantineRoot = join(storeRoot, "quarantine");
const stateRoot = join(storeRoot, "state");
const reportPath = join(evidenceRoot, "snapshot-and-state-report.json");
freshDirectory(evidenceRoot);
mkdirSync(versionsRoot, { recursive: true });
mkdirSync(attemptsRoot, { recursive: true });
mkdirSync(quarantineRoot, { recursive: true });

const results: ProbeResult[] = [];
let baselineManifest: SourceManifest;
let currentBefore: ReturnType<typeof recoverCurrent>;
const report = {
  stage: "Gate 0B",
  category: "snapshot-and-crash-state",
  startedAt: new Date().toISOString(),
  limits: {
    attemptFiles: 200,
    attemptBytes: 64 * 1024 * 1024,
    changedFiles: 20,
    sourceFileBytes: 1024 * 1024,
    passiveAssetBytes: 16 * 1024 * 1024,
  },
  results,
  pass: false,
};
writeJsonAtomic(reportPath, report);

async function probe(id: string, name: string, body: () => Promise<unknown>): Promise<void> {
  const startedAt = new Date().toISOString();
  appendEvent(runRoot, `probe.${id}.started`, "running", { name });
  try {
    const observation = await body();
    results.push({ id, name, startedAt, completedAt: new Date().toISOString(), pass: true, observation });
    writeJsonAtomic(reportPath, report);
    appendEvent(runRoot, `probe.${id}.completed`, "pass", { name, evidence: relativeEvidencePath(runRoot, reportPath) });
  } catch (error) {
    const observation = { error: error instanceof Error ? error.message : String(error) };
    results.push({ id, name, startedAt, completedAt: new Date().toISOString(), pass: false, observation });
    writeJsonAtomic(reportPath, report);
    appendEvent(runRoot, `probe.${id}.completed`, "fail", { name, ...observation });
  }
}

await probe("B-STATE-01", "trusted Godot fixture fits the source boundary and is copied into immutable version v0001", async () => {
  baselineManifest = buildSourceManifest(fixtureRoot);
  const versionRoot = join(versionsRoot, "v0001");
  const copiedManifest = copySnapshot(fixtureRoot, versionRoot);
  if (baselineManifest.sha256 !== copiedManifest.sha256) throw new Error("Trusted fixture copy does not match baseline.");
  for (const entry of copiedManifest.entries) chmodSync(join(versionRoot, ...entry.path.split("/")), 0o444);
  writeJsonAtomic(join(evidenceRoot, "baseline-manifest.json"), baselineManifest);
  writeInitialCurrent(stateRoot, "v0001", copiedManifest.sha256);
  currentBefore = recoverCurrent(stateRoot);
  return { fixtureRoot, manifest: baselineManifest, current: currentBefore, versionFilesMarkedReadOnly: true };
});

await probe("B-STATE-02", "attempt snapshot matches baseline and mutation cannot affect the immutable version", async () => {
  const workspace = join(attemptsRoot, "attempt-clean", "workspace");
  const attemptManifest = copySnapshot(join(versionsRoot, "v0001"), workspace);
  if (attemptManifest.sha256 !== baselineManifest.sha256) throw new Error("Attempt snapshot differs before mutation.");
  writeFileSync(join(workspace, "scripts", "game.gd"), `${readFileSync(join(workspace, "scripts", "game.gd"), "utf8")}\n# isolated attempt mutation\n`, "utf8");
  const versionAfter = buildSourceManifest(join(versionsRoot, "v0001"));
  if (versionAfter.sha256 !== baselineManifest.sha256) throw new Error("Attempt mutation changed immutable version.");
  writeJsonAtomic(join(evidenceRoot, "attempt-manifest.json"), attemptManifest);
  return { attemptManifest, versionManifestAfterAttemptMutation: versionAfter, isolated: true };
});

await probe("B-STATE-03", "mid-copy interruption is quarantined and current remains unchanged", async () => {
  const partialAttempt = join(attemptsRoot, "attempt-interrupted");
  const workspace = join(partialAttempt, "workspace");
  let interruption = "";
  try {
    copySnapshot(join(versionsRoot, "v0001"), workspace, 2);
  } catch (error) {
    interruption = error instanceof Error ? error.message : String(error);
  }
  if (!interruption.startsWith("INJECTED_SNAPSHOT_INTERRUPTION")) throw new Error("Snapshot failpoint did not trigger.");
  const quarantine = join(quarantineRoot, "attempt-interrupted-partial");
  renameSync(partialAttempt, quarantine);
  const currentAfter = recoverCurrent(stateRoot);
  assertSameCurrent(currentBefore, currentAfter);
  return { interruption, quarantine, partialMarkerPreserved: existsSync(join(quarantine, "workspace", ".snapshot-incomplete")), currentUnchanged: true };
});

await probe("B-STATE-04", "torn inactive generation and corrupt pointer recover the checksum-valid current", async () => {
  writeFileSync(join(stateRoot, "current.B.json"), '{"schemaVersion":1,"sequence":2', "utf8");
  writeFileSync(join(stateRoot, "active-slot"), "?\n", "utf8");
  const recovered = recoverCurrent(stateRoot);
  if (recovered.pointerWasValid || recovered.slot !== "A") throw new Error("Recovery did not select checksum-valid generation A.");
  assertSameCurrent(currentBefore, recovered);
  return { recovered, currentUnchanged: true };
});

await probe("B-STATE-05", "junction/reparse escape is rejected before snapshot or Godot", async () => {
  const hostileRoot = join(evidenceRoot, "hostile-reparse-source");
  const outside = join(evidenceRoot, "outside-reparse-target");
  copyDirectoryPlain(fixtureRoot, hostileRoot);
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, "sentinel.json"), "{}", "utf8");
  symlinkSync(outside, join(hostileRoot, "escape"), "junction");
  let rejection = "";
  try {
    buildSourceManifest(hostileRoot);
  } catch (error) {
    rejection = error instanceof Error ? error.message : String(error);
  }
  if (!rejection.startsWith("REPARSE_POINT_REJECTED")) throw new Error(`Reparse point was not rejected: ${rejection}`);
  assertSameCurrent(currentBefore, recoverCurrent(stateRoot));
  return { rejection, godotStarted: false, currentUnchanged: true };
});

await probe("B-STATE-06", "out-of-plan edit makes an attempt ineligible and preserves current", async () => {
  const workspace = join(attemptsRoot, "attempt-out-of-plan", "workspace");
  copySnapshot(join(versionsRoot, "v0001"), workspace);
  writeFileSync(join(workspace, "scripts", "game.gd"), `${readFileSync(join(workspace, "scripts", "game.gd"), "utf8")}\n# allowed change\n`, "utf8");
  writeFileSync(join(workspace, "project.godot"), `${readFileSync(join(workspace, "project.godot"), "utf8")}\n; forbidden change\n`, "utf8");
  const candidateManifest = buildSourceManifest(workspace);
  const diff = diffManifests(baselineManifest, candidateManifest);
  const scope = evaluateChangedPaths(diff, new Set(["scripts/game.gd"]));
  if (scope.eligible || !scope.reasons.some((reason) => reason.includes("project.godot"))) throw new Error("Out-of-plan project change was accepted.");
  writeJsonAtomic(join(evidenceRoot, "candidate-manifest-out-of-plan.json"), candidateManifest);
  assertSameCurrent(currentBefore, recoverCurrent(stateRoot));
  return { diff, scope, eligibleReviewBuild: false, currentUnchanged: true };
});

await probe("B-STATE-07", "in-flight external operation restarts as ambiguous and is never replayed", async () => {
  const attemptStateRoot = join(attemptsRoot, "attempt-ambiguous", "state");
  writeAttemptState(attemptStateRoot, 1, "prepared", null);
  writeAttemptState(attemptStateRoot, 2, "running", { kind: "builder-turn", requestId: "gate0-ambiguous-request", idempotent: false });
  const reconciled = reconcileAttemptAfterRestart(attemptStateRoot);
  if (reconciled.status !== "ambiguous" || reconciled.replayPermitted) throw new Error("Ambiguous operation was treated as replayable.");
  assertSameCurrent(currentBefore, recoverCurrent(stateRoot));
  return { reconciled, automaticReplayCount: 0, currentUnchanged: true };
});

await probe("B-STATE-08", "file count, file size, tree size, and changed-file ceilings fail closed", async () => {
  const limitRoot = join(evidenceRoot, "resource-limit-fixtures");
  mkdirSync(limitRoot, { recursive: true });
  const observations: Record<string, string> = {};

  const countRoot = join(limitRoot, "file-count");
  mkdirSync(countRoot, { recursive: true });
  for (let index = 0; index < 201; index += 1) writeFileSync(join(countRoot, `f-${String(index).padStart(3, "0")}.gd`), "extends RefCounted\n", "utf8");
  observations.fileCount = expectManifestRejection(countRoot, "SOURCE_FILE_COUNT_LIMIT");

  const fileSizeRoot = join(limitRoot, "file-size");
  mkdirSync(fileSizeRoot, { recursive: true });
  writeFileSync(join(fileSizeRoot, "oversized.gd"), Buffer.alloc(1024 * 1024 + 1, 0x20));
  observations.fileSize = expectManifestRejection(fileSizeRoot, "SOURCE_FILE_SIZE_LIMIT");

  const treeSizeRoot = join(limitRoot, "tree-size");
  mkdirSync(treeSizeRoot, { recursive: true });
  for (let index = 0; index < 5; index += 1) writeFileSync(join(treeSizeRoot, `asset-${index}.png`), Buffer.alloc(14 * 1024 * 1024, index));
  observations.treeSize = expectManifestRejection(treeSizeRoot, "SOURCE_TREE_SIZE_LIMIT");

  const changedDiff = { added: Array.from({ length: 21 }, (_, index) => `scripts/generated-${index}.gd`), removed: [], changed: [], allChangedPaths: Array.from({ length: 21 }, (_, index) => `scripts/generated-${index}.gd`) };
  const changed = evaluateChangedPaths(changedDiff, new Set(changedDiff.allChangedPaths));
  if (changed.eligible || !changed.reasons[0]?.startsWith("CHANGED_FILE_COUNT_LIMIT")) throw new Error("Changed-file ceiling did not fail closed.");
  assertSameCurrent(currentBefore, recoverCurrent(stateRoot));
  return { observations, changedFileLimit: changed, currentUnchanged: true, blindReplay: false };
});

report.pass = results.length === 8 && results.every((result) => result.pass);
writeJsonAtomic(reportPath, report);
appendEvent(runRoot, "snapshot-state.completed", report.pass ? "pass" : "fail", {
  evidence: relativeEvidencePath(runRoot, reportPath),
  passed: results.filter((result) => result.pass).length,
  failed: results.filter((result) => !result.pass).map((result) => result.id),
});
if (!report.pass) process.exitCode = 1;

function assertSameCurrent(before: ReturnType<typeof recoverCurrent>, after: ReturnType<typeof recoverCurrent>): void {
  if (before.record.sequence !== after.record.sequence || before.record.versionId !== after.record.versionId || before.record.manifestSha256 !== after.record.manifestSha256) {
    throw new Error("CURRENT_VERSION_CHANGED");
  }
}

function expectManifestRejection(root: string, prefix: string): string {
  try {
    buildSourceManifest(root);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith(prefix)) return message;
    throw error;
  }
  throw new Error(`Expected manifest rejection: ${prefix}`);
}

function copyDirectoryPlain(source: string, destination: string): void {
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name);
    const destinationPath = join(destination, entry.name);
    if (entry.isDirectory()) copyDirectoryPlain(sourcePath, destinationPath);
    else {
      mkdirSync(dirname(destinationPath), { recursive: true });
      copyFileSync(sourcePath, destinationPath);
    }
  }
}

function freshDirectory(path: string): void {
  const resolvedPath = resolve(path);
  const resolvedRunRoot = resolve(runRoot);
  if (!resolvedPath.toLowerCase().startsWith(resolvedRunRoot.toLowerCase() + "\\")) throw new Error(`Refusing to replace outside run root: ${resolvedPath}`);
  rmSync(resolvedPath, { recursive: true, force: true });
  mkdirSync(resolvedPath, { recursive: true });
}

function requiredArgument(index: number, label: string): string {
  const value = process.argv[index];
  if (!value) throw new Error(`Missing ${label} argument.`);
  return value;
}

