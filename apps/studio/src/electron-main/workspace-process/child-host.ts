import {
  type ConnectMessage,
  type FromChild,
  isToChild,
  WORKSPACE_PROCESS_PROTOCOL,
} from "./protocol";

/** How often the child checks that main is still its parent. */
const PARENT_WATCH_MS = 1000;

/** The child's end of the channel main handed over. */
export type ChildPort = {
  close(): void;
  onClose(listener: () => void): void;
  onMessage(listener: (data: unknown) => void): void;
  postMessage(message: FromChild): void;
  start(): void;
};

/**
 * Serves one connection from main: answers `ready` with main's nonce, then
 * `hello`, until main says `shutdown`, the port closes, or main's process is
 * gone. Each of those ends the process, since a child with
 * no main has nobody to serve and must not be left running.
 */
export function serveConnection({
  connect,
  exit,
  isAlive,
  pid,
  port,
}: {
  connect: ConnectMessage;
  exit: (code: number) => void;
  /** Whether a process with this pid is still running. */
  isAlive: (pid: number) => boolean;
  pid: number;
  port: ChildPort;
}) {
  let ended = false;
  const end = (code: number) => {
    if (ended) {
      return;
    }
    ended = true;
    clearInterval(parentWatch);
    port.close();
    exit(code);
  };

  // A killed main may close no port and send no shutdown, and the child would
  // go on running with nobody to serve. Polled by pid rather than by parent,
  // since Windows does not reparent an orphan.
  const parentWatch = setInterval(() => {
    if (!isAlive(connect.parentPid)) {
      end(0);
    }
  }, PARENT_WATCH_MS);

  port.onMessage((data) => {
    if (!isToChild(data)) {
      return;
    }
    if (data.type === "shutdown") {
      end(0);
      return;
    }
    port.postMessage({
      id: data.id,
      result: {
        build: connect.build,
        capabilities: [],
        pid,
        protocolVersion: WORKSPACE_PROCESS_PROTOCOL,
        workspace: connect.workspace,
      },
      type: "response",
    });
  });
  port.onClose(() => {
    end(0);
  });
  port.start();
  port.postMessage({ nonce: connect.nonce, type: "ready" });
}
