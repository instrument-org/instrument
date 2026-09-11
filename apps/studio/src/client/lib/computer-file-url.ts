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
