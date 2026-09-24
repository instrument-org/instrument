import { safe } from "@orpc/client";

import { rpcClient } from "../rpc/client";
import { captureException } from "./telemetry";

// The channel the person's viewers read a file on this computer through, by
// its real path. Its origin carries a per-launch token, resolved once at boot
// (see app.tsx) into this module so a URL derives synchronously from a host
// path anywhere: render, plain functions, event handlers.
let base: string | undefined;

/**
 * The channel URL for a file on this computer.
 *
 * `version` is the caller's claim about which bytes the reference is for: the
 * file's mtime, when the caller listed or watched the file, earns an immutable
 * response, and any other value is answered `no-store`. A caller that never
 * learned an mtime still wants a value here, since the query string is the
 * only thing separating two references to one path, and the renderer reuses a
 * decoded image across elements by URL alone whatever the response said.
 *
 * "" only in the window before {@link resolveComputerFileBase} completes, or
 * if it failed, which is already reported.
 */
export function getComputerFileUrl({
  hostPath,
  version,
}: {
  hostPath: string;
  version?: number | string;
}): string {
  if (base === undefined) {
    return "";
  }
  // Per segment, so the separators survive and a `?` or `#` in a name does not
  // start the query or the fragment. A Windows path's separators are turned
  // into the URL's, and its drive letter becomes the first segment.
  const encodedPath = hostPath
    .split(/[/\\]/)
    .filter((segment, index) => index === 0 || segment !== "")
    .map(encodeURIComponent)
    .join("/");
  const url = encodedPath.startsWith("/")
    ? `${base}${encodedPath}`
    : `${base}/${encodedPath}`;
  return version === undefined
    ? url
    : `${url}?version=${encodeURIComponent(version)}`;
}

/**
 * The file drawn small by the system, on the same channel: a picture, a PDF's
 * first page, a page's file as a page, a text file as its text. `size` is the
 * longer side in px; a 404 means there is no picture of it.
 */
export function getComputerThumbnailUrl({
  hostPath,
  size,
  version,
}: {
  hostPath: string;
  size: 64 | 512 | 1024;
  version?: number | string;
}): string {
  const url = getComputerFileUrl({ hostPath, version });
  if (!url) {
    return "";
  }
  return `${url}${url.includes("?") ? "&" : "?"}thumbnail=${size}`;
}

/**
 * The host path a channel URL names, or nothing for a URL of any other
 * origin: the inverse of {@link getComputerFileUrl}, for a link a document
 * wrote relative to itself and resolved against the document's own URL. The
 * query is the version and not part of the path.
 */
export function hostPathOfComputerFileUrl(url: string): string | undefined {
  if (base === undefined || !url.startsWith(`${base}/`)) {
    return;
  }
  const rest = url.slice(base.length);
  const end = rest.search(/[?#]/);
  const encodedPath = end === -1 ? rest : rest.slice(0, end);
  try {
    const segments = encodedPath.split("/").map(decodeURIComponent);
    // A Windows path went in with its drive letter as the first segment and
    // no leading separator; a POSIX one with its root.
    return /^[a-z]:$/i.test(segments[1] ?? "")
      ? segments.slice(1).join("\\")
      : segments.join("/");
  } catch {
    return;
  }
}

export async function resolveComputerFileBase() {
  const [error, data] = await safe(rpcClient.utils.computerFileBase.call());
  if (error) {
    captureException(
      new Error("Failed to resolve the computer file channel at boot", {
        cause: error,
      }),
    );
    return;
  }
  base = data;
}
