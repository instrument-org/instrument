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
    const info = Buffer.from(stdout.replace(/\s/g, ""), "hex");
    expect(info.readUInt16BE(8) & 0x0400).toBe(0x0400);
    const icon = await fs.stat(iconFile);
    await ensureOutputFolderIcon(folder);
    expect((await fs.stat(iconFile)).mtimeMs).toBe(icon.mtimeMs);
    const resource = await fs.readFile(`${iconFile}/..namedfork/rsrc`);
    expect(resource.length).toBeGreaterThan(1000);
  });

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
  });

  it("leaves other folders alone, including Instrument outside Documents", async () => {
    for (const other of [
      path.join(home, "Instrument"),
      path.join(home, "Documents", "Other"),
    ]) {
      await fs.mkdir(other);
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
