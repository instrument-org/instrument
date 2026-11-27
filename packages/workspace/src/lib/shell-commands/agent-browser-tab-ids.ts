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
 * or as JSON, and the tab `tab new` or `click --new-tab` opened. Nothing for
 * any other command.
 *
 * agent-browser labels tabs `t1`, `t2`; the window names each by its tab_ id,
 * which `instrument window` and the note on the user's message use,
 * and which agent-browser takes anywhere it takes a label. One id per tab, so
 * the agent is never shown the label.
 */
export function tabOutputOf(
  args: readonly string[],
): "list" | "list-json" | "new" | undefined {
  // Global flags such as `--json` may come before the command or after it.
  const { globalFlags, subArgs, subcommand } = parseAgentBrowserArgs([...args]);
  const json = globalFlags.some(
    (flag) => flag.name === "--json" && flag.value !== "false",
  );
  if (opensNewTab(args)) {
    return json ? undefined : "new";
  }
  if (subcommand !== "tab") {
    return undefined;
  }
  const words = subArgs.slice(1).map((arg) => arg.value);
  if (words.length === 0 || (words.length === 1 && words[0] === "list")) {
    return json ? "list-json" : "list";
  }
  return words[0] === "new" && !json ? "new" : undefined;
}

/** Whether the invocation is `click --new-tab`, which opens the link in a tab of its own and makes it the active one. */
export function opensNewTab(args: readonly string[]): boolean {
  const { endOfOptions, subArgs, subcommand } = parseAgentBrowserArgs([
    ...args,
  ]);
  return (
    subcommand === "click" &&
    subArgs.some((arg) => arg.index < endOfOptions && arg.value === "--new-tab")
  );
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

/**
 * The line `tab new` ends with: the id of the tab it opened, which is the
 * active one, and how many tabs are open now, since each one an agent opens
 * stays in the user's tab group until someone closes it. `earlier` is the
 * tab that was active before, for a command that opens one as a side effect
 * (`click --new-tab`), whose agent expects to stay where it was.
 */
export function newTabLine(json: string, earlier?: string): string {
  const tabs = parseTabList(json)?.data.tabs ?? [];
  const id = tabs.find((tab) => tab.active)?.targetId;
  if (id === undefined) {
    return "";
  }
  const behind =
    earlier === undefined || earlier === id
      ? ""
      : ` Commands now act in it; tab ${earlier} is still open behind it.`;
  return `Opened as tab ${id}, one of ${tabs.length} tabs open.${behind}\n`;
}

/** The window's id for the tab `tab list --json` marks active, the one commands act on. */
export function activeTabId(json: string): string | undefined {
  return parseTabList(json)?.data.tabs.find((tab) => tab.active)?.targetId;
}

/** Whether the invocation is `tab close`, of the tab it names or the current one. */
export function isTabClose(args: readonly string[]): boolean {
  const { subArgs, subcommand } = parseAgentBrowserArgs([...args]);
  return subcommand === "tab" && subArgs[1]?.value === "close";
}

/**
 * The window's id of the tab a `tab close` would close: the one it names, by
 * the window's id or agent-browser's label, or the active one when it names
 * none, as `tab list --json` lists them.
 */
export function tabToClose(
  args: readonly string[],
  json: string,
): string | undefined {
  if (!isTabClose(args)) {
    return undefined;
  }
  const ref = parseAgentBrowserArgs([...args]).subArgs[2]?.value;
  return parseTabList(json)?.data.tabs.find((tab) =>
    ref === undefined
      ? tab.active
      : ref === tab.targetId || ref === tab.tabId,
  )?.targetId;
}

/**
 * The window's id of the tab a `tab close` would close when it is the only
 * tab agent-browser has, which agent-browser refuses to close ("Cannot close
 * the last tab"): the one tab `tab list --json` names, when the invocation
 * names it, by the window's id or agent-browser's label, or names none.
 */
export function onlyTabToClose(
  args: readonly string[],
  json: string,
): string | undefined {
  const { subArgs } = parseAgentBrowserArgs([...args]);
  const tabs = parseTabList(json)?.data.tabs;
  const [only] = tabs ?? [];
  if (!isTabClose(args) || only === undefined || tabs?.length !== 1) {
    return undefined;
  }
  const ref = subArgs[2]?.value;
  return ref === undefined || ref === only.targetId || ref === only.tabId
    ? only.targetId
    : undefined;
}

/**
 * What `tab close` prints for a tab it let go of and left open, the user's,
 * which the agent's browser connection never closes.
 */
export function tabLetGoOutput(tabId: string): string {
  return `Let go of tab ${tabId}; it is the user's and stays open.\n`;
}

/** What `tab close` prints for a tab it closed, named by the window's id, as text or as `--json`. */
export function tabClosedOutput(
  args: readonly string[],
  tabId: string,
): string {
  const { globalFlags } = parseAgentBrowserArgs([...args]);
  const json = globalFlags.some(
    (flag) => flag.name === "--json" && flag.value !== "false",
  );
  return json
    ? `${JSON.stringify({ data: { closed: true, tabId, targetId: tabId }, error: null, success: true })}\n`
    : `✓ Tab [${tabId}] closed\n`;
}

/** Whether `tab list --json` names the tab with the window's id `tabId`. */
export function listsTab(json: string, tabId: string): boolean {
  return (
    parseTabList(json)?.data.tabs.some((tab) => tab.targetId === tabId) ?? false
  );
}
