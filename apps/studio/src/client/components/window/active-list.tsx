import { cn } from "@/client/lib/utils";
import { ChatCircleIcon } from "@phosphor-icons/react/ChatCircle";
import { type ChatId } from "@instrument-org/workspace/client";

import { type Chat } from "./chats";
import { type ActiveWord, activeChats } from "./row-lines";

/**
 * The Active list above the pinned groups: one line per chat that waits on
 * you, has a reply not yet read, or is at work, in that order, whether a tab
 * shows it or not. Each says its title and its state in a word. Nothing
 * shows while no chat is active.
 */
export function ActiveList({
  chats,
  onOpen,
}: {
  chats: readonly Chat[];
  onOpen?: (chat: ChatId) => void;
}) {
  const active = activeChats(chats);
  if (active.length === 0) {
    return null;
  }
  return (
    <div className="flex shrink-0 flex-col" data-active-list="">
      <div className="flex h-7 shrink-0 items-end px-2.5 pb-1 text-[12px] font-medium text-muted-foreground">
        Active
      </div>
      {active.map(({ chat, word }) => (
        <ActiveRow chat={chat} key={chat.id} onOpen={onOpen} word={word} />
      ))}
      <div className="mx-2.5 mt-1.5 mb-1 h-px shrink-0 bg-border" />
    </div>
  );
}

function ActiveRow({
  chat,
  onOpen,
  word,
}: {
  chat: Chat;
  onOpen: ((chat: ChatId) => void) | undefined;
  word: ActiveWord;
}) {
  const isStrong = word !== "Working";
  return (
    <button
      className="flex h-7 w-full shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-left text-[13px] hover:bg-foreground/[0.04]"
      data-active-chat={chat.id}
      onClick={() => {
        onOpen?.(chat.id);
      }}
      type="button"
    >
      <ChatCircleIcon className="size-3.5 shrink-0 text-foreground/65" />
      <span
        className={cn(
          "min-w-0 truncate",
          isStrong
            ? "font-semibold text-foreground"
            : "font-medium text-foreground/85",
        )}
      >
        {chat.title}
      </span>
      <span className="shrink-0 text-[12px] text-muted-foreground/60">·</span>
      <span
        className={cn(
          "shrink-0 text-[12px] font-medium",
          word === "Working"
            ? "text-brand-600 dark:text-brand-300"
            : "text-foreground",
        )}
      >
        {word}
      </span>
    </button>
  );
}
