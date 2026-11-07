import { hasReplyWaitingAtom } from "@/client/drafts/store";
import { chatHref } from "@/client/components/window/window-href";
import { FileOpenContext } from "@/client/components/file-open-context";
import { FuzzyHighlight } from "@/client/components/fuzzy-highlight";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { openInNewWindow } from "./app-tabs";
import { NewTabIcon } from "@/client/components/icons/new-tab-icon";
import { PageOpenContext } from "@/client/components/page-open-context";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/client/components/ui/context-menu";
import { MenuScrollArea } from "@/client/components/ui/menu-scroll-area";
import { openClickGestures } from "@/client/hooks/use-open-target";
import { withoutPathQuotes } from "@/client/lib/path-text";
import { cn } from "@/client/lib/utils";
import { type ChatId } from "@instrument-org/workspace/client";
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple";
import { PictureInPictureIcon } from "@phosphor-icons/react/PictureInPicture";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { QuestionIcon } from "@phosphor-icons/react/Question";
import { StarIcon } from "@phosphor-icons/react/Star";
import { CardsThreeIcon } from "@phosphor-icons/react/CardsThree";
import { TrashIcon } from "@phosphor-icons/react/Trash";
import { WarningCircleIcon } from "@phosphor-icons/react/WarningCircle";
import { useAtomValue } from "jotai";
import { type ReactNode, useRef, useState } from "react";

import { type AppsBySlug } from "./apps-by-slug";
import { chatMenuGroups } from "./chat-actions";
import { type RowDensity } from "./chat-list-view";
import { ChatMarkDot } from "./chat-mark";
import { ChatTitleField } from "./chat-title";
import {
  activityLabel,
  type Chat,
  limitedText,
  type Project,
  wordRanges,
} from "./chats";
import { type OpenOptions, useWindow, WindowContext } from "./context";
import { HoldMarks } from "./hold-marks";
import { ROW_CONTROL, RowActionBar } from "./row-action-bar";
import { type RowAction, rowClassName, stopHere } from "./row-shell";
import { projectColor } from "./project-colors";
import { ProjectMark } from "./project-mark";
import { ProjectPicker } from "./project-picker";
import { projectTint } from "./project-tint";
import { useChatRename } from "./use-chat-rename";
import { useTitleArrival } from "./use-title-arrival";
import { ShimmerSweep } from "@/client/components/shimmer-sweep";

/** How long the corner's bar stays after the project list closes: the list's exit animation. */
const PICKER_LEAVE_MS = 250;

/**
 * One chat in the inbox, and the door into it: a click anywhere on it
 * opens the chat beside the list (a chat is never a tab, so no gesture
 * asks for one), a right click raises its menu, and the keyboard opens it
 * with Enter. The title in semibold while there is something unseen in it,
 * which is the only mark unread wears,
 * the word Draft after it in red while a reply waits unsent in the
 * chat, the way mail marks a conversation with a draft in it,
 * the project it is filed under as a pill in the row's corner, the agent's
 * latest line (the step it is on, the question it is waiting on, or its last
 * reply's first words), and the marks of what it holds. The title has the
 * first line with the project at its end, the latest line gets one, and what it holds sits on a
 * third line that never wraps: the files it made as chips with their names,
 * the apps and sites as marks beside them, fading out at the row's edge,
 * with the time in the row's bottom corner. A starred chat wears a filled
 * star past its project. Where the chat
 * stands is said by the latest line alone: shimmering while it works, behind
 * a question mark while it waits on the user. No avatar,
 * no name: every row here is the user's. The marks, the tag
 * control that stands in front of the title while the pointer is on the
 * row, and the actions that stand over the corner then (putting the chat
 * away or back, marking it read or unread, and starring it last, where the
 * star stands) are the row's own controls, and a
 * click on one stops short of the door. The menu offers the same, with the
 * way to open the chat and its project.
 */
