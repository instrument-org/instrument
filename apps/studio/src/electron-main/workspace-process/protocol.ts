/**
 * What main and the workspace child say to each other. Both sides import this
 * file, and nothing else of each other's.
 *
 * Main forks the child, then hands it one end of a `MessageChannelMain` in a
 * `connect` message over the child's parent port, with a nonce. Everything
 * after that goes over the transferred port: the child answers `ready` with
 * the same nonce, so main knows the port it holds is the one it handed over,
 * and then serves requests until main sends `shutdown` or goes away.
 */

/** Bumped when either side's messages change shape. `hello` reports it. */
export const WORKSPACE_PROCESS_PROTOCOL = 1;

/** The workspace a child serves, as main resolved it. */
type WorkspaceProcessWorkspace = { id: string; name: string };

/** What a child says about itself. The command line's first call returns the same. */
export type WorkspaceProcessHello = {
  build: string;
  /** What this child can do. Empty while it hosts nothing. */
  capabilities: string[];
  pid: number;
  protocolVersion: number;
  workspace: WorkspaceProcessWorkspace;
};

/** Main to child, over the parent port, with the child's end of the channel. */
export type ConnectMessage = {
  build: string;
  nonce: string;
  /** Main's pid, which the child watches so it cannot outlive main. */
  parentPid: number;
  type: "connect";
  workspace: WorkspaceProcessWorkspace;
};

/** Main to child, over the port. */
export type ToChild =
  | { id: number; method: "hello"; type: "request" }
  | { type: "shutdown" };

/** Child to main, over the port. */
export type FromChild =
  | { error: string; id: number; type: "response" }
  | { id: number; result: WorkspaceProcessHello; type: "response" }
  | { nonce: string; type: "ready" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isConnectMessage(value: unknown): value is ConnectMessage {
  return (
    isRecord(value) &&
    value.type === "connect" &&
    typeof value.nonce === "string" &&
    typeof value.parentPid === "number" &&
    typeof value.build === "string" &&
    isRecord(value.workspace)
  );
}

export function isToChild(value: unknown): value is ToChild {
  return (
    isRecord(value) &&
    (value.type === "shutdown" ||
      (value.type === "request" &&
        typeof value.id === "number" &&
        value.method === "hello"))
  );
}

export function isFromChild(value: unknown): value is FromChild {
  if (!isRecord(value)) {
    return false;
  }
  if (value.type === "ready") {
    return typeof value.nonce === "string";
  }
  return (
    value.type === "response" &&
    typeof value.id === "number" &&
    (typeof value.error === "string" || isRecord(value.result))
  );
}
