import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { AppServerClient } from "./app-server-client.js";
import { appendEvent, loadRun, relativeEvidencePath, writeJsonAtomic } from "./evidence.js";

const execFileAsync = promisify(execFile);

interface ProbeResult {
  id: string;
  name: string;
  startedAt: string;
  completedAt: string;
  pass: boolean;
  observation: unknown;
}

interface AccountReadResult {
  account: null | { type: string; email?: string | null; planType?: string };
  requiresOpenaiAuth: boolean;
}

const runRoot = resolve(requiredArgument(2, "run root"));
loadRun(runRoot);
const gate0Root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const supervisorPath = join(gate0Root, "build", "native", "JobSupervisor.exe");
const environment = JSON.parse(readFileSync(join(runRoot, "environment.json"), "utf8")) as {
  codex: { pinnedBinary: { path: string }; globalBinary: { path: string } };
};
const authRoot = join(runRoot, "auth");
const codexHome = join(authRoot, "codex-home-attempt-2");
const reportPath = join(authRoot, "auth-report.json");
const globalAuthPath = join(homedir(), ".codex", "auth.json");

if (!resolve(codexHome).toLowerCase().startsWith(resolve(authRoot).toLowerCase() + "\\")) {
  throw new Error("Refusing to initialize authentication outside the run auth root.");
}
rmSync(codexHome, { recursive: true, force: true });
mkdirSync(codexHome, { recursive: true });
const currentUser = (await execFileAsync("whoami.exe", [], { encoding: "utf8", timeout: 5_000 })).stdout.trim();
await execFileAsync("icacls.exe", [codexHome, "/inheritance:r", "/grant:r", `${currentUser}:(OI)(CI)F`], {
  encoding: "utf8",
  timeout: 15_000,
  maxBuffer: 1024 * 1024,
  windowsHide: true,
});
writeFileSync(
  join(codexHome, "config.toml"),
  'cli_auth_credentials_store = "file"\n\n[analytics]\nenabled = false\n\n[feedback]\nenabled = false\n',
  "utf8",
);

const results: ProbeResult[] = [];
const report = {
  stage: "Gate 0A",
  category: "authentication-isolation",
  startedAt: new Date().toISOString(),
  credentialPolicy: {
    codexHome,
    store: "file",
    copiedGlobalCredentials: false,
    reusableSecretsRecorded: false,
    loginTimeoutMs: 600_000,
    automaticRetry: false,
  },
  results,
  pass: false,
};
writeJsonAtomic(reportPath, report);

let globalBefore: Awaited<ReturnType<typeof globalIdentity>> | undefined;
let browserLoginSucceeded = false;

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

await probe("A-AUTH-01", "fresh managed CODEX_HOME has user-only ACL and global auth baseline is recorded", async () => {
  globalBefore = await globalIdentity();
  if (!globalBefore.loginStatus.includes("Logged in using ChatGPT")) {
    throw new Error(`Expected existing global ChatGPT login baseline; observed: ${globalBefore.loginStatus}`);
  }
  const acl = await aclText(codexHome);
  const configAcl = await aclText(join(codexHome, "config.toml"));
  return { globalBefore, isolatedHome: codexHome, credentialFileInitiallyExists: existsSync(join(codexHome, "auth.json")), acl, configAcl };
});

await probe("A-AUTH-02", "fresh App Server account is empty and device-code login can be canceled", async () => {
  const client = createClient();
  client.start();
  try {
    const initialized = (await client.initialize()) as { codexHome: string };
    if (resolve(initialized.codexHome) !== resolve(codexHome)) throw new Error("App Server did not use the isolated CODEX_HOME.");
    const account = (await client.request("account/read", { refreshToken: false })) as AccountReadResult;
    if (account.account !== null) throw new Error("Fresh isolated CODEX_HOME unexpectedly contained an account.");
    const device = (await client.request("account/login/start", { type: "chatgptDeviceCode" })) as {
      type: string;
      loginId: string;
      verificationUrl: string;
      userCode: string;
    };
    if (device.type !== "chatgptDeviceCode" || !device.loginId || !device.verificationUrl || !device.userCode) {
      throw new Error("Device-code response did not match the generated schema.");
    }
    const canceled = (await client.request("account/login/cancel", { loginId: device.loginId })) as { status: string };
    if (canceled.status !== "canceled") throw new Error(`Expected canceled device login; observed ${canceled.status}`);
    return {
      accountBefore: redactAccount(account),
      deviceCodeReturned: true,
      reusableDeviceCodeRecorded: false,
      loginIdSha256: createHash("sha256").update(device.loginId).digest("hex"),
      cancelStatus: canceled.status,
      transport: client.evidence(),
      stop: await client.stop(),
    };
  } finally {
    await client.stop();
  }
});