export function ChatRow({
  actions,
  appsBySlug,
  chat,
  density = "three",
  isArriving = false,
  isOpen,
  isProjectShown = true,
  now,
  onDelete,
  onNewProject,
  onOpen,
  onSetProject,
  search = "",
  projects,
}: {
  /** The chat's actions, answered by the list for every row through one set of mutations. */
  actions: RowAction[];
  appsBySlug: AppsBySlug;
  chat: Chat;
  /** How much of the chat the row shows: see `RowDensity`. */
  density?: RowDensity;
  /** Whether the chat just started from a draft: its row arrives with a wash that settles. */
  isArriving?: boolean;
  /** Whether this chat is the one open beside the list. */
  isOpen: boolean;
  /** Whether the row names the project the chat is filed under: not in the list of that project, which already says it. */
  isProjectShown?: boolean;
  /** The moment the row's time is read against. */
  now: Date;
  /** Asks before the chat goes to the trash, through the caller's dialog. */
  onDelete: () => void;
  /** Opens the new-project dialog for this chat, with the name typed in the picker when anything was. */
  onNewProject: (name?: string) => void;
  /** A plain click: the chat in place of whatever the window shows. */
  onOpen: () => void;
  onSetProject: (project: null | string) => void;
  /** The words the list is searched for, which the title and the latest line mark where they turn up. */
  search?: string;
  projects: Project[];
}) {
  const filed = projects.find((entry) => entry.id === chat.project);
  const appWindow = useWindow();
  // A Cmd-click or a middle click, and the menu's row, open the chat in a
  // tab of the window's own behind the one up, where a plain click opens
  // it beside the list.
  const openInNewTab = () => {
    appWindow.openScreen(chatHref(chat.id), {
      behind: true,
      newTab: true,
    });
  };
  const clicks = openClickGestures({ open: onOpen, openInNewTab });
  const [isPicking, setPicking] = useState(false);
  // Held in the flow for a moment after the list closes: the list animates
  // out anchored to the control, and a control that vanished with the
  // pointer already gone left the list to fly to the window's corner.
  const [isPickerLeaving, setPickerLeaving] = useState(false);
  const pickProjects = (open: boolean) => {
    setPicking(open);
    if (!open) {
      setPickerLeaving(true);
      setTimeout(() => {
        setPickerLeaving(false);
      }, PICKER_LEAVE_MS);
    }
  };
  const isUnseen = chat.unread;
  const rename = useChatRename(chat);
  const titleArrival = useTitleArrival(chat);
  // The menu hands focus back to the row as it closes, which would land
  // after the field took it and blur the rename shut.
  const isStartingRename = useRef(false);
  // What the chat's composer holds, whether or not it is on screen.
  const hasDraft = useAtomValue(hasReplyWaitingAtom(chat.id));
  const hasHolds =
    chat.holds.apps.length > 0 ||
    chat.holds.files.length > 0 ||
    chat.holds.sites.length > 0;
  // Picking the project the chat is under takes it off; any other moves it.
  const pickProject = (id: string) => {
    onSetProject(chat.project === id ? null : id);
  };
  const tagControl = (
    <TagControl
      chat={chat}
      isOpen={isPicking}
      onNewProject={onNewProject}
      onOpenChange={pickProjects}
      onToggle={pickProject}
      projects={projects}
    />
  );
  // The project the chat is filed under, by name in its ink; filing is the
  // control in the corner's bar.
  const shownProject = isProjectShown ? filed : undefined;
  const projectWords = shownProject && <ProjectWords project={shownProject} />;
  // The title takes only its own width, so the draft's word stands right
  // after it and keeps its place as the title truncates before it.
  const title = rename.isEditing ? (
    // Clicks and keys in the field are the field's, not the row's door.
    <span
      className="-my-1.5 flex min-w-0 flex-1"
      onAuxClick={stopHere}
      onClick={stopHere}
      onKeyDown={stopHere}
      onMouseDown={stopHere}
    >
      <ChatTitleField
        className="text-[13px] font-medium"
        grow
        rename={rename}
        width={undefined}
      />
    </span>
  ) : (
    <>
      <span
        className={cn(
          "min-w-0 truncate text-[13px] leading-5 tracking-[-0.005em]",
          isUnseen
            ? "font-semibold text-foreground"
            : "font-medium text-foreground/85",
          titleArrival.className,
        )}
        onAnimationEnd={titleArrival.onAnimationEnd}
      >
        <FuzzyHighlight
          ranges={wordRanges(chat.title, search)}
          text={chat.title}
        />
      </span>
      {hasDraft && (
        <span className="shrink-0 text-[13px] text-error-700 dark:text-error-300">
          Draft
        </span>
      )}
    </>
  );
  // When the user last messaged the chat, which the list is ordered by, at
  // the end of the title's line.
  const time = (
    <span
      className={cn(
        "shrink-0 text-right text-[11px] text-muted-foreground/70 tabular-nums",
        isUnseen && "font-semibold",
      )}
    >
      {activityLabel(new Date(chat.lastUserMessageAt), now)}
    </span>
  );
  // A starred chat's star, past its time in the row's corner and a mark
  // rather than a control: starring and unstarring end the corner's bar,
  // which takes the same spot, in a box of a control's size so the star
  // stays put as the bar comes and goes.
  const starMark = chat.starred && (
    <span className="-my-0.5 grid size-6 shrink-0 place-items-center">
      <StarIcon
        aria-label="Starred"
        className="size-4 text-warning-500"
        role="img"
        weight="fill"
      />
    </span>
  );
  // The same groups, in the same order, as the menu in the chat's head.
  const groups = chatMenuGroups(actions);
  const live = projects.filter((entry) => !entry.retired);
  // Beside the ways to open the chat, where the list offers it.
  const popOut = actions.find((action) => action.id === "popOut");
  const item = (action: RowAction) => (
    <ContextMenuItem
      key={action.id}
      onSelect={action.run}
      variant={action.developerMode ? "developer" : "default"}
    >
      {action.icon}
      {action.label}
    </ContextMenuItem>
  );
  return (
    // Not modal: a modal menu takes the pointer from the whole page while it
    // is up, so the click that put it away was eaten, and a reader who
    // right-clicked one row and then clicked another had asked for the second
    // and got nothing. The list is a list of doors; a click on one is a click
    // on one.
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            rowClassName(isOpen),
            // The chat just started from a draft slides into its place;
            // nothing else that lands in the list does this.
            isArriving && "chat-arrive",
          )}
          data-open={isOpen || undefined}
          {...clicks}
          onKeyDown={(event) => {
            if (event.key === "Enter" && event.target === event.currentTarget) {
              onOpen();
            }
          }}
          role="button"
          tabIndex={0}
        >
          <div className="min-w-0 flex-1">
            <div className="flex h-5 items-center gap-1.5">
              {density === "one" && shownProject && (
                <ProjectMark className="size-4" plain project={shownProject} />
              )}
              {title}
              {/* The time and the star step aside for the row's controls
                  while the pointer is on it. */}
              <RowActionBar
                actions={actions}
                isHeld={isPickerLeaving}
                leading={tagControl}
                resting={
                  <>
                    {time}
                    {starMark}
                  </>
                }
              />
            </div>
            {density === "three" && (
              <>
                {/* A line's room whatever the latest line takes, and when
                    there is none, so the row keeps one height as its chat
                    starts work. */}
                <div className="h-5 min-w-0">
                  <Peek chat={chat} search={search} />
                </div>
                {/* The project and what the chat holds, the files by name,
                    on a line every row has whether or not it holds
                    anything, so the list keeps one row height. */}
                <div className="mt-1 flex h-5 min-w-0 items-center gap-2">
                  {projectWords}
                  {hasHolds && (
                    <HoldsInChat chatId={chat.id}>
                      <HoldMarks
                        appsBySlug={appsBySlug}
                        chatId={chat.id}
                        className="min-w-0 flex-1 gap-1"
                        holds={chat.holds}
                        namedFiles
                        wrap={false}
                      />
                    </HoldsInChat>
                  )}
                </div>
              </>
            )}
            {density === "two" && (
              // A chat at work, waiting or stopped says so here, since there
              // is no other line for it; otherwise the project, or the last
              // reply for a chat filed under none. The marks of what it
              // holds stand at the line's end, without the files' names.
              <div className="flex h-5 min-w-0 items-center gap-2">
                <span className="flex min-w-0 flex-1">
                  {isBusy(chat) || !projectWords ? (
                    <Peek chat={chat} search={search} />
                  ) : (
                    projectWords
                  )}
                </span>
                {hasHolds && (
                  <HoldsInChat chatId={chat.id}>
                    <HoldMarks
                      appsBySlug={appsBySlug}
                      chatId={chat.id}
                      className="max-w-[45%] shrink-0 justify-end gap-1"
                      holds={chat.holds}
                      wrap={false}
                    />
                  </HoldsInChat>
                )}
              </div>
            )}
          </div>
          <RowDot chat={chat} density={density} />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent
        onCloseAutoFocus={(event) => {
          if (isStartingRename.current) {
            isStartingRename.current = false;
            event.preventDefault();
          }
        }}
      >
        <ContextMenuItem onSelect={onOpen}>Open</ContextMenuItem>
        <ContextMenuItem onSelect={openInNewTab}>
          <NewTabIcon className="size-4" />
          Open in New Tab
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => {
            openInNewWindow(chatHref(chat.id));
          }}
        >
          <AppWindowIcon className="size-4" />
          Open in New Window
        </ContextMenuItem>
        {popOut && (
          <ContextMenuItem onSelect={popOut.run}>
            <PictureInPictureIcon className="size-4" />
            Pop Out
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        {groups.marks.map(item)}
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() => {
            isStartingRename.current = true;
            rename.start();
          }}
        >
          <PencilSimpleIcon className="size-4" />
          Rename
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <CardsThreeIcon className="size-4" />
            Project
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="flex w-56 flex-col p-0">
            {live.length > 0 && (
              <MenuScrollArea className="max-h-80">
                {live.map((entry) => (
                  <ContextMenuCheckboxItem
                    checked={chat.project === entry.id}
                    key={entry.id}
                    onSelect={() => {
                      pickProject(entry.id);
                    }}
                  >
                    <ProjectMark project={entry} />
                    <span className="truncate">{entry.name}</span>
                  </ContextMenuCheckboxItem>
                ))}
              </MenuScrollArea>
            )}
            <div
              className={cn(
                "shrink-0 p-1",
                live.length > 0 && "border-t border-border",
              )}
            >
              <ContextMenuItem
                onSelect={() => {
                  onNewProject();
                }}
              >
                <PlusIcon className="size-4" />
                New project…
              </ContextMenuItem>
            </div>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        {groups.files.map(item)}
        <ContextMenuSeparator />
        {groups.feedback.map(item)}
        <ContextMenuSeparator />
        {groups.put.map(item)}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onDelete} variant="destructive">
          <TrashIcon className="size-4" />
          Delete chat…
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** Whether the chat's latest line says where it stands rather than what it last said. */
function isBusy(chat: Chat) {
  return (
    chat.status === "failed" ||
    chat.status === "limited" ||
    chat.status === "waiting" ||
    chat.status === "working"
  );
}

