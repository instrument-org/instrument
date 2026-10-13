import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";

import { execShim } from "./exec-shim";

// A Mac without the Command Line Tools, where the recheck finds them still
// missing.
vi.mock("../command-line-tools-env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../command-line-tools-env")>()),
  commandLineToolsMissing: () => true,
  recheckCommandLineTools: () => Promise.resolve(true),
}));

/** A stand-in program by `name` that prints `line` and exits 0. */
function program(name: string, line: string): string {
  const file = path.join(
    mkdtempSync(path.join(os.tmpdir(), "install-refused-")),
    name,
  );
  writeFileSync(file, `#!/bin/sh\necho '${line}' >&2\nexit 0\n`);
  chmodSync(file, 0o755);
  return file;
}

const REFUSED =
  "xcode-select: note: no install could be requested (perhaps no UI is present)";

it.runIf(process.platform !== "win32")(
  "fails xcode-select --install the sandbox kept from asking, and says what to do",
  async () => {
    const result = await execShim(
      program("xcode-select", REFUSED),
      ["--install"],
      {},
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("needs Apple's Command Line Tools");
  },
);

it.runIf(process.platform !== "win32")(
  "leaves another program's exit code alone",
  async () => {
    const result = await execShim(program("build", REFUSED), [], {});
    expect(result.exitCode).toBe(0);
  },
);
