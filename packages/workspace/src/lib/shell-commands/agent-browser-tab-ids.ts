import { z } from "zod";

import { parseAgentBrowserArgs } from "./agent-browser-args";

/** What `tab list --json` says of each tab: agent-browser's label and the target, which is the window's id for the tab. */
const TabListSchema = z.looseObject({
  data: z.looseObject({
    tabs: z.array(
      z.looseObject({
        active: z.boolean().optional(),
        tabId: z.string(),
        targetId: z.string(),
      }),
    ),
  }),
});

type TabList = z.output<typeof TabListSchema>;

/**
 * What a `tab` invocation prints that names a tab, which the wrapper makes
 * name it by the window's id: the list as text (`tab` alone or `tab list`)
 * or as JSON, and the tab `tab new` opened. Nothing for any other command.
 *
 * agent-browser labels tabs `t1`, `t2`; the window names each by its tab_ id,
 * which `instrument window`, `--tab` and the note on the user's message use,
 * and which agent-browser takes anywhere it takes a label. One id per tab, so
 * the agent is never shown the label.
 */
export function tabOutputOf(
  args: readonly string[],
): "list" | "list-json" | "new" | undefined {
  // Global flags such as `--json` may come before the command or after it.
  const { globalFlags, subArgs, subcommand } = parseAgentBrowserArgs([...args]);
  if (subcommand !== "tab") {
    return undefined;
  }
  const json = globalFlags.some(
    (flag) => flag.name === "--json" && flag.value !== "false",
  );
  const words = subArgs.slice(1).map((arg) => arg.value);
  if (words.length === 0 || (words.length === 1 && words[0] === "list")) {
    return json ? "list-json" : "list";
  }
  return words[0] === "new" && !json ? "new" : undefined;
}

function parseTabList(json: string): TabList | undefined {
  try {
    return TabListSchema.parse(JSON.parse(json));
  } catch {
    return undefined;
  }
}

/**
 * The tab list with each of agent-browser's labels replaced by the window's
 * id: `[t1]` reads `[tab_01…]`. A line whose label the JSON does not name is
 * left as it is.
 */
export function withTabIds(text: string, json: string): string {
  const parsed = parseTabList(json);
  if (!parsed) {
    return text;
  }
  const ids = new Map(
    parsed.data.tabs.map((tab) => [tab.tabId, tab.targetId] as const),
  );
  return text.replace(/\[(t\d+)\]/g, (label, tabId: string) => {
    const id = ids.get(tabId);
    return id === undefined ? label : `[${id}]`;
  });
}

/** `tab list --json` with each tab's `tabId` the window's id, the same as its `targetId`. */
export function jsonWithTabIds(json: string): string {
  const parsed = parseTabList(json);
  if (!parsed) {
    return json;
  }
  const tabs = parsed.data.tabs.map((tab) => ({ ...tab, tabId: tab.targetId }));
  return `${JSON.stringify({ ...parsed, data: { ...parsed.data, tabs } })}\n`;
}

/**
 * Where a `tab` invocation names a tab by the window's id: the argument of
 * `tab <id>` (switch) or `tab close <id>`. agent-browser reads a target id
 * there only when it is hex, as Chrome's are, and takes `tab_01…` for a label
 * it has never seen, so the wrapper puts the tab's own label in its place.
 */
export function windowTabIdArgIndex(
  args: readonly string[],
): number | undefined {
  const { subArgs, subcommand } = parseAgentBrowserArgs([...args]);
  if (subcommand !== "tab") {
    return undefined;
  }
  const ref = subArgs[1]?.value === "close" ? subArgs[2] : subArgs[1];
  return ref?.value.startsWith("tab_") ? ref.index : undefined;
}

/** The args with the window's id at `index` replaced by agent-browser's label for that tab, or as they were when the list does not name it. */
export function withTabLabel(
  args: readonly string[],
  index: number,
  json: string,
): string[] {
  const label = parseTabList(json)?.data.tabs.find(
    (tab) => tab.targetId === args[index],
  )?.tabId;
  return label === undefined
    ? [...args]
    : args.map((arg, i) => (i === index ? label : arg));
}

/** The line `tab new` ends with: the id of the tab it opened, which is the active one. */
export function newTabLine(json: string): string {
  const id = parseTabList(json)?.data.tabs.find((tab) => tab.active)?.targetId;
  return id === undefined ? "" : `Opened as tab ${id}.\n`;
}
