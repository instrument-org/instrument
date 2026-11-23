import path from "node:path";

import { runtimeLayout } from "../runtime-dir";
import { INSTRUMENT_COMMAND } from "../../model-text/commands/instrument-command";
import { AGENT_BROWSER_GUIDE_NAME } from "../../model-text/guides/agent-browser-guide";
import { getWorkspaceConfig } from "../workspace-config";
import { writeRuntimeFile } from "./runtime-file";
import { scriptSurfaceOpen } from "./script-surface";

/** What a program that runs `instrument` is told, on stderr, before it exits 127. */
export const INSTRUMENT_STUB_MESSAGE = `${INSTRUMENT_COMMAND.name}: Instrument's commands run in its shell, not from a program. From Python, \`import instrument\` (instrument.app("google-drive").post(...)); from Node, the \`instrument\` global. \`${INSTRUMENT_COMMAND.name} help\` in the shell lists them.`;

/** What a program that runs `agent-browser` is told, on stderr, before it exits 127. */
export const AGENT_BROWSER_STUB_MESSAGE = `${AGENT_BROWSER_GUIDE_NAME}: ${AGENT_BROWSER_GUIDE_NAME} runs in Instrument's shell, not from a program, so a script cannot start it. Repeat steps with a loop in the shell (for n in 1 2 3; do ${AGENT_BROWSER_GUIDE_NAME} eval --stdin < step.js; done), and give a script what a command printed through a pipe or a file (${AGENT_BROWSER_GUIDE_NAME} eval --stdin < rows.js | python parse.py).`;

/**
 * An `instrument` program in the runtime folder's `bin/`, which is first on
 * the PATH of every program the app starts and never on the shell's own,
 * where the builtin answers first anyway. A script that runs `instrument`
 * as a program (`subprocess.run(["instrument", ...])`) is told how to reach
 * it from its own language, and gets nothing else. Written whenever what is
 * there differs; with no script surface (the evals' bash-only arm), none.
 */
export async function ensureInstrumentStub(): Promise<void> {
  if (!scriptSurfaceOpen()) {
    return;
  }
  await writeStub(INSTRUMENT_COMMAND.name, INSTRUMENT_STUB_MESSAGE);
}

/**
 * An `agent-browser` program beside the `instrument` one, for a script that
 * runs `agent-browser` as a program (`subprocess.run(["agent-browser", ...])`).
 * The shell's command is the only one that drives the chat's tabs, so the
 * script is told to loop there, and gets nothing else.
 */
export async function ensureAgentBrowserStub(): Promise<void> {
  await writeStub(AGENT_BROWSER_GUIDE_NAME, AGENT_BROWSER_STUB_MESSAGE);
}

/** Writes a program by `name` that prints `message` on stderr and exits 127. */
async function writeStub(name: string, message: string): Promise<void> {
  const bin = runtimeLayout(getWorkspaceConfig().runtimeDir).bin;
  if (process.platform === "win32") {
    await writeRuntimeFile(
      path.join(bin, `${name}.cmd`),
      `@ECHO OFF\r\n>&2 ECHO ${message.replaceAll(/[&|<>^%]/g, "^$&")}\r\nEXIT /B 127\r\n`,
    );
    return;
  }
  await writeRuntimeFile(
    path.join(bin, name),
    `#!/bin/sh\ncat >&2 <<'EOF'\n${message}\nEOF\nexit 127\n`,
    0o755,
  );
}
