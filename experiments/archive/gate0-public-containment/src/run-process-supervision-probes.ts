import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AppServerClient } from "./app-server-client.js";
import { appendEvent, loadRun, relativeEvidencePath, writeJsonAtomic } from "./evidence.js";

interface ProcessIdentity {
  role?: string;
  mode?: string;
  pid: number;
  parentPid: number;
  startedAt: string;
}

interface RunningSupervisor {
  child: ChildProcessWithoutNullStreams;
  startedAt: number;
  stderr(): string;
  stdout(): string;
  result: Promise<{ code: number | null; signal: NodeJS.Signals | null; durationMs: number }>;
}

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
const supervisorPath = join(gate0Root, "build", "native", "JobSupervisor.exe");
const treeFixture = join(gate0Root, "fixtures", "process-tree.mjs");
const ownerProxy = join(gate0Root, "fixtures", "owner-proxy.mjs");
const resourceFixture = join(gate0Root, "fixtures", "resource-exhaustion.mjs");
const evidenceRoot = join(runRoot, "process-supervision");
const reportPath = join(evidenceRoot, "process-supervision.json");
const environment = JSON.parse(readFileSync(join(runRoot, "environment.json"), "utf8")) as {
  codex: { pinnedBinary: { path: string } };
};
mkdirSync(evidenceRoot, { recursive: true });

