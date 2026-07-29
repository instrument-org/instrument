import {
  type ClickActivation,
  immediateClickHandlers,
} from "@/client/lib/immediate-click";
import { cn } from "@/client/lib/utils";
import * as TogglePrimitive from "@radix-ui/react-toggle";
import * as React from "react";
import { tv, type VariantProps } from "tailwind-variants";

// Only the focus ring eases. These controls activate on press, so easing the
// surface would put a 150ms ramp in front of feedback for an action that has
// already run. Fill and text are dropped from the transition together: ramping
// one without the other shows the new background under the old text.
const toggleSharedChrome =
  "inline-flex items-center justify-center gap-2 text-sm font-medium whitespace-nowrap transition-[outline] outline-none focus-visible:border-ring focus-visible:[outline-style:solid] focus-visible:outline-[3px] focus-visible:outline-ring/50 focus-visible:outline-offset-0 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

const toolbarSurface = tv({
  // Inset the focus ring (negative outline-offset) so it is painted inside the
  // button box. The toolbar buttons live inside several overflow-hidden flex
  // rows, and an ancestor's overflow:hidden clips an outward outline (the
  // clipped rectangle seen after dismissing a header dropdown). An inset ring
  // cannot be clipped and still follows the rounded corners.
  base: "rounded-lg border-0 shadow-none focus-visible:-outline-offset-[3px]",
  variants: {
    pressed: {
      false:
        "bg-transparent text-muted-foreground not-disabled:hover:bg-muted not-disabled:hover:text-muted-foreground not-disabled:active:bg-muted",
      true: "bg-accent text-accent-foreground not-disabled:hover:bg-accent not-disabled:hover:text-accent-foreground not-disabled:active:bg-accent/90",
    },
  },
});

function toolbarClassName({
  className,
  pressed,
}: {
  className?: string;
  pressed: boolean;
}) {
  return cn(
    toggleSharedChrome,
    toolbarSurface({ pressed }),
    pressed &&
      "data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
    className,
  );
}

const toggleVariants = tv({
  base: cn(
    toggleSharedChrome,
    "rounded-md not-disabled:hover:bg-muted not-disabled:hover:text-muted-foreground aria-pressed:bg-accent aria-pressed:text-accent-foreground not-disabled:aria-pressed:hover:bg-accent not-disabled:aria-pressed:hover:text-accent-foreground not-disabled:aria-pressed:active:bg-accent/90",
  ),
  defaultVariants: {
    size: "default",
    variant: "default",
  },
  variants: {
    size: {
      default: "h-9 min-w-9 px-2",
      lg: "h-10 min-w-10 px-2.5",
      sm: "h-8 min-w-8 px-1.5",
    },
    variant: {
      default: "bg-transparent",
      outline:
        "border border-input bg-transparent shadow-xs not-disabled:hover:bg-accent not-disabled:hover:text-accent-foreground",
      toolbar: toolbarSurface({ pressed: false }),
    },
  },
});

function Toggle({
  activation,
  className,
  onClick,
  onPointerDown,
  size,
  variant,
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> &
  VariantProps<typeof toggleVariants> & {
    activation?: ClickActivation;
  }) {
  return (
    <TogglePrimitive.Root
      className={cn(toggleVariants({ className, size, variant }))}
      data-slot="toggle"
      {...immediateClickHandlers<HTMLButtonElement>({
        activation,
        onClick,
        onPointerDown,
      })}
      {...props}
    />
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export { Toggle, toggleVariants, toolbarClassName };
