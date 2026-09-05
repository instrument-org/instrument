import { FolderView } from "@/client/components/orchestrator/folder-view";
import { TaskChat } from "@/client/components/task/chat";
import { Toaster } from "@/client/components/ui/sonner";
import { Spinner } from "@/client/components/ui/spinner";
import { useDefaultModelURI } from "@/client/hooks/use-default-model-uri";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { type Task, type TaskId } from "@instrument-org/workspace/client";
import { XIcon } from "@phosphor-icons/react/X";
import { skipToken, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import ms from "ms";
import { useState } from "react";

/** How often the orchestrator's tasks and their status are re-read. */
const REFRESH_MS = ms("2 seconds");

type MainTab = "computer" | "tasks";

export const Route = createFileRoute("/orchestrator/")({
  component: OrchestratorRoute,
  head: () => ({ meta: [{ title: APP_NAME }] }),
});

/**
 * A task's own chat, opened in the tasks tab. The escape hatch: the
 * orchestrator is meant to be the only thing the user talks to, and this is
 * how they look over its shoulder.
 */
function ChildChat({ onClose, task }: { onClose: () => void; task: Task }) {
  const sessions = useQuery(
    rpcClient.workspace.session.list.queryOptions({
      input: { id: task.id },
      refetchInterval: REFRESH_MS,
    }),
  );
  const state = useQuery(
    rpcClient.workspace.task.state.get.queryOptions({
      input: { id: task.id },
    }),
  );
  // Newest session: ids are ulids, so the last one alphabetically.
  const sessionId = sessions.data
    ?.map((session) => session.id)
    .toSorted()
    .at(-1);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="truncate text-sm font-medium">{task.title}</span>
        <button
          aria-label="Close task"
          className="rounded-md p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          onClick={onClose}
          type="button"
        >
          <XIcon className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {state.data && sessionId ? (
          <TaskChat
            navigateOnSend={false}
            promptDraft={state.data.promptDraft ?? ""}
            selectedModelURI={state.data.selectedModelURI}
            selectedSessionId={sessionId}
            task={task}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Spinner className="size-5" />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The orchestrator's tasks, one row each with a spinner while its agent is at
 * work, and a click to open one.
 */
function ChildTasks({
  onSelect,
  running,
  selectedId,
  tasks,
}: {
  onSelect: (id: TaskId) => void;
  running: ReadonlySet<TaskId>;
  selectedId: TaskId | undefined;
  tasks: Task[];
}) {
  if (tasks.length === 0) {
    return (
      <p className="px-3 py-2 text-xs text-muted-foreground">
        No tasks yet. Ask for something and one appears here.
      </p>
    );
  }
  return (
    <ul className="flex flex-col">
      {tasks.map((child) => {
        const isRunning = running.has(child.id);
        return (
          <li key={child.id}>
            <button
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-foreground/5",
                child.id === selectedId && "bg-foreground/8",
              )}
              onClick={() => {
                onSelect(child.id);
              }}
              type="button"
            >
              {isRunning ? (
                <Spinner className="size-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <span className="size-3.5 shrink-0" />
              )}
              <span className="truncate">{child.title}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Frame({
  children,
  status,
}: {
  children: React.ReactNode;
  status?: string;
}) {
  return (
    <div className="flex h-screen flex-col bg-background">
      {/* The title bar is hidden, so this strip is what the window is dragged by. */}
      <header className="flex h-11 shrink-0 items-center justify-center gap-3 text-sm font-medium [-webkit-app-region:drag]">
        <span>{APP_NAME}</span>
        {status ? (
          <span className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
            <Spinner className="size-3" />
            {status}
          </span>
        ) : null}
      </header>
      {children}
      <Toaster position="top-center" />
    </div>
  );
}

/**
 * The window: the human's side on the left, the conversation on the right.
 *
 * The left is what the wireframes call the computer: the folders the
 * conversation can reach, browsed like a file browser, with a second tab for
 * the tasks behind the conversation. What is open on the left rides along with
 * every message sent on the right, so "this folder" means the one on screen.
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
      refetchInterval: REFRESH_MS,
    }),
  );
  const childIds = children.data?.map((child) => child.id) ?? [];
  const status = useQuery(
    rpcClient.workspace.task.agentStatus.byIds.queryOptions({
      input: ids ? { ids: [ids.taskId, ...childIds] } : skipToken,
      refetchInterval: REFRESH_MS,
    }),
  );
  const [defaultModelURI] = useDefaultModelURI();

  const [tab, setTab] = useState<MainTab>("computer");
  const [selectedTaskId, setSelectedTaskId] = useState<TaskId | undefined>();
  // The folder view opens on the workspace folder, where outcomes land when
  // nobody named a place, and follows the user from there.
  const [visited, setVisited] = useState<string | undefined>();
  const folder = visited ?? ids?.outputFolder ?? "/";
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const running = new Set<TaskId>(
    status.data
      ?.filter((entry) =>
        entry.sessionActors.some((actor) => actor.tags.includes("agent.alive")),
      )
      .map((entry) => entry.taskId) ?? [],
  );
  const runningChildren = childIds.filter((id) => running.has(id));
  const statusLine =
    ids && running.has(ids.taskId)
      ? runningChildren.length > 0
        ? `thinking, ${runningChildren.length} working`
        : "thinking"
      : runningChildren.length > 0
        ? `${runningChildren.length} working`
        : undefined;

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

  const selectedTask = children.data?.find(
    (child) => child.id === selectedTaskId,
  );

  return (
    <Frame status={statusLine}>
      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col">
          <nav className="flex shrink-0 gap-1 border-b border-border px-3 pt-1">
            {(
              [
                ["computer", "Computer"],
                [
                  "tasks",
                  `Tasks${childIds.length > 0 ? ` (${childIds.length})` : ""}`,
                ],
              ] as const
            ).map(([id, label]) => (
              <button
                className={cn(
                  "-mb-px border-b-2 px-3 py-2 text-sm",
                  tab === id
                    ? "border-foreground font-medium"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
                key={id}
                onClick={() => {
                  setTab(id);
                }}
                type="button"
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1">
            {tab === "computer" ? (
              <FolderView
                folder={folder}
                onNavigate={(path) => {
                  setVisited(path);
                  setSelected(new Set());
                }}
                onSelect={(paths) => {
                  setSelected(new Set(paths));
                }}
                selected={selected}
                taskId={ids.taskId}
              />
            ) : (
              <div className="flex h-full min-h-0 flex-col">
                <div
                  className={cn(
                    "overflow-y-auto",
                    selectedTask ? "max-h-56 shrink-0" : "flex-1",
                  )}
                >
                  <ChildTasks
                    onSelect={(id) => {
                      setSelectedTaskId((current) =>
                        current === id ? undefined : id,
                      );
                    }}
                    running={running}
                    selectedId={selectedTaskId}
                    tasks={children.data ?? []}
                  />
                </div>
                {selectedTask ? (
                  <div className="min-h-0 flex-1 border-t border-border">
                    <ChildChat
                      key={selectedTask.id}
                      onClose={() => {
                        setSelectedTaskId(undefined);
                      }}
                      task={selectedTask}
                    />
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </main>
        <aside className="flex w-[30rem] shrink-0 flex-col border-l border-border">
          <TaskChat
            alwaysSubmittable
            navigateOnSend={false}
            promptDraft={state.data.promptDraft ?? ""}
            selectedModelURI={state.data.selectedModelURI ?? defaultModelURI}
            selectedSessionId={ids.sessionId}
            sendContext={() =>
              folder === "/" ? undefined : { folder, selected: [...selected] }
            }
            task={task.data}
          />
        </aside>
      </div>
    </Frame>
  );
}
