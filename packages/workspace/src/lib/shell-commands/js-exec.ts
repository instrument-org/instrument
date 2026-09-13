import { defineCommand } from "just-bash";

import { TASK_FOLDER_NAMES } from "../../constants";
import { MOUNT } from "../../mount-points";
import { NODE_COMMAND } from "./node";
import { PNPM_COMMAND } from "./pnpm";

/**
 * just-bash's QuickJS runtime, offered beside `node` rather than in place of
 * it. It reads the virtual filesystem directly, so it is the JavaScript that
 * can open an attached folder, and it resolves no `node_modules` at all, which
 * is why `node` keeps the default: the JavaScript an agent writes leans on
 * packages far more often than the Python does.
 */
export const JS_EXEC_COMMAND = {
  description: `Run JavaScript or TypeScript (QuickJS, Node-compatible built-ins: fs, path, child_process, fetch) inside the sandbox: it reads ${MOUNT.attachedFolders} and ${MOUNT.task} paths directly and honors read-only mounts, but resolves NO packages, not even installed ones, and cannot open a file over 8 MB. Code that imports a package runs with \`${NODE_COMMAND.name}\`. \`.ts\` files are type-stripped by extension; inline TypeScript needs \`--strip-types\`.`,
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
    const result = await ctx.origCommand(translated.args);
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
 * Accept Node's inline-code options in front of the runtime's `-c`. An agent
 * reaches for `node -e` by reflex, and the runtime answers `unrecognized
 * option '-e'`, which costs a turn to read `--help` and retry.
 *
 * `-p` prints the value of one expression, as Node does for the last
 * expression statement. A multi-statement program under `-p` is a syntax
 * error here, which the runtime reports as such.
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
    if (print !== null) {
      // The newline keeps a trailing line comment from swallowing the
      // closing parenthesis.
      code = `console.log((${code.replace(/[\s;]+$/, "")}\n))`;
    }
    return { args: [...args.slice(0, index), "-c", code, ...rest] };
  }
  return { args };
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

  const missing = /Cannot find module '([^']+)'/.exec(stderr)?.[1];
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
        `${JS_EXEC_COMMAND.name} has Node's built-in modules (see \`${JS_EXEC_COMMAND.name} --help\`) and relative files only, never a package, installed or not. Code that needs '${missing}' runs with \`${NODE_COMMAND.name}\` after \`${PNPM_COMMAND.name} add ${missing}\`; ${NODE_COMMAND.name} sees only the task folder, so copy an attached file into the task first.`,
      );
    }
  }

  const unavailable =
    /Module '([^']+)' is not available in the js-exec sandbox/.exec(
      stderr,
    )?.[1];
  if (unavailable !== undefined) {
    notes.push(
      `\`${NODE_COMMAND.name}\` has '${unavailable}'; it sees only the task folder, so copy an attached file into the task first.`,
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

  const tooLarge = /Result too large: (\d+) > \d+/.exec(stderr)?.[1];
  if (tooLarge !== undefined) {
    notes.push(
      `${JS_EXEC_COMMAND.name} reads a file whole through an 8 MB bridge, and this one is ${tooLarge} bytes. Copy it into the task (cp '${MOUNT.attachedFolders}/<folder>/<file>' ${TASK_FOLDER_NAMES.attachments}/) and read it with \`${NODE_COMMAND.name}\`, or read only part of it with a shell command (head, tail, rg, xan).`,
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
