import { randomBytes, randomUUID } from "node:crypto";
import { createSocket, type Socket as DatagramSocket } from "node:dgram";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AppServerClient } from "./app-server-client.js";

interface Endpoint {
  name: string;
  transport: "tcp" | "udp";
  family: "ipv4" | "ipv6";
  host: string;
  port: number;
  nonce: string;
}

const priorRunRoot = resolve(requiredArgument(2, "prior Gate 0 run root"));
const setupRoot = resolve(requiredArgument(3, "passing setup evidence root"));
const setupReport = JSON.parse(readFileSync(join(setupRoot, "windows-sandbox-setup-report.json"), "utf8")) as { pass?: boolean };
if (setupReport.pass !== true) throw new Error("PASSING_SETUP_EVIDENCE_REQUIRED");
const environment = JSON.parse(readFileSync(join(priorRunRoot, "environment.json"), "utf8")) as {
  codex: { pinnedBinary: { path: string } };
};
const gate0Root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outputRoot = join(setupRoot, "diagnostics", `${timestamp()}-${randomUUID()}-loopback-matrix`);
const attemptRoot = join(outputRoot, "attempt-root");
const resultPath = join(attemptRoot, "loopback-matrix-result.json");
const reportPath = join(outputRoot, "loopback-network-matrix-report.json");
const codexHome = join(setupRoot, "codex-home");
const supervisorPath = join(gate0Root, "build", "native", "JobSupervisor.exe");
const probeScript = join(gate0Root, "fixtures", "loopback-network-probe.mjs");
mkdirSync(attemptRoot, { recursive: true });

const report: Record<string, unknown> = {
  schemaVersion: 1,
  probe: "B-NET-LOOPBACK-01",
  startedAt: new Date().toISOString(),
  correctionApplied: false,
  correctionReason: "Existing Codex rules already match intended SID and loopback scope; no evidence supports duplicating them. Custom WFP enforcement is a material architecture expansion.",
  targetScope: "app-owned IPv4/IPv6 TCP/UDP loopback sentinels only",
  publicNetworkAttempted: false,
  outsideWriteAttempted: false,
  automaticReplayCount: 0,
  commandExecutionCount: 0,
  godotStarted: false,
  gate0cStarted: false,
  productImplementationStarted: false,
  currentVersionChanged: false,
};
persist();

const observations: Array<{ endpoint: string; at: string; remoteAddress?: string; remotePort?: number; bytes?: number }> = [];
const resources: Array<Server | DatagramSocket> = [];
const fixtureErrors: string[] = [];
const endpoints: Endpoint[] = [];
await addTcp("tcp-ipv4", "ipv4", "127.0.0.1");
await addTcp("tcp-ipv6", "ipv6", "::1");
await addUdp("udp-ipv4", "ipv4", "127.0.0.1");
await addUdp("udp-ipv6", "ipv6", "::1");
report.fixture = { endpoints, errors: fixtureErrors };
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
  processTimeoutMs: 45_000,
  requestTimeoutMs: 20_000,
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
  if (fixtureErrors.length !== 0 || endpoints.length !== 4) throw new Error(`LOOPBACK_FIXTURE_INCOMPLETE ${fixtureErrors.join(" | ")}`);
  client.start();
  report.initialize = await client.initialize();
  report.readiness = await client.requestUnchecked("windowsSandbox/readiness", {});
  if ((report.readiness as { status?: unknown }).status !== "ready") {
    throw new Error(`WINDOWS_SANDBOX_NOT_READY status=${String((report.readiness as { status?: unknown }).status)}`);
  }
  const configuration = Buffer.from(JSON.stringify({ endpoints }), "utf8").toString("base64url");
  report.commandExecutionCount = 1;
  report.command = await client.requestUnchecked("command/exec", {
    command: [process.execPath, probeScript, resultPath, configuration],
    cwd: attemptRoot,
    timeoutMs: 15_000,
    sandboxPolicy: {
      type: "workspaceWrite",
      writableRoots: [attemptRoot],
      networkAccess: false,
      excludeTmpdirEnvVar: true,
      excludeSlashTmp: true,
    },
  });
  const result = JSON.parse(readFileSync(resultPath, "utf8")) as { results: Array<Endpoint & { succeeded: boolean; outcome: string }> };
  const assertions = Object.fromEntries(
    endpoints.map((endpoint) => {
      const clientResult = result.results.find((item) => item.name === endpoint.name);
      const serverObserved = observations.some((item) => item.endpoint === endpoint.name);
      return [endpoint.name, { blocked: clientResult?.succeeded === false && !serverObserved, clientResult, serverObserved }];
    }),
  );
  const pass = Object.values(assertions).every((assertion) => assertion.blocked);
  report.result = result;
  report.serverObservations = observations;
  report.assertions = assertions;
  report.pass = pass;
  report.completedAt = new Date().toISOString();
  report.evidence = client.evidence();
  if (!pass) {
    report.failure = "LOOPBACK_NETWORK_CONTAINMENT_FAILED";
    process.exitCode = 1;
  }
  persist();
} catch (error) {
  report.pass = false;
  report.failure = error instanceof Error ? error.message : String(error);
  report.completedAt = new Date().toISOString();
  report.serverObservations = observations;
  report.evidence = client.evidence();
  persist();
  process.exitCode = 1;
} finally {
  report.processStop = await client.stop();
  for (const resource of resources.reverse()) await closeResource(resource);
  report.stoppedAt = new Date().toISOString();
  report.evidenceAfterStop = client.evidence();
  persist();
  process.stdout.write(`${JSON.stringify({ outputRoot, reportPath, pass: report.pass }, null, 2)}\n`);
}

async function addTcp(name: string, family: "ipv4" | "ipv6", host: string): Promise<void> {
  try {
    const server = createServer((socket) => {
      observations.push({ endpoint: name, at: new Date().toISOString(), ...(socket.remoteAddress ? { remoteAddress: socket.remoteAddress } : {}), ...(socket.remotePort ? { remotePort: socket.remotePort } : {}) });
      socket.destroy();
    });
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once("error", rejectListen);
      server.listen({ host, port: 0, ipv6Only: family === "ipv6" }, () => resolveListen());
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("TCP fixture did not expose a port.");
    resources.push(server);
    endpoints.push({ name, transport: "tcp", family, host, port: address.port, nonce: randomBytes(12).toString("hex") });
  } catch (error) {
    fixtureErrors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function addUdp(name: string, family: "ipv4" | "ipv6", host: string): Promise<void> {
  try {
    const socket = createSocket(family === "ipv6" ? "udp6" : "udp4");
    socket.on("message", (message, remote) => {
      observations.push({ endpoint: name, at: new Date().toISOString(), remoteAddress: remote.address, remotePort: remote.port, bytes: message.length });
      socket.send(message, remote.port, remote.address);
    });
    await new Promise<void>((resolveBind, rejectBind) => {
      socket.once("error", rejectBind);
      socket.bind({ address: host, port: 0 }, () => resolveBind());
    });
    const address = socket.address();
    resources.push(socket);
    endpoints.push({ name, transport: "udp", family, host, port: address.port, nonce: randomBytes(12).toString("hex") });
  } catch (error) {
    fixtureErrors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function closeResource(resource: Server | DatagramSocket): Promise<void> {
  return new Promise((resolveClose) => resource.close(() => resolveClose()));
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
