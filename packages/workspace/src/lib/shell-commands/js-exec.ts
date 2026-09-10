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
    const result = await ctx.origCommand(args);
    return { ...result, stderr: explainJsExecFailure(result.stderr) };
  });
}

/**
 * Explain a failure the runtime reports in its own terms. A missing module is
 * the one that misleads: `Cannot find module 'csv-parse'` reads as a package
 * to install, and the runtime cannot load it once installed either.
 */
export function explainJsExecFailure(stderr: string): string {
  const notes: string[] = [];

  const missing = /Cannot find module '([^']+)'/.exec(stderr)?.[1];
  if (missing !== undefined && !missing.startsWith(".")) {
    notes.push(
      `${JS_EXEC_COMMAND.name} has Node's built-in modules (see \`${JS_EXEC_COMMAND.name} --help\`) and relative files only, never a package, installed or not. Code that needs '${missing}' runs with \`${NODE_COMMAND.name}\` after \`${PNPM_COMMAND.name} add ${missing}\`; ${NODE_COMMAND.name} sees only the task folder, so copy an attached file into the task first.`,
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
