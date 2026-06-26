import { cn } from "@/client/lib/utils";
import { Slot } from "@radix-ui/react-slot";
import * as React from "react";
import { tv, type VariantProps } from "tailwind-variants";

const badgeVariants = tv({
  base: "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,outline] outline-none focus-visible:border-ring focus-visible:outline-[3px] focus-visible:outline-offset-0 focus-visible:outline-ring/50 focus-visible:[outline-style:solid] aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3",
  defaultVariants: {
    variant: "default",
  },
  variants: {
    variant: {
      brand:
        "border-brand-600 bg-brand-600 text-brand-foreground [a&]:hover:bg-brand-700 [a&]:hover:text-brand-foreground",
      "brand-outline":
        "border-brand-400 text-brand-400 [a&]:hover:bg-brand-400 [a&]:hover:text-brand-foreground",
      default:
        "border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
      destructive:
        "border-transparent bg-error-500 text-white focus-visible:outline-error-500/20 dark:bg-error-500/60 dark:focus-visible:outline-error-500/40 [a&]:hover:bg-error-500/90",
      outline:
        "text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
      secondary:
        "border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
      success:
        "border border-success-700 text-success-700 dark:border-transparent dark:bg-success-500 dark:text-success-300 [a&]:hover:bg-success-500/90",
      warning:
        "border border-warning-700 text-warning-700 dark:border-transparent dark:bg-warning-500 dark:text-warning-300 [a&]:hover:bg-warning-500/90",
    },
  },
});

function Badge({
  asChild = false,
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";

  return (
    <Comp
      className={cn(badgeVariants({ variant }), className)}
      data-slot="badge"
      {...props}
    />
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export { Badge, badgeVariants };
