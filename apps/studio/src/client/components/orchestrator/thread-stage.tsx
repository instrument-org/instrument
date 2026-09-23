import { FileDropRegion } from "@/client/components/file-drop-region";
import { FileOpenContext } from "@/client/components/file-open-context";
import { PageOpenContext } from "@/client/components/page-open-context";
import { TaskChat } from "@/client/components/task/chat";
import { Spinner } from "@/client/components/ui/spinner";
import { ActiveTabProvider } from "@/client/hooks/use-active-tab";
import { useAgentSessionStatus } from "@/client/hooks/use-agent-session-status";
import { useDefaultModelURI } from "@/client/hooks/use-default-model-uri";
import { TaskSessionProvider } from "@/client/hooks/use-task-session";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import {
  type SessionMessageDataPart,
  type StoreId,
} from "@instrument-org/workspace/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useContext, useEffect, useState } from "react";

import { OrchestratorContext, useOrchestrator } from "./context";
import { ThreadWork } from "./thread-work";
import { WorkingRow } from "./working-row";

/** How many threads stay mounted behind the one on screen. */
const KEPT = 4;

/**
 * One thread's conversation: its transcript, opening at the end, and a
 * composer that replies in it. Nothing above the transcript: the row over
 * it names the thread, and the top of the scroll is the ask itself. The
 * thread is a session of the orchestrator's, so the chat is the same
 * conversation the inbox holds, narrowed to this one thread.
 */
export function ThreadScreen({
  isUp,
  sendContext,
  sessionId,
}: {
  /** Whether this is the thread on screen: only that one marks itself read or takes the caret. */
  isUp: boolean;
  sendContext: () => Promise<
    SessionMessageDataPart.ViewContextDataPart | undefined
  >;
  sessionId: StoreId.Session;
}) {
  const orchestrator = useOrchestrator();
  const { taskId } = orchestrator;
  const task = useQuery(
    rpcClient.workspace.task.live.byId.experimental_liveOptions({
      input: { id: taskId },
    }),
  );
  const state = useQuery(
    rpcClient.workspace.task.state.get.queryOptions({
      input: { id: taskId },
    }),
  );
  // The thread as the list beside the tabs knows it, for the newest reply
  // that has landed, which is what marks it read below.
  const threads = useQuery(
    rpcClient.workspace.orchestrator.threads.live.list.experimental_liveOptions(
      { input: { id: taskId } },
    ),
  );
  const thread = threads.data?.find((entry) => entry.id === sessionId);
  // While the thread's own agent composes, the transcript shows the typing
  // dots; the thread is otherwise at work when a task filed from it is, and
  // that is said at the transcript's tail too. Read from the tasks filed
  // from it rather than from the thread's state, which folds its own agent
  // in: the state is the list's, a re-read behind the actor the dots follow,
  // so at a turn's end it still says working for a moment after the dots
  // have gone, and the tail would say so in their place.
  const { isAgentRunning } = useAgentSessionStatus({ id: taskId, sessionId });
  const isWorkingElsewhere =
    thread?.runningTasks.some((running) => !running.waiting) === true &&
    !isAgentRunning;
  const [defaultModelURI] = useDefaultModelURI();
  const openFile = useContext(FileOpenContext);
  const createMessage = useMutation(
    rpcClient.workspace.message.create.mutationOptions(),
  );

  // Reading the thread is what clears its count, so it is marked read on
  // arrival and again as each reply finishes while it is on screen. The pane
  // beside the tabs does not clear it on its own.
  const markSeen = useMutation(
    rpcClient.workspace.orchestrator.threads.seen.mutationOptions(),
  );
  const newestSettledMessageId = thread?.newestSettledMessageId;
  useEffect(() => {
    if (!isUp) {
      return;
    }
    markSeen.mutate({ id: taskId, sessionId });
    // The mutation is stable; re-running on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [isUp, taskId, sessionId, newestSettledMessageId]);

  if (!task.data || !state.data) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-5" />
      </div>
    );
  }
  const modelURI = state.data.selectedModelURI ?? defaultModelURI;
  // Into this thread's own group, shown: an open from a thread's chat is the
  // thread's whatever the window has up at that moment, and never a silent
  // nothing because the group on screen was another's.
  const into = { group: sessionId, newTab: true, show: true };
  return (
    // The thread is the drop region, so a file let go anywhere over it lands
    // in the reply, and the pane beside it stays outside.
    <FileDropRegion className="flex h-full min-h-0 flex-col">
      {/* The thread stands over its tabs, so what a reply hands over opens
          as a tab under it rather than in place of one: the openers all say
          so, and a line a card asks the conversation lands in this thread. */}
      <div className="min-h-0 flex-1">
        <OrchestratorContext
          value={{
            ...orchestrator,
            ask: (prompt) => {
              if (!modelURI) {
                return;
              }
              createMessage.mutate({
                id: taskId,
                modelURI,
                prompt,
                sessionId,
              });
            },
            openPage: (url) => {
              orchestrator.openPage(url, into);
            },
            openScreen: (href) => {
              orchestrator.openScreen(href, into);
            },
            opensNewTab: true,
            sessionId,
          }}
        >
          <FileOpenContext
            value={(path) => {
              openFile?.(path, into);
            }}
          >
            <PageOpenContext
              value={(url) => {
                orchestrator.openPage(url, into);
              }}
            >
              <TaskSessionProvider sessionId={sessionId} taskId={taskId}>
                <TaskChat
                  alwaysSubmittable
                  // What the thread is working on, over the composer: a
                  // task pressed opens beside the thread, in the pane.
                  beforeComposer={
                    <ThreadWork
                      onOpen={(id) => {
                        orchestrator.openScreen(
                          `/orchestrator/tasks/${id}`,
                          into,
                        );
                      }}
                      tasks={thread?.runningTasks ?? []}
                    />
                  }
                  composerPlaceholder="Reply in thread"
                  // A key of the thread's own: the task's stored draft is the
                  // top-level field's, and a reply typed here is not that.
                  // Kept past this screen's unmount, so the row in the inbox
                  // can say the thread holds a draft while it does.
                  draftKey={{ scope: "thread", sessionId }}
                  navigateOnSend={false}
                  presentation="orchestrator"
                  promptDraft={state.data.promptDraft ?? ""}
                  selectedModelURI={modelURI}
                  selectedSessionId={sessionId}
                  sendContext={sendContext}
                  task={task.data}
                  transcriptTrailing={
                    isWorkingElsewhere ? <WorkingRow /> : null
                  }
                />
              </TaskSessionProvider>
            </PageOpenContext>
          </FileOpenContext>
        </OrchestratorContext>
      </div>
    </FileDropRegion>
  );
}

