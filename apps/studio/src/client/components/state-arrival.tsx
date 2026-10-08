import { cn } from "@/client/lib/utils";
import { type ReactNode, useState } from "react";

/**
 * Settles its children in whenever `state` changes, so a setting that changed
 * somewhere else (System Settings, a sign-in in the browser) reads as having
 * just happened when the person comes back to it. What it first renders with,
 * and the first value after loading (`undefined`), shows without motion.
 */
export function StateArrival({
  children,
  className,
  state,
}: {
  children: ReactNode;
  className?: string;
  state: string | undefined;
}) {
  const [seen, setSeen] = useState(state);
  const [changes, setChanges] = useState(0);
  if (state !== seen) {
    setSeen(state);
    if (seen !== undefined && state !== undefined) {
      setChanges((count) => count + 1);
    }
  }
  // Keyed by the count, so each change mounts afresh and plays again.
  return (
    <div className={cn(changes > 0 && "state-arrive", className)} key={changes}>
      {children}
    </div>
  );
}
