import { cn } from "@/client/lib/utils";
import { type ChatId } from "@instrument-org/workspace/client";
import { ArrowRightIcon } from "@phosphor-icons/react/ArrowRight";
import { ChatsCircleIcon } from "@phosphor-icons/react/ChatsCircle";
import { type KeyboardEvent, type Ref } from "react";

import { activityLabel } from "./chats";
import { GroupRowLines } from "./group-row-lines";
import { type RecentGroup } from "./recent-groups";
import { useNow } from "./use-now";

/**
 * The tab groups had most recently, under a new tab's box: each as the
 * sidebar's row draws a group (`GroupRowLines`), with Open at its end for
 * one open now and otherwise when it closed, then All chats where there are
 * chats. A row is one press. The keyboard stays in the box: a press leaves
 * it there, and the arrows walk the rows once they have it, Up from the
 * first and Escape handing it back (`onLeave`).
 */
export function RecentGroupRows({
  chatTitles,
  groups,
  hasChats,
  onAllChats,
  onLeave,
  onPick,
  ref,
}: {
  chatTitles: Map<ChatId, string>;
  groups: readonly RecentGroup[];
  hasChats: boolean;
  onAllChats: () => void;
  onLeave: () => void;
  onPick: (group: RecentGroup) => void;
  ref?: Ref<HTMLDivElement>;
}) {
  const now = useNow();
  if (groups.length === 0 && !hasChats) {
    return null;
  }
  const walk = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onLeave();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }
    event.preventDefault();
    const rows = [...event.currentTarget.querySelectorAll("button")];
    const at = rows.findIndex((row) => row === document.activeElement);
    const next = rows[at + (event.key === "ArrowDown" ? 1 : -1)];
    if (next) {
      next.focus();
    } else if (event.key === "ArrowUp") {
      onLeave();
    }
  };
  return (
    <div
      className="mx-auto flex w-full max-w-2xl flex-col px-3 pt-5 pb-3"
      data-slot="recent-groups"
      onKeyDown={walk}
      ref={ref}
    >
      {groups.map((group) => (
        <button
          className="flex shrink-0 items-center gap-3 rounded-xl px-3 py-1.5 text-left hover:bg-foreground/5 focus-visible:bg-foreground/5 focus-visible:outline-none"
          key={group.key}
          onClick={() => {
            onPick(group);
          }}
          type="button"
        >
          <GroupRowLines
            chatTitles={chatTitles}
            isCloseShown={false}
            isOnScreen={false}
            sides={group.sides}
          />
          <span
            className={cn(
              "shrink-0 text-xs",
              group.pick.kind === "open"
                ? "font-medium text-foreground/70"
                : "text-muted-foreground",
            )}
          >
            {group.pick.kind === "open"
              ? "Open"
              : group.at > 0 && activityLabel(new Date(group.at), now)}
          </span>
        </button>
      ))}
      {hasChats && (
        <button
          className="mt-1 flex h-9 shrink-0 items-center gap-2 self-start rounded-lg px-3 text-[13px] font-medium text-foreground/70 hover:bg-foreground/5 hover:text-foreground focus-visible:bg-foreground/5 focus-visible:outline-none"
          onClick={onAllChats}
          type="button"
        >
          <ChatsCircleIcon className="size-4" />
          All chats
          <ArrowRightIcon className="size-3 text-muted-foreground" />
        </button>
      )}
    </div>
  );
}
