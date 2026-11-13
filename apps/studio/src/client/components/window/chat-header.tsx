import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { MenuScrollArea } from "@/client/components/ui/menu-scroll-area";
import { toolbarClassName } from "@/client/components/ui/toggle";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { FolderSimpleIcon } from "@phosphor-icons/react/FolderSimple";
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple";
import { PictureInPictureIcon } from "@phosphor-icons/react/PictureInPicture";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { StopIcon } from "@phosphor-icons/react/Stop";
import { CardsThreeIcon } from "@phosphor-icons/react/CardsThree";
import { TrashIcon } from "@phosphor-icons/react/Trash";
import { useMutation } from "@tanstack/react-query";
import { type ComponentProps, type ReactNode, useRef, useState } from "react";

import { TaskBackgroundProcesses } from "../task/task-background-processes";
import {
  dropdownMenuComponents,
  type MenuComponents,
} from "@/client/components/ui/menu-components";
import { ChatCopyMenu } from "./chat-copy-menu";
import { chatMenuGroups, useChatActions } from "./chat-actions";
import { ProjectPill } from "./chat-row";
import {
  CHAT_TITLE_GROUP,
  ChatMenuCaret,
  ChatTitleButton,
  ChatTitleField,
} from "./chat-title";
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
 * which renames the chat, and the caret that opens its menu, with the project it
 * is filed under after them and,
 * under a hand, the glyph that pops the conversation out (lit, and always
 * there, while it is out, when pressing it brings the conversation back). At
 * the right, the commands the chat and its tasks left running, then whatever
 * the place it is shown in adds: beside the inbox the pane button, popped out
 * the window's own buttons.
 */
