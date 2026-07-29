import {
  type ClickActivation,
  immediateClickHandlers,
} from "@/client/lib/immediate-click";
import { cn } from "@/client/lib/utils";
import { Slot } from "@radix-ui/react-slot";
import * as React from "react";
import { tv, type VariantProps } from "tailwind-variants";

// eslint-disable-next-line react-refresh/only-export-components
export const buttonVariants = tv({
  base: "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg text-sm font-medium whitespace-nowrap transition-[outline] outline-none focus-visible:border-ring focus-visible:outline-[3px] focus-visible:outline-offset-0 focus-visible:outline-ring/50 focus-visible:[outline-style:solid] disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  defaultVariants: {
    size: "default",
    variant: "default",
  },
  variants: {
    size: {
      default: "h-9 px-4 py-2 has-[>svg]:px-3",
      icon: "size-9 rounded-md",
      "icon-lg": "size-10 rounded-md",
      "icon-sm": "size-8 rounded-md",
      lg: "h-10 px-6 has-[>svg]:px-4",
      sm: "h-8 gap-1.5 px-3 has-[>svg]:px-2.5",
      xs: "h-6 gap-1.5 rounded-lg px-2.5 text-xs has-[>svg]:px-2",
    },
    variant: {
      brand:
        "bg-brand-600 button-sheen text-brand-foreground shadow-xs not-disabled:hover:bg-brand-700",
      default:
        "bg-card button-sheen text-card-foreground shadow-sm not-disabled:hover:bg-secondary dark:bg-gray-700 dark:text-foreground dark:shadow-sm dark:not-disabled:hover:bg-gray-600",
      destructive:
        "bg-destructive button-sheen text-white not-disabled:hover:bg-destructive/90 focus-visible:outline-destructive/20 dark:bg-destructive/60 dark:focus-visible:outline-destructive/40",
      ghost:
        "not-disabled:hover:bg-accent not-disabled:hover:text-accent-foreground dark:not-disabled:hover:bg-accent/50",
      "ghost-destructive":
        "text-destructive not-disabled:hover:bg-destructive/10 dark:not-disabled:hover:bg-destructive/20",
      "ghost-overlay":
        "text-white not-disabled:hover:bg-white/20 not-disabled:hover:text-white",
      // For the toolbar surface, where `accent` is the same gray as the
      // background and a plain ghost hover is invisible.
      "ghost-toolbar":
        "not-disabled:hover:bg-muted/60 not-disabled:hover:text-foreground",
      "input-select":
        "border-0 bg-linear-to-b from-white to-[#fafaf9] text-foreground shadow-sm not-disabled:hover:brightness-95 dark:border dark:border-input dark:bg-input/30 dark:bg-none dark:from-transparent dark:to-transparent dark:not-disabled:hover:bg-input/50",
      link: "text-primary underline-offset-4 not-disabled:hover:underline",
      outline:
        "border border-black/5 text-muted-foreground not-disabled:hover:bg-black/5 dark:border-white/10 dark:not-disabled:hover:bg-white/10",
      "outline-muted":
        "border bg-background shadow-xs not-disabled:hover:bg-muted dark:border-input",
      secondary:
        "bg-secondary button-sheen text-secondary-foreground shadow-xs not-disabled:hover:bg-muted not-disabled:hover:text-secondary-foreground dark:bg-gray-800 dark:not-disabled:hover:bg-gray-700",
    },
  },
});

export type ButtonVariant = VariantProps<typeof buttonVariants>["variant"];

export function Button({
  activation,
  asChild = false,
  className,
  onClick,
  onPointerDown,
  size = "default",
  type,
  variant = "default",
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    activation?: ClickActivation;
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      className={cn(buttonVariants({ className, size, variant }))}
      data-size={size}
      data-slot="button"
      data-variant={variant}
      type={type}
      {...immediateClickHandlers<HTMLButtonElement>({
        activation: activation ?? defaultActivation({ asChild, type, variant }),
        onClick,
        onPointerDown,
      })}
      {...props}
    />
  );
}

/**
 * Buttons activate on press, so the app answers a click the way a native
 * desktop control does. Three cases opt back out of that, because pressing
 * them commits something a user cannot take back by releasing somewhere else:
 *
 * - Destructive variants, which is where losing pointer cancellation costs the
 *   most and where the WCAG guidance on down-event activation actually bites.
 * - Explicit `submit`/`reset`, which hand the press to the surrounding form.
 * - `asChild`, where the rendered element is somebody else's and owns its own
 *   activation. `InternalLink` already navigates on press; wrapping it would
 *   navigate twice.
 *
 * Confirmation dialogs need no rule here: `AlertDialogAction` and
 * `AlertDialogCancel` borrow `buttonVariants` for styling and never render
 * this component, so they stay on release.
 */
function defaultActivation({
  asChild,
  type,
  variant,
}: {
  asChild: boolean;
  type: React.ComponentProps<"button">["type"];
  variant: ButtonVariant;
}): ClickActivation {
  if (asChild || type === "submit" || type === "reset") {
    return "release";
  }
  return variant === "destructive" || variant === "ghost-destructive"
    ? "release"
    : "pointer-down";
}
