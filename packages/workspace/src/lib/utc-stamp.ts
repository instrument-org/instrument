/**
 * When something happened, as a file a person opens writes it: ISO 8601 in
 * UTC, to the second (`2026-10-14T18:22:04Z`).
 *
 * The same moment is the same bytes on every computer, whatever its time
 * zone, so a file two computers write never changes for the clock it was
 * written under, and any program reads the moment back exactly. The record
 * logs keep milliseconds, since a log's job is to be exact.
 */
export function utcStamp(at: Date): string {
  return at.toISOString().replace(/\.\d{3}Z$/u, "Z");
}
