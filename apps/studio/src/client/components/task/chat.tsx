import { featuresAtom } from "@/client/atoms/features";
import {
  promptDraftRefAtom,
  promptFocusSignalAtom,
  useHydrateTaskDraft,
} from "@/client/atoms/prompt-value";
import { useIsActiveTab, useTabId } from "@/client/hooks/use-active-tab";
import { useAgentSessionStatus } from "@/client/hooks/use-agent-session-status";
import { useContinueSession } from "@/client/hooks/use-continue-session";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { usePromptQueue } from "@/client/hooks/use-prompt-queue";
import { rpcClient } from "@/client/rpc/client";
import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import { APP_NAME } from "@instrument-org/shared";
import { type StoreId, type Task } from "@instrument-org/workspace/client";
import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import {
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { ChatStream } from "../chat-stream";
import { PromptInput } from "../prompt-input";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from "../ui/message-scroller";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { ChatZeroState } from "./chat-zero-state";
import { PromptBrowserToggle } from "./prompt-browser-toggle";
import { QueuedPrompts } from "./queued-prompts";
import { TutorialPromptCard } from "./tutorial-prompt-card";

export function TaskChat({
  isReplayActive = false,
  onCancelReplay,
  promptDraft,
  selectedModelURI: initialSelectedModelURI,
  selectedSessionId,
  showTutorial,
  task,
}: {
  isReplayActive?: boolean;
  onCancelReplay?: () => void;
  promptDraft: string;
  selectedModelURI?: AIGatewayModelURI.Type;
  selectedSessionId?: StoreId.Session;
  showTutorial?: boolean;
  task: Task;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const id = task.id;

  // The route does not render until the task's state has loaded, so the stored
  // draft is in hand on the composer's very first render rather than arriving
  // after it.
  useHydrateTaskDraft(id, promptDraft);

  const promptInputRef = useRef<{ clear: () => void; focus: () => void }>(null);
  const scrollToEndRef = useRef<
    null | ReturnType<typeof useMessageScroller>["scrollToEnd"]
  >(null);

  const createMessage = useMutation(
    rpcClient.workspace.message.create.mutationOptions({
      onError: (error) => {
        toast.error("Failed to create message", { description: error.message });
      },
    }),
  );
  const stopSessions = useMutation(
    rpcClient.workspace.session.stop.mutationOptions(),
  );
  const dismissTutorial = useMutation(
    rpcClient.workspace.task.state.set.mutationOptions({
      onError: (error) => {
        toast.error("Failed to dismiss tutorial prompt", {
          description: error.message,
        });
      },
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: rpcClient.workspace.task.state.get.queryOptions({
            input: { id },
          }).queryKey,
        });
      },
    }),
  );

  const [selectedModelURI, setSelectedModelURI] = useState<
    AIGatewayModelURI.Type | undefined
  >(initialSelectedModelURI);
  const [lastInitialSelectedModelURI, setLastInitialSelectedModelURI] =
    useState(initialSelectedModelURI);

  if (initialSelectedModelURI !== lastInitialSelectedModelURI) {
    setLastInitialSelectedModelURI(initialSelectedModelURI);
    setSelectedModelURI(initialSelectedModelURI);
  }

  const messagesQuery = useQuery(
    rpcClient.workspace.message.live.listWithParts.experimental_liveOptions({
      input: selectedSessionId
        ? {
            id,
            sessionId: selectedSessionId,
          }
        : skipToken,
      retry: 1,
    }),
  );

  const messages = messagesQuery.data ?? [];
  const messageError = messagesQuery.error;
  const isLoadingMessages = messagesQuery.isLoading;
  const refetch = messagesQuery.refetch;

  const isDeveloperMode = useDeveloperMode();

  const { isAgentAlive, isAgentRunning } = useAgentSessionStatus({
    id,
    isReplayActive,
    sessionId: selectedSessionId,
  });

  const { handleContinue } = useContinueSession({
    id,
    modelURI: selectedModelURI,
    sessionId: selectedSessionId,
  });

  const handleRetry = (prompt: string) => {
    if (!selectedSessionId) {
      // No retry UI is shown when no session is selected
      return;
    }
    if (!selectedModelURI) {
      toast.error("Failed to retry", { description: "No model selected" });
      return;
    }
    createMessage.mutate({
      id,
      modelURI: selectedModelURI,
      prompt,
      sessionId: selectedSessionId,
    });
  };

  const handleStartNewTask = () => {
    if (task.projectId) {
      void navigate({
        params: { id: task.projectId },
        to: "/projects/$id",
      });
    } else {
      void navigate({ to: "/new-tab" });
    }
  };

  const features = useAtomValue(featuresAtom);
  const isQueueEnabled = features.prompt_queue;
  const { clear, enqueue, queue, remove } = usePromptQueue({
    isAgentAlive,
    onDispatch: (queued) => {
      if (!selectedSessionId) {
        return;
      }
      createMessage.mutate({
        files: queued.files,
        folders: queued.folders,
        id,
        modelURI: queued.modelURI,
        prompt: queued.prompt,
        sessionId: selectedSessionId,
      });
    },
  });

  const isActiveTab = useIsActiveTab();
  const focusSignal = useAtomValue(promptFocusSignalAtom(useTabId()));
  const draftKey = { scope: "task", taskId: id } as const;
  const promptEditor = useAtomValue(promptDraftRefAtom(draftKey));
  useLayoutEffect(() => {
    if (!isActiveTab) {
      return;
    }
    promptEditor?.focus();
    promptEditor?.moveCaretToEnd();
  }, [isActiveTab, focusSignal, selectedSessionId, promptEditor]);

  const [isTutorialDismissed, setIsTutorialDismissed] = useState(false);
  const isTutorialVisible = showTutorial === true && !isTutorialDismissed;

  const handleDismissTutorial = () => {
    setIsTutorialDismissed(true);
    dismissTutorial.mutate({
      id,
      state: {
        showTutorial: false,
      },
    });
  };

  const promptInput = (
    <PromptInput
      autoFocus
      browserToggle={
        features.prompt_browser_toggle ? (
          <PromptBrowserToggle disabled={isReplayActive} />
        ) : undefined
      }
      className="relative z-10"
      draftKey={draftKey}
      id={id}
      isLoading={createMessage.isPending}
      isStoppable={isAgentAlive}
      isSubmittable={isQueueEnabled ? true : !isAgentAlive}
      modelURI={selectedModelURI}
      onModelChange={setSelectedModelURI}
      onStop={() => {
        if (isReplayActive && onCancelReplay) {
          onCancelReplay();
        } else {
          // Stop is a hard halt: drop pending follow-ups so the queue does not
          // auto-advance the moment the interrupted turn ends.
          clear();
          stopSessions.mutate({ id });
        }
      }}
      onSubmit={({ files, folders, modelURI, prompt }) => {
        promptInputRef.current?.clear();
        // Submitting is a request to watch what happens next, so a reader who
        // had scrolled back returns to the live edge and follows it again.
        scrollToEndRef.current?.();
        if (isTutorialVisible) {
          handleDismissTutorial();
        }
        // While a turn is running, buffer the prompt; the queue delivers it
        // when the agent goes idle. A brand-new session (no id yet) always
        // starts immediately.
        if (isQueueEnabled && isAgentAlive && selectedSessionId) {
          enqueue({ files, folders, modelURI, prompt });
          return;
        }
        createMessage.mutate(
          {
            files,
            folders,
            id,
            modelURI,
            prompt,
            sessionId: selectedSessionId,
          },
          {
            onSuccess: ({ sessionId }) => {
              void navigate({
                params: { id },
                replace: true,
                search: (prev) => ({
                  ...prev,
                  selectedSessionId: sessionId,
                }),
                to: "/tasks/$id",
              });
            },
          },
        );
      }}
      placeholder={
        isQueueEnabled && isAgentAlive
          ? "Queue a follow-up…"
          : `Talk to ${APP_NAME}`
      }
      ref={promptInputRef}
      selectedSessionId={selectedSessionId}
    />
  );

  // The composer is a plain flex sibling below the scroller: normal flow
  // reserves its height (no measuring), and the scroll viewport holds only the
  // transcript, so the scroller's "at the bottom" math stays exact. A soft
  // gradient overlay at the scroll frame's bottom edge eases the transcript into
  // the composer; pb-8 keeps the last turn's text clear of the fade band.
  return (
    <MessageScrollerProvider
      autoScroll
      defaultScrollPosition="end"
      key={selectedSessionId}
    >
      <ScrollToEndBridge commandRef={scrollToEndRef} />
      <div className="flex h-full min-h-0 flex-col">
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent className="group/assistant-message-footer mx-auto w-full max-w-2xl gap-2 p-4 pb-8">
              {selectedSessionId ? (
                isLoadingMessages ? (
                  <div className="flex animate-in justify-center py-4 opacity-0 duration-150 fade-in-0 [animation-delay:500ms] [animation-fill-mode:forwards]">
                    <Spinner className="size-4 text-muted-foreground" />
                  </div>
                ) : messageError ? (
                  <Alert className="mt-4" variant="warning">
                    <AlertDescription className="flex flex-col gap-4">
                      <div className="font-semibold">
                        Failed to load messages
                      </div>
                      <div className="text-sm">
                        {messageError.message || "Unknown error occurred"}
                      </div>
                      <div className="flex gap-2">
                        <Tooltip delayDuration={0}>
                          <TooltipTrigger asChild>
                            <Button
                              onClick={handleStartNewTask}
                              variant="secondary"
                            >
                              Start new task
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Starts a new task</p>
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip delayDuration={0}>
                          <TooltipTrigger asChild>
                            <Button onClick={() => refetch()}>Retry</Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Retry loading messages</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </AlertDescription>
                  </Alert>
                ) : !isAgentRunning && messages.length === 0 ? (
                  <ChatZeroState
                    id={id}
                    selectedSessionId={selectedSessionId}
                  />
                ) : (
                  <ChatStream
                    isAgentRunning={isAgentRunning}
                    isDeveloperMode={isDeveloperMode}
                    messages={messages}
                    onContinue={handleContinue}
                    onModelChange={setSelectedModelURI}
                    onRetry={handleRetry}
                    onStartNewTask={handleStartNewTask}
                    renderAsItems
                    task={task}
                  />
                )
              ) : (
                <ChatZeroState id={id} selectedSessionId={selectedSessionId} />
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>

          {/* Fade the transcript into the composer with a background gradient
              rather than a viewport mask, so the scrollbar stays crisp. The
              right inset clears the scrollbar; the content column is centered
              and padded, so its text stays fully within the fade. */}
          <div className="pointer-events-none absolute right-3 bottom-0 left-0 h-6 bg-linear-to-t from-background to-transparent" />

          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-4">
            <MessageScrollerButton
              busy={isAgentRunning}
              className="pointer-events-auto"
            />
          </div>
        </MessageScroller>

        {/* isolate: keep the tutorial card's -z-10 background and the prompt
            input's z-10 contained to the composer. */}
        <div className="isolate mx-auto w-full max-w-2xl px-3 pb-3">
          <QueuedPrompts onRemove={remove} prompts={queue} />
          {showTutorial === undefined ? (
            promptInput
          ) : (
            <TutorialPromptCard
              isDismissPending={dismissTutorial.isPending}
              isVisible={isTutorialVisible}
              onDismiss={handleDismissTutorial}
            >
              {promptInput}
            </TutorialPromptCard>
          )}
        </div>
      </div>
    </MessageScrollerProvider>
  );
}

// The scroll commands come from the provider's context, so they are only
// reachable below it. This renders nothing and exists to hand scrollToEnd to
// the submit handler, which sits above the provider.
function ScrollToEndBridge({
  commandRef,
}: {
  commandRef: RefObject<
    null | ReturnType<typeof useMessageScroller>["scrollToEnd"]
  >;
}) {
  const { scrollToEnd } = useMessageScroller();

  useEffect(() => {
    commandRef.current = scrollToEnd;
  }, [commandRef, scrollToEnd]);

  return null;
}