/**
 * The dot in the row's gutter, the rail's own: green while the chat has
 * something not yet seen. A one-line row has no line to say where the chat
 * stands, so there the dot says that too, pulsing green while it works and
 * gray while it waits on the user, as the rail's Chat does.
 */
function RowDot({ chat, density }: { chat: Chat; density: RowDensity }) {
  const shown =
    density === "one" && chat.status === "waiting"
      ? "waiting"
      : density === "one" && chat.working
        ? "working"
        : chat.unread
          ? "unread"
          : undefined;
  if (!shown) {
    return null;
  }
  return (
    <span className="absolute top-4.5 left-1.5 flex size-1.5">
      <ChatMarkDot className="static size-1.5 ring-0" mark={shown} />
    </span>
  );
}

/** The project a chat is filed under, as its name in the project's ink. */
export function ProjectWords({ project }: { project: Project }) {
  return (
    <span
      className="max-w-32 shrink-0 truncate text-[12px] leading-5 font-medium text-(--project-tint-ink) project-tint"
      data-slot="project-words"
      style={projectTint(projectColor(project))}
    >
      {project.name}
    </span>
  );
}

/**
 * A project the chat is filed under, as a pill in its tint no taller than
 * the line it sits on: its emoji, or its mark's tile where it has none, then
 * its name, or the mark alone on a narrow chat head, where the name is its
 * tooltip.
 */
