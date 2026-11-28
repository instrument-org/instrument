import type { ExtensionAccess } from "@/electron-main/stores/workspace/browser-extensions";
import { z } from "zod";

const StringsSchema = z
  .array(z.unknown())
  .transform((items) =>
    items.filter((item): item is string => typeof item === "string"),
  )
  .catch([]);

const AccessManifestSchema = z.object({
  content_scripts: z
    .array(z.object({ matches: StringsSchema }).catch({ matches: [] }))
    .catch([]),
  host_permissions: StringsSchema,
  permissions: StringsSchema,
});

/** What an extension's manifest lets it reach, its content scripts' sites included. */
export function accessOf(manifest: unknown): ExtensionAccess {
  const { content_scripts, host_permissions, permissions } =
    AccessManifestSchema.catch({
      content_scripts: [],
      host_permissions: [],
      permissions: [],
    }).parse(manifest);
  return {
    origins: [
      ...new Set([
        ...host_permissions,
        ...content_scripts.flatMap(({ matches }) => matches),
      ]),
    ],
    permissions,
  };
}

/** Two lots of access as one. */
export function joinAccess(
  a: ExtensionAccess,
  b: ExtensionAccess,
): ExtensionAccess {
  return {
    origins: [...new Set([...a.origins, ...b.origins])],
    permissions: [...new Set([...a.permissions, ...b.permissions])],
  };
}

/** Whether a host pattern's sites are all among another's. */
function coversOrigin(granted: string, asked: string): boolean {
  if (granted === asked || EVERY_SITE.test(granted)) {
    return true;
  }
  const [site, askedSite] = [siteOf(granted), siteOf(asked)];
  if (site === undefined || askedSite === undefined) {
    return false;
  }
  if (site === askedSite) {
    return true;
  }
  if (!site.startsWith("*.")) {
    return false;
  }
  const base = site.slice(2);
  return askedSite === base || askedSite.endsWith(`.${base}`);
}

/** Whether every site asked for is among those granted. */
export function coversOrigins(
  granted: readonly string[],
  asked: readonly string[],
): boolean {
  return asked.every((origin) =>
    granted.some((candidate) => coversOrigin(candidate, origin)),
  );
}

/**
 * The lines for what is asked past what was granted. Empty when nothing a
 * person would notice is new, which is when Chrome lets an update through
 * without a word.
 */
export function newAccessLines(
  granted: ExtensionAccess,
  asked: ExtensionAccess,
): string[] {
  const before = new Set(permissionLines(granted));
  return permissionLines({
    origins: asked.origins.filter(
      (origin) => !coversOrigins(granted.origins, [origin]),
    ),
    permissions: asked.permissions,
  }).filter((line) => !before.has(line));
}

/** A pattern naming every site, in each spelling a manifest may use. */
const EVERY_SITE = /^(<all_urls>|(\*|https?):\/\/\*\/.*)$/;

const EVERY_SITE_LINE = "Read and change what you see on every site";

/** What each permission a person would notice means, in the order the sheet lists them. */
const PERMISSION_LINES: [permission: string, line: string][] = [
  ["tabs", "See the addresses and titles of the pages you open"],
  ["webNavigation", "See the addresses and titles of the pages you open"],
  ["debugger", "Control the pages you open as a developer tool would"],
  ["proxy", "Change where the browser's traffic goes"],
  ["declarativeNetRequest", "Block content on the pages you open"],
  ["declarativeNetRequestFeedback", "See what it blocks on the pages you open"],
  ["desktopCapture", "Capture what is on your screen"],
  ["tabCapture", "Capture what the pages you open show and play"],
  ["pageCapture", "Save the pages you open"],
  ["contentSettings", "Change what sites are allowed to do"],
  ["sessions", "See the tabs you closed recently"],
  ["tabGroups", "See and change your tab groups"],
  ["identity.email", "Know your email address"],
  ["clipboardWrite", "Change what you copy"],
  ["history", "Read and change your browsing history"],
  ["bookmarks", "Read and change your bookmarks"],
  ["nativeMessaging", "Talk to its own app on this computer"],
  ["management", "See and manage the browser's other extensions"],
  ["downloads", "Manage what you download"],
  ["downloads.open", "Open files you download"],
  ["notifications", "Show notifications"],
  ["privacy", "Change the browser's privacy settings"],
  ["clipboardRead", "Read what you copy"],
  ["geolocation", "Know where you are"],
  ["topSites", "See the sites you visit most"],
];

/**
 * What an extension asks to be allowed, in lines a person can weigh before
 * adding it, the way the sheet Chrome shows does: every site first, then each
 * permission that touches something they would notice, each said once. A
 * permission that only lets the extension run (storage, alarms, a menu item,
 * scripting, the request APIs) says nothing, as it does in Chrome.
 */
export function permissionLines(access: ExtensionAccess): string[] {
  const permissions = new Set(access.permissions);
  const hosts = access.origins;
  const lines: string[] = [];
  if (hosts.some((host) => EVERY_SITE.test(host))) {
    lines.push(EVERY_SITE_LINE);
  } else {
    for (const host of hosts) {
      const site = siteOf(host);
      const line = site && `Read and change what you see on ${site}`;
      if (line && !lines.includes(line)) {
        lines.push(line);
      }
    }
  }
  for (const [permission, line] of PERMISSION_LINES) {
    if (permissions.has(permission) && !lines.includes(line)) {
      lines.push(line);
    }
  }
  return lines;
}

/** The site a host pattern names, as a person reads it: `*.example.com` for a subdomain wildcard. */
function siteOf(pattern: string): string | undefined {
  const match = /^[a-z*]+:\/\/([^/]+)\//i.exec(pattern);
  return match?.[1];
}
