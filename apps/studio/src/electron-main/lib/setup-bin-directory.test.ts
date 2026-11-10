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
const binDir = () => path.join(userDataDir, "runtime", "bin");

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

  it("leaves the links alone when a launch finds them as the last one left them", async () => {
    await setupBinDirectory();
    const rm = vi.spyOn(fs, "rm");
    const symlink = vi.spyOn(fs, "symlink");

    await expect(setupBinDirectory()).resolves.toBe(binDir());

    expect(rm).not.toHaveBeenCalled();
    expect(symlink).not.toHaveBeenCalled();
    expect(process.env.PATH?.split(path.delimiter)[0]).toBe(binDir());
  });

  it.each([
    [
      "a link is gone",
      () => fs.rm(path.join(binDir(), "node"), { force: true }),
    ],
    [
      "the record names another target",
      () =>
        fs.writeFile(
          path.join(binDir(), ".links.json"),
          JSON.stringify([{ name: "node", targetPath: "/elsewhere/node" }]),
        ),
    ],
  ])("links again when %s", async (_, change) => {
    await setupBinDirectory();
    await change();
    const symlink = vi.spyOn(fs, "symlink");

    await setupBinDirectory();

    expect(symlink).toHaveBeenCalledWith(
      process.execPath,
      path.join(binDir(), "node"),
    );
    await expect(fs.readlink(path.join(binDir(), "node"))).resolves.toBe(
      process.execPath,
    );
  });

  it("records a node link failure and degrades like the other binaries", async () => {
    const failure = Object.assign(new Error("EPERM: operation not permitted"), {
      code: "EPERM",
    });
    vi.spyOn(fs, "symlink").mockRejectedValue(failure);

    await expect(setupBinDirectory()).resolves.toBe(binDir());

    expect(process.env.PATH?.split(path.delimiter)[0]).toBe(binDir());
    expect(captureServerException).toHaveBeenCalledWith(failure);
  });
});

// Run anywhere: a hardlink and a .cmd file are plain `fs` work on every system.
describe("setupBinDirectory on Windows", () => {
  const originalPath = process.env.PATH;
  const platform = process.platform;
  const execPath = process.execPath;
  let appDir = "";

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    userDataDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "setup-bin-directory-"),
    );
    // An app folder of its own: the program, and the files it starts from.
    appDir = await fs.mkdtemp(path.join(os.tmpdir(), "setup-bin-app-"));
    for (const file of [
      "Instrument.exe",
      "icudtl.dat",
      "snapshot_blob.bin",
      "v8_context_snapshot.bin",
    ]) {
      await fs.writeFile(path.join(appDir, file), file);
    }
    Object.defineProperty(process, "platform", { value: "win32" });
    Object.defineProperty(process, "execPath", {
      value: path.join(appDir, "Instrument.exe"),
    });

    return async () => {
      Object.defineProperty(process, "platform", { value: platform });
      Object.defineProperty(process, "execPath", { value: execPath });
      process.env.PATH = originalPath;
      await fs.rm(userDataDir, { force: true, recursive: true });
      await fs.rm(appDir, { force: true, recursive: true });
    };
  });

  it("links node.exe to the app's program, with the files it starts from beside it", async () => {
    await setupBinDirectory();

    for (const file of [
      "icudtl.dat",
      "snapshot_blob.bin",
      "v8_context_snapshot.bin",
    ]) {
      const [linked, original] = await Promise.all([
        fs.stat(path.join(binDir(), file)),
        fs.stat(path.join(appDir, file)),
      ]);
      expect(linked.ino).toBe(original.ino);
    }
    const [node, program] = await Promise.all([
      fs.stat(path.join(binDir(), "node.exe")),
      fs.stat(path.join(appDir, "Instrument.exe")),
    ]);
    expect(node.ino).toBe(program.ino);
    await expect(fs.access(path.join(binDir(), "node.cmd"))).rejects.toThrow();
  });

  it("writes a node.cmd shim when the program cannot be linked", async () => {
    const failure = Object.assign(new Error("EXDEV: cross-device link"), {
      code: "EXDEV",
    });
    vi.spyOn(fs, "link").mockRejectedValue(failure);

    await setupBinDirectory();

    await expect(
      fs.readFile(path.join(binDir(), "node.cmd"), "utf8"),
    ).resolves.toContain(process.execPath);
    await expect(fs.access(path.join(binDir(), "node.exe"))).rejects.toThrow();
    expect(captureServerException).toHaveBeenCalledWith(failure);
  });

  it("links again once an update writes a new program at the same path", async () => {
    await setupBinDirectory();
    const link = vi.spyOn(fs, "link");
    await setupBinDirectory();
    expect(link).not.toHaveBeenCalled();

    // An update replaces the file: a new one at the same path.
    await fs.rm(path.join(appDir, "Instrument.exe"));
    await fs.writeFile(path.join(appDir, "Instrument.exe"), "a newer build");
    await setupBinDirectory();

    await expect(
      fs.readFile(path.join(binDir(), "node.exe"), "utf8"),
    ).resolves.toBe("a newer build");
  });
});
