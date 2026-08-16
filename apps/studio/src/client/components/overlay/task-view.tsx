import { filePreviewAtom } from "@/client/atoms/file-preview";
import { taskFileViewerAtom } from "@/client/atoms/task-file-viewer";
import { ChatStream } from "@/client/components/chat-stream";
import { BackButton } from "@/client/components/overlay/back-button";
import {
  COMPACT_COMPOSER,
  useOverlayHeight,
} from "@/client/components/overlay/chrome";
import {
  PromptInput,
  type PromptInputRef,
} from "@/client/components/prompt-input";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/client/components/ui/message-scroller";
import { Spinner } from "@/client/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { useAgentSessionStatus } from "@/client/hooks/use-agent-session-status";
import { useDefaultModelURI } from "@/client/hooks/use-default-model-uri";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { type TaskId } from "@instrument-org/workspace/client";
import { safe } from "@orpc/client";
import { ArrowDownLeftIcon } from "@phosphor-icons/react/ArrowDownLeft";
import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { noop } from "radashi";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

// Reading a conversation wants a window that stays put and scrolls inside,
// rather than one that grows with every turn the agent adds.
const TASK_VIEW_HEIGHT = 560;

export function TaskView({
  onBack,
  taskId,
}: {
  onBack: () => void;
  taskId: TaskId;
}) {
  useOverlayHeight(TASK_VIEW_HEIGHT);

  const taskQuery = useQuery(
    rpcClient.workspace.task.live.byId.experimental_liveOptions({
      input: { id: taskId },
    }),
  );

  const sessionsQuery = useQuery(
    rpcClient.workspace.session.live.list.experimental_liveOptions({
      input: { id: taskId },
    }),
  );

  const sessionId = sessionsQuery.data?.at(-1)?.id;

  const messagesQuery = useQuery(
    rpcClient.workspace.message.live.list.experimental_liveOptions({
      input: sessionId ? { id: taskId, sessionId } : skipToken,
    }),
  );

  const { isAgentAlive, isAgentRunning } = useAgentSessionStatus({
    id: taskId,
    sessionId,
  });

  const [selectedModelURI, setSelectedModelURI, saveSelectedModelURI] =
    useDefaultModelURI();
  const promptInputRef = useRef<PromptInputRef>(null);
  const createMessage = useMutation(
    rpcClient.workspace.message.create.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't send that", { description: error.message });
      },
    }),
  );

  // Nothing in this window renders a file viewer, so a click on an attachment
  // or a file link in the transcript would land nowhere. Both viewers announce
  // themselves through an atom, so watching those is enough to catch every one
  // of them without touching the transcript components -- which matters if this
  // whole panel goes away later.
  const [filePreview, setFilePreview] = useAtom(filePreviewAtom);
  const [fileViewer, setFileViewer] = useAtom(taskFileViewerAtom);
  const wantsFile = filePreview.isOpen || fileViewer.isModalOpen;

  useEffect(() => {
    if (!wantsFile) {
      return;
    }
    setFilePreview({ file: null, isOpen: false });
    setFileViewer({ currentIndex: 0, files: [], isModalOpen: false });
    void safe(rpcClient.overlay.openTaskInMainWindow.call({ id: taskId }));
  }, [wantsFile, setFilePreview, setFileViewer, taskId]);

  const task = taskQuery.data;
  const messages = messagesQuery.data ?? [];
  const isLoaded = task != null && !messagesQuery.isLoading;

  return (
    // The app's own background, not the launcher's card: the composer draws
    // itself white, and on a white panel it disappears entirely.
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* The same shape as every other screen's top bar: a way back on the
          left, and what you are looking at beside it. Only the bar's
          background drags, so the title stays selectable. */}
      <div
        className="shrink-0 border-b border-border [&_button]:[-webkit-app-region:no-drag] [&_span]:[-webkit-app-region:no-drag]"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <div className="flex items-center gap-1.5 py-2 pr-3 pl-0">
          <BackButton onBack={onBack} />
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className="min-w-0 truncate text-sm font-medium">
              {task?.title ?? "Untitled task"}
            </span>
            {/* Beside the title rather than off at the edge: it acts on this
                task, so it belongs next to its name. The arrow points back
                down into the app, which is where it takes you. */}
            <Tooltip>
              <TooltipTrigger
                className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => {
                  void safe(
                    rpcClient.overlay.openTaskInMainWindow.call({ id: taskId }),
                  );
                }}
                type="button"
              >
                <ArrowDownLeftIcon className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent>Open in {APP_NAME}</TooltipContent>
            </Tooltip>
          </span>
        </div>
      </div>

      {/* Mounted only once the messages are in hand. `defaultScrollPosition`
          applies when the scroller starts, so mounting it around a spinner
          anchors it to the end of nothing, and the transcript then arrives
          underneath already scrolled to the top. */}
      {isLoaded ? (
        <MessageScrollerProvider
          autoScroll={isAgentAlive}
          defaultScrollPosition="end"
          key={`${taskId}:${sessionId ?? "none"}`}
        >
          <MessageScroller className="min-h-0 flex-1">
            <MessageScrollerViewport>
              <MessageScrollerContent className="gap-2 px-3 pt-3 pb-6">
                <ChatStream
                  isAgentRunning={isAgentRunning}
                  isDeveloperMode={false}
                  messages={messages}
                  onContinue={noop}
                  onModelChange={noop}
                  onRetry={noop}
                  onRunAgain={noop}
                  onStartNewTask={onBack}
                  task={task}
                />
              </MessageScrollerContent>
            </MessageScrollerViewport>

            {/* Softens the last line into the composer instead of ending it on
                a hard edge, the way the real transcript does. */}
            <div className="pointer-events-none absolute right-3 bottom-0 left-0 h-6 bg-linear-to-t from-background to-transparent" />

            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-3">
              <MessageScrollerButton
                busy={isAgentRunning}
                className="pointer-events-auto"
              />
            </div>
          </MessageScroller>
        </MessageScrollerProvider>
      ) : (
        <div className="grid min-h-0 flex-1 place-items-center">
          <Spinner className="size-4 text-muted-foreground" />
        </div>
      )}

      <div className="shrink-0 px-3 pb-3">
        {/* Keyed by the session so it mounts once there is one to reply to:
            the composer starts disabled while the session is still arriving,
            and its focus-on-mount does not fire again when that resolves. You
            open a task to say something, so the cursor belongs here. */}
        <PromptInput
          autoFocus
          autoResizeMaxHeight={140}
          className={COMPACT_COMPOSER}
          disabled={!sessionId}
          draftKey={{ scope: "task", taskId }}
          isLoading={createMessage.isPending}
          key={sessionId ?? "pending"}
          modelURI={selectedModelURI}
          onModelChange={setSelectedModelURI}
          onSubmit={({ files, folders, modelURI, prompt }) => {
            if (!sessionId) {
              return;
            }
            saveSelectedModelURI(modelURI);
            createMessage.mutate(
              { files, folders, id: taskId, modelURI, prompt, sessionId },
              {
                onSuccess: () => {
                  promptInputRef.current?.clear();
                },
              },
            );
          }}
          placeholder="Reply…"
          ref={promptInputRef}
        />
      </div>
    </div>
  );
}