const results: ProbeResult[] = [];
const report = {
  stage: "Gate 0A",
  category: "windows-process-supervision",
  startedAt: new Date().toISOString(),
  mechanism: {
    type: "Windows Job Object",
    createSuspendedThenAssign: true,
    killOnLastHandleClose: true,
    ownerPidMonitor: true,
    hardJobCommitLimit: true,
    terminateAtMemoryHighWaterPercent: 80,
    osHardCommitCapPercentOfDeclaredLimit: 90,
    daemonOrService: false,
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

await probe("A-PROC-01", "killing an unsupervised parent does not reliably kill descendants", async () => {
  const root = join(evidenceRoot, "baseline-parent-kill");
  freshDirectory(root);
  const parent = spawn(process.execPath, [treeFixture, "parent", root, "detached"], {
    cwd: gate0Root,
    detached: false,
    stdio: "ignore",
    windowsHide: true,
  });
  const identities = await waitForTree(root);
  parent.kill();
  await delay(500);
  const aliveAfterParentKill = {
    child: isAlive(identities.child.pid),
    grandchild: isAlive(identities.grandchild.pid),
  };
  const descendantsSurvived = aliveAfterParentKill.child || aliveAfterParentKill.grandchild;
  killIfAlive(identities.child.pid);
  killIfAlive(identities.grandchild.pid);
  await waitForGone([identities.parent.pid, identities.child.pid, identities.grandchild.pid], 5_000);
  if (!descendantsSurvived) throw new Error("Controlled baseline did not reproduce the parent-kill descendant leak.");
  return { identities, aliveAfterParentKill, parentKillLeavesDescendants: descendantsSurvived, cleanup: "explicit test cleanup completed" };
});

await probe("A-PROC-02", "closing the Job Object supervisor kills the full descendant tree", async () => {
  const root = join(evidenceRoot, "job-close-kills-tree");
  freshDirectory(root);
  const supervisor = spawnSupervisor(["--owner-pid", String(process.pid), "--memory-mib", "256", "--timeout-ms", "30000", "--working-directory", gate0Root, "--", process.execPath, treeFixture, "parent", root, "detached"]);
  const identities = await waitForTree(root);
  supervisor.child.kill();
  const exit = await withTimeout(supervisor.result, 5_000, "Supervisor did not exit after termination.");
  await waitForGone([identities.parent.pid, identities.child.pid, identities.grandchild.pid], 5_000);
  return { identities, supervisorPid: supervisor.child.pid, exit, allDescendantsGone: true, stderr: capText(supervisor.stderr()) };
});

await probe("A-PROC-03", "owner-process death is detected and kills the supervised tree", async () => {
  const root = join(evidenceRoot, "owner-death-kills-tree");
  freshDirectory(root);
  const proxyInfo = join(root, "proxy.json");
  const proxy = spawn(process.execPath, [ownerProxy, supervisorPath, gate0Root, treeFixture, root, proxyInfo], {
    cwd: gate0Root,
    detached: false,
    stdio: "ignore",
    windowsHide: true,
  });
  const identities = await waitForTree(root);
  await waitForFile(proxyInfo, 5_000);
  const proxyIdentity = JSON.parse(readFileSync(proxyInfo, "utf8")) as { proxyPid: number; supervisorPid: number; startedAt: string };
  proxy.kill();
  await waitForGone([proxyIdentity.proxyPid, proxyIdentity.supervisorPid, identities.parent.pid, identities.child.pid, identities.grandchild.pid], 7_000);
  return { proxy: proxyIdentity, identities, allProcessesGone: true };
});

await probe("A-PROC-04", "infinite high-CPU process is killed by the wall-clock limit", async () => {
  const root = join(evidenceRoot, "high-cpu-timeout");
  freshDirectory(root);
  const supervisor = spawnSupervisor(["--owner-pid", String(process.pid), "--memory-mib", "256", "--timeout-ms", "1500", "--working-directory", gate0Root, "--", process.execPath, resourceFixture, "cpu", root]);
  await waitForResourceIdentities(root, 1, 5_000);
  const exit = await withTimeout(supervisor.result, 7_000, "High-CPU supervisor did not enforce its timeout.");
  const identities = readResourceIdentities(root);
  await waitForGone(identities.map((identity) => identity.pid), 5_000);
  if (exit.code !== 124 || !supervisor.stderr().includes("reason=timeout")) {
    throw new Error(`Expected timeout exit 124; observed code=${exit.code} stderr=${capText(supervisor.stderr())}`);
  }
  return { identities, exit, allProcessesGone: true, stderr: capText(supervisor.stderr()) };
});

await probe("A-PROC-05", "aggregate process-tree memory growth triggers termination before the hard cap", async () => {
  const root = join(evidenceRoot, "memory-high-water");
  freshDirectory(root);
  const supervisor = spawnSupervisor(["--owner-pid", String(process.pid), "--memory-mib", "128", "--timeout-ms", "10000", "--working-directory", gate0Root, "--", process.execPath, resourceFixture, "memory-root", root]);
  await waitForResourceIdentities(root, 3, 5_000);
  const exit = await withTimeout(supervisor.result, 8_000, "Memory supervisor did not terminate the allocation tree.");
  const identities = readResourceIdentities(root);
  await waitForGone(identities.map((identity) => identity.pid), 5_000);
  if (exit.code !== 123 || !supervisor.stderr().includes("reason=memory-high-water")) {
    throw new Error(`Expected memory-high-water exit 123; observed code=${exit.code} stderr=${capText(supervisor.stderr())}`);
  }
  const peakMatch = /peakJobBytes=(\d+)/u.exec(supervisor.stderr());
  const declaredMatch = /declaredLimitBytes=(\d+)/u.exec(supervisor.stderr());
  const peakJobBytes = Number(peakMatch?.[1]);
  const declaredLimitBytes = Number(declaredMatch?.[1]);
  if (!Number.isFinite(peakJobBytes) || !Number.isFinite(declaredLimitBytes) || peakJobBytes >= declaredLimitBytes) {
    throw new Error(`Memory peak was not proven below the declared limit: ${capText(supervisor.stderr())}`);
  }
  return { identities, exit, peakJobBytes, declaredLimitBytes, remainedBelowDeclaredLimit: true, allProcessesGone: true, stderr: capText(supervisor.stderr()) };
});

await probe("A-PROC-06", "real App Server can spawn a controlled child inside the outer Job Object and cleanup kills it", async () => {
  const root = join(evidenceRoot, "appserver-nested-process");
  const home = join(root, "codex-home");
  freshDirectory(root);
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "config.toml"), 'cli_auth_credentials_store = "file"\n\n[analytics]\nenabled = false\n\n[feedback]\nenabled = false\n', "utf8");
  const client = new AppServerClient({
    supervisorPath,
    targetPath: environment.codex.pinnedBinary.path,
    targetArguments: ["app-server", "--stdio", "--strict-config"],
    codexHome: home,
    workingDirectory: gate0Root,
    jobMemoryMiB: 2_048,
    processTimeoutMs: 30_000,
    requestTimeoutMs: 10_000,
  });
  client.start();
  let longRequest: Promise<unknown> | undefined;
  try {
    await client.initialize();
    const short = (await client.requestUnchecked("command/exec", {
      command: [process.execPath, "-e", "process.stdout.write('job-nested-ok')"],
      cwd: gate0Root,
      timeoutMs: 5_000,
      outputBytesCap: 1_024,
      sandboxPolicy: { type: "dangerFullAccess" },
    })) as { exitCode: number; stdout: string; stderr: string };
    if (short.exitCode !== 0 || short.stdout !== "job-nested-ok") {
      throw new Error(`Controlled command/exec failed: ${JSON.stringify(short)}`);
    }
    const pidFile = join(root, "long-child.json");
    const script = "const fs=require('fs');fs.writeFileSync(process.argv[1],JSON.stringify({pid:process.pid,parentPid:process.ppid,startedAt:new Date().toISOString()}));setInterval(()=>{},1000)";
    longRequest = client.requestUnchecked("command/exec", {
      command: [process.execPath, "-e", script, pidFile],
      cwd: gate0Root,
      timeoutMs: 20_000,
      outputBytesCap: 1_024,
      sandboxPolicy: { type: "dangerFullAccess" },
    });
    void longRequest.catch(() => undefined);
    await waitForFile(pidFile, 5_000);
    const longChild = JSON.parse(readFileSync(pidFile, "utf8")) as ProcessIdentity;
    const stop = await client.stop(500);
    await waitForGone([longChild.pid], 5_000);
    return { shortCommand: short, longChild, stop, longChildGone: true, transport: client.evidence(), replayCount: 0 };
  } finally {
    await client.stop(500);
    if (longRequest) await longRequest.catch(() => undefined);
  }
});

