import { Button } from "@/client/components/ui/button";
import { Spinner } from "@/client/components/ui/spinner";
import { cn } from "@/client/lib/utils";
import { type ComponentProps, type ReactNode } from "react";

/**
 * A button that sends the user to their browser to finish something, such as
 * a sign-in. Once pressed it holds, for as long as the browser has not come
 * back, as a spinner and "Cancel" in the button's own footprint: the wait
 * reads as the user's turn rather than as the app being slow, and pressing it
 * gives up and puts the button back to press again. No timer lets it go on
 * its own: a tab that never came up is the user's to cancel and try again.
 */
export function BrowserHandoffButton({
  children,
  className,
  icon,
  onCancel,
  onStart,
  size,
  waiting,
  ...props
}: Omit<ComponentProps<typeof Button>, "children" | "onClick" | "type"> & {
  children: ReactNode;
  icon?: ReactNode;
  onCancel: () => void;
  onStart: () => void;
  waiting: boolean;
}) {
  // The label stays in place, unseen, under the waiting state, so the button
  // keeps its width and nothing beside it rewraps.
  return (
    <Button
      {...props}
      className={cn("relative", className)}
      onClick={waiting ? onCancel : onStart}
      size={size}
      type="button"
    >
      <span
        className={cn(
          "inline-flex items-center justify-center gap-[inherit]",
          waiting && "invisible",
        )}
      >
        {icon}
        {children}
      </span>
      {waiting && (
        <span className="absolute inset-0 flex items-center justify-center gap-[inherit]">
          <Spinner
            className={
              size === "xs" ? "size-3" : size === "sm" ? "size-3.5" : undefined
            }
            delay={0}
          />
          Cancel
        </span>
      )}
    </Button>
  );
}
