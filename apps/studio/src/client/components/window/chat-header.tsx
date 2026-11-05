import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { MenuScrollArea } from "@/client/components/ui/menu-scroll-area";
import { toolbarClassName } from "@/client/components/ui/toggle";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { ListChecksIcon } from "@phosphor-icons/react/ListChecks";
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple";
import { PictureInPictureIcon } from "@phosphor-icons/react/PictureInPicture";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { StopIcon } from "@phosphor-icons/react/Stop";
import { TagIcon } from "@phosphor-icons/react/Tag";
import { TrashIcon } from "@phosphor-icons/react/Trash";
import { useMutation } from "@tanstack/react-query";
import { type ComponentProps, type ReactNode, useRef, useState } from "react";

import { TaskBackgroundProcesses } from "../task/task-background-processes";
import { chatMenuGroups, useChatActions } from "./chat-actions";
import { ProjectPill } from "./chat-row";
import { ChatTitleButton, ChatTitleField } from "./chat-title";
import { type Chat, type Project } from "./chats";
import { DeleteChatDialog } from "./delete-chat-dialog";
import { type RowAction } from "./row-shell";
import { ProjectMark } from "./project-mark";
import { ProjectPicker } from "./project-picker";
import { type ChatRename, useChatRename } from "./use-chat-rename";
import { useTitleArrival } from "./use-title-arrival";

/**
 * The head over a chat's conversation, wherever the chat is shown: beside the
 * inbox and popped out into its small window alike. Its title at the left,
 * which opens the chat's menu, with the project it is filed under after it and,
 * under a hand, the glyph that pops the conversation out (lit, and always
 * there, while it is out, when pressing it brings the conversation back). At
 * the right, the commands the chat and its tasks left running, then whatever
 * the place it is shown in adds: beside the inbox the pane button, popped out
 * the window's own buttons.
 */
export function ChatHeader({
  chat,
  fallbackTitle = "Chat",
  onArchived,
  onDeleted,
  onNewProject,
  onSetProject,
  onViewTasks,
  popOut,
  projects,
  trailing,
}: {
  chat: Chat | undefined;
  /** The title while there is no chat yet: the words just sent, once there are any. */
  fallbackTitle?: string;
  /** After the chat is archived from its menu, so the window can put it away. */
  onArchived?: () => void;
  /** Told once the chat has been deleted, so the window can put it away. */
  onDeleted: () => void;
  /** Makes a project, named for what was typed in the picker when anything was, and files the chat under it. */
  onNewProject: (name?: string) => void;
  /** Opens one of the chat's tasks beside it, from the list under its title. */
  onSetProject: (project: null | string) => void;
  /** Opens the chat's tasks as a tab in its group, when the head can reach them. */
  onViewTasks?: () => void;
  /** Whether the conversation is in its small view, and the press that sends it there or brings it back. */
  popOut?: { isOut: boolean; onToggle: () => void };
  projects: Project[];
  /** What sits at the head's right: the pane button, or the popped-out window's buttons. */
  trailing?: ReactNode;
}) {
  const [isDeleting, setDeleting] = useState(false);
  return (
    <>
      {chat && (
        <DeleteChatDialog
          chat={chat}
          onDeleted={onDeleted}
          onOpenChange={setDeleting}
          open={isDeleting}
        />
      )}
      <div className="group/head @container/head flex h-14 w-full min-w-0 shrink-0 items-start gap-x-2 bg-background pt-2 pr-3 pl-4">
        <div className="flex h-8 min-w-0 flex-1 items-center gap-x-1">
          {chat ? (
            <ChatHeading
              chat={chat}
              menu={{ onArchived, onViewTasks }}
              onDelete={() => {
                setDeleting(true);
              }}
              onNewProject={onNewProject}
              onSetProject={onSetProject}
              titleClassName="text-sm font-medium"
              projects={projects}
            />
          ) : (
            <h2 className="min-w-0 truncate text-sm font-medium">
              {fallbackTitle}
            </h2>
          )}
          {popOut && (
            <ToolbarTooltip label={popOut.isOut ? "Bring back" : "Pop out"}>
              <Button
                aria-label={popOut.isOut ? "Bring back" : "Pop out"}
                aria-pressed={popOut.isOut}
                className={cn(
                  toolbarClassName({ pressed: popOut.isOut }),
                  "shrink-0",
                  popOut.isOut
                    ? "bg-brand-100 text-brand-700 hover:bg-brand-100 hover:text-brand-700 dark:bg-brand-900/40 dark:text-brand-300"
                    : "text-muted-foreground/70 opacity-0 not-disabled:hover:text-foreground group-hover/head:opacity-100 focus-visible:opacity-100",
                )}
                onClick={popOut.onToggle}
                size="icon-sm"
                variant="ghost"
              >
                <PictureInPictureIcon className="size-4" />
              </Button>
            </ToolbarTooltip>
          )}
        </div>
        <div className="flex h-8 shrink-0 items-center gap-x-1">
          {chat && <TaskBackgroundProcesses chatId={chat.id} />}
          {trailing}
        </div>
      </div>
    </>
  );
}

