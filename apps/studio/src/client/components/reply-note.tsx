import { cn } from "@/client/lib/utils";
import { type Icon } from "@phosphor-icons/react";
import { XIcon } from "@phosphor-icons/react/X";

/**
 * A card that sits over the reply box, as wide as the box, saying something
 * about the chat the person may want to act on: a plan out of usage, a model
 * that has gone, a trial nearly spent.
 *
 * A warning is the app's yellow, for something in the way of the next reply.
 * Anything else is neutral: white like the box, with its icon held back. The
 * words get the row and wrap rather than truncate, so a narrow chat keeps the
 * part that says why; the one action and the dismiss sit at the right.
 *
 * `nudge` counts the sends the note held back: each new count flashes it, so
 * a blocked send points at the reason already on screen.
 */
export function ReplyNote({
  action,
  children,
  className,
  icon: NoteIcon,
  iconClassName,
  nudge = 0,
  onDismiss,
  tone,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  /** One compact button (`ReplyNoteButton`), or a menu opened from one. */
  action?: React.ReactNode;
  children: React.ReactNode;
  icon: Icon;
  /** The icon's color, where the note's tone is not the right one for it. */
  iconClassName?: string;
  nudge?: number;
  /** Shows the dismiss button; a note the person cannot set aside has none. */
  onDismiss?: () => void;
  tone: "neutral" | "warn";
}) {
  const isWarn = tone === "warn";
  return (
    <div
      className={cn(
        "@container/note relative isolate min-h-8 min-w-0 rounded-xl py-1 pr-1 pl-3 text-xs shadow-xs ring-1 ring-inset",
        isWarn
          ? "bg-yellow-50 text-yellow-900 ring-yellow-300 dark:bg-yellow-500/15 dark:text-yellow-100 dark:ring-yellow-500/30"
          : "bg-white text-foreground/70 ring-black/[0.06] dark:bg-gray-800 dark:ring-white/10",
        className,
      )}
      data-slot="reply-note"
      data-tone={tone}
      role={isWarn ? "alert" : "status"}
      {...props}
    >
      {nudge > 0 && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 animate-notice-nudge rounded-[inherit]"
          key={nudge}
        />
      )}
      {/* Laid out against its own width: in a narrow chat the buttons drop
          under the words rather than squeezing them into a column. */}
      <div className="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1">
        <NoteIcon
          className={cn(
            "size-4 shrink-0",
            isWarn
              ? "text-yellow-700 dark:text-yellow-300"
              : "text-foreground/45",
            iconClassName,
          )}
        />
        <span className="min-w-0 flex-1 py-1 leading-snug text-pretty @max-xs/note:basis-[calc(100%-1.5rem)]">
          {children}
        </span>
        <div className="flex shrink-0 items-center gap-1.5 @max-xs/note:ml-6 @max-xs/note:pb-1">
          {action}
          {onDismiss && (
            <button
              aria-label="Dismiss"
              className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
              onClick={onDismiss}
              type="button"
            >
              <XIcon className="size-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The note's one action: a 24px light button, or the brand's when it is the
 * way back into the chat. Takes a ref and every button prop, so it can open a
 * menu.
 */
export function ReplyNoteButton({
  className,
  emphasis = false,
  ...props
}: React.ComponentProps<"button"> & { emphasis?: boolean }) {
  return (
    <button
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-2.5 font-medium shadow-xs disabled:opacity-50",
        emphasis
          ? "bg-brand-600 text-brand-foreground hover:bg-brand-700"
          : "bg-white text-foreground ring-1 ring-black/10 hover:bg-gray-50 dark:bg-gray-700 dark:ring-white/10 dark:hover:bg-gray-600",
        className,
      )}
      type="button"
      {...props}
    />
  );
}
