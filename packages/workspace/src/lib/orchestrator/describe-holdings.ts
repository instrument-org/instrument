/** One top-level entry of a task's folder and how many files sit under it. */
export interface FolderHolding {
  /** The entry's name, with a trailing slash when it is a folder. */
  name: string;
  /** Files under it, counted to the cap and no further. */
  files: number;
  /** True when the count stopped at the cap, so the number reads as at least. */
  capped?: boolean;
}

/** The note's clause for a task's holdings, or its absence. */
export function describeHoldings(holdings: FolderHolding[]): string {
  if (holdings.length === 0) {
    return "nothing of its own";
  }
  return holdings
    .map(({ capped, files, name }) => {
      const count = `${capped ? "at least " : ""}${files.toLocaleString("en-US")} ${files === 1 ? "file" : "files"}`;
      return name === "." ? `${count} at the root` : `${name} ${count}`;
    })
    .join(", ");
}