export function ChatHeader({
  chat,
  className,
  fallbackTitle = "Chat",
  leading,
  onArchived,
  onDeleted,
  onNewProject,
  onSetProject,
  popOut,
  projects,
  trailing,
}: {
  chat: Chat | undefined;
  /** Sets the head's height and inset where it shares a line with what is beside it. */
  className?: string;
  /** The title while there is no chat yet: the words just sent, once there are any. */
  fallbackTitle?: string;
  /** What sits ahead of the title: the toggle that puts the inbox away. */
  leading?: ReactNode;
  /** After the chat is archived from its menu, so the window can put it away. */
  onArchived?: () => void;
  /** Told once the chat has been deleted, so the window can put it away. */
  onDeleted: () => void;
  /** Makes a project, named for what was typed in the picker when anything was, and files the chat under it. */
  onNewProject: (name?: string) => void;
  onSetProject: (project: null | string) => void;
  /** Whether the conversation is in its small view, and the press that sends it there or brings it back. */
  popOut?: { isOut: boolean; onToggle: () => void };
  projects: Project[];
  /** What sits at the head's right: the pane button, or the popped-out window's buttons. */
  trailing?: ReactNode;
}) {
  const [isDeleting, setDeleting] = useState(false);
  const popOutButton = popOut && <PopOutButton {...popOut} />;
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
      <div
        className={cn(
          "group/head @container/head flex h-12 w-full min-w-0 shrink-0 items-center gap-x-2 bg-background pr-3",
          leading ? "pl-3" : "pl-4",
          className,
        )}
      >
        <div className="flex h-8 min-w-0 flex-1 items-center gap-x-1">
          {leading}
          {chat ? (
            <ChatHeading
              chat={chat}
              menu={{ onArchived }}
              onDelete={() => {
                setDeleting(true);
              }}
              onNewProject={onNewProject}
              onSetProject={onSetProject}
              titleClassName="text-sm font-medium"
              projects={projects}
            >
              {popOutButton}
            </ChatHeading>
          ) : (
            <>
              <h2 className="min-w-0 truncate text-sm font-medium">
                {fallbackTitle}
              </h2>
              {popOutButton}
            </>
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
 * The glyph after a head's title that pops the conversation out into its
 * small window, shown under a hand over the head; lit, and always there,
 * while it is out, when pressing it brings the conversation back.
 */
function PopOutButton({
  isOut,
  onToggle,
}: {
  isOut: boolean;
  onToggle: () => void;
}) {
  return (
    <ToolbarTooltip label={isOut ? "Bring back" : "Pop out"}>
      <Button
        aria-label={isOut ? "Bring back" : "Pop out"}
        aria-pressed={isOut}
        className={cn(
          toolbarClassName({ pressed: isOut }),
          "shrink-0",
          isOut
            ? "bg-brand-100 text-brand-700 hover:bg-brand-100 hover:text-brand-700 dark:bg-brand-900/40 dark:text-brand-300"
            : "text-muted-foreground/70 opacity-0 group-hover/head:opacity-100 not-disabled:hover:text-foreground focus-visible:opacity-100",
        )}
        onClick={onToggle}
        size="icon-sm"
        variant="ghost"
      >
        <PictureInPictureIcon className="size-4" />
      </Button>
    </ToolbarTooltip>
  );
}

/**
 * A chat's title and the project it is filed under, as the chat's head and
 * its popped-out window both draw them: a press on the title puts a field in
 * its place, the caret after it opens the chat's menu, and the
 * project follows them the way mail puts a label after a subject. The title
 * gives way first, truncating; on a narrow head the project stands as its
 * mark alone.
 */
function ChatHeading({
  chat,
  children,
  menu,
  onDelete,
  onNewProject,
  onSetProject,
  titleClassName,
  projects,
}: {
  chat: Chat;
  /** What follows the title and its project. */
  children?: ReactNode;
  /** What the menu offers beyond what every head's does. */
  menu: Pick<ComponentProps<typeof ChatMenu>, "onArchived">;
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
    <div className="@container/chathead flex min-w-0 flex-1 items-center gap-x-2">
      <h2 className="flex min-w-0">
        {rename.isEditing ? (
          // Pulled out and padded in by what the title's own segment takes, so
          // the words stay where they were as the press turns them into a field.
          <div className="-ml-1.5 flex min-w-0">
            <ChatTitleField
              className={cn(titleClassName, "pl-1.25")}
              rename={rename}
              width={fieldWidth}
            />
          </div>
        ) : (
          <div className={CHAT_TITLE_GROUP}>
            <ChatTitleButton
              arrival={titleArrival}
              className={titleClassName}
              onClick={rename.start}
              ref={setTitleButton}
              title={chat.title}
            />
            <ChatMenu
              {...menu}
              chat={chat}
              onDelete={onDelete}
              rename={rename}
              projectMenu={{
                onNew: onNewProject,
                onPick: pickProject,
                projects,
              }}
              trigger={<ChatMenuCaret />}
            />
          </div>
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
      {children}
    </div>
  );
}

/**
 * The chat's own menu, opened from the caret after its title (see
 * `ChatMenuItems`).
 */
function ChatMenu({
  chat,
  onArchived,
  onDelete,
  rename,
  projectMenu,
  trigger,
}: {
  chat: Chat;
  /** After the chat is archived from this menu, for a head that should go with it. */
  onArchived?: () => void;
  onDelete: () => void;
  rename: ChatRename;
  /** The projects to file the chat under, as a submenu, when the head that owns the menu files it. */
  projectMenu?: ChatProjectMenu;
  /** What opens it: the caret after the chat's title. */
  trigger: ReactNode;
}) {
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
        <ChatMenuItems
          chat={chat}
          components={dropdownMenuComponents}
          onArchived={onArchived}
          onDelete={onDelete}
          onRename={() => {
            renaming.current = true;
            rename.start();
          }}
          projectMenu={projectMenu}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The projects a chat's menu files it under. */
export interface ChatProjectMenu {
  onNew: (name?: string) => void;
  onPick: (id: string) => void;
  projects: Project[];
}

/**
 * A chat's own menu, in a dropdown or under a right-click alike: while the
 * chat works, Stop, which ends its turn and every task's; the chat's own
 * folder where the menu opens it; then the inbox
 * row's menu in the same groups and order (see `chatMenuGroups`), with
 * renaming it among the ways to organize it, and deleting it at the foot.
 */
export function ChatMenuItems({
  chat,
  components: menu,
  onArchived,
  onDelete,
  onRename,
  onShowFolder,
  projectMenu,
}: {
  chat: Chat;
  components: MenuComponents;
  /** After the chat is archived from this menu, for a place that should go with it. */
  onArchived?: (() => void) | undefined;
  onDelete: () => void;
  onRename: () => void;
  /** Opens the chat's own folder beside it, where the menu offers that: while the folder has files. */
  onShowFolder?: (() => void) | undefined;
  /** The projects to file the chat under, as a submenu, where the menu files it. */
  projectMenu?: ChatProjectMenu | undefined;
}) {
  const groups = chatMenuGroups(useChatActions(chat));
  const stop = useMutation(rpcClient.workspace.session.stop.mutationOptions());
  const item = (action: RowAction) => (
    <menu.Item
      key={action.id}
      onSelect={action.run}
      variant={action.developerMode ? "developer" : "default"}
    >
      {action.icon}
      {action.label}
    </menu.Item>
  );
  return (
    <>
      {chat.status === "working" && (
        <>
          <menu.Item
            onSelect={() => {
              stop.mutate({ id: chat.id });
            }}
          >
            <StopIcon className="size-3.5" />
            Stop
          </menu.Item>
          <menu.Separator />
        </>
      )}
      {onShowFolder && (
        <>
          <menu.Item onSelect={onShowFolder}>
            <FolderSimpleIcon className="size-3.5" />
            Show Chat Folder
          </menu.Item>
          <menu.Separator />
        </>
      )}
      {groups.marks.map(item)}
      <menu.Separator />
      <menu.Item onSelect={onRename}>
        <PencilSimpleIcon className="size-3.5" />
        Rename
      </menu.Item>
      {projectMenu && (
        <ProjectMenuItems
          chosen={chat.project}
          components={menu}
          projectMenu={projectMenu}
        />
      )}
      <menu.Separator />
      {groups.files.map(item)}
      <ChatCopyMenu chat={chat} menu={menu} />
      <menu.Separator />
      {groups.feedback.map(item)}
      <menu.Separator />
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
      <menu.Separator />
      <menu.Item onSelect={onDelete} variant="destructive">
        <TrashIcon className="size-3.5" />
        Delete chat…
      </menu.Item>
    </>
  );
}

/**
 * Project, as a submenu of a chat's menu: the projects to file it under,
 * the one it is under ticked, and New project….
 */
function ProjectMenuItems({
  chosen,
  components: menu,
  projectMenu,
}: {
  /** The project it is filed under, by its id. */
  chosen: string | undefined;
  components: MenuComponents;
  projectMenu: ChatProjectMenu;
}) {
  const live = projectMenu.projects.filter((entry) => !entry.retired);
  return (
    <menu.Sub>
      <menu.SubTrigger>
        <CardsThreeIcon className="size-3.5" />
        Project
      </menu.SubTrigger>
      <menu.SubContent className="flex w-56 flex-col p-0">
        {live.length > 0 && (
          <MenuScrollArea className="max-h-80">
            {live.map((entry) => (
              <menu.CheckboxItem
                checked={chosen === entry.id}
                key={entry.id}
                onSelect={() => {
                  projectMenu.onPick(entry.id);
                }}
              >
                <ProjectMark project={entry} />
                <span className="truncate">{entry.name}</span>
              </menu.CheckboxItem>
            ))}
          </MenuScrollArea>
        )}
        <div
          className={cn(
            "shrink-0 p-1",
            live.length > 0 && "border-t border-border",
          )}
        >
          <menu.Item
            onSelect={() => {
              projectMenu.onNew();
            }}
          >
            <PlusIcon className="size-3.5" />
            New project…
          </menu.Item>
        </div>
      </menu.SubContent>
    </menu.Sub>
  );
}
