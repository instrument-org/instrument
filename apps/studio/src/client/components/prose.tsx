import { cn } from "@/client/lib/utils";
import { type ComponentProps } from "react";

/**
 * The one text size a surface sets its prose at. Everything inside follows
 * it: the heading scales, code, tables and chips are all sized in em in
 * `globals.css` (`prose-custom` and its heading variants), so changing this
 * changes all of it together.
 */
const PROSE_SIZES = {
  /** An assistant turn in the transcript. */
  md: "text-[15px]/[1.5]",
  /** A document or a tool's output read at full width. */
  sm: "text-sm/relaxed",
  /** A document shown inside a small card. */
  xs: "text-xs/relaxed",
} as const;

/**
 * How headings are drawn, each a variant in `globals.css`:
 *
 * - `document`: serif and editorial, for a document read on its own.
 * - `session`: the app's sans face a step or two above the body, for a reply
 *   and the files and output shown in a chat.
 * - `card`: within a step of the body with tight block spacing, so a few lines
 *   of a document in a card read as its outline.
 */
const PROSE_HEADINGS = {
  card: "prose-card",
  document: undefined,
  session: "prose-session",
} as const;

/**
 * Markdown or HTML set as prose. Every surface that shows written text goes
 * through this, so its size and heading scale are named in one place.
 *
 * Choose a size and a heading scale here rather than sizing what is inside.
 * A `prose-p:text-xs` or `prose-h1:text-base` on a call site sizes only the
 * elements it names, so a chip, an inline code span or a quote beside them
 * stays at the size the container had, and sticks out. A surface that needs
 * a different rhythm adds a heading variant in `globals.css`, in em.
 */
export function Prose({
  className,
  headings,
  size,
  ...props
}: ComponentProps<"div"> & {
  headings: keyof typeof PROSE_HEADINGS;
  size: keyof typeof PROSE_SIZES;
}) {
  return (
    <div
      {...props}
      className={cn(
        "prose prose-custom font-sans wrap-break-word dark:prose-invert",
        PROSE_SIZES[size],
        PROSE_HEADINGS[headings],
        className,
      )}
    />
  );
}
