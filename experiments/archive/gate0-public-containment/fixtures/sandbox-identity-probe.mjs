import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { userInfo } from "node:os";

const [resultPath] = process.argv.slice(2);
if (!resultPath) throw new Error("Missing result path.");

const result = {
  pid: process.pid,
  parentPid: process.ppid,
  osUserInfo: safeUserInfo(),
  whoami: runWhoAmI([]),
  user: runWhoAmI(["/user", "/fo", "csv", "/nh"]),
  groups: runWhoAmI(["/groups", "/fo", "csv", "/nh"]),
  environmentNames: Object.keys(process.env).sort(),
};

writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
process.stdout.write("GATE0_SANDBOX_IDENTITY_WRITTEN\n");

function safeUserInfo() {
  try {
    const value = userInfo();
    return { username: value.username, uid: value.uid, gid: value.gid, homedir: value.homedir, shell: value.shell };
  } catch (error) {
    return { error: error?.code ?? error?.message ?? "unknown" };
  }
}

function runWhoAmI(argumentsList) {
  const child = spawnSync("whoami.exe", argumentsList, {
    encoding: "utf8",
    timeout: 3_000,
    windowsHide: true,
    maxBuffer: 64 * 1024,
  });
  return {
    exitCode: child.status,
    signal: child.signal,
    errorCode: child.error?.code ?? null,
    stdout: (child.stdout ?? "").trim(),
    stderr: (child.stderr ?? "").trim(),
  };
}
