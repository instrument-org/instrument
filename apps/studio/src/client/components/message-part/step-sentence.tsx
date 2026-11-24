import { type ReactNode } from "react";

/**
 * What an opened step that came to nothing says: a sentence, and under it
 * the way past it when there is one. `data-step-words` sets it at the step
 * label's edge, where a card has none.
 */
export function StepSentence({
  action,
  children,
}: {
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className="flex flex-col items-start gap-2 text-sm text-muted-foreground"
      data-step-words
    >
      <p>{children}</p>
      {action}
    </div>
  );
}
