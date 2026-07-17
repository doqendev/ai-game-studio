import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

const execFileAsync = promisify(execFile);

export const PRODUCT_METHOD_ALLOWLIST = new Set([
  "account/read",
  "account/login/start",
  "account/login/cancel",
  "account/logout",
  "thread/start",
  "thread/resume",
  "thread/read",
  "turn/start",
  "turn/interrupt",
]);

export interface PinExpectation {
  versionOutput: string;
  sha256: string;
}

export interface BinaryIdentity {
  path: string;
  versionOutput: string;
  sha256: string;
}

export async function verifyCodexPin(path: string, expected: PinExpectation): Promise<BinaryIdentity> {
  const { stdout, stderr } = await execFileAsync(path, ["--version"], {
    encoding: "utf8",
    timeout: 5_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  const versionOutput = `${stdout}${stderr}`.trim();
  const sha256 = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (versionOutput !== expected.versionOutput || sha256 !== expected.sha256) {
    throw new Error(
      `CODEX_PIN_MISMATCH expected=${expected.versionOutput}/${expected.sha256} observed=${versionOutput}/${sha256}`,
    );
  }
  return { path, versionOutput, sha256 };
}

interface RpcResponse {
  id: number | string;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(reason: Error): void;
  timer: NodeJS.Timeout;
}

export interface TranscriptEntry {
  at: string;
  direction: "client-to-server" | "server-to-client" | "server-stderr" | "supervisor";
  kind: string;
  id?: number | string;
  method?: string;
  payload?: unknown;
}

export interface ClientLimits {
  frameBytes: number;
  totalBytes: number;
  totalMessages: number;
  messagesPerWindow: number;
  rateWindowMs: number;
  stderrBytes: number;
}

export interface AppServerClientOptions {
  supervisorPath: string;
  targetPath: string;
  targetArguments: string[];
  codexHome: string;
  workingDirectory: string;
  jobMemoryMiB: number;
  processTimeoutMs: number;
  requestTimeoutMs?: number;
  limits?: Partial<ClientLimits>;
  environment?: NodeJS.ProcessEnv;
}

const defaultLimits: ClientLimits = {
  frameBytes: 2 * 1024 * 1024,
  totalBytes: 64 * 1024 * 1024,
  totalMessages: 50_000,
  messagesPerWindow: 1_250,
  rateWindowMs: 5_000,
  stderrBytes: 8 * 1024 * 1024,
};

export class RpcRemoteError extends Error {
  public constructor(public readonly response: RpcResponse) {
    super(`RPC_ERROR code=${response.error?.code ?? "unknown"} message=${response.error?.message ?? "unknown"}`);
  }
}

export class AppServerClient {
  private readonly options: AppServerClientOptions;
  private readonly limits: ClientLimits;
  private process: ChildProcessWithoutNullStreams | undefined;
  private stdoutBuffer = Buffer.alloc(0);
  private stderrBytes = 0;
  private totalBytes = 0;
  private totalMessages = 0;
  private rateWindowStartedAt: number | undefined;
  private rateWindowMessageCount = 0;
  private nextId = 1;
  private readonly pending = new Map<number | string, PendingRequest>();
  private terminalError: Error | undefined;
  private readonly transcriptFirst: TranscriptEntry[] = [];
  private readonly transcriptLast: TranscriptEntry[] = [];
  private transcriptDropped = 0;
  private readonly streamHash = createHash("sha256");
  private exitPromise: Promise<{ code: number | null; signal: NodeJS.Signals | null }> | undefined;
  private supervisorPid: number | undefined;

  public constructor(options: AppServerClientOptions) {
    this.options = options;
    this.limits = { ...defaultLimits, ...options.limits };
  }

  public start(): void {
    if (this.process) throw new Error("App Server client has already been started.");
    const argumentsForSupervisor = [
      "--owner-pid",
      String(process.pid),
      "--memory-mib",
      String(this.options.jobMemoryMiB),
      "--timeout-ms",
      String(this.options.processTimeoutMs),
      "--working-directory",
      this.options.workingDirectory,
      "--",
      this.options.targetPath,
      ...this.options.targetArguments,
    ];
    const child = spawn(this.options.supervisorPath, argumentsForSupervisor, {
      cwd: this.options.workingDirectory,
      env: {
        ...process.env,
        ...this.options.environment,
        CODEX_HOME: this.options.codexHome,
      },
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.process = child;
    this.supervisorPid = child.pid;
    this.exitPromise = new Promise((resolve) => {
      child.once("exit", (code, signal) => {
        const exitError = this.terminalError ?? new Error(`APP_SERVER_EXIT code=${code} signal=${signal}`);
        this.rejectAll(exitError);
        resolve({ code, signal });
      });
    });
    child.stdout.on("data", (chunk: Buffer) => this.onStdout(chunk));
    child.stderr.on("data", (chunk: Buffer) => this.onStderr(chunk));
    child.once("error", (error) => this.fail(error));
  }

  public async initialize(): Promise<unknown> {
    const result = await this.requestUnchecked("initialize", {
      clientInfo: {
        name: "ai-game-studio-gate0",
        title: "AI Game Studio Gate 0",
        version: "0.0.0-gate0",
      },
      capabilities: {
        experimentalApi: false,
        requestAttestation: false,
        optOutNotificationMethods: [],
      },
    });
    this.notify("initialized");
    return result;
  }

  public request(method: string, params: unknown): Promise<unknown> {
    if (!PRODUCT_METHOD_ALLOWLIST.has(method)) {
      return Promise.reject(new Error(`METHOD_NOT_ALLOWLISTED ${method}`));
    }
    return this.requestUnchecked(method, params);
  }

  public requestUnchecked(method: string, params: unknown): Promise<unknown> {
    if (!this.process || !this.process.stdin.writable) {
      return Promise.reject(this.terminalError ?? new Error("App Server stdin is unavailable."));
    }
    const id = this.nextId++;
    const message = { method, id, params };
    this.record({
      at: new Date().toISOString(),
      direction: "client-to-server",
      kind: "request",
      id,
      method,
      payload: sanitize(message),
    });
    const timeoutMs = this.options.requestTimeoutMs ?? 30_000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC_TIMEOUT method=${method} timeoutMs=${timeoutMs}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.process!.stdin.write(`${JSON.stringify(message)}\n`, "utf8", (error) => {
        if (error) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  public notify(method: string): void {
    if (!this.process || !this.process.stdin.writable) throw new Error("App Server stdin is unavailable.");
    const message = { method };
    this.record({ at: new Date().toISOString(), direction: "client-to-server", kind: "notification", method });
    this.process.stdin.write(`${JSON.stringify(message)}\n`, "utf8");
  }

  public async stop(graceMs = 2_000): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
    if (!this.process || !this.exitPromise) return { code: null, signal: null };
    if (this.process.stdin.writable) this.process.stdin.end();
    const graceful = await Promise.race([
      this.exitPromise.then((result) => ({ kind: "exit" as const, result })),
      delay(graceMs).then(() => ({ kind: "timeout" as const })),
    ]);
    if (graceful.kind === "exit") return graceful.result;
    this.process.kill();
    const forced = await Promise.race([
      this.exitPromise,
      delay(5_000).then(() => ({ code: null, signal: null })),
    ]);
    return forced;
  }

  public async waitForTerminalError(timeoutMs: number): Promise<Error> {
    const started = Date.now();
    while (!this.terminalError && Date.now() - started < timeoutMs) await delay(25);
    if (!this.terminalError) throw new Error(`Expected a terminal client error within ${timeoutMs} ms.`);
    return this.terminalError;
  }

  public evidence(): unknown {
    return {
      statistics: {
        supervisorPid: this.supervisorPid ?? null,
        totalBytes: this.totalBytes,
        totalMessages: this.totalMessages,
        stderrBytes: this.stderrBytes,
        transcriptDropped: this.transcriptDropped,
      },
      terminalError: this.terminalError?.message ?? null,
      transcript: [...this.transcriptFirst, ...this.transcriptLast],
      streamSha256: this.streamHash.copy().digest("hex"),
    };
  }

  private onStdout(chunk: Buffer): void {
    if (this.terminalError) return;
    this.totalBytes += chunk.length;
    this.streamHash.update(chunk);
    if (this.totalBytes > this.limits.totalBytes) {
      this.fail(new Error(`APP_SERVER_TOTAL_BYTES_LIMIT limit=${this.limits.totalBytes}`));
      return;
    }
    this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk]);
    if (this.stdoutBuffer.length > this.limits.frameBytes && this.stdoutBuffer.indexOf(0x0a) === -1) {
      this.fail(new Error(`APP_SERVER_FRAME_LIMIT limit=${this.limits.frameBytes}`));
      return;
    }
    let newline = this.stdoutBuffer.indexOf(0x0a);
    while (newline !== -1) {
      const frame = this.stdoutBuffer.subarray(0, newline);
      this.stdoutBuffer = this.stdoutBuffer.subarray(newline + 1);
      if (frame.length > this.limits.frameBytes) {
        this.fail(new Error(`APP_SERVER_FRAME_LIMIT limit=${this.limits.frameBytes} observed=${frame.length}`));
        return;
      }
      if (frame.length !== 0) this.onFrame(frame);
      newline = this.stdoutBuffer.indexOf(0x0a);
    }
  }

  private onFrame(frame: Buffer): void {
    this.totalMessages += 1;
    if (this.totalMessages > this.limits.totalMessages) {
      this.fail(new Error(`APP_SERVER_EVENT_COUNT_LIMIT limit=${this.limits.totalMessages}`));
      return;
    }
    const now = Date.now();
    this.rateWindowStartedAt ??= now;
    this.rateWindowMessageCount += 1;
    const elapsed = now - this.rateWindowStartedAt;
    if (elapsed >= this.limits.rateWindowMs) {
      if (this.rateWindowMessageCount > this.limits.messagesPerWindow) {
        this.fail(
          new Error(
            `APP_SERVER_EVENT_RATE_LIMIT windowMs=${elapsed} limit=${this.limits.messagesPerWindow} observed=${this.rateWindowMessageCount}`,
          ),
        );
        return;
      }
      this.rateWindowStartedAt = now;
      this.rateWindowMessageCount = 0;
    }
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(frame.toString("utf8")) as Record<string, unknown>;
    } catch {
      this.fail(new Error("APP_SERVER_INVALID_JSON"));
      return;
    }
    const id = typeof message.id === "string" || typeof message.id === "number" ? message.id : undefined;
    const method = typeof message.method === "string" ? message.method : undefined;
    this.record({
      at: new Date().toISOString(),
      direction: "server-to-client",
      kind: id !== undefined ? "response-or-request" : "notification",
      ...(id === undefined ? {} : { id }),
      ...(method === undefined ? {} : { method }),
      payload: sanitize(message),
    });
    if (id === undefined || method !== undefined) return;
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    const response = message as unknown as RpcResponse;
    if (response.error) pending.reject(new RpcRemoteError(response));
    else pending.resolve(response.result);
  }

  private onStderr(chunk: Buffer): void {
    this.stderrBytes += chunk.length;
    if (this.stderrBytes > this.limits.stderrBytes) {
      this.fail(new Error(`APP_SERVER_STDERR_LIMIT limit=${this.limits.stderrBytes}`));
      return;
    }
    const text = chunk.toString("utf8");
    this.record({
      at: new Date().toISOString(),
      direction: text.includes("GATE0_JOB") ? "supervisor" : "server-stderr",
      kind: "diagnostic",
      payload: text.length > 4_096 ? `${text.slice(0, 2_048)}…${text.slice(-2_048)}` : text,
    });
  }

  private fail(error: Error): void {
    if (this.terminalError) return;
    this.terminalError = error;
    this.rejectAll(error);
    this.record({
      at: new Date().toISOString(),
      direction: "supervisor",
      kind: "limit-or-protocol-failure",
      payload: error.message,
    });
    this.process?.kill();
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private record(entry: TranscriptEntry): void {
    if (this.transcriptFirst.length < 100) {
      this.transcriptFirst.push(entry);
      return;
    }
    if (this.transcriptLast.length === 100) {
      this.transcriptLast.shift();
      this.transcriptDropped += 1;
    }
    this.transcriptLast.push(entry);
  }
}

function sanitize(value: unknown, key = ""): unknown {
  if (/token|apiKey|authUrl|verificationUrl|userCode|email/iu.test(key)) return "[redacted]";
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [childKey, child] of Object.entries(value)) output[childKey] = sanitize(child, childKey);
    return output;
  }
  return value;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
