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

  if (version === undefined) {
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
