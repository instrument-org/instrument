import {
  type SessionMessagePart,
  type WorkspaceAppProject,
} from "@instrument-org/workspace/client";

import { type RenderStream, TaskToolCard } from "../tool-part/task";

export function ToolTask({
  part,
  project,
  renderStream,
}: {
  part: Extract<SessionMessagePart.ToolPart, { type: "tool-task" }>;
  project: WorkspaceAppProject;
  renderStream: RenderStream;
}) {
  return (
    <TaskToolCard part={part} project={project} renderStream={renderStream} />
  );
}
