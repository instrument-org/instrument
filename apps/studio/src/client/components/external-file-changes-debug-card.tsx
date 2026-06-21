import { externalFileChangesModelNote, type SessionMessageDataPart } from "@instrument-org/workspace/client";

import { ModelContextDebugCard } from "./model-context-debug-card";

// Developer-mode-only peek at the external file changes the agent was told
// about for this message. Intentionally minimal; not user-facing.
export function ExternalFileChangesDebugCard({
  className,
  files,
}: {
  className?: string;
  files: SessionMessageDataPart.FileChangeDataPartItem[];
}) {
  if (files.length === 0) {
    return null;
  }

  const modelContext = externalFileChangesModelNote({ files });
  if (!modelContext) {
    return null;
  }

  return <ModelContextDebugCard className={className} text={modelContext} />;
}
