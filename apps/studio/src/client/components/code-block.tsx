import { type Icon } from "@phosphor-icons/react";
import { ArrowElbowDownLeftIcon } from "@phosphor-icons/react/ArrowElbowDownLeft";
import { ArrowsHorizontalIcon } from "@phosphor-icons/react/ArrowsHorizontal";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { CaretUpIcon } from "@phosphor-icons/react/CaretUp";
import { useDeferredValue, useState } from "react";

import { useSyntaxHighlighting } from "../hooks/use-syntax-highlighting";
import { getLanguageDisplayName } from "../lib/file-extension-to-language";
import { cn } from "../lib/utils";
import { CopyButton } from "./copy-button";
import { FileIcon } from "./file-icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/** Shared styling for the controls that float over a rendered block. */
export const blockToolbarButtonClassName =
  // `card` rather than `muted` for the hover: muted is a translucent white in
  // dark mode, so the block underneath read straight through the control on top
  // of it. Both of these are solid in both themes.
  "rounded-md border border-border/50 bg-background p-1 text-muted-foreground hover:bg-card hover:text-foreground";

/**
 * One of the controls that float over a rendered block: code, a diagram, an
 * image.
 *
 * Always tooltipped, because the icon is the only thing on screen saying what
 * it does and several of them are asking a lot of one glyph -- nobody reads `↵`
 * as "stop wrapping these lines" on sight. The label is the accessible name as
 * well: a tooltip is portalled somewhere assistive tech never reads, so on its
 * own it leaves the button announcing as nothing.
 */
export const BlockToolbarButton = ({
  icon: Icon,
  label,
  onClick,
  pressed,
}: {
  icon: Icon;
  label: string;
  onClick: () => void;
  /** Present on a control that stays on once pressed, absent on an action. */
  pressed?: boolean;
}) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button
        aria-label={label}
        aria-pressed={pressed}
        className={cn(
          blockToolbarButtonClassName,
          "aria-pressed:bg-card aria-pressed:text-foreground",
        )}
        onClick={onClick}
        type="button"
      >
        <Icon size={12} />
      </button>
    </TooltipTrigger>
    <TooltipContent>{label}</TooltipContent>
  </Tooltip>
);

/**
 * Wrapping is entirely ours to decide: the highlighter hands back tokens as
 * inline spans inside one `<pre>`, so it reflows like any other markup and
 * nothing about the wrapped view is lost or approximated. Breaking is
 * `break-word` rather than `break-all` so a line only breaks mid-token when the
 * token could not fit a line of its own -- a URL or a base64 blob wraps, an
 * ordinary identifier stays whole.
 *
 * Reached through a descendant selector because the `<pre>` it acts on is one
 * the caller wrote in some cases and one the highlighter wrote in others. Put
 * it on whatever element scrolls, so dropping it leaves the unwrapped lines
 * somewhere to go.
 */
export const wrapLinesClassName =
  "[&_pre]:wrap-break-word [&_pre]:whitespace-pre-wrap";

/**
 * Past this many lines a block is capped at `COLLAPSED_HEIGHT` until the reader
 * asks for the rest. Set well above the height so that expanding always reveals
 * a worthwhile amount of code rather than the two lines a block just over the
 * line would be hiding.
 */
const COLLAPSIBLE_LINES = 24;
const COLLAPSED_HEIGHT = "[&_pre]:max-h-[20lh]";

/**
 * The mask that ends a clamped region, fading its content out rather than
 * cutting it off, so the stop reads as "there is more" and not as a line that
 * happened to end there.
 */
export const collapsedFadeClassName =
  "[mask-image:linear-gradient(to_bottom,black_calc(100%_-_3rem),transparent)]";

/**
 * The control that opens a clamped region and closes it again.
 *
 * The caller passes the classes that fade it out and says in which states,
 * because how loud it has to be depends on what else is saying there is more.
 * Which group answers a hover is the caller's too: a named group matches any
 * ancestor carrying the name rather than the nearest, and these regions nest.
 */
export const BlockExpandButton = ({
  className,
  collapsedLabel,
  isExpanded,
  onToggle,
}: {
  className?: string;
  /** What there is more of, e.g. "Show more". */
  collapsedLabel: string;
  isExpanded: boolean;
  onToggle: () => void;
}) => (
  <button
    className={cn(
      "absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-md border border-border/50 bg-background px-2 py-1 text-xs text-muted-foreground hover:bg-card hover:text-foreground",
      className,
    )}
    onClick={onToggle}
    type="button"
  >
    {isExpanded ? <CaretUpIcon size={12} /> : <CaretDownIcon size={12} />}
    {isExpanded ? "Show less" : collapsedLabel}
  </button>
);

