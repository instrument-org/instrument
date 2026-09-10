import { type WindowTab, windowTabsAtom } from "@/client/atoms/orchestrator";
import { ChatStream } from "@/client/components/chat-stream";
import { FileOpenContext } from "@/client/components/file-open-context";
import { MacFolderIcon } from "@/client/components/icons/mac-folder";
import { ModelPreview } from "@/client/components/tasks-data-table/model-preview";
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/client/components/ui/message-scroller";
import { Spinner } from "@/client/components/ui/spinner";
import { TaskSessionProvider } from "@/client/hooks/use-task-session";
import { hasLiveAgent } from "@/client/lib/agent-status";
import { rpcClient } from "@/client/rpc/client";
import { catalogEffort } from "@instrument-org/ai-gateway/client";
import {
  decodeBrowserTargetId,
  type Task,
} from "@instrument-org/workspace/client";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import ms from "ms";
import { type ReactNode, useContext } from "react";

import { TabIcon } from "./browser-tabs";
import { useOrchestrator } from "./context";
import { conversationPathOfTaskPath } from "./file-tabs";
import { useNewestSessionId } from "./newest-session";

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
  const sessionId = useNewestSessionId(task.id);
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
  const isWorking = status.data?.some(hasLiveAgent) ?? false;

  const openFile = useOpenFileNamedByTask(task.id);

  if (!sessionId || !messages.data) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-5" />
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <TaskBrief task={task} />
      <MessageScrollerProvider
        autoScroll={isWorking}
        defaultScrollPosition="end"
        key={sessionId}
      >
        {/* The rest of the column, not the whole of it: with the brief above,
            a full-height scroller ran past the bottom and its end was never
            on screen. */}
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport
            className="@container/transcript"
            data-transcript
          >
            <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-2 p-4 pb-8 [--transcript-room:100cqi]">
              {/* Names the task and session for the links inside, so a page
                  the task names offers its browser as well as the user's. */}
              <TaskSessionProvider sessionId={sessionId} taskId={task.id}>
                {/* Task paths are translated to the conversation's mounts before navigation. */}
                <FileOpenContext value={openFile}>
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
                </FileOpenContext>
              </TaskSessionProvider>
            </MessageScrollerContent>
          </MessageScrollerViewport>
        </MessageScroller>
      </MessageScrollerProvider>
    </div>
  );
}

/**
 * The apps this task may reach. Three states worth telling apart: a list it
 * was handed, none at all, and the absent setting a person's own task carries,
 * which reaches everything connected.
 */
function AppsChip({ apps }: { apps: string[] | undefined }) {
  if (!apps) {
    return (
      <Chip label="Apps" title="Nothing narrows this task's reach">
        every connected app
      </Chip>
    );
  }
  if (apps.length === 0) {
    return (
      <Chip
        label="Apps"
        title="The `app` command finds nothing; the orchestrator hands one over with `task app`"
      >
        none
      </Chip>
    );
  }
  return (
    <Chip label="Apps" title={apps.join(", ")}>
      {apps.join(", ")}
    </Chip>
  );
}

/**
 * One fact about the task: a label in muted type, the value beside it, and an
 * optional note for where the value came from when that is not the task's own
 * doing.
 */
function Chip({
  children,
  label,
  note,
  title,
}: {
  children: ReactNode;
  label: string;
  note?: string;
  title?: string;
}) {
  return (
    <span
      className="flex h-6 max-w-64 items-center gap-1 rounded-md bg-foreground/5 px-1.5"
      title={title}
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-medium">{children}</span>
      {note ? <span className="text-muted-foreground">{note}</span> : null}
    </span>
  );
}

/**
 * The level this task's model thinks at, and where that level came from.
 *
 * Absent settings do not mean no level: the request falls back to the model's
 * own catalog default, so the chip resolves it the same way the request does
 * rather than reading as though nothing were set.
 */
function EffortChip({ task }: { task: Task }) {
  const models = useQuery(rpcClient.gateway.models.list.queryOptions());
  const state = useQuery(
    rpcClient.workspace.task.state.get.queryOptions({ input: { id: task.id } }),
  );
  const model = models.data?.models.find(
    (entry) => entry.uri === state.data?.selectedModelURI,
  );
  const fromModel = model ? catalogEffort(model) : undefined;
  const effort = task.reasoningEffort ?? fromModel;
  if (!effort) {
    return (
      <Chip
        label="Effort"
        title="No level is sent, so the provider's own default stands"
      >
        provider default
      </Chip>
    );
  }
  return (
    <Chip
      label="Effort"
      title={
        task.reasoningEffort
          ? "The level this task was created with"
          : "This model reasons by default; no level was chosen for the task"
      }
      {...(task.reasoningEffort ? {} : { note: "model default" })}
    >
      {effort}
    </Chip>
  );
}

