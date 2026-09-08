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
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { TaskSessionProvider } from "@/client/hooks/use-task-session";
import { hasLiveAgent } from "@/client/lib/agent-status";
import { rpcClient } from "@/client/rpc/client";
import {
  decodeBrowserTargetId,
  type SessionMessage,
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

  const isDeveloperMode = useDeveloperMode();
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
      {isDeveloperMode ? (
        <TaskBrief messages={messages.data} taskId={task.id} />
      ) : null}
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
                {/* A file the task hands over opens as a tab of the window,
                    which reads every path in the conversation's terms. */}
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

/** Lines of a brief that set a limit: effort, minutes, tokens, money. */
const LIMIT_LINE =
  /\b(?:effort|budget|minutes?|tokens?|no more than|at most|do not (?:go|spend)|\$\d)/i;

/** One fact about the task: a label in muted type, the value beside it. */
function Chip({ children, label }: { children: ReactNode; label: string }) {
  return (
    <span className="flex max-w-64 items-center gap-1 rounded-md bg-foreground/5 px-1.5 py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-medium">{children}</span>
    </span>
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
 * What the orchestrator handed the task, along the top, for whoever is
 * checking its work: the model, the folders and their access, a handed tab,
 * and the lines of the brief that set a limit, as a row of labeled chips.
 * The brief itself is the first message below, so it is not repeated here;
 * the row opens to the folders' full paths.
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
      {handed ? <HandedTabChip sessionId={handed.sessionId} /> : null}
      {limits.map((line) => (
        <Chip key={line} label="Limit">
          {line}
        </Chip>
      ))}
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
