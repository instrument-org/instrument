import type { Chat } from "@instrument-org/workspace/electron";

/** How many chats each part of the menu lists before it says how many more. */
const MAX_ROWS = 8;

/** Which icon the menu bar shows: badged while a chat needs the person, plain otherwise. */
export type MenuBarIcon = "ask" | "idle";

/** A part of the menu: its name, its chats newest first, and how many past those it leaves out. */
export type MenuBarSection = {
  chats: { id: Chat["id"]; line?: string; title: string }[];
  label: "Needs you" | "Working";
  more: number;
};

/** The line under a chat's title: what it asks while it waits, the step it is on while it works. */
function lineOf(chat: Chat): string | undefined {
  return (
    chat.ownStep ??
    chat.runningTasks[0]?.step ??
    chat.latest?.text
  )?.split("\n")[0];
}

function count(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/** The dimmed line at the head of the menu, summing up what it lists. */
function summaryOf(asks: number, work: number): string {
  if (asks === 0 && work === 0) {
    return "Chats that are working or need you show here.";
  }
  return [
    ...(work > 0 ? [`${count(work, "chat", "chats")} working`] : []),
    ...(asks > 0
      ? [`${count(asks, "chat needs", "chats need")} you`]
      : []),
  ].join(", ");
}

function section(
  label: MenuBarSection["label"],
  list: Chat[],
): MenuBarSection[] {
  if (list.length === 0) {
    return [];
  }
  const newest = list.toSorted(
    (a, b) =>
      (b.latest?.at ?? b.lastUserMessageAt) -
      (a.latest?.at ?? a.lastUserMessageAt),
  );
  return [
    {
      chats: newest.slice(0, MAX_ROWS).map((chat) => ({
        id: chat.id,
        line: lineOf(chat),
        title: chat.title,
      })),
      label,
      more: Math.max(newest.length - MAX_ROWS, 0),
    },
  ];
}

/**
 * What the menu bar shows of the chats: a line summing them up, the ones
 * waiting on the person, then the ones at work, archived chats left out, and
 * the icon, badged only while one waits on the person. A chat at work or
 * unread leaves the icon plain.
 */
export function menuBarView(chats: readonly Chat[]): {
  icon: MenuBarIcon;
  sections: MenuBarSection[];
  summary: string;
} {
  const listed = chats.filter((chat) => !chat.archived);
  const asks = listed.filter((chat) => chat.status === "waiting");
  const work = listed.filter((chat) => chat.status === "working");
  return {
    icon: asks.length > 0 ? "ask" : "idle",
    sections: [...section("Needs you", asks), ...section("Working", work)],
    summary: summaryOf(asks.length, work.length),
  };
}