/**
 * A chat's title and the project it is filed under, as the chat's head and
 * its popped-out window both draw them: the title, with its caret, opens the
 * chat's menu, whose Rename puts a field in the title's place, and the
 * project follows it the way mail puts a label after a subject. The title
 * gives way first, truncating; on a narrow head the project stands as its
 * mark alone.
 */
function ChatHeading({
  chat,
  menu,
  onDelete,
  onNewProject,
  onSetProject,
  titleClassName,
  projects,
}: {
  chat: Chat;
  /** What the menu offers beyond what every head's does. */
  menu: Pick<ComponentProps<typeof ChatMenu>, "onArchived" | "onViewTasks">;
  onDelete: () => void;
  /** Makes a project, named for what was typed in the picker when anything was, and files the chat under it. */
  onNewProject: (name?: string) => void;
  onSetProject: (project: null | string) => void;
  /** The type the title is set in, which its rename field takes too. */
  titleClassName: string;
  projects: Project[];
}) {
  const filed = projects.find((entry) => entry.id === chat.project);
  const chatRename = useChatRename(chat);
  const titleArrival = useTitleArrival(chat);
  // The title's width as renaming begins, which the field opens at, read
  // in layout px (offsetWidth, not a rect) since the app scales with CSS zoom.
  const [titleButton, setTitleButton] = useState<HTMLButtonElement | null>(
    null,
  );
  const [fieldWidth, setFieldWidth] = useState<number>();
  const rename = {
    ...chatRename,
    start: () => {
      setFieldWidth(titleButton?.offsetWidth);
      chatRename.start();
    },
  };
  // Picking the project the chat is under takes it off; any other moves it.
  const pickProject = (id: string) => {
    onSetProject(chat.project === id ? null : id);
  };
  return (
    <div className="@container/chathead flex min-w-0 items-center gap-x-2">
      {/* The title opens the chat's menu, Rename among it; renaming puts
          the field in the title's place. */}
      <h2 className="flex min-w-0">
        {rename.isEditing ? (
          <ChatTitleField
            className={titleClassName}
            rename={rename}
            width={fieldWidth}
          />
        ) : (
          <ChatMenu
            {...menu}
            chat={chat}
            onDelete={onDelete}
            rename={rename}
            projectMenu={{ onNew: onNewProject, onPick: pickProject, projects }}
            trigger={
              <ChatTitleButton
                arrival={titleArrival}
                className={titleClassName}
                ref={setTitleButton}
                title={chat.title}
              />
            }
          />
        )}
      </h2>
      {/* Pressing it opens the project picker every filing shares. No
          dashed slot in the head: a chat with no project is filed from the
          menu. */}
      {filed && (
        <ProjectPicker
          chosen={new Set([filed.id])}
          onNew={onNewProject}
          onToggle={pickProject}
          projects={projects}
        >
          <button
            aria-label="Project"
            className="flex shrink-0 items-center gap-1"
            type="button"
          >
            <ProjectPill compact="narrow" project={filed} />
          </button>
        </ProjectPicker>
      )}
    </div>
  );
}

