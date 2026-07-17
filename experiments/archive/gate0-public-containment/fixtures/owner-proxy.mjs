import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const supervisor = process.argv[2];
const workingDirectory = process.argv[3];
const treeFixture = process.argv[4];
const treeRoot = process.argv[5];
const proxyInfoPath = process.argv[6];

const child = spawn(
  supervisor,
  [
    "--owner-pid",
    String(process.pid),
    "--memory-mib",
    "256",
    "--timeout-ms",
    "30000",
    "--working-directory",
    workingDirectory,
    "--",
    process.execPath,
    treeFixture,
    "parent",
    treeRoot,
    "detached",
  ],
  { cwd: workingDirectory, detached: false, stdio: "ignore", windowsHide: true },
);

writeFileSync(
  proxyInfoPath,
  JSON.stringify({ proxyPid: process.pid, supervisorPid: child.pid, startedAt: new Date().toISOString() }, null, 2),
  "utf8",
);

setInterval(() => undefined, 1_000);
