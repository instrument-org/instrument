import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { setupBinDirectory } from "./setup-bin-directory";

const { captureServerException } = vi.hoisted(() => ({
  captureServerException: vi.fn(),
}));

vi.mock("./capture-server-exception", () => ({ captureServerException }));

// A real directory, because the link juggling under test is real `fs` work.
let userDataDir = "";
const binDir = () => path.join(userDataDir, "bin");

vi.mock("electron", () => ({
  app: {
    // Nowhere real, so every bundled-binary target fails its access check and
    // the test stays about the node link.
    getAppPath: () => path.join(os.tmpdir(), "setup-bin-directory-no-app"),
    getPath: () => userDataDir,
    isPackaged: false,
  },
}));

// The node entry is a symlink on POSIX; Windows writes a .cmd shim instead,
// which overwrites without any of the collisions under test.
describe.runIf(process.platform !== "win32")("setupBinDirectory", () => {
  const originalPath = process.env.PATH;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    userDataDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "setup-bin-directory-"),
    );

    return async () => {
      process.env.PATH = originalPath;
      await fs.rm(userDataDir, { force: true, recursive: true });
    };
  });

  it("still boots when a bin/node entry survives the wipe", async () => {
    // A locked file the per-entry rm cannot remove, or another instance's
    // relink landing between this boot's wipe and its own: either way the
    // entry is already there when the symlink is attempted.
    await fs.mkdir(binDir(), { recursive: true });
    await fs.writeFile(path.join(binDir(), "node"), "");
    vi.spyOn(fs, "rm").mockResolvedValue(undefined);

    await expect(setupBinDirectory()).resolves.toBe(binDir());

    expect(process.env.PATH?.split(path.delimiter)[0]).toBe(binDir());
    // An entry that already exists is routine, not an exception report.
    expect(captureServerException).not.toHaveBeenCalled();
  });

  it("records a node link failure and degrades like the other binaries", async () => {
    const failure = Object.assign(new Error("EPERM: operation not permitted"), {
      code: "EPERM",
    });
    vi.spyOn(fs, "symlink").mockRejectedValue(failure);

    await expect(setupBinDirectory()).resolves.toBe(binDir());

    expect(process.env.PATH?.split(path.delimiter)[0]).toBe(binDir());
    expect(captureServerException).toHaveBeenCalledWith(failure, {
      scopes: ["studio"],
    });
  });
});
