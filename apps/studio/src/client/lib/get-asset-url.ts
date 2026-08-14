import { normalizeTaskFilePath } from "@instrument-org/workspace/client";

export function getAssetUrl({
  assetBase,
  filePath,
  version,
}: {
  assetBase: string;
  filePath: string;
  version?: number;
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
