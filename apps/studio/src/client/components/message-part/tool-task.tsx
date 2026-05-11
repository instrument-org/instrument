import {
  type SessionMessagePart,
  type WorkspaceAppProject,
} from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";
import { useStickToBottom } from "use-stick-to-bottom";

import { rpcClient } from "../../rpc/client";
import { type RenderStream } from "../tool-part/task";
import { Spinner } from "../ui/spinner";
import { useToolCallSession } from "./tool-call-session";

type TaskPart = Extract<SessionMessagePart.ToolPart, { type: "tool-task" }>;

export function ToolTask({
  part,
  project,
  renderStream,
}: {
  part: TaskPart;
  project: WorkspaceAppProject;
  renderStream: RenderStream;
}) {
  const { isStreaming } = useToolCallSession();
  const isSuccess = part.state === "output-available";
  const isTaskRunning =
    isStreaming && isSuccess && part.output.status === "running";

  if (!isSuccess) {
    return null;
  }

  return (
    // Opaque composites of bg-muted/40 and dark:bg-muted/20 over card --
    // transparent values bleed through the hover card popover surface.
    <div className="mt-2 overflow-hidden rounded-2xl bg-[#f5f5f4] dark:bg-[#211d1b]">
      <TaskStream
        isRunning={isTaskRunning}
        project={project}
        renderStream={renderStream}
        sessionId={part.output.sessionId}
      />
    </div>
  );
}

function TaskStream({
  isRunning,
  project,
  renderStream,
  sessionId,
}: {
  isRunning: boolean;
  project: WorkspaceAppProject;
  renderStream: RenderStream;
  sessionId: string;
}) {
  const {
    data: messages,
    error,
    isLoading,
  } = useQuery(
    rpcClient.workspace.message.live.listWithParts.experimental_liveOptions({
      input: {
        sessionId,
        subdomain: project.subdomain,
      },
    }),
  );

  const { contentRef, scrollRef } = useStickToBottom({ mass: 0.8 });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Spinner className="size-4 text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 py-3 text-sm text-destructive">
        Error loading messages: {error.message}
      </div>
    );
  }

  if (!messages || messages.length === 0) {
    return (
      <div className="px-4 py-3 text-sm text-muted-foreground">
        No messages found.
      </div>
    );
  }

  if (isRunning) {
    return (
      <div
        className="overflow-y-auto p-2"
        ref={scrollRef}
        style={{ height: "300px" }}
      >
        <div ref={contentRef}>
          {renderStream({ isAgentRunning: true, messages: messages ?? [] })}
        </div>
      </div>
    );
  }

  return (
    <div className="p-2">
      {renderStream({ isAgentRunning: false, messages: messages ?? [] })}
    </div>
  );
}

export { type RenderStream } from "../tool-part/task";
