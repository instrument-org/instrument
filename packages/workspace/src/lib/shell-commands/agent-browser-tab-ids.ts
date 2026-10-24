import { z } from "zod";

/** What `tab list --json` says of each tab: agent-browser's label and the target, which is the window's id for the tab. */
const TabListSchema = z.object({
  data: z.object({
    tabs: z.array(z.object({ tabId: z.string(), targetId: z.string() })),
  }),
});

/**
 * Whether an invocation lists the tabs as text: `tab` alone or `tab list`,
 * whose lines name each tab by agent-browser's own `t1`, `t2`.
 */
export function listsTabs(args: readonly string[]): boolean {
  const [subcommand, ...rest] = args;
  return (
    subcommand === "tab" &&
    (rest.length === 0 || (rest.length === 1 && rest[0] === "list"))
  );
}

/**
 * The tab list with the window's id beside each label, the id `instrument
 * tab`, `--tab` and the note on the user's message use: `[t1]` reads
 * `[t1] tab_01…`. A line whose label the JSON does not name is left as it is.
 */
export function withTabIds(text: string, json: string): string {
  let parsed: z.output<typeof TabListSchema>;
  try {
    parsed = TabListSchema.parse(JSON.parse(json));
  } catch {
    return text;
  }
  const ids = new Map(
    parsed.data.tabs.map((tab) => [tab.tabId, tab.targetId] as const),
  );
  return text.replace(/\[(t\d+)\]/g, (label, tabId: string) => {
    const id = ids.get(tabId);
    return id === undefined ? label : `${label} ${id}`;
  });
}
