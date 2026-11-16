import { OFFICE_MANIFEST } from "./manifest.generated";

/** Where TDF keeps every build at an address that never moves. */
export const OFFICE_ARCHIVE_URL =
  "https://downloadarchive.documentfoundation.org/libreoffice/old";

/** TDF's Developer ID team, which signs and notarizes the Mac builds. */
export const TDF_TEAM_ID = "7P5S3ZLCN7";

export type OfficeArtifact = {
  bytes: number;
  file: string;
  /** The folder under the version's, as the archive lays it out. */
  folder: string;
  sha256: string;
};

export type OfficeTarget = keyof typeof OFFICE_MANIFEST.artifacts;

/** The pinned build, `26.2.7.3`. */
export const OFFICE_VERSION: string = OFFICE_MANIFEST.version;

/**
 * The release line a build belongs to, `26.2`: an install of the person's
 * own at or above it is used instead of downloading.
 */
export function officeMajor(version: string): string {
  return version.split(".").slice(0, 2).join(".");
}

/** Whether `version` is the pinned release line or a later one. */
export function atLeastPinnedMajor(
  version: string,
  pinned = OFFICE_VERSION,
): boolean {
  const have = officeMajor(version).split(".").map(Number);
  const want = officeMajor(pinned).split(".").map(Number);
  if (have.length < 2 || have.some((part) => !Number.isFinite(part))) {
    return false;
  }
  const [haveYear = 0, haveMonth = 0] = have;
  const [wantYear = 0, wantMonth = 0] = want;
  return haveYear !== wantYear ? haveYear > wantYear : haveMonth >= wantMonth;
}

/** The pinned artifact for a platform and architecture, if TDF builds one. */
export function officeArtifact(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): OfficeArtifact | undefined {
  const target = `${platform}-${arch}`;
  return Object.entries(OFFICE_MANIFEST.artifacts).find(
    ([key]) => key === target,
  )?.[1];
}

export function officeDownloadUrl(
  artifact: OfficeArtifact,
  version = OFFICE_VERSION,
): string {
  return `${OFFICE_ARCHIVE_URL}/${version}/${artifact.folder}/${artifact.file}`;
}
