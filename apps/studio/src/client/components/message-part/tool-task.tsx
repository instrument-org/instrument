import {
  type SessionMessage,
  type SessionMessagePart,
  type Task,
} from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode } from "react";
import { useStickToBottom } from "use-stick-to-bottom";

import { rpcClient } from "../../rpc/client";
import { Spinner } from "../ui/spinner";
import { useToolCallSession } from "./tool-call-session";

export type RenderStream = (args: {
  isAgentRunning: boolean;
  messages: SessionMessage.WithParts[];
}) => ReactNode;

type TaskPart = Extract<SessionMessagePart.ToolPart, { type: "tool-task" }>;

export function ToolTask({
  part,
  renderStream,
  task,
}: {
  part: TaskPart;
  renderStream: RenderStream;
  task: Task;
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
    <div className="mt-2 overflow-hidden rounded-2xl bg-gray-100 dark:bg-[#211d1b]">
      <TaskStream
        isRunning={isTaskRunning}
        renderStream={renderStream}
        sessionId={part.output.sessionId}
        task={task}
      />
    </div>
  );
}

function TaskStream({
  isRunning,
  renderStream,
  sessionId,
  task,
}: {
  isRunning: boolean;
  renderStream: RenderStream;
  sessionId: string;
  task: Task;
}) {
  const {
    data: messages,
    error,
    isLoading,
  } = useQuery(
    rpcClient.workspace.message.live.listWithParts.experimental_liveOptions({
      input: {
        id: task.id,
        sessionId,
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

  return (
    <div
      className="max-h-72 overflow-y-auto p-4"
      ref={isRunning ? scrollRef : undefined}
    >
      <div ref={isRunning ? contentRef : undefined}>
        {renderStream({ isAgentRunning: isRunning, messages })}
      </div>
    </div>
  );
}
