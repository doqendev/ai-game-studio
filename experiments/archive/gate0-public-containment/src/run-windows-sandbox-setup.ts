import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AppServerClient } from "./app-server-client.js";

interface ClientEvidence {
  transcript: Array<{
    direction: string;
    kind: string;
    method?: string;
    payload?: unknown;
  }>;
}

const priorRunRoot = resolve(requiredArgument(2, "prior Gate 0 run root"));
const priorEnvironment = JSON.parse(readFileSync(join(priorRunRoot, "environment.json"), "utf8")) as {
  codex: { pinnedBinary: { path: string; sha256?: string } };
};
const gate0Root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outputRoot = join(
  process.env.LOCALAPPDATA ?? "C:\\Users\\Public",
  "AI Game Studio",
  "Gate0",
  "repeats",
  `${timestamp()}-${randomUUID()}-windows-sandbox-setup`,
);
const codexHome = join(outputRoot, "codex-home");
const attemptRoot = join(outputRoot, "attempt-root");
const reportPath = join(outputRoot, "windows-sandbox-setup-report.json");
const supervisorPath = join(gate0Root, "build", "native", "JobSupervisor.exe");

mkdirSync(codexHome, { recursive: true });
mkdirSync(attemptRoot, { recursive: true });
writeFileSync(join(codexHome, "config.toml"), makeConfig(), "utf8");

const report: Record<string, unknown> = {
  schemaVersion: 1,
  probe: "B-SANDBOX-01-SETUP-REPEAT",
  startedAt: new Date().toISOString(),
  outputRoot,
  codex: {
    path: priorEnvironment.codex.pinnedBinary.path,
    sha256: priorEnvironment.codex.pinnedBinary.sha256 ?? sha256(priorEnvironment.codex.pinnedBinary.path),
  },
  setupRequested: false,
  currentVersionChanged: false,
  productImplementationStarted: false,
  hostileCommandExecuted: false,
  godotStarted: false,
};
persist();

const client = new AppServerClient({
  supervisorPath,
  targetPath: priorEnvironment.codex.pinnedBinary.path,
  targetArguments: ["app-server", "--stdio", "--strict-config"],
  codexHome,
  workingDirectory: gate0Root,
  jobMemoryMiB: 2_048,
  processTimeoutMs: 90_000,
  requestTimeoutMs: 60_000,
});

try {
  client.start();
  report.initialize = await client.initialize();
  const initial = await client.requestUnchecked("windowsSandbox/readiness", {});
  report.initialReadiness = initial;
  report.initialEvidence = client.evidence();
  persist();

  report.setupRequested = true;
  report.setupRequestAt = new Date().toISOString();
  persist();
  const setupStartResponse = await client.requestUnchecked("windowsSandbox/setupStart", {
    mode: "elevated",
    cwd: attemptRoot,
  });
  report.setupStartResponse = setupStartResponse ?? null;
  report.setupStartResponseAt = new Date().toISOString();
  report.evidenceImmediatelyAfterSetupStartResponse = client.evidence();
  persist();

  const deadline = Date.now() + 55_000;
  let completion: unknown = null;
  let readiness: unknown = initial;
  const readinessPolls: Array<{ at: string; value: unknown }> = [];
  while (Date.now() < deadline) {
    const evidence = client.evidence() as ClientEvidence;
    completion = evidence.transcript.find(
      (entry) => entry.direction === "server-to-client" && entry.method === "windowsSandbox/setupCompleted",
    ) ?? null;
    readiness = await client.requestUnchecked("windowsSandbox/readiness", {});
    readinessPolls.push({ at: new Date().toISOString(), value: readiness });
    report.completionNotification = completion;
    report.readinessPolls = readinessPolls;
    report.latestEvidence = client.evidence();
    persist();
    if (completion && isReady(readiness)) break;
    await delay(1_000);
  }

  report.completedAt = new Date().toISOString();
  report.completionNotification = completion;
  report.finalReadiness = readiness;
  report.finalEvidence = client.evidence();
  report.pass = Boolean(completion) && isSuccessfulCompletion(completion) && isReady(readiness);
  if (!report.pass) {
    report.failure = "SETUP_NOT_PROVEN completion notification and readiness=ready are both required";
    process.exitCode = 1;
  }
  persist();
} catch (error) {
  report.completedAt = new Date().toISOString();
  report.pass = false;
  report.failure = error instanceof Error ? error.message : String(error);
  report.finalEvidence = client.evidence();
  persist();
  process.exitCode = 1;
} finally {
  report.processStop = await client.stop();
  report.stoppedAt = new Date().toISOString();
  report.finalEvidenceAfterStop = client.evidence();
  persist();
  process.stdout.write(`${JSON.stringify({ outputRoot, reportPath, pass: report.pass }, null, 2)}\n`);
}

function isReady(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && (value as { status?: unknown }).status === "ready");
}

function isSuccessfulCompletion(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const payload = (value as { payload?: { params?: { success?: unknown } } }).payload;
  return payload?.params?.success === true;
}

function persist(): void {
  const temporary = `${reportPath}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  renameSync(temporary, reportPath);
}

function makeConfig(): string {
  return [
    'cli_auth_credentials_store = "file"',
    "",
    "[analytics]",
    "enabled = false",
    "",
    "[feedback]",
    "enabled = false",
    "",
    "[windows]",
    'sandbox = "elevated"',
    "",
  ].join("\n");
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function requiredArgument(index: number, label: string): string {
  const value = process.argv[index];
  if (!value) throw new Error(`Missing ${label} argument.`);
  return value;
}
