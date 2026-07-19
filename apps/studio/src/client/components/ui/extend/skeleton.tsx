// Vendored from Extend UI (https://ui.extend.ai), MIT licensed.
// Local changes: the shimmer gradient swapped for `animate-pulse bg-muted`,
// since Studio defines no `--animate-skeleton` keyframes.
import type React from "react";

import { cn } from "@/client/lib/utils";

export function Skeleton({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn("animate-pulse rounded-sm bg-muted", className)}
      data-slot="skeleton"
      {...props}
    />
  );
}
