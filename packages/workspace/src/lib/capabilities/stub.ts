import path from "node:path";

import { runtimeLayout } from "../runtime-dir";
import { INSTRUMENT_COMMAND } from "../shell-commands/instrument-command";
import { getWorkspaceConfig } from "../workspace-config";
import { writeRuntimeFile } from "./runtime-file";
import { scriptSurfaceOpen } from "./script-surface";

/** What a program that runs `instrument` is told, on stderr, before it exits 127. */
export const INSTRUMENT_STUB_MESSAGE = `${INSTRUMENT_COMMAND.name}: Instrument's commands run in its shell, not from a program. From Python, \`import instrument\` (instrument.app("google-drive").post(...)); from Node, the \`instrument\` global. \`${INSTRUMENT_COMMAND.name} help\` in the shell lists them.`;

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
  const bin = runtimeLayout(getWorkspaceConfig().runtimeDir).bin;
  if (process.platform === "win32") {
    await writeRuntimeFile(
      path.join(bin, `${INSTRUMENT_COMMAND.name}.cmd`),
      `@ECHO OFF\r\n>&2 ECHO ${INSTRUMENT_STUB_MESSAGE.replaceAll(/[&|<>^%]/g, "^$&")}\r\nEXIT /B 127\r\n`,
    );
    return;
  }
  await writeRuntimeFile(
    path.join(bin, INSTRUMENT_COMMAND.name),
    `#!/bin/sh\ncat >&2 <<'EOF'\n${INSTRUMENT_STUB_MESSAGE}\nEOF\nexit 127\n`,
    0o755,
  );
}
