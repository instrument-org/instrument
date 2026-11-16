import {
  groupAddressOf,
  isInstrumentAddress,
  tabAddressOf,
} from "@instrument-org/shared";
import { stripMarkdown } from "@instrument-org/shared/strip-markdown";

import {
  type LayoutSnapshot,
  type LayoutTab,
} from "../../schemas/group-layout";
import { WINDOW_COMMAND } from "../commands/window-command";
import { layoutTabName } from "./group-layout-model-text";

/** Every open window's tab groups, the one in front first, as the window answers a list. */
export type WindowGroups = readonly {
  groups: readonly LayoutSnapshot[];
  isThisWindow?: boolean;
}[];

/** The task at work in a tab, by the tab's id, and whether that is the session asking. */
export type TabTasks = Readonly<
  Record<string, { id: string; title: string; you: boolean }>
>;

const SIDE_NAMES = ["left", "right"] as const;

/** The most group names the line about the other groups spells out. */
const NAMED_GROUPS_MAX = 6;

/**
 * A tab group's name, as its sidebar row titles it: the chat up on either
 * side (the keyboard's first), else the tab up on the side with the keyboard.
 */
export function groupName(layout: LayoutSnapshot): string {
  const sides = [
    layout.sides[layout.focused],
    ...layout.sides.filter((_, at) => at !== layout.focused),
  ];
  const ups = sides.flatMap(
    (side) => side?.tabs.filter((tab) => tab.isUp) ?? [],
  );
  const chat = ups.find((tab) => tab.kind === "chat");
  const up = chat ?? ups[0];
  if (up === undefined) {
    return "New Tab";
  }
  switch (up.kind) {
    case "chat": {
      return stripMarkdown(up.title);
    }
    case "newChat": {
      return "New Tab";
    }
    default: {
      return up.title || up.address;
    }
  }
}

/** A tab group's header: its name, its address, and whether the person sees it. */
function groupHeader(layout: LayoutSnapshot): string {
  const split = layout.sides.length === 2 ? ", split" : "";
  const shown = layout.isShown === false ? "not on screen" : "on screen";
  return `Tab group "${groupName(layout)}" ${groupAddressOf(layout.group.id)}${split}, ${shown}:`;
}

/**
 * One tab's line: its id, where it stands (a split group's tab says which
 * side shows it, or that it is hidden; one side's says showing or hidden),
 * what it shows, and the address that names it in a reply.
 */
function tabLine(
  tab: LayoutTab,
  { side, tasks, isTwo }: { isTwo: boolean; side: number; tasks: TabTasks },
): string {
  const task = tasks[tab.id];
  const mark = !tab.isUp
    ? "hidden "
    : isTwo
      ? (SIDE_NAMES[side] ?? "left").padEnd(7)
      : "showing";
  // A page's URL, a file's or folder's path, a built-in page's own address:
  // what `show` takes to open it again.
  const shows =
    tab.kind === "website"
      ? tab.title === ""
        ? tab.address
        : `${tab.title} · ${tab.address}`
      : tab.kind !== "chat" &&
          tab.kind !== "newChat" &&
          isInstrumentAddress(tab.address)
        ? `${layoutTabName(tab)} · ${tab.address}`
        : layoutTabName(tab);
  const link = tab.kind === "chat" ? tab.address : tabAddressOf(tab.id);
  const working = task
    ? task.you
      ? "  you are working in it"
      : `  task ${task.id} is working in it`
    : "";
  return `${tab.id}  ${mark}  ${shows}${tab.isThisChat ? " (you)" : ""}  ${link}${working}`;
}

/**
 * A group's tabs under its header, a split group's under the name of each
 * side, the keyboard's marked; each line indented by `indent`.
 */
