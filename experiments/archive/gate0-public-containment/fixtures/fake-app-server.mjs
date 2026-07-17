import { createInterface } from "node:readline";

const mode = process.argv[2];
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });

input.once("line", (line) => {
  const request = JSON.parse(line);
  if (mode === "unresponsive") return;
  if (mode === "oversized") {
    process.stdout.write(`${JSON.stringify({ id: request.id, result: { payload: "x".repeat(2 * 1024 * 1024) } })}\n`);
    return;
  }
  if (mode === "flood") {
    process.stdout.write(`${JSON.stringify({ id: request.id, result: {} })}\n`);
    let sequence = 0;
    const interval = setInterval(() => {
      for (let batch = 0; batch < 5; batch += 1) {
        process.stdout.write(`${JSON.stringify({ method: "gate0/flood", params: { sequence } })}\n`);
        sequence += 1;
      }
      if (sequence >= 5_000) clearInterval(interval);
    }, 10);
    return;
  }
  process.stderr.write(`unknown fake App Server mode: ${mode}\n`);
  process.exitCode = 2;
});
