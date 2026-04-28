import { cn } from "@/client/lib/utils";
import * as TogglePrimitive from "@radix-ui/react-toggle";
import * as React from "react";
import { tv, type VariantProps } from "tailwind-variants";

const toggleSharedChrome =
  "inline-flex items-center justify-center gap-2 text-sm font-medium whitespace-nowrap transition-[color,box-shadow,background-color] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

const toolbarTabSurface = tv({
  base: "rounded-lg border-0 shadow-none",
  variants: {
    pressed: {
      false:
        "bg-transparent text-muted-foreground hover:bg-muted hover:text-muted-foreground active:bg-muted",
      true: "bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground active:bg-accent/90",
    },
  },
});

function toolbarTabClassName({
  className,
  pressed,
}: {
  className?: string;
  pressed: boolean;
}) {
  return cn(
    toggleSharedChrome,
    toolbarTabSurface({ pressed }),
    pressed &&
      "data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
    className,
  );
}

const toggleVariants = tv({
  base: cn(
    toggleSharedChrome,
    "rounded-md hover:bg-muted hover:text-muted-foreground aria-pressed:bg-accent aria-pressed:text-accent-foreground aria-pressed:hover:bg-accent aria-pressed:hover:text-accent-foreground aria-pressed:active:bg-accent/90",
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
        "border border-input bg-transparent shadow-xs hover:bg-accent hover:text-accent-foreground",
      tab: toolbarTabSurface({ pressed: false }),
    },
  },
});

function Toggle({
  className,
  size,
  variant,
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> &
  VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      className={cn(toggleVariants({ className, size, variant }))}
      data-slot="toggle"
      {...props}
    />
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export { Toggle, toggleVariants, toolbarTabClassName };
