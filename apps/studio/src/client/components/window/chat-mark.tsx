import { type Chat } from "@/client/components/window/chats";
import { cn } from "@/client/lib/utils";
import { type ReactNode } from "react";

/** What a chat's dot says: something in it is not yet seen, or it is at work. */
export type ChatDot = "unread" | "working";

/**
 * The dot on a chat's icon: still green while the chat has something not yet seen,
 * pulsing green while it works. A question waiting on the person is the
 * icon's to say (`ChatAskIcon`), so a chat can be unread and asking at once.
 */
export function ChatMarkDot({
  className,
  mark,
}: {
  className?: string;
  mark: ChatDot;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute -top-0.5 -right-1 size-2.5 rounded-full",
        mark === "unread" && "bg-brand-500",
        className,
      )}
      data-chat-mark={mark}
    >
      {mark === "working" && (
        <span className="absolute inset-0 rounded-full bg-brand-500 motion-safe:animate-pulse" />
      )}
    </span>
  );
}

/**
 * The dot a chat's mark wears: with `isWorkShown`, the pulse of a chat at
 * work, else green for something not yet seen. A chat with a question waiting
 * is not at work.
 */
export function chatDotOf(
  chat: Pick<Chat, "status" | "unread" | "working"> | undefined,
  { isWorkShown = false }: { isWorkShown?: boolean } = {},
): ChatDot | undefined {
  if (isWorkShown && chat?.working === true && !isAsking(chat)) {
    return "working";
  }
  return chat?.unread === true ? "unread" : undefined;
}

/**
 * Whether a chat's icon is the asking bubble wherever it stands: the chat
 * waits on the person, read or not, on screen or not.
 */
export function isAsking(chat: Pick<Chat, "status"> | undefined): boolean {
  return chat?.status === "waiting";
}

/**
 * One chat's icon wherever it stands for the chat (its tab in a strip, its
 * mark in a sidebar row, its row of the bookmarks bar's Chats menu or of the
 * command menu), with its dot on the corner. The icon is cut away around the dot, so
 * the two read apart on any background.
 */
export function ChatMarkIcon({
  dot,
  icon,
}: {
  dot: ChatDot | undefined;
  icon: ReactNode;
}) {
  if (!dot) {
    return icon;
  }
  return (
    <span className="relative flex shrink-0">
      <span className="flex mask-[radial-gradient(circle_5.5px_at_100%_2px,transparent_5px,black)]">
        {icon}
      </span>
      <ChatMarkDot className="size-2" mark={dot} />
    </span>
  );
}
