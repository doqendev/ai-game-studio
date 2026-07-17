import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AppServerClient } from "./app-server-client.js";
import { appendEvent, loadRun, relativeEvidencePath, writeJsonAtomic } from "./evidence.js";
import { buildSourceManifest, copySnapshot } from "./snapshot-store.js";

interface ProbeResult {
  id: string;
  name: string;
  startedAt: string;
  completedAt: string;
  pass: boolean;
  observation: unknown;
}

interface HostileResult {
  pid: number;
  parentPid: number;
  environmentNames: string[];
  insideWrite: { succeeded: boolean; code?: string };
  outsideRead: { succeeded: boolean; bytes?: number; code?: string };
  outsideWrite: { succeeded: boolean; code?: string };
  junctionEscapeWrite: { succeeded: boolean; code?: string };
  childOutsideWrite: { exitCode: number | null; signal: string | null; errorCode: string | null; stderrBytes: number };
  localNetwork: { succeeded: boolean; outcome: string };
  publicNetwork: { succeeded: boolean; outcome: string };
}

const runRoot = resolve(requiredArgument(2, "run root"));
loadRun(runRoot);
const gate0Root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixtureRoot = join(gate0Root, "fixtures", "godot-collect-one");
const hostileScript = join(gate0Root, "fixtures", "hostile-sandbox-probe.mjs");
const supervisorPath = join(gate0Root, "build", "native", "JobSupervisor.exe");
const environment = JSON.parse(readFileSync(join(runRoot, "environment.json"), "utf8")) as {
  codex: { pinnedBinary: { path: string } };
};
const evidenceRoot = join(runRoot, "gate0b", "sandbox");
const reportPath = join(evidenceRoot, "sandbox-report.json");
const codexHome = join(evidenceRoot, "codex-home");
const attemptRoot = join(evidenceRoot, "attempt-root");
const outsideRoot = join(evidenceRoot, "outside-attempt-root");
freshDirectory(evidenceRoot);
mkdirSync(codexHome, { recursive: true });
mkdirSync(attemptRoot, { recursive: true });
mkdirSync(outsideRoot, { recursive: true });

writeFileSync(join(codexHome, "config.toml"), makeConfig(), "utf8");
const outsideSentinel = join(outsideRoot, "sentinel.txt");
writeFileSync(outsideSentinel, "outside-sentinel-must-not-change", "utf8");
const outsideWrite = join(outsideRoot, "forbidden-write.txt");
const junctionRoot = join(attemptRoot, "junction-to-outside");
symlinkSync(outsideRoot, junctionRoot, "junction");

const results: ProbeResult[] = [];
let sandboxReadiness: unknown;
const report = {
  stage: "Gate 0B",
  category: "builder-and-command-sandbox-containment",
  startedAt: new Date().toISOString(),
  realBuilderTurnExecuted: false,
  note: "This stage uses app-owned command/exec hostile sentinels. The one real Builder turn is reserved for Gate 0C.",
  results,
  pass: false,
};
writeJsonAtomic(reportPath, report);

const client = new AppServerClient({
  supervisorPath,
  targetPath: environment.codex.pinnedBinary.path,
  targetArguments: ["app-server", "--stdio", "--strict-config"],
  codexHome,
  workingDirectory: gate0Root,
  jobMemoryMiB: 2_048,
  processTimeoutMs: 180_000,
  requestTimeoutMs: 90_000,
});
client.start();

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

