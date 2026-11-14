import { RelativeTime } from "@/client/components/relative-time";
import { type ChatId } from "@instrument-org/workspace/client";
import { ChatCircleIcon } from "@phosphor-icons/react/ChatCircle";
import { QuestionIcon } from "@phosphor-icons/react/Question";
import { useId } from "react";

import { lastActiveAt, useOpenGroups } from "./tab-groups";

/** Rows the list stops at: enough to find a chat closed lately at a glance. */
const CLOSED_SHOWN = 5;

/**
 * The chats closed lately, under a new tab's composer: History's chats,
 * which no window has a tab on, most recently active first, each its title
 * and when it was last active, or that it waits on the person. Nothing
 * while there are none.
 */
export function ClosedRecently({ onOpen }: { onOpen: (chat: ChatId) => void }) {
  const headingId = useId();
  const closed = useOpenGroups()
    .history.flatMap((entry) => (entry.kind === "chat" ? [entry] : []))
    .slice(0, CLOSED_SHOWN);
  if (closed.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby={headingId} className="flex flex-col">
      <h2
        className="px-3 pb-1 text-xs font-medium text-muted-foreground"
        id={headingId}
      >
        Closed recently
      </h2>
      {closed.map((entry) => (
        <button
          className="flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-left text-[13px] hover:bg-foreground/5"
          key={entry.chat.id}
          onClick={() => {
            onOpen(entry.chat.id);
          }}
          type="button"
        >
          <ChatCircleIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate text-foreground/85">
            {entry.chat.title}
          </span>
          {entry.chat.status === "waiting" ? (
            <span className="flex shrink-0 items-center gap-1 text-foreground/80">
              <QuestionIcon className="size-3.5" weight="bold" />
              Waiting on you
            </span>
          ) : (
            <RelativeTime
              className="shrink-0 text-muted-foreground"
              date={new Date(lastActiveAt(entry))}
              tooltip={false}
            />
          )}
        </button>
      ))}
    </section>
  );
}
