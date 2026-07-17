import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AppServerClient } from "./app-server-client.js";

const priorRunRoot = resolve(requiredArgument(2, "prior Gate 0 run root"));
const setupRoot = resolve(requiredArgument(3, "passing setup evidence root"));
const setupReport = JSON.parse(readFileSync(join(setupRoot, "windows-sandbox-setup-report.json"), "utf8")) as {
  pass?: boolean;
};
if (setupReport.pass !== true) throw new Error("PASSING_SETUP_EVIDENCE_REQUIRED");
const environment = JSON.parse(readFileSync(join(priorRunRoot, "environment.json"), "utf8")) as {
  codex: { pinnedBinary: { path: string } };
};
const gate0Root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outputRoot = join(setupRoot, "diagnostics", `${timestamp()}-${randomUUID()}-sandbox-identity`);
const attemptRoot = join(outputRoot, "attempt-root");
const resultPath = join(attemptRoot, "sandbox-identity.json");
const reportPath = join(outputRoot, "sandbox-identity-diagnostic-report.json");
const codexHome = join(setupRoot, "codex-home");
const supervisorPath = join(gate0Root, "build", "native", "JobSupervisor.exe");
const identityScript = join(gate0Root, "fixtures", "sandbox-identity-probe.mjs");
mkdirSync(attemptRoot, { recursive: true });

const report: Record<string, unknown> = {
  schemaVersion: 1,
  probe: "B-NET-LOOPBACK-IDENTITY",
  startedAt: new Date().toISOString(),
  setupRequested: false,
  networkAttempted: false,
  outsideWriteAttempted: false,
  godotStarted: false,
  productImplementationStarted: false,
};
persist();

const client = new AppServerClient({
  supervisorPath,
  targetPath: environment.codex.pinnedBinary.path,
  targetArguments: [
    "app-server",
    "--stdio",
    "--strict-config",
    "-c",
    'shell_environment_policy.inherit="none"',
    "-c",
    `shell_environment_policy.set=${safeEnvironmentToml()}`,
  ],
  codexHome,
  workingDirectory: gate0Root,
  jobMemoryMiB: 512,
  processTimeoutMs: 30_000,
  requestTimeoutMs: 15_000,
  limits: {
    frameBytes: 256 * 1024,
    totalBytes: 2 * 1024 * 1024,
    totalMessages: 2_000,
    messagesPerWindow: 1_000,
    rateWindowMs: 5_000,
    stderrBytes: 512 * 1024,
  },
});

try {
  client.start();
  report.initialize = await client.initialize();
  report.readiness = await client.requestUnchecked("windowsSandbox/readiness", {});
  if ((report.readiness as { status?: unknown }).status !== "ready") {
    throw new Error(`WINDOWS_SANDBOX_NOT_READY status=${String((report.readiness as { status?: unknown }).status)}`);
  }
  report.command = await client.requestUnchecked("command/exec", {
    command: [process.execPath, identityScript, resultPath],
    cwd: attemptRoot,
    timeoutMs: 10_000,
    sandboxPolicy: {
      type: "workspaceWrite",
      writableRoots: [attemptRoot],
      networkAccess: false,
      excludeTmpdirEnvVar: true,
      excludeSlashTmp: true,
    },
  });
  report.identity = JSON.parse(readFileSync(resultPath, "utf8"));
  report.pass = true;
  report.completedAt = new Date().toISOString();
  report.evidence = client.evidence();
  persist();
} catch (error) {
  report.pass = false;
  report.failure = error instanceof Error ? error.message : String(error);
  report.completedAt = new Date().toISOString();
  report.evidence = client.evidence();
  persist();
  process.exitCode = 1;
} finally {
  report.processStop = await client.stop();
  report.stoppedAt = new Date().toISOString();
  report.evidenceAfterStop = client.evidence();
  persist();
  process.stdout.write(`${JSON.stringify({ outputRoot, reportPath, pass: report.pass }, null, 2)}\n`);
}

function safeEnvironmentToml(): string {
  const values: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
    WINDIR: process.env.WINDIR ?? "C:\\Windows",
    TEMP: attemptRoot,
    TMP: attemptRoot,
    USERPROFILE: codexHome,
    APPDATA: attemptRoot,
    LOCALAPPDATA: attemptRoot,
  };
  return `{ ${Object.entries(values).map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join(", ")} }`;
}

function persist(): void {
  const temporary = `${reportPath}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  renameSync(temporary, reportPath);
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");
}

function requiredArgument(index: number, label: string): string {
  const value = process.argv[index];
  if (!value) throw new Error(`Missing ${label} argument.`);
  return value;
}
