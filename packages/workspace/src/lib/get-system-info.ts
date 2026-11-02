import { readFile } from "node:fs/promises";
import os from "node:os";

import { readComputerName } from "./records/device-file";

/** Windows 11 kept the 10.0 release; its builds start here. */
const FIRST_WINDOWS_11_BUILD = 22_000;

/**
 * The OS as its own settings name it: "macOS 27.0.1", "Windows 11 (build
 * 26100)", "Ubuntu 24.04 LTS (Linux 6.8.0)". The kernel's release is not the
 * OS's version on macOS, and on Windows 11 it still reads 10.0, so a model
 * told only the release names the wrong system.
 */
export async function osName(
  platform: NodeJS.Platform = process.platform,
  release: string = os.release(),
): Promise<string> {
  switch (platform) {
    case "darwin": {
      const version = await readPlistString(
        "/System/Library/CoreServices/SystemVersion.plist",
        "ProductVersion",
      );
      return version === undefined
        ? `macOS (Darwin ${release})`
        : `macOS ${version}`;
    }
    case "win32": {
      const build = Number(release.split(".")[2]);
      if (!Number.isInteger(build)) {
        return `Windows ${release}`;
      }
      const major = build >= FIRST_WINDOWS_11_BUILD ? "11" : "10";
      return `Windows ${major} (build ${build})`;
    }
    case "linux": {
      const distro = await readOsReleaseName();
      return distro === undefined
        ? `Linux ${release}`
        : `${distro} (Linux ${release})`;
    }
    default: {
      return `${platform} ${release}`;
    }
  }
}

async function readPlistString(file: string, key: string) {
  const text = await readFile(file, "utf8").catch(() => undefined);
  const match = text?.match(
    new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`),
  );
  return match?.[1];
}

async function readOsReleaseName() {
  const text = await readFile("/etc/os-release", "utf8").catch(() => undefined);
  const match = text?.match(/^PRETTY_NAME="?([^"\n]+)"?$/m);
  return match?.[1];
}

let systemInfo: Promise<string> | undefined;

/**
 * Names the user's computer and its OS, "Studio's Mac Studio, macOS 27.0.1",
 * for deliverables and instructions written for them to run, and so a chat
 * that moves between two computers on the same OS is told it moved. Read
 * once per process: renaming the computer or updating the OS restarts it.
 */
export function getSystemInfo(): Promise<string> {
  systemInfo ??= Promise.all([readComputerName(), osName()]).then(
    ([name, system]) => `${name}, ${system}`,
  );
  return systemInfo;
}
