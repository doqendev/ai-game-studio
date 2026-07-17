import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AppServerClient } from "./app-server-client.js";

interface HostileResult {
  environmentNames: string[];
  insideWrite: { succeeded: boolean; code?: string };
  outsideRead: { succeeded: boolean; bytes?: number; code?: string };
  outsideWrite: { succeeded: boolean; code?: string };
  junctionEscapeWrite: { succeeded: boolean; code?: string };
  childOutsideWrite: { exitCode: number | null; signal: string | null; errorCode: string | null; stderrBytes: number };
  localNetwork: { succeeded: boolean; outcome: string };
  publicNetwork: { succeeded: boolean; outcome: string };
}

const priorRunRoot = resolve(requiredArgument(2, "prior Gate 0 run root"));
const setupRoot = resolve(requiredArgument(3, "passing sandbox setup evidence root"));
const setupReport = JSON.parse(readFileSync(join(setupRoot, "windows-sandbox-setup-report.json"), "utf8")) as {
  pass?: boolean;
  finalReadiness?: { status?: string };
};
if (setupReport.pass !== true || setupReport.finalReadiness?.status !== "ready") {
  throw new Error("PASSING_SETUP_EVIDENCE_REQUIRED");
}

const environment = JSON.parse(readFileSync(join(priorRunRoot, "environment.json"), "utf8")) as {
  codex: { pinnedBinary: { path: string; sha256?: string } };
};
const gate0Root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outputRoot = join(setupRoot, `${timestamp()}-${randomUUID()}-containment-repeat`);
const codexHome = join(setupRoot, "codex-home");
const attemptRoot = join(outputRoot, "attempt-root");
const outsideRoot = join(outputRoot, "outside-attempt-root");
const reportPath = join(outputRoot, "sandbox-containment-repeat-report.json");
const hostileScript = join(gate0Root, "fixtures", "hostile-sandbox-probe.mjs");
const supervisorPath = join(gate0Root, "build", "native", "JobSupervisor.exe");

mkdirSync(attemptRoot, { recursive: true });
mkdirSync(outsideRoot, { recursive: true });

const outsideSentinel = join(outsideRoot, "sentinel.txt");
const outsideWrite = join(outsideRoot, "forbidden-write.txt");
const junctionRoot = join(attemptRoot, "junction-to-outside");
writeFileSync(outsideSentinel, "outside-sentinel-must-not-change", "utf8");
symlinkSync(outsideRoot, junctionRoot, "junction");

const report: Record<string, unknown> = {
  schemaVersion: 1,
  stage: "Gate 0B named repeat",
  startedAt: new Date().toISOString(),
  outputRoot,
  priorSetupEvidence: setupRoot,
  codex: {
    path: environment.codex.pinnedBinary.path,
    sha256: environment.codex.pinnedBinary.sha256 ?? sha256(environment.codex.pinnedBinary.path),
  },
  productImplementationStarted: false,
  godotStarted: false,
  gate0cStarted: false,
  currentVersionChanged: false,
  automaticReplayCount: 0,
  hostileCommandRequestCount: 0,
  hostileCommandExecutionCount: 0,
  commandOutputContainment: {
    appServerFrameBytes: 1 * 1024 * 1024,
    appServerTotalBytes: 8 * 1024 * 1024,
    appServerStderrBytes: 1 * 1024 * 1024,
    customCommandOutputBytesCap: "unsupported by pinned Codex 0.144.5 with Windows sandbox",
  },
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
  jobMemoryMiB: 2_048,
  processTimeoutMs: 90_000,
  requestTimeoutMs: 30_000,
  limits: {
    frameBytes: 1 * 1024 * 1024,
    totalBytes: 8 * 1024 * 1024,
    totalMessages: 10_000,
    messagesPerWindow: 1_250,
    rateWindowMs: 5_000,
    stderrBytes: 1 * 1024 * 1024,
  },
});

