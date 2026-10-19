// Guards the Seatbelt launcher (native/mac-helper/seatbelt) in a packaged
// macOS app: it is there, and, where the build host can run it, it compiles
// a profile, runs a program under the bytecode, and refuses to run anything
// when the bytecode cannot be applied. That last one is the promise the app
// relies on: a launcher that ran the program anyway would run it
// unsandboxed.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";

const PERMISSIVE_PROFILE = "(version 1)(allow default)";

export function verifySeatbeltHelper(
  file: string,
  { execute = true }: { execute?: boolean } = {},
): { size: number } {
  if (!existsSync(file)) {
    throw new Error(
      `Seatbelt launcher not found at ${file}. Run \`pnpm build:mac-helper\` before packaging; without it every native command starts through sandbox-exec, about three times slower.`,
    );
  }
  const { size } = statSync(file);
  if (!execute) {
    return { size };
  }
  const bytecode = execFileSync(file, ["compile"], {
    input: PERMISSIVE_PROFILE,
  });
  if (bytecode.length === 0) {
    throw new Error(`Seatbelt launcher at ${file} compiled no bytecode.`);
  }
  const ran = spawnSync(
    file,
    ["run", bytecode.toString("base64"), "/bin/echo", "sandboxed"],
    { encoding: "utf8" },
  );
  if (ran.status !== 0 || ran.stdout.trim() !== "sandboxed") {
    throw new Error(
      `Seatbelt launcher at ${file} did not run a program under compiled bytecode (exit ${String(ran.status)}): ${ran.stderr}`,
    );
  }
  const refused = spawnSync(
    file,
    ["run", Buffer.from("not bytecode").toString("base64"), "/bin/echo", "ran"],
    { encoding: "utf8" },
  );
  if (refused.status !== 126 || refused.stdout.includes("ran")) {
    throw new Error(
      `Seatbelt launcher at ${file} ran a program whose profile it could not apply (exit ${String(refused.status)}).`,
    );
  }
  return { size };
}