report.pass = results.length === 6 && results.every((result) => result.pass);
writeJsonAtomic(reportPath, report);
appendEvent(runRoot, "process-supervision.completed", report.pass ? "pass" : "fail", {
  evidence: relativeEvidencePath(runRoot, reportPath),
  passed: results.filter((result) => result.pass).length,
  failed: results.filter((result) => !result.pass).map((result) => result.id),
});
if (!report.pass) process.exitCode = 1;

function spawnSupervisor(argumentsForSupervisor: string[]): RunningSupervisor {
  const startedAt = Date.now();
  const child = spawn(supervisorPath, argumentsForSupervisor, {
    cwd: gate0Root,
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout = appendCapped(stdout, chunk.toString("utf8"));
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = appendCapped(stderr, chunk.toString("utf8"));
  });
  const result = new Promise<{ code: number | null; signal: NodeJS.Signals | null; durationMs: number }>((resolveResult, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveResult({ code, signal, durationMs: Date.now() - startedAt }));
  });
  return { child, startedAt, stderr: () => stderr, stdout: () => stdout, result };
}

async function waitForTree(root: string): Promise<{ parent: ProcessIdentity; child: ProcessIdentity; grandchild: ProcessIdentity }> {
  await Promise.all(["parent", "child", "grandchild"].map((role) => waitForFile(join(root, `${role}.json`), 5_000)));
  return {
    parent: JSON.parse(readFileSync(join(root, "parent.json"), "utf8")) as ProcessIdentity,
    child: JSON.parse(readFileSync(join(root, "child.json"), "utf8")) as ProcessIdentity,
    grandchild: JSON.parse(readFileSync(join(root, "grandchild.json"), "utf8")) as ProcessIdentity,
  };
}

async function waitForResourceIdentities(root: string, count: number, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (readResourceIdentities(root).length >= count) return;
    await delay(25);
  }
  throw new Error(`Expected ${count} resource fixture identities within ${timeoutMs} ms.`);
}

function readResourceIdentities(root: string): ProcessIdentity[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => JSON.parse(readFileSync(join(root, entry.name), "utf8")) as ProcessIdentity)
    .filter((identity) => typeof identity.pid === "number");
}

async function waitForFile(path: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      readFileSync(path);
      return;
    } catch {
      await delay(25);
    }
  }
  throw new Error(`Timed out waiting for fixture evidence: ${path}`);
}

async function waitForGone(pids: number[], timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (pids.every((pid) => !isAlive(pid))) return;
    await delay(50);
  }
  throw new Error(`Processes remained after cleanup: ${pids.filter(isAlive).join(",")}`);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killIfAlive(pid: number): void {
  if (!isAlive(pid)) return;
  try {
    process.kill(pid);
  } catch {
    // A concurrent exit is acceptable.
  }
}

function appendCapped(existing: string, addition: string): string {
  const combined = existing + addition;
  if (combined.length <= 8 * 1024 * 1024) return combined;
  throw new Error("PROCESS_STREAM_LIMIT limit=8388608");
}

function freshDirectory(path: string): void {
  const resolvedPath = resolve(path);
  const resolvedEvidenceRoot = resolve(evidenceRoot);
  if (!resolvedPath.toLowerCase().startsWith(resolvedEvidenceRoot.toLowerCase() + "\\")) {
    throw new Error(`Refusing to replace a directory outside process-supervision evidence: ${resolvedPath}`);
  }
  rmSync(resolvedPath, { recursive: true, force: true });
  mkdirSync(resolvedPath, { recursive: true });
}

function capText(value: string): string {
  return value.length <= 8_192 ? value : `${value.slice(0, 4_096)}…${value.slice(-4_096)}`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return Promise.race([promise, delay(timeoutMs).then(() => Promise.reject(new Error(message)))]);
}

function requiredArgument(index: number, label: string): string {
  const value = process.argv[index];
  if (!value) throw new Error(`Missing ${label} argument.`);
  return value;
}
