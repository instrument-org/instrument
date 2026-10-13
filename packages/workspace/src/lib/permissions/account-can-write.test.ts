import { chmodSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { accountCanWrite } from "./account-can-write";

describe.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "accountCanWrite",
  () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "account-can-write-"));
    const locked = path.join(root, "locked");
    mkdirSync(locked);
    chmodSync(locked, 0o555);
    afterAll(() => {
      chmodSync(locked, 0o755);
      rmSync(root, { force: true, recursive: true });
    });

    it.each([
      ["a folder this account owns", path.join(root, "new", "file.txt"), true],
      ["a folder with no write bit", path.join(locked, "file.txt"), false],
      ["a missing path in it", path.join(locked, "a", "b.txt"), false],
      ["the system's own", "/usr/bin/zz", false],
      ["a pseudo folder", "/proc/self/zz", false],
    ])("%s", (_name, target, expected) => {
      expect(accountCanWrite(target)).toBe(expected);
    });
  },
);
