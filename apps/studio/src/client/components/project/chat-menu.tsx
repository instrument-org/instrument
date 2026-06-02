import { promptInputRefAtom } from "@/client/atoms/prompt-value";
import { SessionStatusIcon } from "@/client/components/app-status-icon";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { toolbarClassName } from "@/client/components/ui/toggle";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { getSessionTags } from "@/client/hooks/use-agent-session-status";
import { useAppState } from "@/client/hooks/use-app-state";
import { useProjectRouteSubdomain } from "@/client/hooks/use-project-route-subdomain";
import { rpcClient } from "@/client/rpc/client";
import { type SessionTag, StoreId } from "@instrument-org/workspace/client";
import {
  CaretDownIcon,
  ChatCircleIcon,
  ChatsCircleIcon,
  CheckIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { useRef } from "react";
import { toast } from "sonner";

const CHAT_MENU_PREVIEW_LIMIT = 6;

function sessionHasListStatusIcon(
  tags: SessionTag[],
  isReplayForSession: boolean,
) {
  return (
    isReplayForSession ||
    tags.includes("agent.paused") ||
    tags.includes("agent.running")
  );
}

const allChatsSubListScrollStyle = {
  maxHeight: "min(50vh, var(--radix-popper-available-height, 50vh))",
} as const;

const chatSessionRadioItemClassName =
  "group rounded-lg pl-2 data-[state=checked]:bg-black/10 dark:data-[state=checked]:bg-white/10 [&>span:first-child]:hidden";

export function ProjectChatMenu({
  onChatClick,
  projectTitle,
  selectedSessionId,
  sidebar,
}: {
  onChatClick: () => void;
  projectTitle: string;
  selectedSessionId?: StoreId.Session;
  sidebar: "chat" | "files";
}) {
  const navigate = useNavigate();
  // Use the route subdomain for session data; project may be placeholder data
  // from the previous project while keepPreviousData is active.
  const subdomain = useProjectRouteSubdomain();

  const { data: sessions = [] } = useQuery(
    rpcClient.workspace.session.live.list.experimental_liveOptions({
      input: { subdomain },
    }),
  );

  const { data: appState } = useAppState({ subdomain });
  const sessionActors = appState?.sessionActors ?? [];
  const { data: replayStatus } = useQuery(
    rpcClient.workspace.replay.live.statusBySubdomain.experimental_liveOptions({
      input: { subdomain },
    }),
  );

  const createEmptySession = useMutation(
    rpcClient.workspace.session.create.mutationOptions(),
  );

  const skipCloseFocusToTriggerRef = useRef(false);
  const promptTextarea = useAtomValue(promptInputRefAtom);

  const visibleSessions = sessions.slice(0, CHAT_MENU_PREVIEW_LIMIT);
  const overflowSessions = sessions.slice(CHAT_MENU_PREVIEW_LIMIT);

  const selectedSession =
    selectedSessionId && sessions.find((s) => s.id === selectedSessionId);
  const chatMenuTitle =
    selectedSessionId === undefined
      ? projectTitle
      : (selectedSession?.title ?? "Untitled chat");

  const handleNewChat = () => {
    skipCloseFocusToTriggerRef.current = true;
    createEmptySession.mutate(
      { subdomain },
      {
        onError: (error) => {
          toast.error("Failed to create new chat", {
            description: error.message,
          });
        },
        onSuccess: (result) => {
          void navigate({
            params: {
              subdomain,
            },
            replace: true,
            search: (prev) => ({
              ...prev,
              selectedSessionId: result.id,
              sidebar: undefined,
            }),
            to: "/projects/$subdomain",
          });
        },
      },
    );
  };

  const navigateToSession = (sessionId: StoreId.Session) => {
    skipCloseFocusToTriggerRef.current = true;
    void navigate({
      params: {
        subdomain,
      },
      replace: true,
      search: (prev) => ({
        ...prev,
        selectedSessionId: sessionId,
      }),
      to: "/projects/$subdomain",
    });
  };

  const button = (
    <Button
      className={toolbarClassName({
        className:
          "min-w-0 w-full max-w-80 shrink justify-start gap-2 px-2 has-[>svg]:px-2",
        pressed: sidebar === "chat",
      })}
      onClick={sidebar === "files" ? onChatClick : undefined}
      size="sm"
      variant="ghost"
    >
      <ChatsCircleIcon className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{chatMenuTitle}</span>
      <CaretDownIcon className="size-3 shrink-0" />
    </Button>
  );

  if (sidebar === "files") {
    return <div className="min-w-0 shrink overflow-hidden">{button}</div>;
  }

  return (
    <div className="min-w-0 shrink overflow-hidden">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="min-w-(--radix-popper-anchor-width)"
          onCloseAutoFocus={(e) => {
            if (skipCloseFocusToTriggerRef.current) {
              e.preventDefault();
              skipCloseFocusToTriggerRef.current = false;
              promptTextarea?.focus();
            }
          }}
          side="bottom"
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuItem
                disabled={createEmptySession.isPending}
                onClick={handleNewChat}
              >
                <PlusIcon className="size-4" />
                <span>New Chat</span>
              </DropdownMenuItem>
            </TooltipTrigger>
            <TooltipContent>Start a fresh chat in this task.</TooltipContent>
          </Tooltip>

          {sessions.length > 0 && (
            <>
              <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground">
                Previous chats
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                className="flex flex-col gap-0.5"
                onValueChange={(value) => {
                  const sessionId = StoreId.SessionSchema.parse(value);
                  navigateToSession(sessionId);
                }}
                value={selectedSessionId}
              >
                {visibleSessions.map((session) => (
                  <ProjectChatMenuSessionRadioItem
                    activeReplaySessionIds={replayStatus?.activeSessionIds}
                    key={session.id}
                    session={session}
                    sessionActors={sessionActors}
                  />
                ))}

                {overflowSessions.length > 0 && (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger className="gap-2 text-xs font-semibold text-muted-foreground data-[state=open]:text-muted-foreground">
                      All chats
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="min-w-(--radix-dropdown-menu-trigger-width) overflow-hidden p-0">
                      <div
                        className="flex flex-col gap-0.5 overflow-x-hidden overflow-y-auto p-1"
                        style={allChatsSubListScrollStyle}
                      >
                        {overflowSessions.map((session) => (
                          <ProjectChatMenuSessionRadioItem
                            activeReplaySessionIds={
                              replayStatus?.activeSessionIds
                            }
                            key={session.id}
                            session={session}
                            sessionActors={sessionActors}
                          />
                        ))}
                      </div>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                )}
              </DropdownMenuRadioGroup>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function ProjectChatMenuSessionRadioItem({
  activeReplaySessionIds,
  session,
  sessionActors,
}: {
  activeReplaySessionIds: StoreId.Session[] | undefined;
  session: { id: StoreId.Session; title: null | string };
  sessionActors: { sessionId: string; tags: SessionTag[] }[];
}) {
  const tags = getSessionTags({
    sessionActors,
    sessionId: session.id,
  });
  const isReplayForSession =
    activeReplaySessionIds?.includes(session.id) ?? false;
  const isPaused = tags.includes("agent.paused");

  return (
    <DropdownMenuRadioItem
      className={chatSessionRadioItemClassName}
      value={session.id}
    >
      {sessionHasListStatusIcon(tags, isReplayForSession) ? (
        <span className="inline-flex size-4 shrink-0 items-center justify-center">
          <SessionStatusIcon
            className={isPaused ? "size-4" : "size-3"}
            isReplayRunning={isReplayForSession}
            tags={tags}
          />
        </span>
      ) : (
        <ChatCircleIcon className="size-4 shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 flex-1 truncate">
        {session.title || "Untitled chat"}
      </span>
      <CheckIcon className="ml-auto size-3 shrink-0 text-black/30 opacity-0 group-data-[state=checked]:opacity-100 dark:text-white/30" />
    </DropdownMenuRadioItem>
  );
}
