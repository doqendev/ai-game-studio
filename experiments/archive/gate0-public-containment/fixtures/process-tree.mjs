import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const role = process.argv[2];
const root = resolve(process.argv[3]);
const detached = process.argv[4] === "detached";
mkdirSync(root, { recursive: true });

writeFileSync(
  join(root, `${role}.json`),
  JSON.stringify({ role, pid: process.pid, parentPid: process.ppid, startedAt: new Date().toISOString() }, null, 2),
  "utf8",
);

if (role === "parent") {
  spawn(process.execPath, [import.meta.filename, "child", root, ...(detached ? ["detached"] : [])], {
    detached,
    stdio: "ignore",
    windowsHide: true,
  }).unref();
} else if (role === "child") {
  spawn(process.execPath, [import.meta.filename, "grandchild", root, ...(detached ? ["detached"] : [])], {
    detached,
    stdio: "ignore",
    windowsHide: true,
  }).unref();
} else if (role !== "grandchild") {
  throw new Error(`Unknown process-tree role: ${role}`);
}

setInterval(() => {
  writeFileSync(join(root, `${role}.heartbeat`), new Date().toISOString(), "utf8");
}, 100);
