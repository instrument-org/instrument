/** The parts of a manifest that say what an extension may reach. */
export type ExtensionManifest = {
  host_permissions?: string[];
  permissions?: string[];
};

/** A pattern naming every site, in each spelling a manifest may use. */
const EVERY_SITE = /^(<all_urls>|\*:\/\/\*\/\*?|https?:\/\/\*\/\*)$/;

const EVERY_SITE_LINE = "Read and change what you see on every site";

/** What each permission a person would notice means, in the order the sheet lists them. */
const PERMISSION_LINES: [permission: string, line: string][] = [
  ["tabs", "See the addresses and titles of the pages you open"],
  ["webNavigation", "See the addresses and titles of the pages you open"],
  ["history", "Read and change your browsing history"],
  ["bookmarks", "Read and change your bookmarks"],
  ["nativeMessaging", "Talk to its own app on this computer"],
  ["management", "See and manage the browser's other extensions"],
  ["downloads", "Manage what you download"],
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
export function permissionLines(manifest: ExtensionManifest): string[] {
  const permissions = new Set(manifest.permissions ?? []);
  const hosts = manifest.host_permissions ?? [];
  const lines: string[] = [];
  if (hosts.some((host) => EVERY_SITE.test(host))) {
    lines.push(EVERY_SITE_LINE);
  } else {
    for (const host of hosts) {
      const site = siteOf(host);
      if (site) {
        lines.push(`Read and change what you see on ${site}`);
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
