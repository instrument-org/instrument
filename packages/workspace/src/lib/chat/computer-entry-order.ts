/** Folders first, then by name as a person reads one: `file 2` before `file 10`. */
export function compareEntries(
  a: { kind: "file" | "folder"; name: string },
  b: { kind: "file" | "folder"; name: string },
): number {
  if (a.kind !== b.kind) {
    return a.kind === "folder" ? -1 : 1;
  }
  return a.name.localeCompare(b.name, undefined, { numeric: true });
}
