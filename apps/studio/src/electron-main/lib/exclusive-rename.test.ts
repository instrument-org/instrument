import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renameExclusive } from "./exclusive-rename";

// The bridge stands aside, so this is the rename every other system gets.
vi.mock("./mac-native", () => ({
  renameExclusive: () => Promise.resolve(false),
}));

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(tmpdir(), "exclusive-rename-"));
  await fs.writeFile(path.join(dir, "a"), "a");
  await fs.writeFile(path.join(dir, "b"), "b");
});
afterEach(async () => {
  await fs.rm(dir, { force: true, recursive: true });
});

it("refuses a name that is taken, touching neither", async () => {
  await expect(
    renameExclusive(path.join(dir, "a"), path.join(dir, "b")),
  ).rejects.toMatchObject({ code: "EEXIST" });
  expect(await fs.readFile(path.join(dir, "b"), "utf8")).toBe("b");
  expect(await fs.readFile(path.join(dir, "a"), "utf8")).toBe("a");
});

it("refuses an empty folder in the way, which a plain rename would replace", async () => {
  await fs.mkdir(path.join(dir, "empty"));
  await fs.mkdir(path.join(dir, "folder"));

  await expect(
    renameExclusive(path.join(dir, "folder"), path.join(dir, "empty")),
  ).rejects.toMatchObject({ code: "EEXIST" });
});

it("renames to a name nothing has", async () => {
  await renameExclusive(path.join(dir, "a"), path.join(dir, "c"));
  expect((await fs.readdir(dir)).toSorted()).toEqual(["b", "c"]);
});

// The Mac's own exclusive rename, from the module the app loads, where it
// has been built.
const MODULE = path.join(
  import.meta.dirname,
  "../../../native/mac-helper/.build/bridge/instrument-mac.node",
);
describe.runIf(process.platform === "darwin" && existsSync(MODULE))(
  "the Mac module's rename",
  () => {
    it("refuses a taken name in one step, and renames to a free one", async () => {
      // Required here rather than in the suite's body, which vitest runs
      // while collecting even a suite `runIf` skips.
      // `as`: a native module's exports are untyped; this is FUNCTIONS in addon.m.
      const native = createRequire(import.meta.url)(MODULE) as {
        renameExclusive: (from: string, to: string) => Promise<string>;
      };
      expect(
        JSON.parse(
          await native.renameExclusive(
            path.join(dir, "a"),
            path.join(dir, "b"),
          ),
        ),
      ).toMatchObject({ code: "EEXIST" });
      expect(
        JSON.parse(
          await native.renameExclusive(
            path.join(dir, "a"),
            path.join(dir, "c"),
          ),
        ),
      ).toEqual({ renamed: true });
      expect(await fs.readFile(path.join(dir, "b"), "utf8")).toBe("b");
    });
  },
);
