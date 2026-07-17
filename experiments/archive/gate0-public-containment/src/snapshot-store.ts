import { createHash } from "node:crypto";
import {
  closeSync,
  chmodSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";

export interface ManifestEntry {
  path: string;
  size: number;
  sha256: string;
}

export interface SourceManifest {
  root: string;
  fileCount: number;
  totalBytes: number;
  entries: ManifestEntry[];
  sha256: string;
}

export interface SnapshotLimits {
  maxFiles: number;
  maxTreeBytes: number;
  maxSourceFileBytes: number;
  maxPassiveAssetBytes: number;
}

export const gate0SnapshotLimits: SnapshotLimits = {
  maxFiles: 200,
  maxTreeBytes: 64 * 1024 * 1024,
  maxSourceFileBytes: 1024 * 1024,
  maxPassiveAssetBytes: 16 * 1024 * 1024,
};

const allowedExtensions = new Set([".gd", ".tscn", ".tres", ".godot", ".cfg", ".json", ".png", ".jpg", ".jpeg", ".webp", ".wav", ".ogg"]);
const passiveExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".wav", ".ogg"]);
const ignoredDirectories = new Set([".godot"]);

export function buildSourceManifest(root: string, limits: SnapshotLimits = gate0SnapshotLimits): SourceManifest {
  const resolvedRoot = resolve(root);
  const entries: ManifestEntry[] = [];
  walk(resolvedRoot, "");
  entries.sort((left, right) => left.path.localeCompare(right.path, "en"));
  const totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  const canonical = JSON.stringify(entries);
  return {
    root: resolvedRoot,
    fileCount: entries.length,
    totalBytes,
    entries,
    sha256: createHash("sha256").update(canonical).digest("hex"),
  };

  function walk(directory: string, relativeDirectory: string): void {
    const directoryIdentity = lstatSync(directory);
    if (directoryIdentity.isSymbolicLink()) throw new Error(`REPARSE_POINT_REJECTED ${relativeDirectory || "."}`);
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const absolutePath = join(directory, entry.name);
      const identity = lstatSync(absolutePath);
      if (identity.isSymbolicLink()) throw new Error(`REPARSE_POINT_REJECTED ${relativePath}`);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) walk(absolutePath, relativePath);
        continue;
      }
      if (!entry.isFile()) throw new Error(`NON_REGULAR_FILE_REJECTED ${relativePath}`);
      const extension = extname(entry.name).toLowerCase();
      if (!allowedExtensions.has(extension)) throw new Error(`SOURCE_EXTENSION_REJECTED ${relativePath}`);
      const perFileLimit = passiveExtensions.has(extension) ? limits.maxPassiveAssetBytes : limits.maxSourceFileBytes;
      if (identity.size > perFileLimit) {
        throw new Error(`SOURCE_FILE_SIZE_LIMIT path=${relativePath} size=${identity.size} limit=${perFileLimit}`);
      }
      entries.push({
        path: relativePath.replaceAll("\\", "/"),
        size: identity.size,
        sha256: createHash("sha256").update(readFileSync(absolutePath)).digest("hex"),
      });
      if (entries.length > limits.maxFiles) throw new Error(`SOURCE_FILE_COUNT_LIMIT limit=${limits.maxFiles}`);
      const runningBytes = entries.reduce((sum, item) => sum + item.size, 0);
      if (runningBytes > limits.maxTreeBytes) {
        throw new Error(`SOURCE_TREE_SIZE_LIMIT size=${runningBytes} limit=${limits.maxTreeBytes}`);
      }
    }
  }
}

export function copySnapshot(sourceRoot: string, destinationRoot: string, failAfterFiles?: number): SourceManifest {
  const manifest = buildSourceManifest(sourceRoot);
  if (existsSync(destinationRoot)) throw new Error(`SNAPSHOT_DESTINATION_EXISTS ${destinationRoot}`);
  mkdirSync(destinationRoot, { recursive: true });
  let copied = 0;
  for (const entry of manifest.entries) {
    const destination = join(destinationRoot, ...entry.path.split("/"));
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(sourceRoot, ...entry.path.split("/")), destination);
    chmodSync(destination, 0o666);
    copied += 1;
    if (failAfterFiles !== undefined && copied >= failAfterFiles) {
      writeFileSync(join(destinationRoot, ".snapshot-incomplete"), JSON.stringify({ copied, expected: manifest.fileCount }), "utf8");
      throw new Error(`INJECTED_SNAPSHOT_INTERRUPTION copied=${copied} expected=${manifest.fileCount}`);
    }
  }
  const copiedManifest = buildSourceManifest(destinationRoot);
  if (manifest.sha256 !== copiedManifest.sha256) throw new Error("SNAPSHOT_MANIFEST_MISMATCH");
  return copiedManifest;
}

export interface ManifestDiff {
  added: string[];
  removed: string[];
  changed: string[];
  allChangedPaths: string[];
}

export function diffManifests(before: SourceManifest, after: SourceManifest): ManifestDiff {
  const beforeByPath = new Map(before.entries.map((entry) => [entry.path, entry]));
  const afterByPath = new Map(after.entries.map((entry) => [entry.path, entry]));
  const added = [...afterByPath.keys()].filter((path) => !beforeByPath.has(path)).sort();
  const removed = [...beforeByPath.keys()].filter((path) => !afterByPath.has(path)).sort();
  const changed = [...beforeByPath.keys()]
    .filter((path) => afterByPath.has(path) && beforeByPath.get(path)!.sha256 !== afterByPath.get(path)!.sha256)
    .sort();
  return { added, removed, changed, allChangedPaths: [...added, ...removed, ...changed].sort() };
}

