import { createSocket } from "node:dgram";
import { writeFileSync } from "node:fs";
import { connect } from "node:net";

const [resultPath, encodedConfiguration] = process.argv.slice(2);
if (!resultPath || !encodedConfiguration) throw new Error("Missing loopback probe arguments.");
const configuration = JSON.parse(Buffer.from(encodedConfiguration, "base64url").toString("utf8"));
const results = [];
for (const endpoint of configuration.endpoints) {
  results.push(endpoint.transport === "tcp" ? await attemptTcp(endpoint) : await attemptUdp(endpoint));
}
writeFileSync(resultPath, `${JSON.stringify({ pid: process.pid, parentPid: process.ppid, results }, null, 2)}\n`, "utf8");
process.stdout.write("GATE0_LOOPBACK_MATRIX_WRITTEN\n");

function attemptTcp(endpoint) {
  return new Promise((resolve) => {
    const socket = connect({ host: endpoint.host, port: endpoint.port });
    let finished = false;
    const complete = (value) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolve({ ...endpoint, ...value });
    };
    socket.setTimeout(1_500, () => complete({ succeeded: false, outcome: "timeout" }));
    socket.once("connect", () => complete({ succeeded: true, outcome: "connected" }));
    socket.once("error", (error) => complete({ succeeded: false, outcome: error.code ?? "error" }));
  });
}

function attemptUdp(endpoint) {
  return new Promise((resolve) => {
    const socket = createSocket(endpoint.family === "ipv6" ? "udp6" : "udp4");
    let finished = false;
    const timer = setTimeout(() => complete({ succeeded: false, outcome: "timeout" }), 1_500);
    const complete = (value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.close();
      resolve({ ...endpoint, ...value });
    };
    socket.once("error", (error) => complete({ succeeded: false, outcome: error.code ?? "error" }));
    socket.once("message", (message) => complete({ succeeded: message.toString("utf8") === endpoint.nonce, outcome: "response" }));
    socket.bind(0, endpoint.family === "ipv6" ? "::" : "0.0.0.0", () => {
      socket.send(Buffer.from(endpoint.nonce, "utf8"), endpoint.port, endpoint.host, (error) => {
        if (error) complete({ succeeded: false, outcome: error.code ?? "send-error" });
      });
    });
  });
}
