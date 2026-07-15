import { cn } from "@/client/lib/utils";
import { Slot } from "@radix-ui/react-slot";
import * as React from "react";

export function ButtonGroup({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex w-fit items-stretch [&>*]:relative [&>*]:focus-visible:z-10 [&>[data-slot=button]:not(:first-child)]:rounded-l-none [&>[data-slot=button]:not(:last-child)]:rounded-r-none",
        className,
      )}
      data-slot="button-group"
      role="group"
      {...props}
    />
  );
}

export function ButtonGroupSeparator({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      aria-orientation="vertical"
      className={cn("z-10 w-px bg-border/50", className)}
      data-slot="button-group-separator"
      role="separator"
      {...props}
    />
  );
}

export function ButtonGroupText({
  asChild = false,
  className,
  ...props
}: React.ComponentProps<"div"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "div";

  return (
    <Comp
      className={cn(
        "flex items-center border-y px-3 text-sm text-muted-foreground first:rounded-l-lg first:border-l last:rounded-r-lg last:border-r",
        className,
      )}
      data-slot="button-group-text"
      {...props}
    />
  );
}