export function ProjectPill({
  compact,
  quiet = false,
  project,
}: {
  /** The mark alone on a narrow chat head. */
  compact?: "narrow";
  /** A faint wash with the name in the project's ink, for a list where the pill is a label beside the words rather than a thing to look at. */
  quiet?: boolean;
  project: Project;
}) {
  // `leading-4` rather than none: the name's box has to hold its descenders,
  // or the clip that truncates it cuts them off.
  const className = cn(
    // The file chips' corners, so a row's labels read as one set.
    "inline-flex h-5 max-w-32 shrink-0 items-center gap-1 rounded-md pl-1 text-[11px] leading-4 project-tint",
    quiet
      ? "bg-(--project-tint-surface)/40 font-medium text-(--project-tint-ink)"
      : "bg-(--project-tint-surface) text-foreground/90",
    compact === "narrow" ? "pr-1.5 @max-sm/chathead:pr-1" : "pr-1.5",
    // A little more room in a list, where the label sits among the words.
    quiet && "pr-2 pl-1.5",
  );
  const inside = (
    <>
      {project.emoji ? (
        <span className="text-[10px]">{project.emoji}</span>
      ) : (
        <ProjectMark className="size-3.5 text-[10px]" project={project} />
      )}
      <span
        className={cn(
          "truncate",
          compact === "narrow" && "@max-sm/chathead:hidden",
        )}
      >
        {project.name}
      </span>
    </>
  );
  return (
    <span
      className={className}
      data-slot="project-pill"
      style={projectTint(projectColor(project))}
      title={compact ? project.name : undefined}
    >
      {inside}
    </span>
  );
}

