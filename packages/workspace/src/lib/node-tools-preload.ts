import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { runtimeLayout } from "./runtime-dir";
import { getWorkspaceConfig } from "./workspace-config";

/** What the preload sends for `tools.<slug>.<tool>(args)`. */
export interface ToolCallMessage {
  argsJson: string;
  id: number;
  path: string;
  type: typeof TOOL_CALL;
}

/** What the `node` command sends back: the result as JSON, or the refusal's message. */
export type ToolReplyMessage =
  | { error: string; id: number; type: typeof TOOL_REPLY }
  | { id: number; result: string; type: typeof TOOL_REPLY };

const TOOL_CALL = "instrument:tool-call";
const TOOL_REPLY = "instrument:tool-reply";

/**
 * The module `node` loads with `--import` ahead of the agent's script. It
 * defines `tools`, a proxy whose `tools.<slug>.<tool>(args)` sends the call
 * to the `node` command over the IPC channel the command opened, and resolves
 * to the value the command sends back, or throws its refusal.
 *
 * It keeps out of the way of the script's own code: it defines nothing when
 * there is no channel or when `tools` already exists, the global is
 * non-enumerable (so walking the globals never shows it) and writable and
 * configurable (so a package assigning its own `tools` replaces it), and the
 * channel is referenced only while a call is waiting, so a script that never
 * calls a tool exits when its own work is done.
 */
const NODE_TOOLS_PRELOAD = `
if (globalThis.tools === undefined && typeof process.send === "function") {
  const pending = new Map();
  let nextId = 0;
  const onMessage = (message) => {
    if (message?.type !== ${JSON.stringify(TOOL_REPLY)}) return;
    const call = pending.get(message.id);
    if (call === undefined) return;
    pending.delete(message.id);
    if (pending.size === 0) {
      process.off("message", onMessage);
      process.channel?.unref();
    }
    if (typeof message.error === "string") {
      call.reject(new Error(message.error));
    } else {
      call.resolve(JSON.parse(message.result));
    }
  };
  const invoke = (toolPath, args) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      if (pending.size === 0) {
        process.on("message", onMessage);
        process.channel?.ref();
      }
      pending.set(id, { reject, resolve });
      process.send({
        argsJson: JSON.stringify(args ?? {}),
        id,
        path: toolPath,
        type: ${JSON.stringify(TOOL_CALL)},
      });
    });
  const at = (toolPath) =>
    new Proxy(function tools() {}, {
      apply: (_target, _this, [args]) => invoke(toolPath, args),
      get: (_target, key) =>
        typeof key === "string" && key !== "then"
          ? at(toolPath === "" ? key : toolPath + "." + key)
          : undefined,
    });
  process.channel?.unref();
  Object.defineProperty(globalThis, "tools", {
    configurable: true,
    enumerable: false,
    value: at(""),
    writable: true,
  });
}
`;

/** Whether a message from the script is a tool call the preload sent. */
export function isToolCallMessage(
  message: unknown,
): message is ToolCallMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === TOOL_CALL &&
    "id" in message &&
    typeof message.id === "number" &&
    "path" in message &&
    typeof message.path === "string" &&
    "argsJson" in message &&
    typeof message.argsJson === "string"
  );
}

/** The reply to one tool call, from what answered it. */
export async function answerToolCall(
  message: ToolCallMessage,
  invoke: () => Promise<string>,
): Promise<ToolReplyMessage> {
  try {
    return { id: message.id, result: await invoke(), type: TOOL_REPLY };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      id: message.id,
      type: TOOL_REPLY,
    };
  }
}

/**
 * The preload as a `file:` URL for `--import`, written into the runtime
 * folder's `preload/`, which every native command may read inside the
 * sandbox and none may change, so no chat can change what another chat's
 * `node` loads. Written by the app whenever what is there differs, so a
 * build's preload replaces an older one and a deleted file comes back.
 */
export async function nodeToolsPreloadUrl(): Promise<string> {
  const file = path.join(
    runtimeLayout(getWorkspaceConfig().runtimeDir).preload,
    "tools-preload.mjs",
  );
  const current = await fs.readFile(file, "utf8").catch(() => undefined);
  if (current !== NODE_TOOLS_PRELOAD) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    // Renamed into place, so a `node` starting at the same moment reads the
    // old file or the new one, never half of one.
    const temporary = `${file}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, NODE_TOOLS_PRELOAD);
    await fs.rename(temporary, file);
  }
  return pathToFileURL(file).href;
}