try {
  const guard = testFailClosedGuard();
  report.failClosedGuard = guard;
  if (!guard.pass) throw new Error("FAIL_CLOSED_GUARD_TEST_FAILED");
  persist();

  client.start();
  report.initialize = await client.initialize();
  const readiness = await client.requestUnchecked("windowsSandbox/readiness", {});
  report.readiness = readiness;
  report.readinessEvidence = client.evidence();
  persist();
  requireReady(readiness);
  report.bSandbox01 = { pass: true, readiness, hostileCommandCountAtDecision: 0 };
  persist();

  const listenerConnections: Array<{ remoteAddress?: string; at: string }> = [];
  const listener = createServer((socket) => {
    listenerConnections.push({ ...(socket.remoteAddress ? { remoteAddress: socket.remoteAddress } : {}), at: new Date().toISOString() });
    socket.destroy();
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    listener.once("error", rejectListen);
    listener.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = listener.address();
  if (!address || typeof address === "string") throw new Error("LOCAL_SENTINEL_PORT_UNAVAILABLE");

  const sentinelBefore = sha256(outsideSentinel);
  const resultPath = join(attemptRoot, "hostile-result.json");
  const insidePath = join(attemptRoot, "allowed-write.txt");
  const junctionWrite = join(junctionRoot, "junction-forbidden-write.txt");
  let command: unknown;
  report.hostileCommandRequestCount = 1;
  report.hostileCommandStartedAt = new Date().toISOString();
  persist();
  try {
    command = await client.requestUnchecked("command/exec", {
      command: [process.execPath, hostileScript, resultPath, insidePath, outsideWrite, outsideSentinel, junctionWrite, String(address.port)],
      cwd: attemptRoot,
      timeoutMs: 20_000,
      sandboxPolicy: {
        type: "workspaceWrite",
        writableRoots: [attemptRoot],
        networkAccess: false,
        excludeTmpdirEnvVar: true,
        excludeSlashTmp: true,
      },
    });
  } finally {
    await new Promise<void>((resolveClose) => listener.close(() => resolveClose()));
  }

  const hostile = JSON.parse(readFileSync(resultPath, "utf8")) as HostileResult;
  report.hostileCommandExecutionCount = 1;
  const sentinelAfter = sha256(outsideSentinel);
  const suspiciousEnvironmentNames = hostile.environmentNames.filter((name) => /TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE/iu.test(name));
  const assertions = {
    insideWriteSucceeded: hostile.insideWrite.succeeded,
    directSiblingWriteBlocked: !hostile.outsideWrite.succeeded,
    junctionWriteBlocked: !hostile.junctionEscapeWrite.succeeded,
    childOutsideWriteBlocked: hostile.childOutsideWrite.exitCode !== 0,
    localNetworkBlocked: !hostile.localNetwork.succeeded && listenerConnections.length === 0,
    publicNetworkBlocked: !hostile.publicNetwork.succeeded,
    outsideSentinelUnchanged: sentinelBefore === sentinelAfter,
    sensitiveEnvironmentNamesAbsent: suspiciousEnvironmentNames.length === 0,
  };
  const pass = Object.values(assertions).every(Boolean);
  report.bSandbox02 = {
    pass,
    assertions,
    command,
    hostile,
    listenerConnections,
    sentinel: { before: sentinelBefore, after: sentinelAfter },
    outsideFiles: describeFiles(outsideRoot),
    outsideReadWasAllowed: hostile.outsideRead.succeeded,
    confidentialityBoundaryProven: false,
    suspiciousEnvironmentNames,
  };
  report.finalEvidence = client.evidence();
  report.completedAt = new Date().toISOString();
  report.pass = pass;
  if (!pass) {
    report.failure = "HOSTILE_CONTAINMENT_ASSERTION_FAILED";
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

function testFailClosedGuard(): { pass: boolean; rejectedStatus: string; commandStarted: boolean; error: string | null } {
  let commandStarted = false;
  let error: string | null = null;
  try {
    requireReady({ status: "notConfigured" });
    commandStarted = true;
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  return {
    pass: !commandStarted && error === "WINDOWS_SANDBOX_NOT_READY status=notConfigured",
    rejectedStatus: "notConfigured",
    commandStarted,
    error,
  };
}

function requireReady(value: unknown): void {
  const status = value && typeof value === "object" ? (value as { status?: unknown }).status : undefined;
  if (status !== "ready") throw new Error(`WINDOWS_SANDBOX_NOT_READY status=${String(status)}`);
}

function describeFiles(root: string): Array<{ name: string; size: number; sha256: string }> {
  return readdirSync(root)
    .filter((name) => statSync(join(root, name)).isFile())
    .sort()
    .map((name) => ({ name, size: statSync(join(root, name)).size, sha256: sha256(join(root, name)) }));
}

function persist(): void {
  const temporary = `${reportPath}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  renameSync(temporary, reportPath);
}

function safeEnvironmentToml(): string {
  const temporaryRoot = join(outputRoot, "tmp");
  const values: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
    WINDIR: process.env.WINDIR ?? "C:\\Windows",
    TEMP: temporaryRoot,
    TMP: temporaryRoot,
    USERPROFILE: codexHome,
    APPDATA: join(outputRoot, "appdata", "roaming"),
    LOCALAPPDATA: join(outputRoot, "appdata", "local"),
  };
  mkdirSync(temporaryRoot, { recursive: true });
  mkdirSync(values.APPDATA!, { recursive: true });
  mkdirSync(values.LOCALAPPDATA!, { recursive: true });
  const set = Object.entries(values).map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join(", ");
  return `{ ${set} }`;
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");
}

function requiredArgument(index: number, label: string): string {
  const value = process.argv[index];
  if (!value) throw new Error(`Missing ${label} argument.`);
  return value;
}