await probe("A-AUTH-03", "browser ChatGPT login completes inside only the managed CODEX_HOME", async () => {
  const client = createClient(600_000);
  client.start();
  try {
    await client.initialize();
    const login = (await client.request("account/login/start", {
      type: "chatgpt",
      codexStreamlinedLogin: true,
      useHostedLoginSuccessPage: true,
      appBrand: "codex",
    })) as { type: string; loginId: string; authUrl: string };
    if (login.type !== "chatgpt" || !login.loginId || !login.authUrl) throw new Error("Browser login response did not match the generated schema.");
    appendEvent(runRoot, "auth.browser.opened", "running", {
      loginIdSha256: createHash("sha256").update(login.loginId).digest("hex"),
      urlRecorded: false,
      timeoutMs: 600_000,
    });
    const opener = spawn("rundll32.exe", ["url.dll,FileProtocolHandler", login.authUrl], {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    opener.unref();
    const account = await waitForAccount(client, 600_000);
    browserLoginSucceeded = true;
    const credential = fileIdentity(join(codexHome, "auth.json"));
    if (!credential.exists) throw new Error("File credential store did not create auth.json in the isolated CODEX_HOME.");
    const acl = await aclText(join(codexHome, "auth.json"));
    return {
      loginCompleted: true,
      account: redactAccount(account),
      credential,
      credentialAcl: acl,
      authUrlRecorded: false,
      accessTokenRecorded: false,
      transport: client.evidence(),
      stop: await client.stop(),
    };
  } finally {
    await client.stop();
  }
});

await probe("A-AUTH-04", "App Server restart preserves only the isolated login", async () => {
  if (!browserLoginSucceeded) throw new Error("Browser login did not complete; restart persistence cannot be tested.");
  const client = createClient();
  client.start();
  try {
    await client.initialize();
    const account = (await client.request("account/read", { refreshToken: false })) as AccountReadResult;
    if (account.account?.type !== "chatgpt") throw new Error("Isolated ChatGPT login did not survive App Server restart.");
    const globalDuring = await globalIdentity();
    if (!sameGlobalIdentity(globalBefore, globalDuring)) throw new Error("Global Codex authentication changed during isolated login.");
    return { isolatedAccountAfterRestart: redactAccount(account), globalUnchanged: true, transport: client.evidence(), stop: await client.stop() };
  } finally {
    await client.stop();
  }
});

await probe("A-AUTH-05", "isolated logout clears the managed account and leaves global login unchanged", async () => {
  if (!browserLoginSucceeded) throw new Error("Browser login did not complete; isolated logout cannot be tested.");
  const client = createClient();
  client.start();
  try {
    await client.initialize();
    await client.request("account/logout", {});
    const account = (await client.request("account/read", { refreshToken: false })) as AccountReadResult;
    if (account.account !== null) throw new Error("Isolated logout left an account active.");
    const globalAfter = await globalIdentity();
    if (!sameGlobalIdentity(globalBefore, globalAfter)) throw new Error("Isolated logout changed global Codex authentication.");
    return {
      isolatedAccountAfterLogout: redactAccount(account),
      isolatedCredentialAfterLogout: fileIdentity(join(codexHome, "auth.json")),
      globalAfter,
      globalUnchanged: true,
      replayCount: 0,
      transport: client.evidence(),
      stop: await client.stop(),
    };
  } finally {
    await client.stop();
  }
});

report.pass = results.length === 5 && results.every((result) => result.pass);
writeJsonAtomic(reportPath, report);
appendEvent(runRoot, "authentication-isolation.completed", report.pass ? "pass" : "fail", {
  evidence: relativeEvidencePath(runRoot, reportPath),
  passed: results.filter((result) => result.pass).length,
  failed: results.filter((result) => !result.pass).map((result) => result.id),
});
if (!report.pass) process.exitCode = 1;

function createClient(requestTimeoutMs = 30_000): AppServerClient {
  return new AppServerClient({
    supervisorPath,
    targetPath: environment.codex.pinnedBinary.path,
    targetArguments: ["app-server", "--stdio", "--strict-config"],
    codexHome,
    workingDirectory: gate0Root,
    jobMemoryMiB: 2_048,
    processTimeoutMs: 610_000,
    requestTimeoutMs,
  });
}

async function waitForAccount(client: AppServerClient, timeoutMs: number): Promise<AccountReadResult> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const account = (await client.request("account/read", { refreshToken: false })) as AccountReadResult;
    if (account.account !== null) return account;
    await delay(2_000);
  }
  throw new Error(`AUTH_LOGIN_TIMEOUT timeoutMs=${timeoutMs} replayCount=0`);
}

async function globalIdentity(): Promise<{ loginStatus: string; authFile: ReturnType<typeof fileIdentity> }> {
  const result = await execFileAsync(environment.codex.globalBinary.path, ["login", "status"], {
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  return { loginStatus: `${result.stdout}${result.stderr}`.trim(), authFile: fileIdentity(globalAuthPath) };
}

function fileIdentity(path: string): { path: string; exists: boolean; size?: number; modifiedAt?: string; sha256?: string } {
  if (!existsSync(path)) return { path, exists: false };
  const statistics = statSync(path);
  return {
    path,
    exists: true,
    size: statistics.size,
    modifiedAt: statistics.mtime.toISOString(),
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
  };
}

async function aclText(path: string): Promise<string> {
  const result = await execFileAsync("icacls.exe", [path], {
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  return result.stdout.trim();
}

function sameGlobalIdentity(
  before: Awaited<ReturnType<typeof globalIdentity>> | undefined,
  after: Awaited<ReturnType<typeof globalIdentity>>,
): boolean {
  if (!before) return false;
  return JSON.stringify(before) === JSON.stringify(after);
}

function redactAccount(result: AccountReadResult): unknown {
  return {
    requiresOpenaiAuth: result.requiresOpenaiAuth,
    account:
      result.account === null
        ? null
        : {
            type: result.account.type,
            planType: result.account.planType ?? null,
            emailPresent: typeof result.account.email === "string" && result.account.email.length > 0,
          },
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function requiredArgument(index: number, label: string): string {
  const value = process.argv[index];
  if (!value) throw new Error(`Missing ${label} argument.`);
  return value;
}
