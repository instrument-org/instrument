import { APP_NAME } from "@instrument-org/shared";
import { createContext, use } from "react";

/** What the line under a stopped turn offers. */
export interface Stopped {
  /** Opens Send feedback about the chat; absent when the person has Ask for feedback off. */
  onSendFeedback?: () => void;
}

/** Given by a chat around its own transcript while the person's Stop holds. */
export const StoppedContext = createContext<Stopped | undefined>(undefined);

/**
 * Says under a chat's last turn that the person stopped it, with a link to
 * Send feedback. It goes once the chat starts again, since a chat reads only
 * its newest stop and nothing ties that to a turn.
 */
export function StoppedLine() {
  const stopped = use(StoppedContext);
  if (!stopped) {
    return null;
  }
  return (
    <p className="mt-0.5 text-xs/5 text-muted-foreground">
      You stopped {APP_NAME}.
      {stopped.onSendFeedback && (
        <>
          {" "}
          If it wasn't working as expected, please{" "}
          <button
            className="underline decoration-current/35 underline-offset-3"
            onClick={stopped.onSendFeedback}
            type="button"
          >
            send feedback
          </button>
          .
        </>
      )}
    </p>
  );
}
