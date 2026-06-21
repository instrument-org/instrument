import {
  browserStatusModelNote,
  type SessionMessageDataPart,
} from "@instrument-org/workspace/client";

import { ModelContextDebugCard } from "./model-context-debug-card";

export function BrowserStatusDebugCard({
  className,
  data,
}: {
  className?: string;
  data: SessionMessageDataPart.BrowserStatusDataPart;
}) {
  return (
    <ModelContextDebugCard
      className={className}
      text={browserStatusModelNote(data)}
    />
  );
}
