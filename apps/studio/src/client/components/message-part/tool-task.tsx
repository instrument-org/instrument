import {
  type SessionMessagePart,
  type WorkspaceAppProject,
} from "@instrument-org/workspace/client";

import { type RenderStream, TaskToolCard } from "../tool-part/task";

export function ToolTask({
  isStreaming,
  part,
  project,
  renderStream,
}: {
  isStreaming: boolean;
  part: Extract<SessionMessagePart.ToolPart, { type: "tool-task" }>;
  project: WorkspaceAppProject;
  renderStream: RenderStream;
}) {
  return (
    <TaskToolCard
      isStreaming={isStreaming}
      part={part}
      project={project}
      renderStream={renderStream}
    />
  );
}
