import { cn } from "@/client/lib/utils";

/**
 * The moving glint of a `brand-shiny-text` or `shiny-text` span, placed as the
 * span's last child while it shimmers. It draws a copy of `text` over the
 * span's own, masked to its glyphs, and slides a highlight bar across that
 * copy with a transform, so the GPU moves the glint and nothing repaints per
 * frame. The copy comes from `attr(data-text)` (see `globals.css`), so the
 * span's text content, and what tests and screen readers read, stays `text`
 * once.
 */
export function ShimmerSweep({ text }: { text: string }) {
  return <span aria-hidden className="shimmer-sweep" data-text={text} />;
}

/**
 * The same glint running around a card's edge while it works, over the card's own
 * border. A sibling of the card inside a positioned box of the card's size and
 * rounding, since a card that clips its contents would clip this too.
 */
export function BorderSweep({ className }: { className?: string }) {
  return <span aria-hidden className={cn("border-sweep", className)} />;
}
