import { cn } from "@/client/lib/utils";
import { Slot } from "@radix-ui/react-slot";
import * as React from "react";
import { tv, type VariantProps } from "tailwind-variants";

// eslint-disable-next-line react-refresh/only-export-components
export const buttonVariants = tv({
  base: "inline-flex shrink-0 items-center justify-center gap-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:outline-[3px] focus-visible:outline-offset-0 focus-visible:outline-ring/50 focus-visible:[outline-style:solid] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
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
      brand: "bg-brand-600 text-brand-foreground shadow-xs hover:bg-brand-700",
      default:
        "bg-card text-card-foreground shadow-sm hover:bg-secondary dark:bg-gray-200 dark:text-gray-900 dark:hover:bg-gray-300",
      destructive:
        "bg-destructive text-white hover:bg-destructive/90 focus-visible:outline-destructive/20 dark:bg-destructive/60 dark:focus-visible:outline-destructive/40",
      ghost:
        "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
      "ghost-destructive":
        "text-destructive hover:bg-destructive/10 dark:hover:bg-destructive/20",
      "ghost-overlay": "text-white hover:bg-white/20 hover:text-white",
      "input-select":
        "border-0 bg-gradient-to-b from-white to-[#fafaf9] text-foreground shadow-sm hover:brightness-95 dark:border dark:border-input dark:bg-input/30 dark:bg-none dark:from-transparent dark:to-transparent dark:hover:bg-input/50",
      link: "text-primary underline-offset-4 hover:underline",
      outline:
        "border border-black/5 text-muted-foreground hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10",
      "outline-muted":
        "border bg-background shadow-xs hover:bg-muted dark:border-input",
      secondary:
        "border border-transparent bg-secondary text-secondary-foreground shadow-xs hover:bg-muted hover:text-secondary-foreground dark:hover:bg-muted",
    },
  },
});

export type ButtonVariant = VariantProps<typeof buttonVariants>["variant"];

export function Button({
  asChild = false,
  className,
  size = "default",
  variant = "default",
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      className={cn(buttonVariants({ className, size, variant }))}
      data-size={size}
      data-slot="button"
      data-variant={variant}
      {...props}
    />
  );
}