export const CodeWithCopy = ({
  children,
  content,
  ref,
}: {
  children: React.ReactNode;
  content: string;
  ref?: React.Ref<HTMLDivElement>;
}) => (
  <div className="group/block-toolbar relative isolate" ref={ref}>
    {/* `focus-within` as well as hover: the button stays in the tab order while
        it is transparent, so without it a keyboard user lands on a control
        with nothing on screen to show for it. */}
    <div className="absolute top-1 right-1 z-10 opacity-0 group-hover/block-toolbar:opacity-100 focus-within:opacity-100">
      <CopyButton
        className={blockToolbarButtonClassName}
        iconSize={12}
        onCopy={async () => {
          await navigator.clipboard.writeText(content);
        }}
        tooltip="Copy code"
      />
    </div>
    {children}
  </div>
);

export const CodeBlock = ({
  code,
  language,
}: {
  code: string;
  language?: string;
}) => {
  const deferredCode = useDeferredValue(code);
  const { highlightedHtml } = useSyntaxHighlighting({
    code: deferredCode,
    language,
  });

  if (!highlightedHtml) {
    return (
      <pre>
        <code>{code}</code>
      </pre>
    );
  }

  return (
    <div dangerouslySetInnerHTML={{ __html: highlightedHtml.join("\n") }} />
  );
};

/**
 * A fenced code block in rendered markdown, with the controls that act on it.
 *
 * Lines wrap by default and the toggle is per block and forgotten on unmount:
 * unwrapping is something a reader wants for the one wide table or log in front
 * of them, and a remembered setting would instead reflow every other block in
 * the transcript around whatever they were reading.
 */
export const MarkdownCodeBlock = ({
  code,
  filename,
  language,
}: {
  code: string;
  filename?: string;
  language?: string;
}) => {
  const [wrapLines, setWrapLines] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);

  const lineCount = code.split("\n").length;
  const isCollapsible = lineCount > COLLAPSIBLE_LINES;
  const isCollapsed = isCollapsible && !isExpanded;
  // What the fence says it is holding, written out: the file it names, or
  // failing that the language, under the name a person would use for it rather
  // than the token a model typed. A fence claiming neither carries no label,
  // which is the one case where the block is drawn exactly as it always was.
  const label = filename ?? (language && getLanguageDisplayName(language));

  return (
    <div className="group/block-toolbar relative isolate">
      {/* Out of the flow, which is not only about overlaying the code: the
          block's own margin collapses out of this wrapper, and an in-flow
          sibling ahead of it would keep the margin inside instead and leave
          everything positioned here sitting in the gap above the block. */}
      <div
        className={cn(
          "pointer-events-none absolute inset-x-1 top-1 z-10 flex items-start gap-2",
          label ? "justify-between" : "justify-end",
        )}
      >
        {/* Drawn on the block's own background rather than in a chip of its
            own: it says what the block is, and nothing about it is a control. */}
        {label && (
          <span className="flex min-w-0 items-center gap-1.5 px-1.5 py-0.5 text-xs text-muted-foreground">
            {filename && (
              <FileIcon className="size-3.5 shrink-0" filename={filename} />
            )}
            <span className="truncate">{label}</span>
          </span>
        )}

        {/* `focus-within` as well as hover: the buttons stay in the tab order
            while they are transparent, so without it a keyboard user lands on a
            control with nothing on screen to show for it. */}
        <div className="pointer-events-auto flex items-center gap-1 opacity-0 group-hover/block-toolbar:opacity-100 focus-within:opacity-100">
          {/* The icon is the state rather than the action: on a block whose
              lines all fit, nothing about the code changes when this is
              clicked, so the button is the only thing that can report it. */}
          <BlockToolbarButton
            icon={wrapLines ? ArrowElbowDownLeftIcon : ArrowsHorizontalIcon}
            label="Wrap lines"
            onClick={() => {
              setWrapLines(!wrapLines);
            }}
            pressed={wrapLines}
          />
          <CopyButton
            className={blockToolbarButtonClassName}
            iconSize={12}
            onCopy={async () => {
              await navigator.clipboard.writeText(code);
            }}
            tooltip="Copy code"
          />
        </div>
      </div>

      <div
        className={cn(
          wrapLines && wrapLinesClassName,
          // The mask fades the block's own background out with the code, so the
          // cut reads as the block continuing under the message rather than as
          // a line that happens to end there.
          // The `[&_pre]:` form of the fade, spelled out rather than built from
          // the shared one: Tailwind scans source for whole class names, and a
          // variant glued on at runtime is a class it never generates.
          isCollapsed &&
            `${COLLAPSED_HEIGHT} [&_pre]:overflow-y-hidden [&_pre]:[mask-image:linear-gradient(to_bottom,black_calc(100%_-_3rem),transparent)]`,
          label && "[&_pre]:pt-8",
        )}
      >
        <CodeBlock code={code} language={language} />
      </div>

      {isCollapsible && (
        <BlockExpandButton
          // Collapsed it is the only thing offering the rest, so it stays on
          // screen. Expanded it is chrome like the rest of the toolbar.
          className={
            isExpanded
              ? "opacity-0 group-hover/block-toolbar:opacity-100 focus-visible:opacity-100"
              : undefined
          }
          collapsedLabel={`Show all ${lineCount} lines`}
          isExpanded={isExpanded}
          onToggle={() => {
            setIsExpanded(!isExpanded);
          }}
        />
      )}
    </div>
  );
};
