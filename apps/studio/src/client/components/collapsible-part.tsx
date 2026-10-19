import { type ReactNode } from "react";

import { Button } from "./ui/button";

export function CollapsiblePartMainContent({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="mt-2 text-xs">
      <div className="max-h-64 overflow-y-auto rounded-md border bg-muted/30 p-2">
        {children}
      </div>
    </div>
  );
}

export function CollapsiblePartTrigger({
  children,
  ref,
  ...props
}: {
  children: ReactNode;
  ref?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <Button
      className="h-6 w-full justify-start rounded-sm px-1 py-0 hover:bg-accent/30 disabled:opacity-100"
      ref={ref}
      variant="ghost"
      {...props}
    >
      {children}
    </Button>
  );
}
