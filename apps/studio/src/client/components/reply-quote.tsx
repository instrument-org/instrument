import { type SessionMessageDataPart } from "@instrument-org/workspace/client";
import { ArrowBendUpLeftIcon } from "@phosphor-icons/react/ArrowBendUpLeft";
import { XIcon } from "@phosphor-icons/react/X";

import { useReleaseAutoScroll } from "./transcript-scroll-context";

type Reply = SessionMessageDataPart.ReplyDataPart;

/** The message the next send answers, over the composer until it goes or is let go. */
export function ComposerReplyQuote({
  onDismiss,
  reply,
}: {
  onDismiss: () => void;
  reply: Reply;
}) {
  return (
    <div className="mb-1.5 flex items-center gap-2 rounded-xl bg-muted/60 py-1 pr-1 pl-3 text-xs text-muted-foreground">
      <ArrowBendUpLeftIcon className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{reply.text}</span>
      <button
        aria-label="Cancel reply"
        className="shrink-0 rounded-md p-1 hover:bg-muted hover:text-foreground"
        onClick={onDismiss}
        type="button"
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}

/**
 * The message a sent reply answers, on one line over the user's bubble. It
 * takes the reader to the original, in the transcript it is drawn in.
 */
export function SentReplyQuote({ reply }: { reply: Reply }) {
  const releaseAutoScroll = useReleaseAutoScroll();
  return (
    <div className="flex justify-end">
      <button
        className="inline-flex max-w-[80%] min-w-0 cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
        onClick={(event) => {
          const target = event.currentTarget
            .closest("[data-transcript]")
            ?.querySelector(
              `[data-reply-target="${CSS.escape(reply.partId)}"]`,
            );
          if (target) {
            releaseAutoScroll();
            target.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }}
        type="button"
      >
        <ArrowBendUpLeftIcon className="size-3.5 shrink-0" />
        <span className="truncate">{reply.text}</span>
      </button>
    </div>
  );
}
