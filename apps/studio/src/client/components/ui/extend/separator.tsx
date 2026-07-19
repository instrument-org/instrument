// Vendored from Extend UI (https://ui.extend.ai), MIT licensed.
// Local changes: import paths only.
import type React from "react";

import { cn } from "@/client/lib/utils";
import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";

export function Separator({
  className,
  orientation = "horizontal",
  ...props
}: SeparatorPrimitive.Props): React.ReactElement {
  return (
    <SeparatorPrimitive
      className={cn(
        "shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-px data-[orientation=vertical]:not-[[class^='h-']]:not-[[class*='_h-']]:self-stretch",
        className,
      )}
      data-slot="separator"
      orientation={orientation}
      {...props}
    />
  );
}

export { Separator as SeparatorPrimitive } from "@base-ui/react/separator";
