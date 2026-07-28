import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runHelper } from "./helper-process";
import { type ResolvedApp } from "./types";

export async function resolveLinuxTarget(
  fullPath: string,
): Promise<null | ResolvedApp> {
  const mimeOut = await runHelper({
    args: ["query", "filetype", fullPath],
    file: "xdg-mime",
  });
  const mime = mimeOut.trim();
  if (!mime) {
    return null;
  }
  const desktopOut = await runHelper({
    args: ["query", "default", mime],
    file: "xdg-mime",
  });
  const desktopId = desktopOut.trim();
  if (!desktopId || desktopId.includes("/")) {
    return null;
  }
  const appName = await readDesktopEntryName(desktopId);
  if (!appName) {
    return null;
  }
  // No portable icon-theme lookup; callers get the file-type icon instead.
  return { appName, iconUrl: null };
}

async function readDesktopEntryName(desktopId: string) {
  const dataDirs = [
    path.join(os.homedir(), ".local/share"),
    // eslint-disable-next-line turbo/no-undeclared-env-vars
    ...(process.env.XDG_DATA_DIRS ?? "/usr/local/share:/usr/share").split(":"),
  ];
  for (const dir of dataDirs) {
    if (!dir) {
      continue;
    }
    try {
      const content = await fs.readFile(
        path.join(dir, "applications", desktopId),
        "utf8",
      );
      const name = /^Name=(.+)$/m.exec(content)?.[1]?.trim();
      if (name) {
        return name;
      }
    } catch {
      // not in this data dir; try the next one
    }
  }
  return null;
}
