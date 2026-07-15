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
  const url = normalizedPath.startsWith("/")
    ? `${assetBase}${normalizedPath}`
    : `${assetBase}/${normalizedPath}`;

  // Attached folders are mutable but not watched by the task file index, so a
  // stored tool-output mtime can go stale. Keep mount URLs unversioned so the
  // asset server serves them with no-store semantics.
  if (version === undefined || normalizedPath.startsWith("/mnt/")) {
    return url;
  }

  return `${url}?version=${encodeURIComponent(version)}`;
}

// Rewrites the cache-busting `version` on an already-built asset URL. Asset URLs
// only ever carry `version`, so dropping the existing query is safe.
export function withAssetUrlVersion(url: string, version: number): string {
  const base = url.split("?")[0] ?? url;
  return `${base}?version=${encodeURIComponent(version)}`;
}
