import { normalizeProjectFilePath } from "@instrument-org/workspace/client";

export function getAssetUrl({
  assetBase,
  filePath,
  version,
}: {
  assetBase: string;
  filePath: string;
  version?: number | string;
}): string {
  const url = `${assetBase}/${normalizeProjectFilePath(filePath)}`;

  if (version === undefined) {
    return url;
  }

  return `${url}?version=${encodeURIComponent(version)}`;
}
