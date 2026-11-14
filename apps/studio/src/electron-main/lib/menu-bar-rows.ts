import type { Chat } from "@instrument-org/workspace/electron";

/** How many chats each part of the menu lists before it says how many more. */
const MAX_ROWS = 8;

/** Which icon the menu bar shows: a chat needs the person, one is at work, or neither. */
export type MenuBarIcon = "ask" | "idle" | "working";

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
 * What the menu bar shows of the chats: the ones waiting on the person, then
 * the ones at work, archived chats left out, and the icon that sums them up.
 */
export function menuBarView(chats: readonly Chat[]): {
  icon: MenuBarIcon;
  sections: MenuBarSection[];
} {
  const listed = chats.filter((chat) => !chat.archived);
  const asks = listed.filter((chat) => chat.status === "waiting");
  const work = listed.filter((chat) => chat.status === "working");
  return {
    icon: asks.length > 0 ? "ask" : work.length > 0 ? "working" : "idle",
    sections: [...section("Needs you", asks), ...section("Working", work)],
  };
}
