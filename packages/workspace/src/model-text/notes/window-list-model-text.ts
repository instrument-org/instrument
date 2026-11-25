import {
  groupAddressOf,
  isInstrumentAddress,
  tabAddressOf,
} from "@instrument-org/shared";
import { stripMarkdown } from "@instrument-org/shared/strip-markdown";

import {
  type LayoutSnapshot,
  type LayoutTab,
  type ListedGroup,
} from "../../schemas/group-layout";
import { type ChatStatus } from "../../lib/chat/chat-status";
import { WINDOW_COMMAND } from "../commands/window-command";
import { layoutTabName } from "./group-layout-model-text";

/** Every open window's tab groups, the one in front first, as the window answers a list. */
export type WindowGroups = readonly {
  groups: readonly ListedGroup[];
  isThisWindow?: boolean;
}[];

/** The task at work in a tab, by the tab's id, and whether that is the session asking. */
export type TabTasks = Readonly<
  Record<string, { id: string; title: string; you: boolean }>
>;

/** What a chat's tab says of its chat, as the sidebar and the Chats page show it. */
export interface TabChat {
  archived: boolean;
  /** The day anything last happened in it, YYYY-MM-DD. */
  last_activity: string;
  starred: boolean;
  status: ChatStatus;
  unread: boolean;
  /** Whether anything of it still moves, its tasks included, whatever its status. */
  working: boolean;
}

/** What a list says of groups and tabs past where they stand. */
export interface ListFacts {
  /** Each chat's tab's chat, by the tab's id. */
  chats: Readonly<Record<string, TabChat>>;
  /** The projects in use, their names by their ids. */
  projects: Readonly<Record<string, string>>;
  tasks: TabTasks;
}

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

/** A tab group's header: its name, its address, its pin and project, whether the person sees it, and when they last did. */
function groupHeader(layout: ListedGroup, { projects }: ListFacts): string {
  const pinned = layout.pinned === true ? ", pinned" : "";
  const named =
    layout.project === undefined ? undefined : projects[layout.project];
  const project = named === undefined ? "" : `, in the project "${named}"`;
  const last =
    layout.isShown === false && layout.shownAt !== undefined
      ? `, last brought up ${new Date(layout.shownAt).toISOString().slice(0, 16)}Z`
      : "";
  const split = layout.sides.length === 2 ? ", split" : "";
  const shown = layout.isShown === false ? "not on screen" : "on screen";
  return `Tab group "${groupName(layout)}" ${groupAddressOf(layout.group.id)}${pinned}${project}${split}, ${shown}${last}:`;
}

/**
 * One tab's line: its id, where it stands (a split group's tab says which
 * side shows it, or that it is hidden; one side's says showing or hidden),
 * what it shows, and the address that names it in a reply.
 */
function tabLine(
  tab: LayoutTab,
  {
    draft,
    facts,
    isTwo,
    side,
  }: {
    draft: string | undefined;
    facts: ListFacts;
    isTwo: boolean;
    side: number;
  },
): string {
  const task = facts.tasks[tab.id];
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
  const chat = facts.chats[tab.id];
  const notes = [
    ...(tab.byAgent ? ["opened by an agent"] : []),
    ...(chat === undefined || tab.isThisChat ? [] : chatNotes(chat)),
    ...(draft === undefined ? [] : [`unsent: ${JSON.stringify(draft)}`]),
  ];
  return `${tab.id}  ${mark}  ${shows}${tab.isThisChat ? " (you)" : ""}  ${link}${working}${notes.length === 0 ? "" : `  (${notes.join(", ")})`}`;
}

/** Where a chat stands, as the clauses after its tab's line. */
function chatNotes(chat: TabChat): string[] {
  const status = {
    failed: "stopped by an error",
    idle: undefined,
    limited: "stopped by a usage limit",
    stopped: "stopped by the user",
    waiting: "waiting on the user",
    working: "working",
  }[chat.status];
  return [
    ...(status === undefined ? [] : [status]),
    ...(chat.working && chat.status !== "working" ? ["still working"] : []),
    ...(chat.unread ? ["unread"] : []),
    ...(chat.starred ? ["starred"] : []),
    ...(chat.archived ? ["archived"] : []),
    `last active ${chat.last_activity}`,
  ];
}

/**
 * A group's tabs under its header, a split group's under the name of each
 * side, the keyboard's marked; each line indented by `indent`.
 */
export function groupLines(
  layout: ListedGroup,
  { facts, indent = "" }: { facts: ListFacts; indent?: string },
): string[] {
  const isTwo = layout.sides.length === 2;
  return [
    `${indent}${groupHeader(layout, facts)}`,
    ...layout.sides.flatMap(({ tabs }, side) => [
      ...(isTwo
        ? [
            `${indent}  ${SIDE_NAMES[side] ?? "left"}${layout.focused === side ? " (keyboard)" : ""}:`,
          ]
        : []),
      ...tabs.map(
        (tab) =>
          `${indent}${isTwo ? "    " : "  "}${tabLine(tab, { draft: layout.drafts?.[tab.id], facts, isTwo, side })}`,
      ),
    ]),
  ];
}

/** Names, quoted, the first few and an ellipsis past them. */
function someNames(groups: readonly ListedGroup[]): string {
  const named = groups
    .slice(0, NAMED_GROUPS_MAX)
    .map(
      (group) =>
        `"${groupName(group)}"${group.pinned === true ? " (pinned)" : ""}`,
    )
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
  facts: ListFacts,
): string[] {
  return windows.flatMap((window, at) => [
    `Window ${at + 1}${at === 0 ? ", in front" : ""}${window.isThisWindow === true ? ", yours" : ""}: ${plural(window.groups.length, "tab group", "tab groups")}`,
    ...window.groups.flatMap((group) =>
      groupLines(group, { facts, indent: "  " }),
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
): { error: string } | { group: ListedGroup } {
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