/**
 * Names the openers for the marks of what a chat holds: a hold is the
 * chat's, so opening one opens it as a tab of the chat's group, never
 * in place of whatever the right area had up, and brings the chat on
 * screen at that tab with its pane up. A middle or modified click asks for
 * the same tab.
 */
function HoldsInChat({
  chatId,
  children,
}: {
  chatId: ChatId;
  children: ReactNode;
}) {
  const appWindow = useWindow();
  const inChat = { group: chatId, ownTab: true, show: true };
  // A new-tab gesture asks for a tab of the window's own instead.
  const options = (asked?: OpenOptions) =>
    asked?.newTab ? { behind: asked.behind, newTab: true } : inChat;
  return (
    <WindowContext
      value={{
        ...appWindow,
        openPage: (url, asked) => {
          appWindow.openPage(url, options(asked));
        },
        openScreen: (href, asked) => {
          appWindow.openScreen(href, options(asked));
        },
      }}
    >
      <FileOpenContext
        value={(path, asked) => {
          appWindow.openPath(path, options(asked));
        }}
      >
        <PageOpenContext
          value={(url, asked) => {
            appWindow.openPage(url, options(asked));
          }}
        >
          {children}
        </PageOpenContext>
      </FileOpenContext>
    </WindowContext>
  );
}

/**
 * The agent's latest line: the step while it works, in brand; that its turn
 * stopped on an error, behind a red warning glyph; the question while it
 * waits, behind a question mark, both in gray; and
 * otherwise, a chat the user stopped included, the last reply's first words,
 * in muted. Nothing when an idle or stopped chat has said nothing yet. One
 * line that truncates.
 */
