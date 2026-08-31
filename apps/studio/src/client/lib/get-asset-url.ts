import { normalizeTaskFilePath } from "@instrument-org/workspace/client";

/**
 * The asset-origin URL for a task file.
 *
 * `version` is the caller's claim about *which* bytes the reference is for, and
 * the assets route reads it two ways at once. It compares the value against the
 * file's mtime, so a caller that watched or listed the file names that mtime and
 * earns an immutable response; every other value is unrecognized and answered
 * `no-store`. Only a claim the server can check is allowed to be cached.
 *
 * A caller that never learned an mtime still wants a value here, because the
 * query string is the only thing separating two references to one path. The
 * renderer reuses a decoded image across elements by URL alone and does so
 * whatever `no-store` says, so a later card naming a rewritten file draws the
 * older card's bytes unless its URL differs. Transcript surfaces pass the
 * identity of the message part that named the file, which is stable for as long
 * as that reference is on screen and distinct from the next one.
 */
export function getAssetUrl({
  assetBase,
  filePath,
  version,
}: {
  assetBase: string;
  filePath: string;
  version?: number | string;
}): string {
  const normalizedPath = normalizeTaskFilePath(filePath);
  // Per segment, so the separators survive. A `?` or `#` in a filename would
  // otherwise start the query or the fragment and truncate the path; the rest
  // the client would escape on its own, but only once it is already a URL.
  // Matches `assetPathForVirtualPath`'s encoding on the agent-browser side, and
  // the assets route decodes it.
  const encodedPath = normalizedPath
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  const url = encodedPath.startsWith("/")
    ? `${assetBase}${encodedPath}`
    : `${assetBase}/${encodedPath}`;

  if (version === undefined) {
    return url;
  }

  return `${url}?version=${encodeURIComponent(version)}`;
}
