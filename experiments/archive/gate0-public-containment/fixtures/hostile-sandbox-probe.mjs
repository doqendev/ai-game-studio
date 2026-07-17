import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { connect } from "node:net";

const [resultPath, insidePath, outsidePath, outsideReadPath, junctionPath, localPortText] = process.argv.slice(2);
const localPort = Number(localPortText);

const result = {
  pid: process.pid,
  parentPid: process.ppid,
  environmentNames: Object.keys(process.env).sort(),
  insideWrite: attemptWrite(insidePath, "inside-write-ok"),
  outsideRead: attemptRead(outsideReadPath),
  outsideWrite: attemptWrite(outsidePath, "outside-write-should-fail"),
  junctionEscapeWrite: attemptWrite(junctionPath, "junction-write-should-fail"),
  childOutsideWrite: attemptChildWrite(outsidePath),
  localNetwork: await attemptConnection("127.0.0.1", localPort),
  publicNetwork: await attemptConnection("example.com", 443),
};

writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf8");
process.stdout.write("GATE0_HOSTILE_SANDBOX_RESULT_WRITTEN\n");

function attemptWrite(path, value) {
  try {
    writeFileSync(path, value, "utf8");
    return { succeeded: true };
  } catch (error) {
    return { succeeded: false, code: error?.code ?? "unknown" };
  }
}

function attemptRead(path) {
  try {
    const value = readFileSync(path, "utf8");
    return { succeeded: true, bytes: Buffer.byteLength(value) };
  } catch (error) {
    return { succeeded: false, code: error?.code ?? "unknown" };
  }
}

function attemptChildWrite(path) {
  const script = "require('fs').writeFileSync(process.argv[1],'child-outside-write-should-fail')";
  const child = spawnSync(process.execPath, ["-e", script, path], { encoding: "utf8", timeout: 3_000, windowsHide: true });
  return {
    exitCode: child.status,
    signal: child.signal,
    errorCode: child.error?.code ?? null,
    stderrBytes: Buffer.byteLength(child.stderr ?? ""),
  };
}

function attemptConnection(host, port) {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    let finished = false;
    const complete = (value) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(1_500, () => complete({ succeeded: false, outcome: "timeout" }));
    socket.once("connect", () => complete({ succeeded: true, outcome: "connected" }));
    socket.once("error", (error) => complete({ succeeded: false, outcome: error.code ?? "error" }));
  });
}

