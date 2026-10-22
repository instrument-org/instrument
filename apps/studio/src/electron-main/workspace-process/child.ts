import { serveConnection } from "./child-host";
import { isConnectMessage } from "./protocol";

// The workspace child's entry, run by `utilityProcess.fork`. It hosts nothing
// yet: it answers main's handshake and `hello`, and ends when main says so or
// goes away. Only the first `connect` is served; main forks a new child rather
// than reconnecting one.

/** How long a child waits for main's `connect` before deciding main is gone. */
const CONNECT_WAIT_MS = 30_000;

const unconnected = setTimeout(() => process.exit(0), CONNECT_WAIT_MS);
let connected = false;

process.parentPort.on("message", (event) => {
  const port = event.ports[0];
  if (connected || !port || !isConnectMessage(event.data)) {
    return;
  }
  connected = true;
  clearTimeout(unconnected);
  serveConnection({
    connect: event.data,
    exit: (code) => process.exit(code),
    isAlive: (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        // EPERM is a process that exists and is someone else's.
        return error instanceof Error && "code" in error && error.code === "EPERM";
      }
    },
    pid: process.pid,
    port: {
      close: () => port.close(),
      onClose: (listener) => port.on("close", listener),
      onMessage: (listener) =>
        port.on("message", (message) => listener(message.data)),
      postMessage: (message) => port.postMessage(message),
      start: () => port.start(),
    },
  });
});