/**
 * The chat's own menu, opened from its title: while the chat works, Stop,
 * which ends its turn and every task's; then the inbox row's menu in the
 * same groups and order (see `chatMenuGroups`), with renaming it, which
 * opens the title's field, and its tasks among the ways to organize it, and
 * deleting it at the foot. Its project is the pill beside the title.
 */
function ChatMenu({
  chat,
  onArchived,
  onDelete,
  onViewTasks,
  rename,
  projectMenu,
  trigger,
}: {
  chat: Chat;
  /** After the chat is archived from this menu, for a head that should go with it. */
  onArchived?: () => void;
  onDelete: () => void;
  /** Opens the chat's tasks, when the head can reach them. */
  onViewTasks?: () => void;
  rename: ChatRename;
  /** The projects to file the chat under, as a submenu, when the head that owns the menu files it. */
  projectMenu?: {
    onNew: (name?: string) => void;
    onPick: (id: string) => void;
    projects: Project[];
  };
  /** What opens it: the chat's title. */
  trigger: ReactNode;
}) {
  const groups = chatMenuGroups(useChatActions(chat));
  const stop = useMutation(rpcClient.workspace.session.stop.mutationOptions());
  const item = (action: RowAction) => (
    <DropdownMenuItem
      key={action.id}
      onSelect={action.run}
      variant={action.developerMode ? "developer" : "default"}
    >
      {action.icon}
      {action.label}
    </DropdownMenuItem>
  );
  // The menu hands focus back to its trigger as it closes, which would land
  // after the field took it and blur the rename shut.
  const renaming = useRef(false);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-56"
        onCloseAutoFocus={(event) => {
          if (renaming.current) {
            renaming.current = false;
            event.preventDefault();
          }
        }}
      >
        {chat.state === "working" && (
          <>
            <DropdownMenuItem
              onSelect={() => {
                stop.mutate({ id: chat.id });
              }}
            >
              <StopIcon className="size-3.5" />
              Stop
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {groups.marks.map(item)}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            renaming.current = true;
            rename.start();
          }}
        >
          <PencilSimpleIcon className="size-3.5" />
          Rename
        </DropdownMenuItem>
        {projectMenu && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <TagIcon className="size-3.5" />
              Project
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="flex w-56 flex-col p-0">
              <MenuScrollArea className="max-h-80">
                {projectMenu.projects
                  .filter((entry) => !entry.retired)
                  .map((entry) => (
                    <DropdownMenuCheckboxItem
                      checked={chat.project === entry.id}
                      key={entry.id}
                      onSelect={() => {
                        projectMenu.onPick(entry.id);
                      }}
                    >
                      <ProjectMark project={entry} />
                      <span className="truncate">{entry.name}</span>
                    </DropdownMenuCheckboxItem>
                  ))}
              </MenuScrollArea>
              <div className="shrink-0 border-t border-border p-1">
                <DropdownMenuItem
                  onSelect={() => {
                    projectMenu.onNew();
                  }}
                >
                  <PlusIcon className="size-3.5" />
                  New project…
                </DropdownMenuItem>
              </div>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        {onViewTasks && (
          <DropdownMenuItem
            onSelect={() => {
              onViewTasks();
            }}
          >
            <ListChecksIcon className="size-3.5" />
            View tasks
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {groups.files.map(item)}
        <DropdownMenuSeparator />
        {groups.feedback.map(item)}
        <DropdownMenuSeparator />
        {groups.put.map((action) =>
          action.id === "archive"
            ? item({
                ...action,
                run: () => {
                  action.run();
                  onArchived?.();
                },
              })
            : item(action),
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onDelete} variant="destructive">
          <TrashIcon className="size-3.5" />
          Delete chat…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
