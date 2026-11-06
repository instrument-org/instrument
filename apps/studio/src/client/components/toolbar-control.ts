import { cn } from "@/client/lib/utils";

// The surface every framed control around a tab's location row stands on: 32px
// tall, a card fill with a hairline ring as its edge and a faint drop under it,
// so the Files toolbar's sort, search and overflow menu, the browser's reload
// and menu, and whatever a host adds after them are one family. Its 12px
// corners sit 6px inside the row's edge, concentric with the card's 18px
// corner around them.
const TOOLBAR_SURFACE_CLASSNAME =
  "h-8 rounded-xl border-0 bg-card text-foreground/70 shadow-[0_1px_2px_rgb(0_0_0/0.04)] ring-1 ring-border dark:bg-input/30";

// A control on that surface. The hover is restated with `not-disabled:` so it
// replaces the one each primitive (button, select trigger) brings.
export const TOOLBAR_CONTROL_CLASSNAME = cn(
  TOOLBAR_SURFACE_CLASSNAME,
  "not-disabled:hover:bg-accent not-disabled:hover:text-foreground dark:not-disabled:hover:bg-input/50",
);

// The square, icon-only member of that family.
export const TOOLBAR_ICON_BUTTON_CLASSNAME = cn(
  TOOLBAR_CONTROL_CLASSNAME,
  "flex size-8 shrink-0 items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring",
);

// Several controls framed as one, the way back, forward and reload sit
// together: the frame is the family's, and each control inside is a bare 28px
// glyph that fills only on hover. Hidden while it holds no control, since a row
// fills it through a slot that is sometimes empty.
export const TOOLBAR_GROUP_CLASSNAME = cn(
  TOOLBAR_SURFACE_CLASSNAME,
  "flex shrink-0 items-center gap-0.5 px-0.5 not-has-[button]:hidden",
);
