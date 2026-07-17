import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AppServerClient } from "./app-server-client.js";

const priorRunRoot = resolve(requiredArgument(2, "prior Gate 0 run root"));
const codexHome = resolve(requiredArgument(3, "managed CODEX_HOME"));
const parentEvidenceRoot = resolve(requiredArgument(4, "parent evidence root"));
const environment = JSON.parse(readFileSync(join(priorRunRoot, "environment.json"), "utf8")) as {
  codex: { pinnedBinary: { path: string } };
};
const gate0Root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const supervisorPath = join(gate0Root, "build", "native", "JobSupervisor.exe");
const outputRoot = join(parentEvidenceRoot, `${timestamp()}-${randomUUID()}-restart-readiness`);
const reportPath = join(outputRoot, "restart-readiness-report.json");
mkdirSync(outputRoot, { recursive: true });

const report: Record<string, unknown> = {
  schemaVersion: 1,
  probe: "B-SANDBOX-01-RESTART-READINESS-DIAGNOSTIC",
  startedAt: new Date().toISOString(),
  codexHome,
  setupRequested: false,
  commandExecRequested: false,
  hostileCommandExecuted: false,
  godotStarted: false,
  productImplementationStarted: false,
};
persist();

const client = new AppServerClient({
  supervisorPath,
  targetPath: environment.codex.pinnedBinary.path,
  targetArguments: ["app-server", "--stdio", "--strict-config"],
  codexHome,
  workingDirectory: gate0Root,
  jobMemoryMiB: 2_048,
  processTimeoutMs: 30_000,
  requestTimeoutMs: 15_000,
});

try {
  client.start();
  report.initialize = await client.initialize();
  report.readiness = await client.requestUnchecked("windowsSandbox/readiness", {});
  report.pass = (report.readiness as { status?: unknown }).status === "ready";
  report.completedAt = new Date().toISOString();
  report.evidence = client.evidence();
  persist();
  if (!report.pass) process.exitCode = 1;
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
  process.stdout.write(`${JSON.stringify({ outputRoot, reportPath, readiness: report.readiness, pass: report.pass }, null, 2)}\n`);
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
