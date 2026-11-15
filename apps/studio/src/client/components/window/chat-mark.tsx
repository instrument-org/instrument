import { type RailChatMark } from "@/client/components/window/chats";
import { cn } from "@/client/lib/utils";

/**
 * The dot that says where chats stand, ringed in what it sits on so it reads
 * clear of the icon under it: gray and still while a chat waits on the user,
 * pulsing green while one works, and still green while one has something not
 * yet seen. The rail's Chat wears it for every chat; a chat's window tab and
 * its bar along the foot wear it, smaller, for that chat alone.
 */
export function ChatMarkDot({
  className,
  mark,
}: {
  className?: string;
  mark: RailChatMark;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute -top-0.5 -right-1 size-2.5 rounded-full ring-2 ring-ground",
        mark === "waiting" && "bg-foreground/70",
        mark === "unread" && "bg-brand-500",
        // Filled with its ring's color, so the pulse inside fades to what
        // the dot sits on and never shows the icon's lines through it.
        mark === "working" && "bg-(--tw-ring-color)",
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
