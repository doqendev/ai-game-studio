import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AppServerClient, PRODUCT_METHOD_ALLOWLIST, RpcRemoteError, verifyCodexPin } from "./app-server-client.js";
import { appendEvent, loadRun, relativeEvidencePath, writeJsonAtomic } from "./evidence.js";

interface ProbeResult {
  id: string;
  name: string;
  startedAt: string;
  completedAt: string;
  pass: boolean;
  observation: unknown;
}

const runRoot = resolve(requiredArgument(2, "run root"));
const gate0Root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const environment = JSON.parse(readFileSync(join(runRoot, "environment.json"), "utf8")) as {
  codex: {
    pinnedBinary: { path: string; sha256: string };
    globalBinary: { path: string; sha256: string };
  };
};
loadRun(runRoot);

const supervisorPath = join(gate0Root, "build", "native", "JobSupervisor.exe");
const reportPath = join(runRoot, "protocol", "protocol-compatibility.json");
const codexHome = join(runRoot, "protocol", "protocol-probe-codex-home");
mkdirSync(codexHome, { recursive: true });
writeFileSync(
  join(codexHome, "config.toml"),
  'cli_auth_credentials_store = "file"\n\n[analytics]\nenabled = false\n\n[feedback]\nenabled = false\n',
  { encoding: "utf8", flag: "w" },
);

const results: ProbeResult[] = [];
const report = {
  stage: "Gate 0A",
  category: "protocol-compatibility",
  startedAt: new Date().toISOString(),
  limits: {
    frameBytes: 2 * 1024 * 1024,
    totalBytesPerRole: 64 * 1024 * 1024,
    totalMessagesPerRole: 50_000,
    sustainedRateWindowMs: 5_000,
    messagesPerWindow: 1_250,
    startupTimeoutMs: 30_000,
  },
  methodAllowlist: [...PRODUCT_METHOD_ALLOWLIST].sort(),
  results,
  pass: false,
};
writeJsonAtomic(reportPath, report);

async function probe(id: string, name: string, body: () => Promise<unknown>): Promise<void> {
  const startedAt = new Date().toISOString();
  appendEvent(runRoot, `probe.${id}.started`, "running", { name });
  try {
    const observation = await body();
    const result: ProbeResult = { id, name, startedAt, completedAt: new Date().toISOString(), pass: true, observation };
    results.push(result);
    writeJsonAtomic(reportPath, report);
    appendEvent(runRoot, `probe.${id}.completed`, "pass", { name, evidence: relativeEvidencePath(runRoot, reportPath) });
  } catch (error) {
    const observation = { error: error instanceof Error ? error.message : String(error) };
    const result: ProbeResult = { id, name, startedAt, completedAt: new Date().toISOString(), pass: false, observation };
    results.push(result);
    writeJsonAtomic(reportPath, report);
    appendEvent(runRoot, `probe.${id}.completed`, "fail", { name, ...observation });
  }
}

function codexClient(home = codexHome, requestTimeoutMs = 5_000): AppServerClient {
  return new AppServerClient({
    supervisorPath,
    targetPath: environment.codex.pinnedBinary.path,
    targetArguments: ["app-server", "--stdio", "--strict-config"],
    codexHome: home,
    workingDirectory: gate0Root,
    jobMemoryMiB: 2_048,
    processTimeoutMs: 30_000,
    requestTimeoutMs,
  });
}

function fixtureClient(mode: "flood" | "oversized" | "unresponsive", requestTimeoutMs: number): AppServerClient {
  return new AppServerClient({
    supervisorPath,
    targetPath: process.execPath,
    targetArguments: [join(gate0Root, "fixtures", "fake-app-server.mjs"), mode],
    codexHome,
    workingDirectory: gate0Root,
    jobMemoryMiB: 256,
    processTimeoutMs: 15_000,
    requestTimeoutMs,
  });
}

await probe("A-PROTO-01", "exact binary version and SHA-256 pin succeeds", async () => {
  return verifyCodexPin(environment.codex.pinnedBinary.path, {
    versionOutput: "codex-cli 0.144.5",
    sha256: environment.codex.pinnedBinary.sha256,
  });
});

