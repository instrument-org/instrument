import { ChatsCircle } from "@/client/components/icons/chats-circle";
import {
  StoreId,
  type WorkspaceAppProject,
} from "@instrument-org/workspace/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Bug,
  ChevronDown,
  Copy,
  MessageCircle,
  MoreVertical,
  Pencil,
  Plus,
  RotateCcw,
  TrashIcon,
} from "lucide-react";
import { toast } from "sonner";

import { getSessionTags } from "../hooks/use-agent-session-status";
import { useAppState } from "../hooks/use-app-state";
import { useDeveloperMode } from "../hooks/use-developer-mode";
import { rpcClient } from "../rpc/client";
import { SessionStatusIcon } from "./app-status-icon";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export function ProjectActionsMenu({
  onDebugClick,
  onReplayClick,
  onSettingsClick,
  project,
  selectedSessionId,
}: {
  onDebugClick: () => void;
  onReplayClick: () => void;
  onSettingsClick: () => void;
  project: WorkspaceAppProject;
  selectedSessionId?: StoreId.Session;
}) {
  const navigate = useNavigate();
  const isDeveloperMode = useDeveloperMode();

  const handleDebugChat = () => {
    if (!selectedSessionId) {
      return;
    }
    onDebugClick();
  };

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost">
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Project actions</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" side="bottom">
        <DropdownMenuItem
          onClick={() => {
            void navigate({
              from: "/projects/$subdomain",
              params: { subdomain: project.subdomain },
              search: (prev) => ({ ...prev, showDuplicate: true }),
            });
          }}
        >
          <Copy className="size-4" />
          <span>Duplicate</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onSettingsClick}>
          <Pencil className="size-4" />
          <span>Rename</span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {isDeveloperMode && (
          <>
            <DropdownMenuItem
              className="text-warning-foreground"
              disabled={!selectedSessionId}
              onClick={handleDebugChat}
            >
              <Bug className="size-4 text-warning-foreground" />
              Debug chat
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-warning-foreground"
              disabled={!selectedSessionId}
              onClick={() => {
                if (selectedSessionId) {
                  onReplayClick();
                }
              }}
            >
              <RotateCcw className="size-4 text-warning-foreground" />
              Replay chat
            </DropdownMenuItem>
          </>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onSelect={() => {
            void navigate({
              from: "/projects/$subdomain",
              params: { subdomain: project.subdomain },
              search: (prev) => ({ ...prev, showDelete: true }),
            });
          }}
          variant="destructive"
        >
          <TrashIcon />
          <span>Delete</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ProjectChatPicker({
  onChatClick,
  project,
  selectedSessionId,
  sidebar,
}: {
  onChatClick: () => void;
  project: WorkspaceAppProject;
  selectedSessionId?: StoreId.Session;
  sidebar: "chat" | "files";
}) {
  const navigate = useNavigate();

  const { data: sessions = [] } = useQuery(
    rpcClient.workspace.session.live.list.experimental_liveOptions({
      input: { subdomain: project.subdomain },
    }),
  );

  const { data: appState } = useAppState({ subdomain: project.subdomain });
  const sessionActors = appState?.sessionActors ?? [];

  const createEmptySession = useMutation(
    rpcClient.workspace.session.create.mutationOptions(),
  );

  const handleNewChat = () => {
    createEmptySession.mutate(
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
              sidebar: undefined,
            }),
            to: "/projects/$subdomain",
          });
        },
      },
    );
  };

  const button = (
    <Button
      className="h-auto max-w-80 min-w-0 justify-start gap-2 py-1 font-semibold text-foreground hover:bg-accent hover:text-accent-foreground has-[>svg]:px-1"
      onClick={sidebar === "files" ? onChatClick : undefined}
      variant="ghost"
    >
      <ChatsCircle className="size-4 shrink-0" />
      <span className="truncate">{project.title}</span>
      {sidebar === "chat" && <ChevronDown className="size-3 shrink-0" />}
    </Button>
  );

  if (sidebar === "files") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent>Back to chat</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent className="max-w-[min(500px,90vw)] break-all">
          {project.title}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" side="bottom">
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuItem
              disabled={createEmptySession.isPending}
              onClick={handleNewChat}
            >
              <Plus className="size-4" />
              <span>New chat</span>
            </DropdownMenuItem>
          </TooltipTrigger>
          <TooltipContent>Start a fresh chat in this project.</TooltipContent>
        </Tooltip>

        {sessions.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup
              onValueChange={(value) => {
                const sessionId = StoreId.SessionSchema.parse(value);
                void navigate({
                  params: {
                    subdomain: project.subdomain,
                  },
                  replace: true,
                  search: (prev) => ({
                    ...prev,
                    selectedSessionId: sessionId,
                  }),
                  to: "/projects/$subdomain",
                });
              }}
              value={selectedSessionId}
            >
              {sessions.map((session) => {
                const tags = getSessionTags({
                  sessionActors,
                  sessionId: session.id,
                });
                return (
                  <DropdownMenuRadioItem
                    className="pl-2 data-[state=checked]:bg-black/10 dark:data-[state=checked]:bg-white/10 [&>span:first-child]:hidden"
                    key={session.id}
                    value={session.id}
                  >
                    <MessageCircle className="size-4" />
                    <span className="flex-1 truncate">
                      {session.title || "Untitled Chat"}
                    </span>
                    <SessionStatusIcon
                      className="size-3 shrink-0"
                      tags={tags}
                    />
                  </DropdownMenuRadioItem>
                );
              })}
            </DropdownMenuRadioGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
