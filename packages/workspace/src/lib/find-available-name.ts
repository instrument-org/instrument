import path from "node:path";

/**
 * Resolve a name a predicate reports as free, appending `-2`, `-3`, ... to the
 * stem until one is available. Shared collision-safe naming for copied files,
 * uploaded attachments, task/branch folders, exported zips, and images.
 *
 * `isTaken` decides availability (disk existence, a directory listing, a
 * reserved set); it may be sync or async.
 *
 * @param splitExtension put the suffix before the extension: `report.zip` ->
 *   `report-2.zip`, not `report.zip-2`.
 * @param startAt first suffix to try; `2` -> `name`, `name-2`, ...; `1` ->
 *   `name`, `name-1`, ...
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
