import { normalizeProjectFilePath } from "@instrument-org/workspace/client";

export function getAssetUrl({
  assetBase,
  filePath,
}: {
  assetBase: string;
  filePath: string;
}): string {
  return `${assetBase}/${normalizeProjectFilePath(filePath)}`;
}
