import path from "node:path";
import { pathToFileURL } from "node:url";

import { INSTRUMENT_NODE_PRELOAD } from "./capabilities/node-runtime";
import { writeRuntimeFile } from "./capabilities/runtime-file";
import { runtimeLayout } from "./runtime-dir";
import { getWorkspaceConfig } from "./workspace-config";

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
 * The agent's \`node\` is the app's Electron run as Node, which keeps
 * \`process.versions.electron\`. Argument parsers (yargs, commander) take a
 * process with it and no \`process.defaultApp\` for a packaged Electron app,
 * whose argv has no script in it, and hand the script's own path to the
 * program as its first argument. Marked as Electron's default app, it reads
 * argv as Node's.
 */
const ELECTRON_AS_NODE_PRELOAD = `
process.defaultApp ??= true;
`;

/**
 * The module `node` loads with `--import` ahead of the agent's script: the
 * package.json part, the `instrument` global, then Electron's.
 */
const NODE_PRELOAD = `${PACKAGE_SCOPE_PRELOAD}${INSTRUMENT_NODE_PRELOAD}${ELECTRON_AS_NODE_PRELOAD}`;

/**
 * The preload as a `file:` URL for `--import`, written into the runtime
 * folder's `preload/`, which every native command may read inside the
 * sandbox and none may change, so no chat can change what another chat's
 * `node` loads. Written by the app whenever what is there differs, so a
 * build's preload replaces an older one and a deleted file comes back.
 */
export async function nodePreloadUrl(): Promise<string> {
  const file = path.join(
    runtimeLayout(getWorkspaceConfig().runtimeDir).preload,
    "preload.mjs",
  );
  await writeRuntimeFile(file, NODE_PRELOAD);
  return pathToFileURL(file).href;
}
