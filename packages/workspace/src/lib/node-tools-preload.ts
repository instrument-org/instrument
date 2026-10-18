import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { runtimeLayout } from "./runtime-dir";
import { getWorkspaceConfig } from "./workspace-config";

/**
 * The variable that tells the preload where the `node` command listens for
 * its tool calls: `<port>:<token>` on 127.0.0.1.
 */
const TOOLS_ENV = "INSTRUMENT_TOOLS";

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
 * - loading (the same hooks): a file resolved without a format, such as the
 *   script `node <script>` starts, which the `--import` preload sends
 *   through the ES module loader, is loaded with the format detected the
 *   same way;
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
  load(url, context, nextLoad) {
    try {
      return nextLoad(url, context);
    } catch (error) {
      if (!scopeRefused(error) || !url.startsWith("file:")) throw error;
      return nextLoad(url, {
        ...context,
        format: detectedFormat(fileURLToPath(url)),
      });
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
 * The preload's second part, `tools`: a proxy whose `tools.<slug>.<tool>(args)`
 * sends the call to the `node` command over a loopback connection the command
 * listens on for this one process, and resolves to the value the command
 * sends back, or throws its refusal. Loopback TCP is the channel on every
 * platform since a sandbox lets a program connect to it, where Node's IPC
 * handle does not reach a program MXC holds. The port and the token that
 * opens it come in `INSTRUMENT_TOOLS`, which the preload takes out of the
 * environment before the script runs, so a process the script starts gets
 * neither; a program that read it anyway could call what `app call` can.
 *
 * It keeps out of the way of the script's own code: it defines nothing when
 * there is no channel or when `tools` already exists, the global is
 * non-enumerable (so walking the globals never shows it) and writable and
 * configurable (so a package assigning its own `tools` replaces it), and it
 * connects at the first call and holds the process open only while a call
 * is waiting, so a script that never calls a tool exits when its own work
 * is done.
 */
const TOOLS_PRELOAD = `
import { connect } from "node:net";

const toolsAt = process.env.${TOOLS_ENV};
delete process.env.${TOOLS_ENV};
if (globalThis.tools === undefined && toolsAt !== undefined) {
  const [port, token] = toolsAt.split(":");
  const pending = new Map();
  let nextId = 0;
  let socket;
  let received = "";
  const fail = (error) => {
    socket = undefined;
    received = "";
    for (const call of pending.values()) call.reject(error);
    pending.clear();
  };
  const onReply = (reply) => {
    const call = pending.get(reply.id);
    if (call === undefined) return;
    pending.delete(reply.id);
    if (pending.size === 0) socket?.unref();
    if (typeof reply.error === "string") {
      call.reject(new Error(reply.error));
    } else {
      call.resolve(JSON.parse(reply.result));
    }
  };
  const connection = () => {
    if (socket !== undefined) return socket;
    const opened = connect({ host: "127.0.0.1", noDelay: true, port: Number(port) });
    opened.setEncoding("utf8");
    opened.write(token + "\\n");
    opened.on("data", (chunk) => {
      received += chunk;
      for (let end = received.indexOf("\\n"); end !== -1; end = received.indexOf("\\n")) {
        const line = received.slice(0, end);
        received = received.slice(end + 1);
        onReply(JSON.parse(line));
      }
    });
    opened.on("error", fail);
    opened.on("close", () => fail(new Error("The app closed the connection tools use.")));
    socket = opened;
    return opened;
  };
  const invoke = (toolPath, args) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { reject, resolve });
      const open = connection();
      open.ref();
      open.write(JSON.stringify({ argsJson: JSON.stringify(args ?? {}), id, path: toolPath }) + "\\n");
    });
  const at = (toolPath) =>
    new Proxy(function tools() {}, {
      apply: (_target, _this, [args]) => invoke(toolPath, args),
      get: (_target, key) =>
        typeof key === "string" && key !== "then"
          ? at(toolPath === "" ? key : toolPath + "." + key)
          : undefined,
    });
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

/** A tool call the preload sends, one JSON line each. */
interface ToolCall {
  argsJson: string;
  id: number;
  path: string;
}

function isToolCall(value: unknown): value is ToolCall {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "number" &&
    "path" in value &&
    typeof value.path === "string" &&
    "argsJson" in value &&
    typeof value.argsJson === "string"
  );
}

/** The reply to one tool call, from what answered it. */
async function answerToolCall(
  call: ToolCall,
  invoke: () => Promise<string>,
): Promise<{ error: string; id: number } | { id: number; result: string }> {
  try {
    return { id: call.id, result: await invoke() };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      id: call.id,
    };
  }
}

/** Longest a connection may write before giving its token. */
const TOKEN_LINE_LIMIT = 256;

/**
 * Where one `node` process calls tools: a listener on 127.0.0.1 that takes
 * a connection only once its first line is the token, then answers each
 * call line with `answer`. The token opens exactly what `app call` opens:
 * every call goes through the same `answer` the command was given.
 */
export interface ToolsChannel {
  /** The variable to start the process with. */
  env: Record<string, string>;
  /**
   * The signal calls run under from now on: a stage handing its stdout on
   * outlives the command that started it.
   */
  attach(signal: AbortSignal): void;
  /** Stops listening and drops every connection, once the process is gone. */
  close(): void;
}

export async function openToolsChannel(
  answer: (
    toolPath: string,
    argsJson: string,
    signal?: AbortSignal,
  ) => Promise<string>,
): Promise<ToolsChannel> {
  const token = randomBytes(32).toString("hex");
  const expected = Buffer.from(token);
  const sockets = new Set<net.Socket>();
  let signal: AbortSignal | undefined;
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    socket.setNoDelay(true);
    let opened = false;
    let received = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      received = Buffer.concat([received, chunk]);
      for (
        let end = received.indexOf(10);
        end !== -1;
        end = received.indexOf(10)
      ) {
        const line = received.subarray(0, end);
        received = received.subarray(end + 1);
        if (!opened) {
          if (
            line.length !== expected.length ||
            !timingSafeEqual(line, expected)
          ) {
            socket.destroy();
            return;
          }
          opened = true;
          continue;
        }
        let call: unknown;
        try {
          call = JSON.parse(line.toString("utf8"));
        } catch {
          socket.destroy();
          return;
        }
        if (!isToolCall(call)) {
          socket.destroy();
          return;
        }
        void answerToolCall(call, () =>
          answer(call.path, call.argsJson, signal),
        ).then((reply) => {
          if (!socket.destroyed) {
            socket.write(`${JSON.stringify(reply)}\n`);
          }
        });
      }
      if (!opened && received.length > TOKEN_LINE_LIMIT) {
        socket.destroy();
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    attach(next) {
      signal = next;
    },
    close() {
      server.close();
      for (const socket of sockets) {
        socket.destroy();
      }
    },
    env: { [TOOLS_ENV]: `${port}:${token}` },
  };
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