export function evaluateChangedPaths(diff: ManifestDiff, allowedPaths: Set<string>, maximumChangedFiles = 20): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (diff.allChangedPaths.length > maximumChangedFiles) reasons.push(`CHANGED_FILE_COUNT_LIMIT limit=${maximumChangedFiles} observed=${diff.allChangedPaths.length}`);
  const outsidePlan = diff.allChangedPaths.filter((path) => !allowedPaths.has(path));
  if (outsidePlan.length !== 0) reasons.push(`OUTSIDE_PLAN_PATHS ${outsidePlan.join(",")}`);
  return { eligible: reasons.length === 0, reasons };
}

export interface CurrentRecordBody {
  schemaVersion: 1;
  sequence: number;
  versionId: string;
  manifestSha256: string;
  priorSequence: number | null;
  writtenAt: string;
}

export interface CurrentRecord extends CurrentRecordBody {
  checksum: string;
}

export interface RecoveredCurrent {
  record: CurrentRecord;
  slot: "A" | "B";
  pointerWasValid: boolean;
  recoveryReason: string;
}

export function writeInitialCurrent(stateRoot: string, versionId: string, manifestSha256: string): CurrentRecord {
  mkdirSync(stateRoot, { recursive: true });
  const record = withChecksum({
    schemaVersion: 1,
    sequence: 1,
    versionId,
    manifestSha256,
    priorSequence: null,
    writtenAt: new Date().toISOString(),
  });
  writeJsonDurable(join(stateRoot, "current.A.json"), record);
  writeTextDurable(join(stateRoot, "active-slot"), "A\n");
  return record;
}

export function recoverCurrent(stateRoot: string): RecoveredCurrent {
  const slots = (["A", "B"] as const)
    .map((slot) => ({ slot, record: readValidRecord(join(stateRoot, `current.${slot}.json`)) }))
    .filter((entry): entry is { slot: "A" | "B"; record: CurrentRecord } => entry.record !== null);
  if (slots.length === 0) throw new Error("CURRENT_STATE_UNRECOVERABLE");
  let pointer: string | null = null;
  try {
    pointer = readFileSync(join(stateRoot, "active-slot"), "utf8").trim();
  } catch {
    pointer = null;
  }
  const pointed = slots.find((entry) => entry.slot === pointer);
  if (pointed) return { ...pointed, pointerWasValid: true, recoveryReason: "active pointer and checksum valid" };
  const newest = slots.sort((left, right) => right.record.sequence - left.record.sequence)[0]!;
  return { ...newest, pointerWasValid: false, recoveryReason: "pointer invalid; selected highest checksum-valid generation" };
}

export function writeAttemptState(stateRoot: string, sequence: number, status: string, externalOperation: unknown): CurrentRecord {
  mkdirSync(stateRoot, { recursive: true });
  const slot: "A" | "B" = sequence % 2 === 1 ? "A" : "B";
  const body: CurrentRecordBody & { status: string; externalOperation: unknown } = {
    schemaVersion: 1,
    sequence,
    versionId: status,
    manifestSha256: createHash("sha256").update(JSON.stringify(externalOperation)).digest("hex"),
    priorSequence: sequence === 1 ? null : sequence - 1,
    writtenAt: new Date().toISOString(),
    status,
    externalOperation,
  };
  const checksum = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  const record = { ...body, checksum } as CurrentRecord;
  writeJsonDurable(join(stateRoot, `attempt.${slot}.json`), record);
  writeTextDurable(join(stateRoot, "active-slot"), `${slot}\n`);
  return record;
}

export function reconcileAttemptAfterRestart(stateRoot: string): { status: string; replayPermitted: boolean; explanation: string } {
  const records = (["A", "B"] as const)
    .map((slot) => readValidArbitraryRecord(join(stateRoot, `attempt.${slot}.json`)))
    .filter((record): record is Record<string, unknown> => record !== null)
    .sort((left, right) => Number(right.sequence) - Number(left.sequence));
  const latest = records[0];
  if (!latest) return { status: "missing", replayPermitted: false, explanation: "No checksum-valid attempt state exists." };
  if (latest.status === "running" && latest.externalOperation) {
    return {
      status: "ambiguous",
      replayPermitted: false,
      explanation: "An external operation was in flight at interruption; inspect effects and never replay blindly.",
    };
  }
  return { status: String(latest.status), replayPermitted: false, explanation: "No automatic replay is defined." };
}

function withChecksum(body: CurrentRecordBody): CurrentRecord {
  return { ...body, checksum: createHash("sha256").update(JSON.stringify(body)).digest("hex") };
}

function readValidRecord(path: string): CurrentRecord | null {
  const value = readValidArbitraryRecord(path);
  if (!value) return null;
  return value as unknown as CurrentRecord;
}

function readValidArbitraryRecord(path: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const { checksum, ...body } = parsed;
    if (typeof checksum !== "string") return null;
    const expected = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    return expected === checksum ? parsed : null;
  } catch {
    return null;
  }
}

function writeJsonDurable(path: string, value: unknown): void {
  writeTextDurable(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeTextDurable(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  const descriptor = openSync(temporary, "wx");
  try {
    writeFileSync(descriptor, value, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporary, path);
  const directoryDescriptor = openSync(dirname(path), "r");
  try {
    fsyncSync(directoryDescriptor);
  } catch {
    // Windows does not consistently support directory fsync. File durability and checksum recovery remain enforced.
  } finally {
    closeSync(directoryDescriptor);
  }
}
