import { type CommandContext, defineCommand, latin1FromBytes } from "just-bash";

import { CHAT_FOLDER_NAMES } from "../../constants";
import { MOUNT } from "../../mount-points";
import { APP_COMMAND } from "./app-command";
import { NODE_COMMAND } from "./node";
import { PNPM_COMMAND } from "./pnpm";

/**
 * just-bash's QuickJS runtime, offered beside `node` rather than in place of
 * it. It reads the virtual filesystem directly, so it is the JavaScript that
 * can open a folder mount, and it resolves no `node_modules` at all, which
 * is why `node` keeps the default: the JavaScript an agent writes leans on
 * packages far more often than the Python does.
 */
export const JS_EXEC_COMMAND = {
  description: `Run JavaScript or TypeScript (QuickJS, Node-compatible built-ins: fs, path, child_process, fetch) inside the sandbox: it reads ${MOUNT.folders} and ${MOUNT.task} paths directly and honors read-only mounts, but resolves NO packages, not even installed ones, and cannot open a file over 6 MB. Code that imports a package runs with \`${NODE_COMMAND.name}\`. TypeScript types are stripped wherever they appear. \`await tools.<slug>.<tool>({...})\` calls a connected app's tool as \`${APP_COMMAND.name} call\` does and returns the result as a value.`,
  name: "js-exec",
} as const;

/**
 * The runtime's own help lists `-c` alone. The two lines added under it
 * document the Node spellings this command accepts on its behalf.
 */
const HELP_INLINE_OPTION = "  -c CODE          Execute inline code\n";
const HELP_NODE_OPTIONS =
  "  -e, --eval CODE  Execute inline code (Node's spelling of -c)\n" +
  "  -p, --print EXPR Evaluate an expression and print its value\n";

export function createJsExecCommand() {
  return defineCommand(JS_EXEC_COMMAND.name, async (args, ctx) => {
    // The bundled runtime this command shadows. Absent only if the shell was
    // built without `javascript: true`, which no caller does.
    if (ctx.origCommand === undefined) {
      return {
        exitCode: 1,
        stderr: `${JS_EXEC_COMMAND.name}: the sandboxed runtime is not registered in this shell.\n`,
        stdout: "",
      };
    }
    const translated = translateNodeOptions(args);
    if ("exitCode" in translated) {
      return translated;
    }
    const result = await ctx.origCommand(
      (await usesModuleSyntax(translated.args, ctx))
        ? ["-m", ...translated.args]
        : translated.args,
    );
    return {
      ...result,
      stderr: explainJsExecFailure(result.stderr),
      // The runtime answers `--help` anywhere in the arguments.
      stdout: translated.args.includes("--help")
        ? result.stdout.replace(
            HELP_INLINE_OPTION,
            HELP_INLINE_OPTION + HELP_NODE_OPTIONS,
          )
        : result.stdout,
    };
  });
}

/**
 * Whether every quote in `code` is closed, so that a `//` or a `/*` at its
 * end is a comment rather than the inside of a string.
 */
function quotesBalanced(code: string): boolean {
  let open: string | undefined;
  for (let index = 0; index < code.length; index++) {
    const char = code[index];
    if (open === undefined) {
      if (char === "'" || char === '"' || char === "`") open = char;
    } else if (char === "\\") {
      index++;
    } else if (char === open) {
      open = undefined;
    }
  }
  return open === undefined;
}

/**
 * The program without the trailing semicolons and comments that end a typed
 * expression (`1; // two`), so it can sit in an expression position.
 */
function trailingExpression(code: string): string {
  let expression = code;
  for (;;) {
    const trimmed = expression.trimEnd();
    let next = trimmed;
    if (trimmed.endsWith(";")) {
      next = trimmed.slice(0, -1);
    } else if (trimmed.endsWith("*/")) {
      const start = trimmed.lastIndexOf("/*");
      if (start !== -1 && quotesBalanced(trimmed.slice(0, start))) {
        next = trimmed.slice(0, start);
      }
    } else {
      // A `//` inside a string, or one whose first slash is escaped (the
      // end of a regex like /https:\/\//), is not a comment.
      let commentStart = trimmed.indexOf("//", trimmed.lastIndexOf("\n") + 1);
      while (
        commentStart !== -1 &&
        (trimmed[commentStart - 1] === "\\" ||
          !quotesBalanced(trimmed.slice(0, commentStart)))
      ) {
        commentStart = trimmed.indexOf("//", commentStart + 1);
      }
      if (commentStart !== -1) next = trimmed.slice(0, commentStart);
    }
    if (next === expression) return expression;
    expression = next;
  }
}

