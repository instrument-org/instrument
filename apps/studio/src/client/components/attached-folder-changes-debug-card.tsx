import {
  attachedFolderRemovalsModelNote,
  type SessionMessageDataPart,
} from "@instrument-org/workspace/client";

import { ModelContextDebugCard } from "./model-context-debug-card";

export function AttachedFolderChangesDebugCard({
  className,
  data,
}: {
  className?: string;
  data: SessionMessageDataPart.AttachedFolderChangesDataPart;
}) {
  const modelContext = attachedFolderRemovalsModelNote(data);
  if (!modelContext) {
    return null;
  }

  return <ModelContextDebugCard className={className} text={modelContext} />;
}
