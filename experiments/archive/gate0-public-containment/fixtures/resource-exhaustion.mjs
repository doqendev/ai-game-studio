import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const mode = process.argv[2];
const root = resolve(process.argv[3]);
mkdirSync(root, { recursive: true });
writeFileSync(
  join(root, `${mode}-${process.pid}.json`),
  JSON.stringify({ mode, pid: process.pid, parentPid: process.ppid, startedAt: new Date().toISOString() }, null, 2),
  "utf8",
);

if (mode === "cpu") {
  let accumulator = 0;
  while (true) accumulator = Math.sqrt(accumulator + Math.random());
}

if (mode === "memory-root") {
  for (let index = 0; index < 2; index += 1) {
    spawn(process.execPath, [import.meta.filename, "memory-child", root], {
      detached: false,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
  }
  setInterval(() => undefined, 1_000);
} else if (mode === "memory-child") {
  const allocations = [];
  setInterval(() => allocations.push(Buffer.alloc(2 * 1024 * 1024, 0x5a)), 50);
} else if (mode !== "cpu") {
  throw new Error(`Unknown resource-exhaustion mode: ${mode}`);
}