/**
 * Accept Node's inline-code options in front of the runtime's `-c`. An agent
 * reaches for `node -e` by reflex, and the runtime answers `unrecognized
 * option '-e'`, which costs a turn to read `--help` and retry.
 */
function translateNodeOptions(
  args: string[],
): { args: string[] } | { exitCode: number; stderr: string; stdout: string } {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === undefined) {
      break;
    }
    // The runtime takes the first option-looking argument that is not its
    // own as the error, so translation stops at the same place: past the
    // script file or `--`, everything belongs to the script.
    if (!arg.startsWith("-") || arg === "-" || arg === "--" || arg === "-c") {
      break;
    }
    const inline = /^(?:-e|--eval)(?:=(.*))?$/s.exec(arg);
    const print = /^(?:-p|--print)(?:=(.*))?$/s.exec(arg);
    const match = inline ?? print;
    if (match === null) {
      continue;
    }
    let code = match[1];
    let rest = args.slice(index + 1);
    if (code === undefined) {
      code = rest[0];
      rest = rest.slice(1);
      if (code === undefined) {
        return {
          exitCode: 2,
          stderr: `${JS_EXEC_COMMAND.name}: option requires an argument -- '${arg.replace(/^-+/, "")}'\n`,
          stdout: "",
        };
      }
    }
    return {
      args: [
        ...args.slice(0, index),
        "-c",
        print === null ? code : printSource(code),
        ...rest,
      ],
    };
  }
  return { args };
}

/**
 * A line opening with a static `import` or `export`, or `import.meta`
 * anywhere. A dynamic `import(...)` runs in a script and does not count.
 */
