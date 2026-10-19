import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ensureOutputFolderIcon } from "./output-folder-icon";

const exec = promisify(execFile);
let home: string;
let folder: string;

// Exercise AppKit and Finder metadata on disposable folders, without Electron.
describe.skipIf(process.platform !== "darwin")("output folder icon", () => {
  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "instrument-folder-icon-"));
    vi.spyOn(os, "homedir").mockReturnValue(home);
    folder = path.join(home, "Documents", "Instrument");
    await fs.mkdir(folder, { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(home, { force: true, recursive: true });
  });

  it("assigns a persistent icon and leaves it unchanged on repeated calls", async () => {
    await Promise.all([
      ensureOutputFolderIcon(folder),
      ensureOutputFolderIcon(folder),
    ]);
    const iconFile = path.join(folder, "Icon\r");
    const { stdout } = await exec("/usr/bin/xattr", [
      "-px",
      "com.apple.FinderInfo",
      folder,
    ]);
    const info = Buffer.from(stdout.replaceAll(/\s/g, ""), "hex");
    expect(info.readUInt16BE(8) & 0x04_00).toBe(0x04_00);
    const icon = await fs.stat(iconFile);
    await ensureOutputFolderIcon(folder);
    const updatedIcon = await fs.stat(iconFile);
    expect(updatedIcon.mtimeMs).toBe(icon.mtimeMs);
    const resource = await fs.readFile(`${iconFile}/..namedfork/rsrc`);
    expect(resource.length).toBeGreaterThan(1000);
  });

  // Two cold AppKit launches through osascript, which take several seconds
  // each while the rest of the suite holds the CPU.
  it("preserves a preexisting custom icon", async () => {
    const script = `ObjC.import("AppKit"); function run(argv) {
      const ws = $.NSWorkspace.sharedWorkspace;
      if (!ws.setIconForFileOptions(ws.iconForFile("/System/Applications/Calculator.app"), argv[0], 0)) throw Error("Cannot set fixture icon");
    }`;
    await exec("/usr/bin/osascript", [
      "-l",
      "JavaScript",
      "-e",
      script,
      folder,
    ]);
    const iconFile = path.join(folder, "Icon\r");
    const before = await fs.readFile(`${iconFile}/..namedfork/rsrc`);
    await ensureOutputFolderIcon(folder);
    const after = await fs.readFile(`${iconFile}/..namedfork/rsrc`);
    expect(after).toEqual(before);
  }, 30_000);

  // The two folders the app names itself are decorated, in the home folder
  // and the older one in Documents; a folder of the person's own is not,
  // whatever it is called.
  it("leaves a folder the app did not name alone, whatever it is called", async () => {
    for (const other of [
      path.join(home, "Projects", "Instrument"),
      path.join(home, "Documents", "Other"),
    ]) {
      await fs.mkdir(other, { recursive: true });
      await ensureOutputFolderIcon(other);
      expect(await fs.readdir(other)).toEqual([]);
    }
  });

  it("does not decorate the target of a symlink at the default location", async () => {
    const target = path.join(home, "elsewhere");
    await fs.mkdir(target);
    await fs.rmdir(folder);
    await fs.symlink(target, folder);
    await ensureOutputFolderIcon(folder);
    expect(await fs.readdir(target)).toEqual([]);
  });
});
