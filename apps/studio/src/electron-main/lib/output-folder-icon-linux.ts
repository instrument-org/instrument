import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import artwork from "../../../resources/instrument-folder.svg?raw";

const exec = promisify(execFile);
const directory = "[Desktop Entry]\nIcon=./.instrument-folder.svg\n";

export async function applyLinuxFolderIcon(folder: string): Promise<void> {
  const directoryFile = path.join(folder, ".directory");
  const existing = await fs
    .readFile(directoryFile, "utf8")
    .catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return undefined;
      throw error;
    });
  if (existing !== undefined && existing !== directory) return;

  // GIO metadata belongs to the desktop session, not to filesystem xattrs.
  const gio = await exec(
    "gio",
    ["info", "-a", "metadata::custom-icon,metadata::custom-icon-name", folder],
    { timeout: 5000 },
  ).catch(() => undefined);
  const icon = path.join(folder, ".instrument-folder.svg");
  const uri = pathToFileURL(icon).href;
  if (
    gio &&
    gio.stdout.split("\n").some((line) => {
      const attribute = line.trim();
      return (
        (attribute.startsWith("metadata::custom-icon:") &&
          attribute !== `metadata::custom-icon: ${uri}`) ||
        attribute.startsWith("metadata::custom-icon-name:")
      );
    })
  )
    return;

  try {
    await fs.writeFile(icon, artwork, { flag: "wx" });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST"))
      throw error;
    if ((await fs.readFile(icon, "utf8")) !== artwork) return;
  }
  if (existing === undefined) {
    try {
      await fs.writeFile(directoryFile, directory, { flag: "wx" });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST")
        return;
      throw error;
    }
  }
  // KDE reads .directory; GNOME Files and other GIO file managers read metadata.
  if (gio && !gio.stdout.includes(`metadata::custom-icon: ${uri}`)) {
    await exec(
      "gio",
      ["set", "-t", "string", folder, "metadata::custom-icon", uri],
      { timeout: 5000 },
    );
  }
}
