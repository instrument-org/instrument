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
 * The preload's first part: Node reading past a package.json it may not read.
 *
 * Node looks for a package.json in every folder above a script (for its
 * module type, and for a package naming itself in `require`) and fails
 * outright with "Cannot read package config" when the sandbox refuses the
 * read of one, where a missing file would do: under MXC every folder above
 * the work folder and a granted folder is closed. Each of the three steps
 * that look is taken again as Node takes it when there is no package.json,
 * and only after the look was refused, so nothing changes where it was not:
 *
 * - resolving (`module.registerHooks`): the file is found by Node's own
 *   lookup without the package's name for itself, and an `import` of a
 *   `.js` or `.ts` file gets the format Node would detect from its syntax;
 * - the CommonJS loader's `.js` handler, which reads the module type before
 *   any hook runs: the file is compiled with no type, as Node compiles one
 *   with no package.json, detecting ES module syntax itself.
 *
 * Node's message names the type it could not read, which ends with the
 * script if this part is not there to read past it.
 */
const PACKAGE_SCOPE_PRELOAD = `
import { readFileSync } from "node:fs";
import Module, { registerHooks, stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const scopeRefused = (error) =>
  error?.code === "ERR_INVALID_PACKAGE_CONFIG" &&
  /operation not permitted|permission denied/i.test(String(error.message));

// Messages V8 gives a module's syntax compiled as a CommonJS function, which
// are how Node itself detects an ES module with no type to go by.
const MODULE_SYNTAX = [
  "Cannot use import statement outside a module",
  "Unexpected token 'export'",
  "Cannot use 'import.meta' outside a module",
  "await is only valid in async functions and the top level bodies of modules",
];
const hasModuleSyntax = (source) => {
  try {
    vm.compileFunction(source, ["exports", "require", "module", "__filename", "__dirname"]);
    return false;
  } catch (error) {
    return error instanceof SyntaxError && MODULE_SYNTAX.some((message) => error.message.includes(message));
  }
};
const quietly = (run) => {
  const emit = process.emitWarning;
  process.emitWarning = () => {};
  try {
    return run();
  } finally {
    process.emitWarning = emit;
  }
};
const FORMATS = {
  ".cjs": "commonjs",
  ".cts": "commonjs-typescript",
  ".json": "json",
  ".mjs": "module",
  ".mts": "module-typescript",
  ".node": "addon",
  ".wasm": "wasm",
};
// The format an import of a file with no package.json to go by gets.
const detectedFormat = (filename) => {
  const extension = path.extname(filename);
  if (FORMATS[extension] !== undefined) return FORMATS[extension];
  const source = readFileSync(filename, "utf8");
  if (extension === ".ts") {
    return hasModuleSyntax(quietly(() => stripTypeScriptTypes(source)))
      ? "module-typescript"
      : "commonjs-typescript";
  }
  return hasModuleSyntax(source) ? "module" : "commonjs";
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (!scopeRefused(error)) throw error;
      const required = context.conditions?.includes("require") ?? false;
      const parentPath = context.parentURL?.startsWith("file:")
        ? fileURLToPath(context.parentURL)
        : path.join(process.cwd(), "[eval]");
      let filename;
      if (!required && /^(?:\\.{1,2}\\/|\\/|file:)/.test(specifier)) {
        filename = fileURLToPath(new URL(specifier, pathToFileURL(parentPath)));
      } else {
        const parent = new Module(parentPath);
        parent.filename = parentPath;
        parent.paths = Module._nodeModulePaths(path.dirname(parentPath));
        filename = Module._findPath(
          specifier,
          Module._resolveLookupPaths(specifier, parent),
          false,
          new Set(context.conditions ?? []),
        );
        if (!filename) {
          const missing = new Error("Cannot find module '" + specifier + "'\\nRequire stack:\\n- " + parentPath);
          missing.code = required ? "MODULE_NOT_FOUND" : "ERR_MODULE_NOT_FOUND";
          throw missing;
        }
      }
      const url = pathToFileURL(filename).href;
      if (required) return { shortCircuit: true, url };
      try {
        return nextResolve(url, context);
      } catch (again) {
        if (!scopeRefused(again)) throw again;
        return { format: detectedFormat(filename), shortCircuit: true, url };
      }
    }
  },
});

const compileJs = Module._extensions[".js"];
Module._extensions[".js"] = function (module, filename) {
  try {
    return compileJs.call(this, module, filename);
  } catch (error) {
    if (!scopeRefused(error)) throw error;
    module._compile(
      readFileSync(filename, "utf8"),
      filename,
      filename.endsWith(".ts") ? "typescript" : undefined,
    );
  }
};
`;

/**
 * The preload's second part, `tools`: a proxy whose `tools.<slug>.<tool>(args)` sends the call
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
const TOOLS_PRELOAD = `
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

/**
 * The module `node` loads with `--import` ahead of the agent's script: the
 * package.json part, then `tools`.
 */
const NODE_TOOLS_PRELOAD = `${PACKAGE_SCOPE_PRELOAD}${TOOLS_PRELOAD}`;

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
