import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import artwork from "../../../resources/instrument-folder.svg?raw";
import { applyLinuxFolderIcon } from "./output-folder-icon-linux";
import { applyWindowsFolderIcon } from "./output-folder-icon-windows";

const exec = promisify(execFile);
const applied = new Map<string, Promise<void>>();

const SET_ICON_SCRIPT = `
ObjC.import("AppKit");
function run(argv) {
  const data = $.NSData.alloc.initWithBase64EncodedStringOptions(argv[1], 0);
  const image = $.NSImage.alloc.initWithData(data);
  if (!image.isValid) throw Error("Cannot load the output folder icon");
  if (!$.NSWorkspace.sharedWorkspace.setIconForFileOptions(image, argv[0], 0)) {
    throw Error("Cannot set the output folder icon");
  }
}
`;

/** Decorate only the app's default output folder, preserving custom icons. */
export async function ensureOutputFolderIcon(
  folderPath: string,
): Promise<void> {
  if (
    !["darwin", "linux", "win32"].includes(process.platform) ||
    folderPath !== path.join(os.homedir(), "Documents", "Instrument")
  ) {
    return;
  }
  // Once per launch: AppKit's icon writer must be called serially, and each
  // Windows attempt spends a PowerShell process. A failure is retried later.
  let attempt = applied.get(folderPath);
  if (!attempt) {
    attempt = applyIcon(folderPath).catch((error: unknown) => {
      applied.delete(folderPath);
      throw error;
    });
    applied.set(folderPath, attempt);
  }
  await attempt;
}

async function applyIcon(folderPath: string): Promise<void> {
  const folder = await fs.lstat(folderPath);
  if (!folder.isDirectory()) return;
  if (process.platform === "win32") return applyWindowsFolderIcon(folderPath);
  if (process.platform === "linux") return applyLinuxFolderIcon(folderPath);
  let finderInfo: Buffer;
  try {
    const { stdout } = await exec(
      "/usr/bin/xattr",
      ["-px", "com.apple.FinderInfo", folderPath],
      { timeout: 5000 },
    );
    finderInfo = Buffer.from(stdout.replaceAll(/\s/g, ""), "hex");
  } catch (error) {
    // A folder without Finder metadata has no custom icon to preserve.
    if (!(error instanceof Error) || !error.message.includes("No such xattr")) {
      throw error;
    }
    finderInfo = Buffer.alloc(0);
  }
  // Finder's kHasCustomIcon flag is bit 10 of the big-endian flags at byte 8.
  if (finderInfo.length >= 10 && (finderInfo.readUInt16BE(8) & 0x04_00) !== 0) {
    return;
  }
  await exec(
    "/usr/bin/osascript",
    [
      "-l",
      "JavaScript",
      "-e",
      SET_ICON_SCRIPT,
      folderPath,
      Buffer.from(artwork).toString("base64"),
    ],
    { timeout: 5000 },
  );
}
