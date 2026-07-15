import { featuresAtom } from "@/client/atoms/features";
import {
  focusPromptDraft,
  promptDraftRefAtom,
  promptFocusSignalAtom,
} from "@/client/atoms/prompt-value";
import { useIsActiveTab, useTabId } from "@/client/hooks/use-active-tab";
import { useAgentSessionStatus } from "@/client/hooks/use-agent-session-status";
import { useContinueSession } from "@/client/hooks/use-continue-session";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { useTaskRouteId } from "@/client/hooks/use-task-route-id";
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
import { useLayoutEffect, useRef, useState } from "react";
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
import { TutorialPromptCard } from "./tutorial-prompt-card";

export function TaskChat({
  isReplayActive = false,
  onCancelReplay,
  selectedModelURI: initialSelectedModelURI,
  selectedSessionId,
  showTutorial,
  task,
}: {
  isReplayActive?: boolean;
  onCancelReplay?: () => void;
  selectedModelURI?: AIGatewayModelURI.Type;
  selectedSessionId?: StoreId.Session;
  showTutorial?: boolean;
  task: Task;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Use the route id for chat data; task may be placeholder data
  // from the previous task while keepPreviousData is active.
  const id = useTaskRouteId();
  // TODO: Stop passing the entire task object down and rely just on the
  // id as much as possible to keep this from being an issue.
  const isTaskRouteSettled = task.id === id;

  const promptInputRef = useRef<{ clear: () => void; focus: () => void }>(null);

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
      input:
        selectedSessionId && isTaskRouteSettled
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
  const isActiveTab = useIsActiveTab();
  const focusSignal = useAtomValue(promptFocusSignalAtom(useTabId()));
  const draftKey = { scope: "task", taskId: id } as const;
  const promptTextarea = useAtomValue(promptDraftRefAtom(draftKey));
  useLayoutEffect(() => {
    if (!isActiveTab) {
      return;
    }
    focusPromptDraft(promptTextarea);
  }, [isActiveTab, focusSignal, selectedSessionId, promptTextarea]);

  const [isTutorialDismissed, setIsTutorialDismissed] = useState(false);
  const isTutorialVisible =
    isTaskRouteSettled && showTutorial === true && !isTutorialDismissed;

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
      isSubmittable={!isAgentAlive}
      modelURI={selectedModelURI}
      onModelChange={setSelectedModelURI}
      onStop={() => {
        if (isReplayActive && onCancelReplay) {
          onCancelReplay();
        } else {
          stopSessions.mutate({ id });
        }
      }}
      onSubmit={({ files, folders, modelURI, prompt }) => {
        promptInputRef.current?.clear();
        if (isTutorialVisible) {
          handleDismissTutorial();
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
      placeholder={`Talk to ${APP_NAME}`}
      ref={promptInputRef}
      selectedSessionId={selectedSessionId}
    />
  );

  return (
    <MessageScrollerProvider
      autoScroll
      defaultScrollPosition="end"
      key={selectedSessionId}
    >
      <PinToBottomWhileOpening />
      <div className="relative flex h-full min-h-0 flex-col">
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport className="flex flex-col">
            <MessageScrollerContent className="group/assistant-message-footer mx-auto w-full max-w-2xl gap-2 p-4 pb-16">
              {selectedSessionId ? (
                isTaskRouteSettled ? (
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
                  <div className="flex animate-in justify-center py-4 opacity-0 duration-150 fade-in-0 [animation-delay:500ms] [animation-fill-mode:forwards]">
                    <Spinner className="size-4 text-muted-foreground" />
                  </div>
                )
              ) : (
                <ChatZeroState id={id} selectedSessionId={selectedSessionId} />
              )}
            </MessageScrollerContent>

            {/* Holds the composer at the bottom when the transcript is short;
                collapses to zero once the content overflows. */}
            <div className="flex-1" />

            {/* Composer sticks to the bottom inside the scroll viewport so the
                transcript scrolls behind its rounded top corners. Sticky
                reserves its height in normal flow, so content is never trapped
                behind it. */}
            <div className="sticky bottom-0 flex w-full">
              <div className="pointer-events-none absolute inset-x-0 bottom-full flex justify-center pb-4">
                <MessageScrollerButton className="pointer-events-auto" />
              </div>
              <div className="relative mx-auto w-full max-w-2xl px-3 pb-3">
                {/* Rounded-top backdrop behind the composer; the transcript
                    peeks through the top corners. The tutorial card brings its
                    own background, so skip it then. */}
                {!isTutorialVisible && (
                  <div className="pointer-events-none absolute inset-x-3 top-0 bottom-0 rounded-t-[20px] bg-background" />
                )}
                {/* undefined = server never set tutorial; skip motion overhead */}
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
          </MessageScrollerViewport>
        </MessageScroller>
      </div>
    </MessageScrollerProvider>
  );
}

// The scroller applies "start at the end" once, but on task open the live
// messages query briefly serves the previous task's (shorter) messages, so it
// can pin to that stale height and never re-pin once the real, taller messages
// swap in (leaving a long chat parked mid-scroll). Hold the view at the bottom
// across the opening settle window; any manual scroll cancels it so we never
// fight the user. Runs once per session (the provider is keyed by session id).
function PinToBottomWhileOpening() {
  const { scrollToEnd } = useMessageScroller();
  useLayoutEffect(() => {
    let raf = 0;
    let frames = 0;
    let active = true;
    const stop = () => {
      active = false;
    };
    window.addEventListener("wheel", stop, { passive: true });
    window.addEventListener("touchmove", stop, { passive: true });
    const step = () => {
      if (!active) {
        return;
      }
      scrollToEnd({ behavior: "auto" });
      frames += 1;
      if (frames < 40) {
        raf = requestAnimationFrame(step);
      }
    };
    raf = requestAnimationFrame(step);
    return () => {
      active = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchmove", stop);
    };
  }, [scrollToEnd]);
  return null;
}
