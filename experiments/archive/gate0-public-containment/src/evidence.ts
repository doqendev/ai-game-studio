import { appendFileSync, closeSync, fsyncSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type ProbeStatus = "running" | "pass" | "fail" | "blocked" | "info";

export interface Gate0Run {
  runId: string;
  stage: string;
  status: string;
  evidenceRoot: string;
}

export function loadRun(runRoot: string): Gate0Run {
  const resolved = resolve(runRoot);
  const expected = resolve(process.env.LOCALAPPDATA ?? "", "AI Game Studio", "Gate0", "runs");
  if (!resolved.toLowerCase().startsWith(expected.toLowerCase() + "\\")) {
    throw new Error(`Evidence root is outside the Gate 0 runs directory: ${resolved}`);
  }
  const run = JSON.parse(readFileSync(join(resolved, "run.json"), "utf8")) as Gate0Run;
  if (resolve(run.evidenceRoot) !== resolved) {
    throw new Error("Gate 0 run manifest does not match the requested evidence root.");
  }
  return run;
}

export function writeJsonAtomic(path: string, value: unknown): void {
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: "utf8", flag: "wx" });
  renameSync(temporary, path);
}

export function appendEvent(runRoot: string, type: string, status: ProbeStatus, data: unknown = {}): void {
  const run = loadRun(runRoot);
  const path = join(runRoot, "events.jsonl");
  const existing = readFileSync(path, "utf8");
  const sequence = existing.length === 0 ? 1 : existing.trimEnd().split(/\r?\n/u).length + 1;
  const event = {
    seq: sequence,
    at: new Date().toISOString(),
    stage: run.stage,
    type,
    status,
    data,
  };
  appendFileSync(path, `${JSON.stringify(event)}\n`, "utf8");
  const descriptor = openSync(path, "r+");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export function relativeEvidencePath(runRoot: string, path: string): string {
  const base = resolve(runRoot).toLowerCase();
  const target = resolve(path);
  if (!target.toLowerCase().startsWith(base + "\\")) {
    throw new Error(`Evidence path escapes the run root: ${target}`);
  }
  return target.slice(base.length + 1).replaceAll("\\", "/");
}

export function ensureParent(path: string): string {
  return dirname(path);
}
