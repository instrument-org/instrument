import { FileOpenContext } from "@/client/components/file-open-context";
import {
  OrchestratorContext,
  useOrchestrator,
} from "@/client/components/orchestrator/context";
import { useOnScreen } from "@/client/components/orchestrator/on-screen";
import { PageOpenContext } from "@/client/components/page-open-context";
import { TaskChat } from "@/client/components/task/chat";
import { Spinner } from "@/client/components/ui/spinner";
import { useDefaultModelURI } from "@/client/hooks/use-default-model-uri";
import { TaskSessionProvider } from "@/client/hooks/use-task-session";
import { rpcClient } from "@/client/rpc/client";
import { StoreId } from "@instrument-org/workspace/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useContext, useEffect } from "react";

/**
 * A thread opened as a tab: its transcript, opening at the end, and a
 * composer that replies in it. Nothing above the transcript: the tab's
 * location row names the thread, the row in the pane beside it shows its
 * topics and what it holds, and the top of the scroll is the ask itself. The
 * thread is a session of the orchestrator's, so the chat is the same
 * conversation the pane holds, narrowed to this one thread.
 */
export const Route = createFileRoute("/orchestrator/threads/$id")({
  component: ThreadRoute,
});

function ThreadRoute() {
  const { id } = Route.useParams();
  const sessionId = StoreId.SessionSchema.parse(id);
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
  // The thread as the list beside the tabs knows it: its title as the agent
  // keeps renaming it, and the newest reply that has landed, which is what
  // marks it read below.
  const threads = useQuery(
    rpcClient.workspace.orchestrator.threads.live.list.experimental_liveOptions(
      { input: { id: taskId } },
    ),
  );
  const thread = threads.data?.find((entry) => entry.id === sessionId);
  // The session itself stands in until the list has it: a thread opened by
  // address before the list is in still has a title.
  const session = useQuery(
    rpcClient.workspace.session.byId.queryOptions({
      enabled: thread === undefined,
      input: { id: taskId, sessionId },
    }),
  );
  const [defaultModelURI] = useDefaultModelURI();
  const openFile = useContext(FileOpenContext);
  const createMessage = useMutation(
    rpcClient.workspace.message.create.mutationOptions(),
  );

  const title = thread?.title ?? session.data?.title ?? "Thread";

  useOnScreen({ screen: "thread", thread: { id: sessionId, title } });

  // Reading the thread is what clears its count, so it is marked read on
  // arrival and again as each reply finishes while it is on screen. The pane
  // beside the tabs does not clear it on its own.
  const markSeen = useMutation(
    rpcClient.workspace.orchestrator.threads.seen.mutationOptions(),
  );
  const newestSettledMessageId = thread?.newestSettledMessageId;
  useEffect(() => {
    markSeen.mutate({ id: taskId, sessionId });
    // The mutation is stable; re-running on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [taskId, sessionId, newestSettledMessageId]);

  if (!task.data || !state.data) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-5" />
      </div>
    );
  }
  const modelURI = state.data.selectedModelURI ?? defaultModelURI;
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* The thread is a tab, so what a reply hands over opens as another
          tab beside it rather than in its place: the openers all say so, and
          a line a card asks the conversation lands in this thread. */}
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
              orchestrator.openPage(url, { newTab: true });
            },
            openScreen: (href) => {
              orchestrator.openScreen(href, { newTab: true });
            },
            opensNewTab: true,
            sessionId,
          }}
        >
          <FileOpenContext
            value={(path) => {
              openFile?.(path, { newTab: true });
            }}
          >
            <PageOpenContext
              value={(url) => {
                orchestrator.openPage(url, { newTab: true });
              }}
            >
              <TaskSessionProvider sessionId={sessionId} taskId={taskId}>
                <TaskChat
                  alwaysSubmittable
                  composerPlaceholder="Reply in thread"
                  // A key of the thread's own: the task's stored draft is the
                  // top-level field's, and a reply typed here is not that.
                  draftKey={{ id: sessionId, scope: "transient" }}
                  navigateOnSend={false}
                  presentation="orchestrator"
                  promptDraft={state.data.promptDraft ?? ""}
                  selectedModelURI={modelURI}
                  selectedSessionId={sessionId}
                  task={task.data}
                />
              </TaskSessionProvider>
            </PageOpenContext>
          </FileOpenContext>
        </OrchestratorContext>
      </div>
    </div>
  );
}