export function groupLines(
  layout: LayoutSnapshot,
  { indent = "", tasks }: { indent?: string; tasks: TabTasks },
): string[] {
  const isTwo = layout.sides.length === 2;
  return [
    `${indent}${groupHeader(layout)}`,
    ...layout.sides.flatMap(({ tabs }, side) => [
      ...(isTwo
        ? [
            `${indent}  ${SIDE_NAMES[side] ?? "left"}${layout.focused === side ? " (keyboard)" : ""}:`,
          ]
        : []),
      ...tabs.map(
        (tab) =>
          `${indent}${isTwo ? "    " : "  "}${tabLine(tab, { isTwo, side, tasks })}`,
      ),
    ]),
  ];
}

/** Names, quoted, the first few and an ellipsis past them. */
function someNames(groups: readonly LayoutSnapshot[]): string {
  const named = groups
    .slice(0, NAMED_GROUPS_MAX)
    .map((group) => `"${groupName(group)}"`)
    .join(", ");
  return groups.length > NAMED_GROUPS_MAX ? `${named}…` : named;
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The line after one group's list: the other groups in its window by
 * name, how many the other windows have, and how to list their tabs.
 */
export function otherGroupsLine(windows: WindowGroups, group: string): string {
  const here =
    windows.find((window) =>
      window.groups.some((each) => each.group.id === group),
    ) ?? windows.find((window) => window.isThisWindow === true);
  const others = (here?.groups ?? []).filter((each) => each.group.id !== group);
  const elsewhere = windows.filter((window) => window !== here);
  const elsewhereGroups = elsewhere.reduce(
    (count, window) => count + window.groups.length,
    0,
  );
  const parts = [
    others.length === 0
      ? "No other tab groups in this window."
      : `${plural(others.length, "other tab group", "other tab groups")} in this window: ${someNames(others)}.`,
    ...(elsewhere.length === 0
      ? []
      : [
          `${plural(elsewhere.length, "other window has", "other windows have")} ${plural(elsewhereGroups, "tab group", "tab groups")}.`,
        ]),
    ...(others.length + elsewhereGroups === 0
      ? []
      : [`\`${WINDOW_COMMAND.name} list --all\` lists their tabs.`]),
  ];
  return parts.join(" ");
}

/**
 * Every window, the one in front first, each group in it with its tabs,
 * the window the chat works in named so.
 */
export function allWindowsLines(
  windows: WindowGroups,
  tasks: TabTasks,
): string[] {
  return windows.flatMap((window, at) => [
    `Window ${at + 1}${at === 0 ? ", in front" : ""}${window.isThisWindow === true ? ", yours" : ""}: ${plural(window.groups.length, "tab group", "tab groups")}`,
    ...window.groups.flatMap((group) =>
      groupLines(group, { indent: "  ", tasks }),
    ),
  ]);
}

/**
 * The group a name or id names among every window's: by its id, then by its
 * name exactly, then by its name in any case where only one has it.
 */
export function groupNamed(
  windows: WindowGroups,
  named: string,
): { error: string } | { group: LayoutSnapshot } {
  const groups = windows.flatMap((window) => window.groups);
  const id = named.startsWith("instrument://group/")
    ? named.slice("instrument://group/".length)
    : named;
  const byId = groups.find((each) => each.group.id === id);
  if (byId) {
    return { group: byId };
  }
  const exact = groups.filter((each) => groupName(each) === named);
  const matches =
    exact.length > 0
      ? exact
      : groups.filter(
          (each) => groupName(each).toLowerCase() === named.toLowerCase(),
        );
  const [only] = matches;
  if (only !== undefined && matches.length === 1) {
    return { group: only };
  }
  if (matches.length > 1) {
    return {
      error: `${plural(matches.length, "tab group is", "tab groups are")} named "${named}": ${matches.map((each) => groupAddressOf(each.group.id)).join(", ")}. Name one by its id.`,
    };
  }
  return {
    error: `no tab group is named "${named}". \`${WINDOW_COMMAND.name} list --all\` names every group.`,
  };
}