/** The window's tab the task was handed, drawn as the strip draws it: its icon and name, the address on hover. */
function HandedTabChip({ sessionId }: { sessionId: string }) {
  const { tabs } = useAtomValue(windowTabsAtom);
  const tab = tabs.find(
    (entry): entry is Extract<WindowTab, { kind: "page" }> =>
      entry.kind === "page" && entry.id === sessionId,
  );
  return (
    <span
      className="flex h-6 max-w-64 items-center gap-1.5 rounded-md bg-foreground/5 px-1.5"
      title={tab?.url ?? "A tab of this window"}
    >
      <span className="text-muted-foreground">Tab</span>
      <TabIcon favicon={tab?.favicon} url={tab?.url} />
      <span className="truncate font-medium">
        {tab?.title || tab?.url || "closed"}
      </span>
    </span>
  );
}

/**
 * Everything that constrains the task, along the top, for whoever is checking
 * its work: the model it runs on and the level it thinks at, the folders it
 * reaches and whether it may write to them, the apps it may reach, and a
 * handed tab. One chip per thing something enforces, and nothing else -- what
 * the brief asked of the task is the first message below, in the words it was
 * asked in, where it cannot be mistaken for a rule. Chips open to their full
 * value on hover.
 */
function TaskBrief({ task }: { task: Task }) {
  const taskId = task.id;
  const state = useQuery(
    rpcClient.workspace.task.state.get.queryOptions({ input: { id: taskId } }),
  );
  const folders = Object.values(state.data?.attachedFolders ?? {});
  const handed = state.data?.browserTargetId
    ? decodeBrowserTargetId(state.data.browserTargetId)
    : null;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-4 py-2 text-xs">
      <span
        className="flex h-6 items-center rounded-md bg-foreground/5 px-1.5"
        title="The model the task runs on"
      >
        <ModelPreview id={taskId} />
      </span>
      <EffortChip task={task} />
      {folders.length === 0 ? (
        <Chip label="Folders">none</Chip>
      ) : (
        folders.map((folder) => (
          <span
            className="flex h-6 max-w-64 items-center gap-1.5 rounded-md bg-foreground/5 px-1.5"
            key={folder.id}
            title={`${folder.path} · ${folder.access}`}
          >
            <MacFolderIcon className="size-4 shrink-0" />
            <span className="truncate font-medium">{folder.mountName}</span>
            <span className="text-muted-foreground">
              {folder.access === "read-write" ? "read, write" : "read"}
            </span>
          </span>
        ))
      )}
      <AppsChip apps={task.apps} />
      {handed ? <HandedTabChip sessionId={handed.sessionId} /> : null}
    </div>
  );
}

/**
 * Opens a file the task named, in the window's own terms.
 *
 * A reply writes the paths the task works in, which is the whole of what it
 * knows: `output/report.md` is its own folder, and a folder it was handed
 * wears the name it was mounted under there. The window has neither -- it
 * shows a file through the conversation, whose mounts are its own -- so the
 * path is translated before a tab is asked for it. Untranslated, a card in a
 * task's reply opens a tab reporting a file that was never in the
 * conversation's folder.
 */
function useOpenFileNamedByTask(taskId: Task["id"]) {
  const orchestrator = useOrchestrator();
  // The window's own opener, which this stands in front of rather than
  // replaces: where a file opens is the window's business either way.
  const openInWindow = useContext(FileOpenContext);
  const state = useQuery(
    rpcClient.workspace.task.state.get.queryOptions({ input: { id: taskId } }),
  );
  const conversation = useQuery(
    rpcClient.workspace.task.state.get.queryOptions({
      input: { id: orchestrator.taskId },
    }),
  );
  return (filePath: string) => {
    openInWindow?.(
      conversationPathOfTaskPath({
        attachedFolders: state.data?.attachedFolders ?? {},
        conversationFolders: conversation.data?.attachedFolders ?? {},
        path: filePath,
        taskId,
      }),
    );
  };
}
