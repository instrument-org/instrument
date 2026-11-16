import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * The settings every LibreOffice the app runs starts with, in its profile's
 * `registrymodifications.xcu`: no document code runs, nothing a document
 * links to is fetched, and every formula is computed on load rather than
 * read from the cached values a file carries.
 */
export const PROFILE_SETTINGS = [
  // Always recalculate an Excel file on load (the default, 1, keeps its
  // cached values, stale or not), and an ODF file LibreOffice did not write.
  {
    name: "OOXMLRecalcMode",
    path: "/org.openoffice.Office.Calc/Formula/Load",
    value: "0",
  },
  {
    name: "ODFRecalcMode",
    path: "/org.openoffice.Office.Calc/Formula/Load",
    value: "0",
  },
  // Macros: the highest security level, and none run at all.
  {
    name: "MacroSecurityLevel",
    path: "/org.openoffice.Office.Common/Security/Scripting",
    value: "3",
  },
  {
    name: "DisableMacrosExecution",
    path: "/org.openoffice.Office.Common/Security/Scripting",
    value: "true",
  },
  {
    name: "BlockUntrustedRefererLinks",
    path: "/org.openoffice.Office.Common/Security/Scripting",
    value: "true",
  },
  // Links and external data are never updated on load: never is Calc's 1
  // (`ScLkUpdMode`) and Writer's 0 (`linkenum.hxx`).
  {
    name: "Link",
    path: "/org.openoffice.Office.Calc/Content/Update",
    value: "1",
  },
  {
    name: "Link",
    path: "/org.openoffice.Office.Writer/Content/Update",
    value: "0",
  },
] as const;

/** The profile's `registrymodifications.xcu`, with `PROFILE_SETTINGS`. */
export function registryModifications(): string {
  const items = PROFILE_SETTINGS.map(
    ({ name, path: itemPath, value }) =>
      `<item oor:path="${escapeXml(itemPath)}"><prop oor:name="${name}" oor:op="fuse"><value>${value}</value></prop></item>`,
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    ...items,
    "</oor:items>",
    "",
  ].join("\n");
}

function escapeXml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** The settings file in a profile folder. */
export function registryFile(profile: string): string {
  return path.join(profile, "user", "registrymodifications.xcu");
}

/** Writes a profile holding only `PROFILE_SETTINGS` into `dir`. */
export async function writeProfileTemplate(dir: string): Promise<void> {
  await fs.mkdir(path.join(dir, "user"), { recursive: true });
  await fs.writeFile(registryFile(dir), registryModifications());
}

/**
 * Whether a profile LibreOffice has run with still says what
 * `PROFILE_SETTINGS` does: it merges its own settings into the file on exit,
 * and a value it rewrote would change what every later call runs with.
 */
export async function profileKeepsSettings(dir: string): Promise<boolean> {
  const text = await fs.readFile(registryFile(dir), "utf8").catch(() => "");
  return PROFILE_SETTINGS.every(({ name, path: itemPath, value }) => {
    const item = new RegExp(
      `<item oor:path="${regexEscape(escapeXml(itemPath))}"><prop oor:name="${name}"[^>]*><value>([^<]*)</value>`,
    ).exec(text);
    return item?.[1] === value;
  });
}

function regexEscape(text: string) {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A copy of the template in a folder of its own under `tempRoot`, for one
 * call: LibreOffice runs one instance per profile and hands a second call
 * to the first, so no two calls share one. Removed by `dispose`.
 */
export async function freshProfile(
  template: string,
  tempRoot: string,
): Promise<{ dir: string; dispose: () => Promise<void>; url: string }> {
  const dir = path.join(tempRoot, `office-profile-${randomUUID()}`);
  // A template removed under a running app (Settings' Remove) is written
  // again for this call.
  await fs
    .cp(template, dir, { recursive: true })
    .catch(() => writeProfileTemplate(dir));
  return {
    dir,
    dispose: () => fs.rm(dir, { force: true, recursive: true }),
    url: profileUrl(dir),
  };
}

/** The `-env:UserInstallation` value for a profile folder. */
export function profileUrl(dir: string): string {
  return pathToFileURL(dir).href;
}
