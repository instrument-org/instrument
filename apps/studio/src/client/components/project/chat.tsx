import { promptInputRefAtom } from "@/client/atoms/prompt-value";
import { useAgentSessionStatus } from "@/client/hooks/use-agent-session-status";
import { useContinueSession } from "@/client/hooks/use-continue-session";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { rpcClient } from "@/client/rpc/client";
import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import { APP_NAME } from "@instrument-org/shared";
import {
  type StoreId,
  type WorkspaceAppProject,
} from "@instrument-org/workspace/client";
import { CaretDownIcon } from "@phosphor-icons/react";
import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { useLayoutEffect, useState } from "react";
import { toast } from "sonner";
import { useStickToBottom } from "use-stick-to-bottom";

import { PromptInput } from "../prompt-input";
import { SessionStream } from "../session-stream";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { ChatZeroState } from "./chat-zero-state";

export function ProjectChat({
  isReplayActive = false,
  isViewingApp = false,
  onCancelReplay,
  project,
  selectedModelURI: initialSelectedModelURI,
  selectedSessionId,
  showVersions,
  versionRef,
}: {
  isReplayActive?: boolean;
  isViewingApp?: boolean;
  onCancelReplay?: () => void;
  project: WorkspaceAppProject;
  selectedModelURI?: AIGatewayModelURI.Type;
  selectedSessionId?: StoreId.Session;
  showVersions?: boolean;
  versionRef?: string;
}) {
  const navigate = useNavigate();

  const { contentRef, isNearBottom, scrollRef, scrollToBottom } =
    // Less animation when sticking to bottom
    useStickToBottom({ mass: 0.8 });
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
            sessionId: selectedSessionId,
            subdomain: project.subdomain,
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
    isReplayActive,
    sessionId: selectedSessionId,
    subdomain: project.subdomain,
  });

  const { handleContinue } = useContinueSession({
    modelURI: selectedModelURI,
    sessionId: selectedSessionId,
    subdomain: project.subdomain,
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
      modelURI: selectedModelURI,
      prompt,
      sessionId: selectedSessionId,
      subdomain: project.subdomain,
    });
  };

  const createEmptySessionMutation = useMutation(
    rpcClient.workspace.session.create.mutationOptions(),
  );

  const handleNewSession = () => {
    createEmptySessionMutation.mutate(
      { subdomain: project.subdomain },
      {
        onError: (error) => {
          toast.error("Failed to create new chat", {
            description: error.message,
          });
        },
        onSuccess: (result) => {
          void navigate({
            params: {
              subdomain: project.subdomain,
            },
            replace: true,
            search: (prev) => ({
              ...prev,
              selectedSessionId: result.id,
            }),
            to: "/projects/$subdomain",
          });
        },
      },
    );
  };

  const promptTextarea = useAtomValue(promptInputRefAtom);
  useLayoutEffect(() => {
    promptTextarea?.focus();
  }, [selectedSessionId, promptTextarea]);

  return (
    <div
      className="relative flex h-full min-h-0 flex-col overflow-y-auto"
      ref={scrollRef}
    >
      <div
        className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4"
        ref={contentRef}
      >
        {selectedSessionId ? (
          isLoadingMessages ? (
            <div className="flex justify-center py-4">
              <Spinner className="size-4 text-muted-foreground" />
            </div>
          ) : messageError ? (
            <Alert className="mt-4" variant="warning">
              <AlertDescription className="flex flex-col gap-4">
                <div className="font-semibold">Failed to load messages</div>
                <div className="text-sm">
                  {messageError.message || "Unknown error occurred"}
                </div>
                <div className="flex gap-2">
                  <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                      <Button onClick={handleNewSession} variant="secondary">
                        Start new chat
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Starts a fresh chat in this project</p>
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
              project={project}
              selectedSessionId={selectedSessionId}
            />
          ) : (
            <SessionStream
              isAgentRunning={isAgentRunning}
              isDeveloperMode={isDeveloperMode}
              isViewingApp={isViewingApp}
              messages={messages}
              onContinue={handleContinue}
              onModelChange={setSelectedModelURI}
              onRetry={handleRetry}
              onStartNewChat={handleNewSession}
              project={project}
              versionRef={versionRef}
            />
          )
        ) : (
          <ChatZeroState
            project={project}
            selectedSessionId={selectedSessionId}
          />
        )}
      </div>

      <div className="flex-1" />

      <div className="sticky bottom-0 flex w-full bg-background">
        {!isNearBottom && (
          <div className="pointer-events-none absolute inset-x-0 bottom-full flex justify-center pb-4">
            <Button
              className="pointer-events-auto border border-border shadow-lg"
              onClick={() => scrollToBottom()}
              size="icon"
              variant="secondary"
            >
              <CaretDownIcon className="size-3" />
            </Button>
          </div>
        )}
        <div className="mx-auto w-full max-w-3xl px-3 pb-3">
          <PromptInput
            atomKey={project.subdomain}
            autoFocus
            isLoading={createMessage.isPending}
            isStoppable={isAgentAlive}
            isSubmittable={!isAgentAlive}
            modelURI={selectedModelURI}
            onModelChange={setSelectedModelURI}
            onStop={() => {
              if (isReplayActive && onCancelReplay) {
                onCancelReplay();
              } else {
                stopSessions.mutate({ subdomain: project.subdomain });
              }
            }}
            onSubmit={({ files, folders, modelURI, prompt }) => {
              createMessage.mutate(
                {
                  files,
                  folders,
                  modelURI,
                  prompt,
                  sessionId: selectedSessionId,
                  subdomain: project.subdomain,
                },
                {
                  onSuccess: ({ sessionId }) => {
                    void scrollToBottom();
                    if (versionRef || showVersions) {
                      void navigate({
                        params: {
                          subdomain: project.subdomain,
                        },
                        replace: true,
                        search: (prev) => ({
                          ...prev,
                          artifactPanel: { type: "app" },
                          selectedSessionId: sessionId,
                          showVersions: undefined,
                        }),
                        to: "/projects/$subdomain",
                      });
                    }
                  },
                },
              );
            }}
            placeholder={`Talk to ${APP_NAME}`}
          />
        </div>
      </div>
    </div>
  );
}
