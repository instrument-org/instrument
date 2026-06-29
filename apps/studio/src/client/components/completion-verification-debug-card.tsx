import {
  completionVerificationModelNote,
  type SessionMessageDataPart,
} from "@instrument-org/workspace/client";

import { ModelContextDebugCard } from "./model-context-debug-card";

export function CompletionVerificationDebugCard({
  className,
  data,
}: {
  className?: string;
  data: SessionMessageDataPart.CompletionVerificationDataPart;
}) {
  return (
    <ModelContextDebugCard
      className={className}
      text={completionVerificationModelNote(data)}
    />
  );
}
