import { type SessionMessagePart } from "@instrument-org/workspace/client";
import { ArrowElbowDownLeftIcon } from "@phosphor-icons/react/ArrowElbowDownLeft";
import { ArrowsHorizontalIcon } from "@phosphor-icons/react/ArrowsHorizontal";
import { debounce } from "radashi";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { filenameFromFilePath } from "../../lib/path-utils";
import { cn } from "../../lib/utils";
import {
  BlockExpandButton,
  BlockToolbarButton,
  blockToolbarButtonClassName,
  collapsedFadeClassName,
  wrapLinesClassName,
} from "../code-block";
import { CopyButton } from "../copy-button";
import { useReleaseAutoScroll } from "../transcript-scroll-context";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

export function FileChip({ part }: { part: SessionMessagePart.ToolPart }) {
  let filePath: string | undefined;

  if (
    (part.type === "tool-edit_file" ||
      part.type === "tool-write_file" ||
      part.type === "tool-read_file") &&
    // typeof guard is intentional: the AI SDK types DeepPartial<string> as
    // string during streaming, but parsePartialJson can produce null mid-stream.
    typeof part.input?.filePath === "string" &&
    part.input.filePath.length > 0
  ) {
    filePath = part.input.filePath;
  }

  if (!filePath) {
    return null;
  }

  const filename = filenameFromFilePath(filePath);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ToolChip className="max-w-[12rem] px-2">
          <span className="truncate text-xs font-medium text-foreground/50">
            {filename}
          </span>
        </ToolChip>
      </TooltipTrigger>
      <TooltipContent>{filePath}</TooltipContent>
    </Tooltip>
  );
}

export function ToolCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "group/card mt-2 overflow-hidden rounded-2xl border border-border bg-card",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * The controls at the right-hand end of a card's header.
 *
 * They stand 20px tall against a header line of 16px, so left in the flow they
 * are what sets the header's height -- and they only appear once there is a
 * file to act on, which means the header grew by the difference at the moment
 * the call finished, on top of whatever the card's body was already doing. So
 * the row hangs 2px into the header's own padding instead, which keeps a 20px
 * hit target and leaves the header one height from start to end.
 */
export function ToolCardActions({ children }: { children: ReactNode }) {
  return (
    <div className="-my-0.5 flex shrink-0 items-center gap-3">{children}</div>
  );
}

/**
 * The body of a call that has nothing to draw.
 *
 * Every call's row carries a chevron, because whether a body will have anything
 * in it is only knowable inside the body -- restating each tool's emptiness in
 * the summary is the same condition written twice, and the copy that drifts is
 * the one nobody is looking at. So the row always opens, and this is what it
 * opens onto when the answer is nothing.
 *
 * Saying so out loud rather than rendering nothing: an empty card is a thing
 * the reader can see and report, and a row that opens onto blank space is not.
 * A diff whose header stripped one line too many looked exactly like a call
 * that had drawn correctly and been collapsed again.
 */
export function ToolCardEmpty({ message }: { message: string }) {
  return (
    <ToolCard>
      <div className="px-4 py-3">
        <p className="text-sm text-muted-foreground italic">{message}</p>
      </div>
    </ToolCard>
  );
}

export function ToolCardHeader({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("border-b border-border bg-muted px-4 py-3", className)}>
      {children}
    </div>
  );
}

function ToolCardCopyButton({ text }: { text: string }) {
  return (
    <CopyButton
      className={blockToolbarButtonClassName}
      iconSize={12}
      onCopy={async () => {
        await navigator.clipboard.writeText(text);
      }}
      tooltip="Copy"
    />
  );
}

/**
 * The corner cluster of controls acting on one region of a card.
 *
 * Reveals on `group/section`, which the region has to carry. Named rather than
 * bare, and not the card's group, because a card can hold more than one region:
 * an unnamed group answers any hovered ancestor, so the output's controls would
 * light while the reader is over the command.
 */
function ToolCardOverlay({ children }: { children: ReactNode }) {
  return (
    // `focus-within` as well as hover: the buttons stay in the tab order while
    // they are transparent, so without it a keyboard user lands on a control
    // with nothing on screen to show for it.
    <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 transition-opacity duration-200 group-hover/section:opacity-100 focus-within:opacity-100">
      {children}
    </div>
  );
}

/**
 * How tall an opened region may stand. Roughly two and a half times the height
 * most sections rest at: enough to read a stack trace without leaving the
 * transcript, short enough that two open at once do not own it.
 */
const EXPANDED_HEIGHT = 480;

/**
 * One region of a card, clamped until the reader asks for the rest, with the
 * controls that act on it floating in its corner.
 *
 * Per section rather than per card because a card can hold more than one -- a
 * bash call is a command and its output -- and "copy" or "stop wrapping" have
 * to mean one of them rather than both.
 *
 * The controls are the same ones a fenced code block in markdown carries, drawn
 * the same way. A reader who has learned `↵` there should not have to learn it
 * twice.
 *
 * Clamped rather than scrolled: a scroller nobody opened catches the wheel of a
 * reader on their way past, which is what makes one inside a transcript a trap.
 * Opening the region is what asks for it, so that is where the scrolling goes
 * -- and opening grows to `EXPANDED_HEIGHT` rather than to whatever the content
 * measures, because a four-hundred-line log laid out in full is a card taller
 * than the window, and scrolling the transcript past it costs more than the
 * scroller inside it ever did.
 *
 * Bounding it is also what retires the line count. Naming the price only earns
 * its noise while the price is unbounded; opened, every region is the same
 * height, so there is nothing to warn about and the control can just say what
 * it does.
 */
