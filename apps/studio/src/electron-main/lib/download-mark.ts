import { app } from "electron";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Whether the system marks a file as downloaded from the internet, read where
 * its path really leads, so a link to it carries the mark too. A browser
 * marks what it saves: macOS by the `com.apple.quarantine` attribute, Windows
 * by a `Zone.Identifier` stream naming the Internet zone (3) or an untrusted
 * one (4). Linux browsers write `user.xdg.origin.url`, which Node cannot read
 * without a native module, so there a file in the Downloads folder counts as
 * marked and nothing else does. A path that does not lead to a file counts as
 * marked, since nothing then shows it is not.
 */
export async function isFromInternet(
  hostPath: string,
  {
    downloads = () => app.getPath("downloads"),
    platform = process.platform,
  }: {
    downloads?: () => string;
    platform?: NodeJS.Platform;
  } = {},
): Promise<boolean> {
  let real: string;
  try {
    real = await fs.realpath(hostPath);
  } catch {
    return true;
  }
  switch (platform) {
    case "darwin": {
      return hasQuarantine(real);
    }
    case "win32": {
      return (zoneOf(await zoneIdentifierOf(real)) ?? 0) >= 3;
    }
    default: {
      return isInDownloads(real, downloads);
    }
  }
}

async function hasQuarantine(real: string) {
  try {
    await run("/usr/bin/xattr", ["-p", "com.apple.quarantine", real], {
      timeout: 2000,
    });
    return true;
  } catch {
    // A nonzero exit is no such attribute.
    return false;
  }
}

async function zoneIdentifierOf(real: string) {
  try {
    const bytes = await fs.readFile(`${real}:Zone.Identifier`);
    // Browsers write it in the system's code page; some writers in UTF-16.
    return bytes[0] === 0xff && bytes[1] === 0xfe
      ? bytes.subarray(2).toString("utf16le")
      : bytes.toString("utf8");
  } catch {
    return "";
  }
}

/** The zone a `Zone.Identifier` stream names, or undefined for none. */
export function zoneOf(stream: string): number | undefined {
  const zone = /^\s*ZoneId\s*=\s*(\d+)\s*$/im.exec(stream)?.[1];
  return zone === undefined ? undefined : Number(zone);
}

async function isInDownloads(real: string, downloads: () => string) {
  let folder: string;
  try {
    folder = await fs.realpath(downloads());
  } catch {
    return false;
  }
  const relative = path.relative(folder, real);
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}
