import path from "node:path";

/**
 * Find a name a predicate reports as free, appending `-2`, `-3`, ... to the
 * stem (before any extension) until one is available. Consolidates the ad-hoc
 * "bump a numeric suffix on collision" loops across the workspace (uploaded
 * attachments, copied files, task/branch folders, exported zips, generated
 * images).
 *
 * `isTaken` decides availability, so callers plug in disk existence, a
 * directory listing, or an in-memory reserved set. It may be sync or async.
 *
 * @param splitExtension keep a trailing extension after the suffix, so
 *   `report.zip` -> `report-2.zip` rather than `report.zip-2`.
 * @param startAt first numeric suffix to try; `2` gives `name`, `name-2`,
 *   `name-3`, while `1` gives `name`, `name-1`, `name-2`.
 */
export async function findAvailableName({
  isTaken,
  name,
  splitExtension = false,
  startAt = 2,
}: {
  isTaken: (candidate: string) => boolean | Promise<boolean>;
  name: string;
  splitExtension?: boolean;
  startAt?: number;
}): Promise<{ name: string; renamed: boolean }> {
  if (!(await isTaken(name))) {
    return { name, renamed: false };
  }

  const ext = splitExtension ? path.extname(name) : "";
  const stem = ext ? name.slice(0, -ext.length) : name;

  let suffix = startAt;
  while (await isTaken(`${stem}-${suffix}${ext}`)) {
    suffix += 1;
  }
  return { name: `${stem}-${suffix}${ext}`, renamed: true };
}