export function ToolCardSection({
  borderBottom = false,
  children,
  collapsedHeight,
  copyText,
  wrappable = false,
}: {
  borderBottom?: boolean;
  children: React.ReactNode;
  /**
   * How tall the region stands before it is opened, in px.
   *
   * A number rather than a `max-h-*` class because the clamp and the check that
   * decides whether anything is being clamped have to be the same value.
   * Content taller than one and shorter than the other gets a fade and a
   * control over text that was never cut off.
   */
  collapsedHeight: number;
  copyText?: string;
  /**
   * Whether the region holds preformatted text wide enough to be worth seeing
   * unwrapped. Off for prose and for anything laid out as rows, where there are
   * no long lines to reflow and the toggle would do nothing visible.
   */
  wrappable?: boolean;
}) {
  // Both per section and forgotten on unmount, for the same reason a code
  // block's are: these answer the one wide log in front of the reader, and a
  // remembered setting would instead reflow every other card in the transcript
  // around whatever they were reading.
  const [wrapLines, setWrapLines] = useState(true);
  const releaseAutoScroll = useReleaseAutoScroll();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Measured rather than counted from the text: a section is clamped by height,
  // and with wrapping on a single 400-character line fills the slot on its own.
  // Counting lines would leave that one clipped with nothing offering the rest.
  useEffect(() => {
    const element = contentRef.current;
    if (!element) {
      return;
    }

    const checkOverflow = () => {
      setIsOverflowing(element.scrollHeight > collapsedHeight);
    };

    checkOverflow();

    // The observed element is the content, never the clamp around it: a clamped
    // box stays exactly `collapsedHeight` tall no matter how much output
    // arrives, so observing that one would go quiet for the whole of a
    // streaming call -- which is when the answer changes.
    const resizeObserver = new ResizeObserver(
      debounce({ delay: 100 }, checkOverflow),
    );
    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
    };
  }, [collapsedHeight]);

  const isCollapsed = isOverflowing && !isExpanded;
  const hasToolbar = wrappable || copyText !== undefined;

  return (
    <div
      className={cn(
        "group/section relative",
        borderBottom && "border-b border-border",
      )}
    >
      <div
        className={cn(
          // Horizontal only. Vertical is the clamp's, and a box that scrolls
          // both ways would put back the trap the clamp is here to avoid.
          "scrollbar-thin scrollbar-color overflow-x-auto",
          // Scrolls only once opened, and chains rather than containing, so
          // reaching the end of a log carries on down the transcript instead of
          // stopping dead in a box.
          isExpanded ? "overflow-y-auto" : "overflow-y-hidden",
          isCollapsed && collapsedFadeClassName,
        )}
        style={{
          maxHeight: isExpanded
            ? // Never shorter than it rested at: a section can be clamped taller
              // than this closed, and opening one must not shrink it.
              Math.max(collapsedHeight, EXPANDED_HEIGHT)
            : collapsedHeight,
        }}
      >
        <div
          className={cn(
            "px-4 py-3",
            wrappable && wrapLines && wrapLinesClassName,
            // Room for the controls, so they never come down on the first line.
            // Sized to the cluster rather than guessed, since a section that
            // reserved for one button had the second one land on the text.
            hasToolbar &&
              (wrappable && copyText !== undefined ? "pr-14" : "pr-7"),
            // Likewise for the control at the foot, which sits over the last
            // line rather than after it once the section is open.
            isOverflowing && "pb-10",
          )}
          ref={contentRef}
        >
          {children}
        </div>
      </div>

      {hasToolbar && (
        <ToolCardOverlay>
          {wrappable && (
            // The icon is the state rather than the action: on a section whose
            // lines all fit, nothing about the text changes when this is
            // clicked, so the button is the only thing that can report it.
            <BlockToolbarButton
              icon={wrapLines ? ArrowElbowDownLeftIcon : ArrowsHorizontalIcon}
              label="Wrap lines"
              onClick={() => {
                releaseAutoScroll();
                setWrapLines(!wrapLines);
              }}
              pressed={wrapLines}
            />
          )}
          {copyText !== undefined && <ToolCardCopyButton text={copyText} />}
        </ToolCardOverlay>
      )}

      {isOverflowing && (
        <BlockExpandButton
          // Quiet in both states, unlike a code block's. The fade is already
          // saying the region is holding something back, and it says it without
          // putting a widget on every long card in the transcript.
          className="opacity-0 group-hover/section:opacity-100 focus-visible:opacity-100"
          isExpanded={isExpanded}
          onToggle={() => {
            releaseAutoScroll();
            setIsExpanded(!isExpanded);
          }}
        />
      )}
    </div>
  );
}

export function ToolChip({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "ml-1 flex shrink-0 items-center gap-1.5 rounded-full bg-foreground/5 py-0.5 pr-2.5 pl-1",
        className,
      )}
    >
      {children}
    </span>
  );
}