try {
  await probe("B-SANDBOX-01", "App Server reports Windows sandbox readiness", async () => {
    await client.initialize();
    const initial = (await client.requestUnchecked("windowsSandbox/readiness", {})) as { status: string };
    let setup: unknown = null;
    if (initial.status !== "ready") {
      appendEvent(runRoot, "sandbox.elevated-setup.started", "running", { initialStatus: initial.status });
      setup = await client.requestUnchecked("windowsSandbox/setupStart", { mode: "elevated", cwd: attemptRoot });
      const startedAt = Date.now();
      while (Date.now() - startedAt < 90_000) {
        const current = (await client.requestUnchecked("windowsSandbox/readiness", {})) as { status: string };
        if (current.status === "ready") break;
        await delay(1_000);
      }
    }
    const final = (await client.requestUnchecked("windowsSandbox/readiness", {})) as { status: string };
    if (final.status !== "ready") throw new Error(`WINDOWS_SANDBOX_NOT_READY status=${final.status}`);
    sandboxReadiness = { initial, setup, final, modeReportedByReadinessApi: false };
    return sandboxReadiness;
  });

  await probe("B-SANDBOX-02", "workspace-write permits only the attempt root and blocks direct, child, junction, and network escape", async () => {
    const listenerConnections: Array<{ remoteAddress?: string; at: string }> = [];
    const listener = createServer((socket) => {
      listenerConnections.push({ ...(socket.remoteAddress ? { remoteAddress: socket.remoteAddress } : {}), at: new Date().toISOString() });
      socket.destroy();
    });
    await new Promise<void>((resolveListen, reject) => {
      listener.once("error", reject);
      listener.listen(0, "127.0.0.1", () => resolveListen());
    });
    const address = listener.address();
    if (!address || typeof address === "string") throw new Error("Local sentinel listener did not expose a TCP port.");

    const sentinelBefore = sha256(outsideSentinel);
    const resultPath = join(attemptRoot, "hostile-result.json");
    const insidePath = join(attemptRoot, "allowed-write.txt");
    const junctionWrite = join(junctionRoot, "junction-forbidden-write.txt");
    let command: unknown;
    try {
      command = await client.requestUnchecked("command/exec", {
        command: [process.execPath, hostileScript, resultPath, insidePath, outsideWrite, outsideSentinel, junctionWrite, String(address.port)],
        cwd: attemptRoot,
        timeoutMs: 20_000,
        outputBytesCap: 64 * 1024,
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
    const sentinelAfter = sha256(outsideSentinel);
    const suspiciousEnvironmentNames = hostile.environmentNames.filter((name) => /TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE/iu.test(name));
    if (!hostile.insideWrite.succeeded) throw new Error(`Allowed attempt write failed: ${JSON.stringify(hostile.insideWrite)}`);
    if (hostile.outsideWrite.succeeded) throw new Error("Direct sibling write escaped the sandbox.");
    if (hostile.junctionEscapeWrite.succeeded) throw new Error("Junction write escaped the sandbox.");
    if (hostile.childOutsideWrite.exitCode === 0) throw new Error("Spawned child wrote outside the sandbox.");
    if (hostile.localNetwork.succeeded || listenerConnections.length !== 0) throw new Error("Sandboxed command reached the local network sentinel.");
    if (hostile.publicNetwork.succeeded) throw new Error("Sandboxed command reached a public host.");
    if (sentinelBefore !== sentinelAfter) throw new Error("Outside sentinel hash changed.");
    if (suspiciousEnvironmentNames.length !== 0) throw new Error(`Sensitive environment names reached the child: ${suspiciousEnvironmentNames.join(",")}`);
    return {
      command,
      hostile,
      outsideSentinel: { before: sentinelBefore, after: sentinelAfter, unchanged: true },
      listenerConnections,
      effectiveWriteContainment: true,
      effectiveNetworkContainment: true,
      outsideReadWasAllowed: hostile.outsideRead.succeeded,
      confidentialityBoundary: false,
      suspiciousEnvironmentNames,
    };
  });

  await probe("B-SANDBOX-03", "static project validation blocks active or native Godot capabilities before execution", async () => {
    const cases = [
      { name: "tool-script", path: "scripts/hostile.gd", content: "@tool\nextends Node\n" },
      { name: "os-execute", path: "scripts/hostile.gd", content: "extends Node\nfunc x(): OS.execute('cmd.exe', [])\n" },
      { name: "native-extension", path: "addons/hostile.gdextension", content: "[configuration]\nentry_symbol='x'\n" },
      { name: "native-binary", path: "addons/hostile.dll", content: "not-a-real-dll" },
    ];
    const observations: Array<{ name: string; rejection: string }> = [];
    for (const hostileCase of cases) {
      const root = join(evidenceRoot, "static-rejections", hostileCase.name);
      copySnapshot(fixtureRoot, root);
      const target = join(root, ...hostileCase.path.split("/"));
      mkdirSync(resolve(target, ".."), { recursive: true });
      writeFileSync(target, hostileCase.content, "utf8");
      const rejection = validateGodotProject(root);
      if (!rejection) throw new Error(`Dangerous case was not rejected: ${hostileCase.name}`);
      observations.push({ name: hostileCase.name, rejection });
    }
    return { observations, godotProcessesStarted: 0 };
  });
} finally {
  await client.stop();
}

report.pass = results.length === 3 && results.every((result) => result.pass);
writeJsonAtomic(reportPath, report);
appendEvent(runRoot, "sandbox-containment.completed", report.pass ? "pass" : "fail", {
  evidence: relativeEvidencePath(runRoot, reportPath),
  passed: results.filter((result) => result.pass).length,
  failed: results.filter((result) => !result.pass).map((result) => result.id),
});
if (!report.pass) process.exitCode = 1;

function validateGodotProject(root: string): string | null {
  try {
    const manifest = buildSourceManifest(root);
    const forbiddenPatterns = [
      { pattern: /@tool\b/u, label: "FORBIDDEN_TOOL_SCRIPT" },
      { pattern: /\bOS\.(execute|create_process|create_instance)\s*\(/u, label: "FORBIDDEN_OS_PROCESS_API" },
      { pattern: /\b(FileAccess|DirAccess|HTTPClient|HTTPRequest|TCPServer|WebSocketPeer)\b/u, label: "FORBIDDEN_ACTIVE_API" },
    ];
    for (const entry of manifest.entries.filter((item) => item.path.endsWith(".gd"))) {
      if (entry.path === "tests/scenario_runner.gd") continue;
      const content = readFileSync(join(root, ...entry.path.split("/")), "utf8");
      for (const forbidden of forbiddenPatterns) if (forbidden.pattern.test(content)) return `${forbidden.label} ${entry.path}`;
    }
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function makeConfig(): string {
  const values: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
    WINDIR: process.env.WINDIR ?? "C:\\Windows",
    TEMP: process.env.TEMP ?? join(evidenceRoot, "tmp"),
    TMP: process.env.TMP ?? join(evidenceRoot, "tmp"),
    USERPROFILE: process.env.USERPROFILE ?? "",
    APPDATA: process.env.APPDATA ?? "",
    LOCALAPPDATA: process.env.LOCALAPPDATA ?? "",
  };
  const set = Object.entries(values).map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join(", ");
  return `cli_auth_credentials_store = "file"\n\n[analytics]\nenabled = false\n\n[feedback]\nenabled = false\n\n[shell_environment_policy]\ninherit = "none"\nignore_default_excludes = false\nset = { ${set} }\n`;
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function freshDirectory(path: string): void {
  const resolvedPath = resolve(path);
  const resolvedRunRoot = resolve(runRoot);
  if (!resolvedPath.toLowerCase().startsWith(resolvedRunRoot.toLowerCase() + "\\")) throw new Error(`Refusing to replace outside run root: ${resolvedPath}`);
  rmSync(resolvedPath, { recursive: true, force: true });
  mkdirSync(resolvedPath, { recursive: true });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function requiredArgument(index: number, label: string): string {
  const value = process.argv[index];
  if (!value) throw new Error(`Missing ${label} argument.`);
  return value;
}

