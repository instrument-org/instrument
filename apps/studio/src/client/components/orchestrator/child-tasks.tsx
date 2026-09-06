import { ChatStream } from "@/client/components/chat-stream";
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/client/components/ui/message-scroller";
import { Spinner } from "@/client/components/ui/spinner";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { rpcClient } from "@/client/rpc/client";
import {
  type SessionMessage,
  type Task,
} from "@instrument-org/workspace/client";
import { skipToken, useQuery } from "@tanstack/react-query";
import ms from "ms";

/** How often a task's sessions and standing are re-read while it is open. */
const REFRESH_MS = ms("2 seconds");

const noop = () => {
  // A transcript with nothing to type into has nothing to retry or continue.
};

/**
 * A task's transcript, on its own screen, read the way it unfolded and kept
 * at its end while the task works. Nothing to type into: the user talks to
 * the orchestrator, which talks to the task, so this is how they look over
 * its shoulder and not a second conversation.
 */
export function ChildTranscript({ task }: { task: Task }) {
  const sessions = useQuery(
    rpcClient.workspace.session.list.queryOptions({
      input: { id: task.id },
      refetchInterval: REFRESH_MS,
    }),
  );
  // Newest session: ids are ulids, so the last one alphabetically.
  const sessionId = sessions.data
    ?.map((session) => session.id)
    .toSorted()
    .at(-1);
  const messages = useQuery(
    rpcClient.workspace.message.live.list.experimental_liveOptions({
      input: sessionId ? { id: task.id, sessionId } : skipToken,
    }),
  );
  const status = useQuery(
    rpcClient.workspace.task.agentStatus.byIds.queryOptions({
      input: { ids: [task.id] },
      refetchInterval: REFRESH_MS,
    }),
  );
  const isWorking =
    status.data?.some((entry) =>
      entry.sessionActors.some((actor) => actor.tags.includes("agent.alive")),
    ) ?? false;

  const isDeveloperMode = useDeveloperMode();

  if (!sessionId || !messages.data) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-5" />
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      {isDeveloperMode ? (
        <TaskBrief messages={messages.data} taskId={task.id} />
      ) : null}
      <MessageScrollerProvider
        autoScroll={isWorking}
        defaultScrollPosition="end"
        key={sessionId}
      >
        <MessageScroller className="h-full min-h-0">
          <MessageScrollerViewport
            className="@container/transcript"
            data-transcript
          >
            <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-2 p-4 pb-8 [--transcript-room:100cqi]">
              <ChatStream
                isAgentRunning={isWorking}
                isDeveloperMode={false}
                messages={messages.data}
                onContinue={noop}
                onModelChange={noop}
                onRetry={noop}
                onRunAgain={noop}
                onStartNewTask={noop}
                renderAsItems
                task={task}
              />
            </MessageScrollerContent>
          </MessageScrollerViewport>
        </MessageScroller>
      </MessageScrollerProvider>
    </div>
  );
}

/** Lines of a brief that set a limit: effort, minutes, tokens, money. */
const LIMIT_LINE =
  /\b(?:effort|budget|minutes?|tokens?|no more than|at most|do not (?:go|spend)|\$\d)/i;

/**
 * What the orchestrator handed the task, along the top, for whoever is
 * checking its work: the model it runs on, the folders it was given and with
 * what access, the tab it was handed, the lines of its brief that set a
 * limit, and the brief itself behind a click.
 */
function TaskBrief({
  messages,
  taskId,
}: {
  messages: SessionMessage.WithParts[];
  taskId: Task["id"];
}) {
  const state = useQuery(
    rpcClient.workspace.task.state.get.queryOptions({ input: { id: taskId } }),
  );
  const brief =
    messages
      .find((message) => message.role === "user")
      ?.parts.flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n") ?? "";
  const limits = brief
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && LIMIT_LINE.test(line))
    .slice(0, 3);
  const folders = Object.values(state.data?.attachedFolders ?? {});
  const model = state.data?.selectedModelURI?.split("?")[0];
  const chips = [
    ...(model ? [`Model: ${model}`] : []),
    ...folders.map(
      (folder) =>
        `${folder.mountName}: ${folder.access === "read-write" ? "read and write" : "read only"}`,
    ),
    ...(state.data?.browserTargetId ? ["A browser tab was handed over"] : []),
  ];
  return (
    <details className="shrink-0 border-b border-border px-4 py-2 text-xs text-muted-foreground">
      <summary className="cursor-default select-none">
        <span className="font-medium text-foreground">Brief</span>
        {chips.length > 0 ? ` · ${chips.join(" · ")}` : ""}
        {limits.length > 0 ? ` · ${limits.join(" · ")}` : ""}
      </summary>
      <pre className="mt-2 max-h-64 overflow-auto font-sans whitespace-pre-wrap text-foreground/80">
        {brief || "No brief recorded."}
      </pre>
    </details>
  );
}
