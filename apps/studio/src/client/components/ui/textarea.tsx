import { cn } from "@/client/lib/utils";
import * as React from "react";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "flex field-sizing-content min-h-16 w-full resize-none rounded-xl border-0 bg-linear-to-b from-white to-[#fafaf9] px-3 py-2 text-base shadow-sm transition-[color,outline] outline-none placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "dark:border dark:border-input dark:bg-input/30 dark:bg-none dark:from-transparent dark:to-transparent",
        "focus-visible:outline-[3px] focus-visible:outline-offset-0 focus-visible:outline-ring/50 focus-visible:[outline-style:solid]",
        "aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        className,
      )}
      data-slot="textarea"
      {...props}
    />
  );
}

export { Textarea };
