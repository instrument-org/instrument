import { withoutPageEditParam } from "@instrument-org/shared";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  classifyHostPath,
  nonTaskMounts,
  type WorkspaceFsLayout,
} from "./workspace-fs-layout";

/**
 * A page on this computer has one address, its `file://` URL, whoever opens
 * it. The person's browser tab shows that address; the agent's browser loads
 * that same address, so what the agent checks is the page the person sees.
 * The agent names such a page by its own path (`work/report.html`,
 * `/mnt/Docs/page.html`), and these translate between the two spellings at
 * the edge of the agent's browser, the way the shell's path bridge does for
 * native binaries.
 */

/**
 * The agent's path for a `file://` address, or null when the address is not a
 * local file the agent could read (see {@link agentPathOfHostFile}).
 */
export function agentPathOfFileUrl(
  layout: WorkspaceFsLayout,
  url: string,
): null | string {
  let hostPath: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "file:") {
      return null;
    }
    hostPath = fileURLToPath(parsed);
  } catch {
    return null;
  }
  return agentPathOfHostFile(layout, hostPath);
}

/**
 * The agent's path for a file on this computer, or null when the agent could
 * not read that file with its own tools: outside every mount, inside a mount's
 * private directory, or reached through a symlink that leaves its mount.
 */
function agentPathOfHostFile(
  layout: WorkspaceFsLayout,
  hostPath: string,
): null | string {
  const found = classifyHostPath(layout, hostPath);
  return found === null || found.masked !== undefined || found.escapes
    ? null
    : found.virtualPath;
}

/** How a file outside every mount is named to the agent. */
const OUTSIDE_FILE_ADDRESS = "file://<a file outside your folders>";

/**
 * Text the agent's browser printed, with every `file://` address under a mount
 * spelled in the agent's own paths: `file:///Users/.../report.html` becomes
 * `file:///task/work/report.html`, which the agent can hand straight back to
 * `agent-browser open`. A page in Edit carries a parameter the person's own
 * view of it never shows, and the agent does not see it either. An address
 * outside every mount is a place on this computer the agent has no path for,
 * and is named only as that.
 */
export function agentSpellingOfFileUrls(
  text: string,
  layout: WorkspaceFsLayout,
): string {
  const mounts = [layout.task, ...nonTaskMounts(layout)].toSorted(
    (a, b) => b.hostRoot.length - a.hostRoot.length,
  );
  let result = withoutPageEditParam(text);
  for (const mount of mounts) {
    const hostUrl = fileUrlOfHostPath(mount.hostRoot);
    const agentUrl = `file://${mount.mountPoint}`;
    result = result.replaceAll(
      new RegExp(`${escapeRegExp(hostUrl)}(?=[/?#]|$|[^\\w%.-])`, "g"),
      agentUrl,
    );
  }
  const mountPoints = mounts
    .map((mount) => escapeRegExp(mount.mountPoint.slice(1)))
    .join("|");
  return result.replaceAll(
    new RegExp(
      String.raw`file:\/\/\/(?!(?:${mountPoints})(?:[\/?#]|$|[^\w%.-]))[^\s"'<>)\]]*`,
      "g",
    ),
    OUTSIDE_FILE_ADDRESS,
  );
}

/** The `file://` address of a file on this computer. */
export function fileUrlOfHostPath(hostPath: string): string {
  return pathToFileURL(hostPath).href;
}

/**
 * Whether an address loads a file on this computer, however it is spelled:
 * the browser strips leading spaces and control characters and drops tabs
 * and newlines before it reads the scheme, so a pattern on the raw string
 * misses ` file://` and `file\n:///`, and `view-source:` shows the file it
 * wraps.
 */
export function isLocalAddress(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === "view-source:") {
    return isLocalAddress(parsed.href.slice("view-source:".length));
  }
  return parsed.protocol === "file:";
}

function escapeRegExp(text: string) {
  return text.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);
}