const MODULE_SYNTAX =
  /^[ \t]*(?:import(?:[ \t]+[\w$*{"']|[ \t]*[{*"'])|export(?:[ \t]+[\w$*{]|[ \t]*[{*]))|\bimport\.meta\b/m;

/**
 * Whether the code to run is an ES module the runtime would run as a script.
 * The runtime runs `.mjs`, `.mts`, and `.ts` as modules and everything else
 * as the body of an async function; Node also detects `import` and `export`,
 * and without that a `.js` file or `-e` code that imports `fs` fails with
 * `Unexpected identifier 'fs'`, which reads as the code being wrong. Running
 * CommonJS as a module costs nothing here, since `require` and `module` stay
 * defined, so a false positive is harmless.
 */
async function usesModuleSyntax(
  args: string[],
  ctx: CommandContext,
): Promise<boolean> {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === undefined || arg === "-m" || arg === "--module") {
      return false;
    }
    if (arg === "-c") {
      return MODULE_SYNTAX.test(args[index + 1] ?? "");
    }
    if (!arg.startsWith("-")) {
      if (arg.endsWith(".cjs")) {
        return false;
      }
      try {
        const source = await ctx.fs.readFile(ctx.fs.resolvePath(ctx.cwd, arg));
        return MODULE_SYNTAX.test(source);
      } catch {
        // The runtime reports a file it cannot open in its own words.
        return false;
      }
    }
  }
  return MODULE_SYNTAX.test(latin1FromBytes(ctx.stdin));
}

/**
 * How `-p` prints a value: a string as it is, and the rest the way Node
 * inspects them where the runtime's `console.log` (JSON) would lose them: a
 * RegExp as `{}`, a Symbol or a function as nothing. Objects and arrays stay
 * JSON, as `console.log` prints them everywhere in this runtime. A
 * declaration, so it hoists above the expression and the expression keeps
 * its place on line 1.
 */
const PRINT_VALUE = `function __jbPrint(v) { console.log(typeof v === 'string' ? v : typeof v === 'symbol' ? v.toString() : typeof v === 'bigint' ? v + 'n' : typeof v === 'function' ? (v.name ? '[Function: ' + v.name + ']' : '[Function (anonymous)]') : v instanceof RegExp ? String(v) : v instanceof Date ? v.toISOString() : v instanceof Error ? String(v) + (v.stack ? '\\n' + v.stack : '') : v === undefined || v === null || typeof v === 'number' || typeof v === 'boolean' ? String(v) : (function () { try { return JSON.stringify(v); } catch (_) { return String(v); } })()); }`;

/**
 * `-p` prints the value of one expression, which is what Node prints for a
 * single expression statement; an empty program prints `undefined`, as Node
 * does. A program of several statements is a syntax error here, which the
 * runtime reports as such. The newline after the expression keeps a comment
 * inside it from swallowing the closing parenthesis.
 */
function printSource(code: string): string {
  const expression = trailingExpression(code);
  return `__jbPrint((${expression === "" ? "undefined" : expression}\n));\n${PRINT_VALUE}`;
}

/**
 * Names `js-exec --help` lists, so an import of `<name>/<subpath>` can be
 * told apart from a package: the module is here, the subpath is not.
 */
const BUILTIN_MODULES = new Set([
  "assert",
  "buffer",
  "child_process",
  "events",
  "fs",
  "os",
  "path",
  "process",
  "querystring",
  "stream",
  "string_decoder",
  "url",
  "util",
]);

/**
 * Explain a failure the runtime reports in its own terms. A missing module is
 * the one that misleads: `Cannot find module 'csv-parse'` reads as a package
 * to install, and the runtime cannot load it once installed either.
 */
function explainJsExecFailure(stderr: string): string {
  const notes: string[] = [];

  // A named ESM import of a missing module fails at link time, naming the
  // runtime's placeholder for it rather than the module.
  const missing = (
    /Cannot find module '([^']+)'/.exec(stderr)?.[1] ??
    /Could not find export '[^']+' in module 'just-bash:missing:([^']+)'/.exec(
      stderr,
    )?.[1]
  )?.replace(/^node:/, "");
  if (missing !== undefined && !missing.startsWith(".")) {
    const [top = missing] = missing.split("/");
    if (missing.includes("/") && BUILTIN_MODULES.has(top)) {
      // The bootstrap answers `require('fs/promises')`; an ESM import goes
      // through the runtime's own loader, which knows the top-level names
      // only.
      notes.push(
        `'${missing}' is a subpath of a built-in module, and ${JS_EXEC_COMMAND.name} loads only the module itself: \`import ${top} from 'node:${top}'\` and reach it from there (fs/promises is fs.promises, path/posix is path.posix).`,
      );
    } else {
      notes.push(
        `${JS_EXEC_COMMAND.name} has Node's built-in modules (see \`${JS_EXEC_COMMAND.name} --help\`) and relative files only, never a package, installed or not. Code that needs '${missing}' runs with \`${NODE_COMMAND.name}\` after \`${PNPM_COMMAND.name} add ${missing}\`; ${NODE_COMMAND.name} sees only the task folder, so copy a file from a folder mount into the task first.`,
      );
    }
  }

  const unavailable =
    /Module '([^']+)' is not available in the js-exec sandbox/.exec(
      stderr,
    )?.[1];
  if (unavailable !== undefined) {
    notes.push(
      `\`${NODE_COMMAND.name}\` has '${unavailable}'; it sees only the task folder, so copy a file from a folder mount into the task first.`,
    );
  }

  const timer =
    /'(setTimeout|setInterval|setImmediate|clearTimeout|clearInterval)' is not defined/.exec(
      stderr,
    )?.[1];
  if (timer !== undefined) {
    notes.push(
      `${JS_EXEC_COMMAND.name} has no timers and no event loop: a script runs to completion, and fetch() and fs settle before their promises do. Drop the delay behind ${timer}, or run the script with \`${NODE_COMMAND.name}\`.`,
    );
  }

  const limit =
    /File exceeds JavaScript bridge read limit \((\d+) bytes\)/.exec(
      stderr,
    )?.[1];
  if (limit !== undefined) {
    notes.push(
      `${JS_EXEC_COMMAND.name} reads a file whole through a bridge that carries at most ${limit} bytes, and this one is larger. Copy it into the task (cp '${MOUNT.folders}/<folder>/<file>' ${CHAT_FOLDER_NAMES.attachments}/) and read it with \`${NODE_COMMAND.name}\`, or read only part of it with a shell command (head, tail, rg, xan).`,
    );
  }

  if (/Execution timeout: exceeded \d+ms limit/.test(stderr)) {
    notes.push(
      `${JS_EXEC_COMMAND.name} is capped at that much run time. For longer work, run the script with \`${NODE_COMMAND.name}\`, which is a real process and can keep running in the background.`,
    );
  }

  let text = stderr;
  for (const note of notes) {
    text += `${JS_EXEC_COMMAND.name}: ${note}\n`;
  }
  return text;
}
