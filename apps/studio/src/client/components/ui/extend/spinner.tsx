// Vendored from Extend UI (https://ui.extend.ai), MIT licensed.
// Local changes: import paths only.
import type React from "react";

import { cn } from "@/client/lib/utils";
import { Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

export function Spinner({
  className,
  ...props
}: Omit<
  React.ComponentProps<typeof HugeiconsIcon>,
  "icon"
>): React.ReactElement {
  return (
    <HugeiconsIcon
      aria-label="Loading"
      className={cn("animate-spin", className)}
      icon={Loading03Icon}
      role="status"
      {...props}
    />
  );
}
