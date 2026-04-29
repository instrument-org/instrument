import { promptInputRefAtom } from "@/client/atoms/prompt-value";
import { SessionStatusIcon } from "@/client/components/app-status-icon";
import { ChatsCircle } from "@/client/components/icons/chats-circle";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
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
import { rpcClient } from "@/client/rpc/client";
import {
  StoreId,
  type WorkspaceAppProject,
} from "@instrument-org/workspace/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { ChevronDown, MessageCircle, Plus } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";

export function ProjectChatMenu({
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

  const skipCloseFocusToTriggerRef = useRef(false);
  const promptTextarea = useAtomValue(promptInputRefAtom);

  const handleNewChat = () => {
    skipCloseFocusToTriggerRef.current = true;
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
      className={toolbarClassName({
        className:
          "h-auto max-w-80 min-w-0 justify-start gap-2 py-1 font-semibold has-[>svg]:px-1",
        pressed: sidebar === "chat",
      })}
      onClick={sidebar === "files" ? onChatClick : undefined}
      variant="ghost"
    >
      <ChatsCircle className="size-4 shrink-0" />
      <span className="truncate">{project.title}</span>
      {sidebar === "chat" && <ChevronDown className="size-3 shrink-0" />}
    </Button>
  );

  if (sidebar === "files") {
    return button;
  }

  return (
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
                skipCloseFocusToTriggerRef.current = true;
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