/**
 * The threads on screen and the few lately left, all mounted: the one whose
 * group is up is shown over its tabs, and the others stay laid out under it,
 * hidden, so coming back to a thread is the transcript as it was rather than
 * a transcript rebuilt, with its images and its scroll. Which thread is up
 * is the tab model's business; the stage only follows it.
 */
export function ThreadStage({
  floating,
  sendContext,
  sessionId,
}: {
  /** The threads in their small views, which the stage leaves to them: a floating thread's conversation is drawn in its window and nowhere else. */
  floating: StoreId.Session[];
  /** What the tab under the thread shows, read as a reply is sent, so the reply carries it. */
  sendContext: () => Promise<
    SessionMessageDataPart.ViewContextDataPart | undefined
  >;
  /** The thread whose group is up, or nothing while a draft's is. */
  sessionId: StoreId.Session | undefined;
}) {
  // Newest last; the one up is always among them.
  const [kept, setKept] = useState<StoreId.Session[]>([]);
  if (sessionId !== undefined && kept.at(-1) !== sessionId) {
    setKept((current) =>
      [...current.filter((id) => id !== sessionId), sessionId].slice(-KEPT),
    );
  }
  return (
    <>
      {kept.map((id) => {
        if (floating.includes(id)) {
          return null;
        }
        const isUp = id === sessionId;
        return (
          <div
            aria-hidden={!isUp}
            // Hidden by visibility rather than display, so the transcript
            // keeps its layout and its scroll while it waits.
            className={cn(
              "absolute inset-0",
              isUp ? undefined : "pointer-events-none invisible",
            )}
            key={id}
          >
            <ActiveTabProvider isActive={isUp}>
              <ThreadScreen
                isUp={isUp}
                sendContext={sendContext}
                sessionId={id}
              />
            </ActiveTabProvider>
          </div>
        );
      })}
    </>
  );
}