await probe("A-PROTO-02", "mismatched global Codex is rejected before App Server launch", async () => {
  try {
    await verifyCodexPin(environment.codex.globalBinary.path, {
      versionOutput: "codex-cli 0.144.5",
      sha256: environment.codex.pinnedBinary.sha256,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.startsWith("CODEX_PIN_MISMATCH")) throw error;
    return { rejected: true, reason: message };
  }
  throw new Error("A mismatched Codex binary was accepted.");
});

await probe("A-PROTO-03", "initialize handshake reports exact isolated CODEX_HOME", async () => {
  const client = codexClient();
  client.start();
  try {
    const initialized = (await client.initialize()) as { codexHome?: string; platformOs?: string; userAgent?: string };
    const account = await client.request("account/read", { refreshToken: false });
    if (resolve(initialized.codexHome ?? "") !== resolve(codexHome)) {
      throw new Error(`App Server reported unexpected CODEX_HOME: ${initialized.codexHome}`);
    }
    if (initialized.platformOs !== "windows") throw new Error(`Unexpected App Server platform: ${initialized.platformOs}`);
    return { initialized, account, transport: client.evidence(), stop: await client.stop() };
  } finally {
    await client.stop();
  }
});

await probe("A-PROTO-04", "request before initialize fails closed", async () => {
  const client = codexClient();
  client.start();
  try {
    await client.request("account/read", { refreshToken: false });
  } catch (error) {
    if (!(error instanceof RpcRemoteError)) throw error;
    return { rejected: true, error: error.message, transport: client.evidence(), stop: await client.stop() };
  } finally {
    await client.stop();
  }
  throw new Error("App Server accepted account/read before initialize.");
});

await probe("A-PROTO-05", "unknown server method returns an explicit RPC error", async () => {
  const client = codexClient();
  client.start();
  try {
    await client.initialize();
    await client.requestUnchecked("gate0/unknown", {});
  } catch (error) {
    if (!(error instanceof RpcRemoteError)) throw error;
    return { rejected: true, error: error.message, transport: client.evidence(), stop: await client.stop() };
  } finally {
    await client.stop();
  }
  throw new Error("App Server accepted an unknown method.");
});

await probe("A-PROTO-06", "adapter blocks a real but non-allowlisted App Server method", async () => {
  const client = codexClient();
  client.start();
  try {
    await client.initialize();
    await client.request("command/exec", {});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message !== "METHOD_NOT_ALLOWLISTED command/exec") throw error;
    return { rejectedBeforeWire: true, error: message, transport: client.evidence(), stop: await client.stop() };
  } finally {
    await client.stop();
  }
  throw new Error("Adapter accepted a non-allowlisted method.");
});

await probe("A-PROTO-07", "oversized App Server frame terminates the supervised fixture", async () => {
  const client = fixtureClient("oversized", 5_000);
  client.start();
  void client.requestUnchecked("initialize", {}).catch(() => undefined);
  const error = await client.waitForTerminalError(5_000);
  if (!error.message.startsWith("APP_SERVER_FRAME_LIMIT")) throw error;
  return { breach: error.message, transport: client.evidence(), stop: await client.stop() };
});

await probe("A-PROTO-08", "sustained App Server event flooding terminates the supervised fixture", async () => {
  const client = fixtureClient("flood", 10_000);
  client.start();
  try {
    void client.requestUnchecked("initialize", {}).catch(() => undefined);
    const error = await client.waitForTerminalError(10_000);
    if (!error.message.startsWith("APP_SERVER_EVENT_RATE_LIMIT")) throw error;
    return { breach: error.message, transport: client.evidence(), stop: await client.stop() };
  } finally {
    await client.stop();
  }
});

await probe("A-PROTO-09", "unresponsive App Server request times out without replay", async () => {
  const client = fixtureClient("unresponsive", 1_000);
  client.start();
  try {
    await client.requestUnchecked("initialize", {});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.startsWith("RPC_TIMEOUT")) throw error;
    return { timedOut: true, replayCount: 0, error: message, transport: client.evidence(), stop: await client.stop() };
  } finally {
    await client.stop();
  }
  throw new Error("Unresponsive fixture unexpectedly responded.");
});

report.pass = results.length === 9 && results.every((result) => result.pass);
writeJsonAtomic(reportPath, report);
appendEvent(runRoot, "protocol.compatibility.completed", report.pass ? "pass" : "fail", {
  evidence: relativeEvidencePath(runRoot, reportPath),
  passed: results.filter((result) => result.pass).length,
  failed: results.filter((result) => !result.pass).map((result) => result.id),
});

if (!report.pass) process.exitCode = 1;

function requiredArgument(index: number, label: string): string {
  const value = process.argv[index];
  if (!value) throw new Error(`Missing ${label} argument.`);
  return value;
}
