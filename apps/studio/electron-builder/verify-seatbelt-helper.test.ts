import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { verifySeatbeltHelper } from "./verify-seatbelt-helper";

/** What `pnpm build:mac-helper` builds on a Mac. */
const BUILT = path.resolve(
  import.meta.dirname,
  "../native/mac-helper/.build/bridge/instrument-seatbelt",
);

describe("verifySeatbeltHelper", () => {
  it.skipIf(process.platform !== "darwin" || !existsSync(BUILT))(
    "compiles, runs under the bytecode, and refuses bytecode it cannot apply",
    () => {
      expect(verifySeatbeltHelper(BUILT).size).toBeGreaterThan(10_000);
    },
  );

  it("throws when the launcher is missing", () => {
    expect(() =>
      verifySeatbeltHelper(path.join(tmpdir(), "no-instrument-seatbelt")),
    ).toThrow(/not found/);
  });

  it.skipIf(process.platform === "win32")(
    "throws when the launcher runs a program it could not sandbox",
    () => {
      // A stand-in that compiles to something and then execs whatever it is
      // handed, the failure the check exists for.
      const dir = mkdtempSync(path.join(tmpdir(), "seatbelt-verify-"));
      const fake = path.join(dir, "instrument-seatbelt");
      writeFileSync(
        fake,
        '#!/bin/sh\nif [ "$1" = compile ]; then printf x; exit 0; fi\nshift 2\nexec "$@"\n',
        { mode: 0o755 },
      );
      expect(() => verifySeatbeltHelper(fake)).toThrow(
        /ran a program whose profile it could not apply/,
      );
    },
  );
});
