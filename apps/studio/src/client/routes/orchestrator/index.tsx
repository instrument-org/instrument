import { TaskChat } from "@/client/components/task/chat";
import { Toaster } from "@/client/components/ui/sonner";
import { Spinner } from "@/client/components/ui/spinner";
import { useDefaultModelURI } from "@/client/hooks/use-default-model-uri";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { type Task } from "@instrument-org/workspace/client";
import { skipToken, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import ms from "ms";

/** How often the list of the orchestrator's tasks is re-read. */
const CHILDREN_REFRESH_MS = ms("3 seconds");

export const Route = createFileRoute("/orchestrator/")({
  component: OrchestratorRoute,
  head: () => ({ meta: [{ title: APP_NAME }] }),
});

function ChildTasks({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) {
    return null;
  }
  return (
    <aside className="max-h-48 shrink-0 overflow-y-auto border-t border-border px-4 py-2">
      <p className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Tasks
      </p>
      <ul className="flex flex-col gap-0.5">
        {tasks.map((child) => (
          <li
            className="flex items-baseline justify-between gap-3 text-sm"
            key={child.id}
          >
            <span className="truncate">{child.title}</span>
            <span className="shrink-0 font-mono text-xs text-muted-foreground">
              {child.id}
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen flex-col bg-background">
      {/* The title bar is hidden, so this strip is what the window is dragged by. */}
      <header className="flex h-11 shrink-0 items-center justify-center text-sm font-medium [-webkit-app-region:drag]">
        {APP_NAME}
      </header>
      {children}
      <Toaster position="top-center" />
    </div>
  );
}

/**
 * The one conversation, over the orchestrator's task, with the tasks it has
 * created listed beneath. The chat is the task page's own, with the sidebar
 * and the pane left behind: what this window is for is feeling whether one
 * thread that never takes turns is enough, not a new rendering of it.
 */
function OrchestratorRoute() {
  const ensure = useQuery(
    rpcClient.workspace.orchestrator.ensure.queryOptions({
      // The orchestrator, once it exists, is the one this window shows for as
      // long as it is open.
      staleTime: Number.POSITIVE_INFINITY,
    }),
  );
  const ids = ensure.data;

  const task = useQuery(
    rpcClient.workspace.task.live.byId.experimental_liveOptions({
      input: ids ? { id: ids.taskId } : skipToken,
    }),
  );
  const state = useQuery(
    rpcClient.workspace.task.state.get.queryOptions({
      input: ids ? { id: ids.taskId } : skipToken,
    }),
  );
  const children = useQuery(
    rpcClient.workspace.orchestrator.children.queryOptions({
      input: ids ? { id: ids.taskId } : skipToken,
      refetchInterval: CHILDREN_REFRESH_MS,
    }),
  );
  const [defaultModelURI] = useDefaultModelURI();

  if (ensure.error) {
    return (
      <Frame>
        <p className="p-4 text-sm text-destructive">
          Could not open the conversation: {ensure.error.message}
        </p>
      </Frame>
    );
  }

  if (!ids || !task.data || !state.data) {
    return (
      <Frame>
        <div className="flex h-full items-center justify-center">
          <Spinner className="size-6" />
        </div>
      </Frame>
    );
  }

  return (
    <Frame>
      <div className="min-h-0 flex-1">
        <TaskChat
          alwaysSubmittable
          navigateOnSend={false}
          promptDraft={state.data.promptDraft ?? ""}
          selectedModelURI={state.data.selectedModelURI ?? defaultModelURI}
          selectedSessionId={ids.sessionId}
          task={task.data}
        />
      </div>
      <ChildTasks tasks={children.data ?? []} />
    </Frame>
  );
}
