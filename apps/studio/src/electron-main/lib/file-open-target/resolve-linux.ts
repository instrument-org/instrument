import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { storeFileOpenIcon, storeFileOpenSvgIcon } from "../app-protocol";
import { runHelper } from "./helper-process";
import { type ResolvedApp } from "./types";

// Largest first: the stored icon is downsampled, never scaled up.
const HICOLOR_SIZES = ["256x256", "128x128", "96x96", "64x64", "48x48"];

// The default browser as the desktop records it: `xdg-settings` answers with
// a desktop entry id, the same currency `xdg-mime` answers a file type in.
export async function resolveLinuxBrowserTarget(): Promise<null | ResolvedApp> {
  const desktopOut = await runHelper({
    args: ["get", "default-web-browser"],
    file: "xdg-settings",
  });
  return resolveDesktopId(desktopOut.trim());
}

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
  return resolveDesktopId(desktopOut.trim());
}

function dataDirs() {
  return [
    path.join(os.homedir(), ".local/share"),
    // eslint-disable-next-line turbo/no-undeclared-env-vars
    ...(process.env.XDG_DATA_DIRS ?? "/usr/local/share:/usr/share").split(":"),
  ].filter(Boolean);
}

/**
 * Where an entry's `Icon=` can be found as a PNG: the path itself when it is
 * one, otherwise the hicolor theme every desktop falls back to, then pixmaps,
 * across the data dirs. A full icon-theme lookup would follow the desktop's
 * own theme; hicolor is the one every app installs into, which is what makes
 * it portable. PNGs come first; an app that ships only a scalable SVG, as
 * most GNOME apps do, is found last.
 */
function linuxIconCandidates(icon: string, dirs: string[]) {
  if (path.isAbsolute(icon)) {
    return /\.(?:png|svg)$/.test(icon) ? [icon] : [];
  }
  return [
    ...dirs.flatMap((dir) => [
      ...HICOLOR_SIZES.map((size) =>
        path.join(dir, "icons/hicolor", size, "apps", `${icon}.png`),
      ),
      path.join(dir, "pixmaps", `${icon}.png`),
    ]),
    ...dirs.flatMap((dir) => [
      path.join(dir, "icons/hicolor/scalable/apps", `${icon}.svg`),
      path.join(dir, "pixmaps", `${icon}.svg`),
    ]),
  ];
}

/** Reads `Name=` and `Icon=` from a desktop entry's main group. */
function parseDesktopEntry(content: string) {
  const main = content.split(/^\[(?!Desktop Entry\])/m)[0] ?? "";
  return {
    icon: /^Icon=(.+)$/m.exec(main)?.[1]?.trim() || null,
    name: /^Name=(.+)$/m.exec(main)?.[1]?.trim() || null,
  };
}

async function readDesktopEntry(desktopId: string) {
  for (const dir of dataDirs()) {
    try {
      const entry = parseDesktopEntry(
        await fs.readFile(path.join(dir, "applications", desktopId), "utf8"),
      );
      if (entry.name) {
        return entry;
      }
    } catch {
      // not in this data dir; try the next one
    }
  }
  return null;
}

async function resolveDesktopId(desktopId: string) {
  if (!desktopId || desktopId.includes("/")) {
    return null;
  }
  const entry = await readDesktopEntry(desktopId);
  if (!entry?.name) {
    return null;
  }
  return {
    appName: entry.name,
    bundleId: null,
    iconUrl: entry.icon ? await resolveIcon(entry.icon) : null,
  };
}

async function resolveIcon(icon: string) {
  for (const candidate of linuxIconCandidates(icon, dataDirs())) {
    try {
      const bytes = await fs.readFile(candidate);
      return candidate.endsWith(".svg")
        ? await storeFileOpenSvgIcon(bytes)
        : await storeFileOpenIcon(bytes.toString("base64"));
    } catch {
      // not installed at this size or in this dir; try the next one
    }
  }
  return null;
}