export function Peek({
  chat,
  className,
  search = "",
}: {
  chat: Chat;
  className?: string;
  /** The words searched for, marked where they turn up in the line. */
  search?: string;
}) {
  const isFailed = chat.status === "failed";
  const isLimited = chat.status === "limited";
  const isWaiting = chat.status === "waiting";
  const isWorking = chat.status === "working";
  if (!chat.latest && !isFailed && !isLimited && !isWaiting && !isWorking) {
    return null;
  }
  return (
    <span
      className={cn(
        "flex min-w-0 items-center gap-1.5 text-[12px] leading-5",
        className,
      )}
    >
      {isWorking ? (
        <WorkingPeek chat={chat} />
      ) : isFailed ? (
        // The turn never got its reply out, which nothing else on the row
        // would say: the latest line is whatever came before it.
        <>
          <WarningCircleIcon
            className="size-3.5 shrink-0 text-error-700 dark:text-error-300"
            weight="bold"
          />
          <span className="min-w-0 truncate text-error-700 dark:text-error-300">
            Stopped on an error
          </span>
        </>
      ) : isLimited ? (
        <span className="min-w-0 truncate text-muted-foreground">
          {limitedText(chat)}
        </span>
      ) : isWaiting ? (
        <>
          <QuestionIcon
            className="size-3.5 shrink-0 text-foreground/80"
            weight="bold"
          />
          <span className="min-w-0 truncate text-foreground/80">
            <Marked
              search={search}
              text={chat.latest?.text || "Waiting on you"}
            />
          </span>
        </>
      ) : (
        <span className="min-w-0 truncate text-muted-foreground">
          <Marked
            search={search}
            text={withoutPathQuotes(
              chat.latest?.text ?? "",
              window.electron.process.platform,
            )}
          />
        </span>
      )}
    </span>
  );
}

/** A line with the words searched for marked the way the command menu marks a match. */
function Marked({ search, text }: { search: string; text: string }) {
  return <FuzzyHighlight ranges={wordRanges(text, search)} text={text} />;
}

/**
 * The control that files the chat, first in the corner's bar: the project
 * picker every filing shares. The row keeps its open state, so the bar stays
 * in the flow while the list is up and the list keeps its anchor as it
 * closes.
 */
function TagControl({
  chat,
  isOpen,
  onNewProject,
  onOpenChange,
  onToggle,
  projects,
}: {
  chat: Chat;
  isOpen: boolean;
  onNewProject: (name: string) => void;
  onOpenChange: (open: boolean) => void;
  onToggle: (id: string) => void;
  projects: Project[];
}) {
  return (
    // The list is drawn elsewhere on the page but is this span's in React's
    // eyes, so a pick inside it stops here rather than opening the chat. A
    // right click on the control is the row's, and raises the row's menu
    // like a right click on the words.
    <span className="flex shrink-0" onAuxClick={stopHere} onClick={stopHere}>
      <ProjectPicker
        align="end"
        chosen={new Set(chat.project ? [chat.project] : [])}
        isOpen={isOpen}
        onNew={onNewProject}
        onOpenChange={onOpenChange}
        onToggle={onToggle}
        projects={projects}
      >
        <button
          aria-label="Project"
          className={ROW_CONTROL}
          title="Project"
          type="button"
        >
          <CardsThreeIcon />
        </button>
      </ProjectPicker>
    </span>
  );
}

/**
 * What the chat is on, as the line under its title says it: the step its own
 * turn or a task at work names, or Instrument is working until a step lands.
 * One line keeps the row's height stable as the status changes.
 */
function WorkingPeek({ chat }: { chat: Chat }) {
  const step = chat.latest?.kind === "step" ? chat.latest.text : undefined;
  // `brand-shiny-text` is an inline-block, which a parent's truncate cannot
  // shrink, so it carries its own.
  return (
    <span className="brand-shiny-text min-w-0 truncate">
      {step ?? "Instrument is working"}
      <ShimmerSweep text={step ?? "Instrument is working"} />
    </span>
  );
}
