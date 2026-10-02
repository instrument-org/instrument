import { promptDraftAtom } from "@/client/atoms/prompt-value";
import { FileOpenContext } from "@/client/components/file-open-context";
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
import { cn } from "@/client/lib/utils";
import { type StoreId } from "@instrument-org/workspace/client";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { QuestionIcon } from "@phosphor-icons/react/Question";
import { StarIcon } from "@phosphor-icons/react/Star";
import { TagIcon } from "@phosphor-icons/react/Tag";
import { useAtomValue } from "jotai";
import { type ReactNode, useState } from "react";

import { type AppsBySlug } from "./apps-by-slug";
import { chatMenuGroups } from "./chat-actions";
import { activityLabel, type Chat, type Topic } from "./chats";
import { type OpenOptions, useWindow, WindowContext } from "./context";
import { HoldMarks } from "./hold-marks";
import { RowActionBar } from "./row-action-bar";
import { type RowAction, rowClassName, stopHere } from "./row-shell";
import { topicColor } from "./topic-colors";
import { TopicMark } from "./topic-mark";
import { TopicPicker } from "./topic-picker";
import { topicTint } from "./topic-tint";

/** How long the corner's bar stays after the topic list closes: the list's exit animation. */
const PICKER_LEAVE_MS = 250;

/**
 * One chat in the inbox, and the door into it: a click anywhere on it
 * opens the chat beside the list (a chat is never a tab, so no gesture
 * asks for one), a right click raises its menu, and the keyboard opens it
 * with Enter. The title in semibold while there is something unseen in it,
 * which is the only mark unread wears,
 * the word Draft after it in red while a reply sits typed and unsent in the
 * chat's composer, the way mail marks a conversation with a draft in it,
 * the topics it is filed under as pills in the row's corner, the agent's
 * latest line (the step it is on, the question it is waiting on, or its last
 * reply's first words), and the marks of what it holds. The title has the
 * first line with the topics at its end, the latest line gets two, and what it holds sits on a
 * third line that never wraps: the files it made as chips with their names,
 * the apps and sites as marks beside them, fading out at the row's edge,
 * with the time in the row's bottom corner. A starred chat wears a filled
 * star past its topics. Where the chat
 * stands is said by the latest line alone: shimmering while it works, behind
 * an amber glyph while it waits on the user. No avatar,
 * no name: every row here is the user's. The marks, the tag
 * control that stands in front of the title while the pointer is on the
 * row, and the actions that stand over the corner then (putting the chat
 * away or back, marking it read or unread, and starring it last, where the
 * star stands) are the row's own controls, and a
 * click on one stops short of the door. The menu offers the same, with the
 * way to open the chat and its topics.
 */
export function ChatRow({
  actions,
  appsBySlug,
  chat,
  isArriving = false,
  isOpen,
  now,
  onNewTopic,
  onOpen,
  onSetTopics,
  topics,
}: {
  /** The chat's actions, answered by the list for every row through one set of mutations. */
  actions: RowAction[];
  appsBySlug: AppsBySlug;
  chat: Chat;
  /** Whether the chat just started from a draft: its row arrives with a wash that settles. */
  isArriving?: boolean;
  /** Whether this chat is the one open beside the list. */
  isOpen: boolean;
  /** The moment the row's time is read against. */
  now: Date;
  /** Opens the new-topic dialog for this chat, with the name typed in the picker when anything was. */
  onNewTopic: (name?: string) => void;
  /** A plain click: the chat in place of whatever the window shows. */
  onOpen: () => void;
  onSetTopics: (topics: string[]) => void;
  topics: Topic[];
}) {
  // Every topic the chat is filed under, in the order it was filed.
  const filed = chat.topics.flatMap((id) => {
    const topic = topics.find((entry) => entry.id === id);
    return topic ? [topic] : [];
  });
  const [isPicking, setPicking] = useState(false);
  // Held in the flow for a moment after the list closes: the list animates
  // out anchored to the control, and a control that vanished with the
  // pointer already gone left the list to fly to the window's corner.
  const [isPickerLeaving, setPickerLeaving] = useState(false);
  const pickTopics = (open: boolean) => {
    setPicking(open);
    if (!open) {
      setPickerLeaving(true);
      setTimeout(() => {
        setPickerLeaving(false);
      }, PICKER_LEAVE_MS);
    }
  };
  const isUnseen = chat.unread > 0;
  // What the chat's composer holds, whether or not it is on screen.
  const draft = useAtomValue(
    promptDraftAtom({ scope: "chat", sessionId: chat.id }),
  );
  const hasDraft = draft.trim() !== "";
  const hasHolds =
    chat.holds.apps.length > 0 ||
    chat.holds.files.length > 0 ||
    chat.holds.sites.length > 0;
  const toggleTopic = (id: string) => {
    onSetTopics(
      chat.topics.includes(id)
        ? chat.topics.filter((entry) => entry !== id)
        : [...chat.topics, id],
    );
  };
  const tagControl = (
    <TagControl
      chat={chat}
      isOpen={isPicking}
      onNewTopic={onNewTopic}
      onOpenChange={pickTopics}
      onToggle={toggleTopic}
      topics={topics}
    />
  );
  // The topics in the row's corner, each by name; filing is the control in
  // the corner's bar.
  const pills = filed.map((topic) => (
    <TopicPill key={topic.id} topic={topic} />
  ));
  // The title takes only its own width, so the draft's word stands right
  // after it and keeps its place as the title truncates before it.
  const title = (
    <>
      <span
        className={cn(
          "min-w-0 truncate text-[13px]",
          isUnseen ? "font-semibold" : "text-foreground/90",
        )}
      >
        {chat.title}
      </span>
      {hasDraft && (
        <span className="shrink-0 text-[13px] text-error-700 dark:text-error-300">
          Draft
        </span>
      )}
    </>
  );
  // When something last happened, in the row's bottom corner, in a column
  // of one width so the times line up down the list.
  const time = (
    <span
      className={cn(
        "w-14 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums",
        isUnseen && "font-semibold text-foreground",
      )}
    >
      {activityLabel(new Date(chat.updatedAt), now)}
    </span>
  );
  // A starred chat's star, past its topics in the row's corner and a mark
  // rather than a control: starring and unstarring end the corner's bar,
  // which stands over the same spot.
  const starMark = chat.starred && (
    <StarIcon
      aria-label="Starred"
      className="size-3.5 shrink-0 text-warning-500"
      role="img"
      weight="fill"
    />
  );
  // The same groups, in the same order, as the menu in the chat's head.
  const groups = chatMenuGroups(actions);
  const item = (action: RowAction) => (
    <ContextMenuItem key={action.id} onSelect={action.run}>
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
          onClick={onOpen}
          onKeyDown={(event) => {
            if (event.key === "Enter" && event.target === event.currentTarget) {
              onOpen();
            }
          }}
          role="button"
          tabIndex={0}
        >
          <div className="min-w-0 flex-1">
            {/* The topics at the line's end in the row's corner. */}
            <div className="flex h-5 items-center gap-1.5">
              {title}
              {/* Stepping aside for the corner's bar while the pointer is
                  on the row. */}
              <span className="ml-auto flex shrink-0 items-center gap-1 group-hover/row:invisible">
                {pills}
                {starMark}
              </span>
            </div>
            {/* The time in the row's bottom corner: at the end of the
                holds' line when the chat holds anything, and otherwise at
                the end of the latest line, so a row with nothing held takes
                no line for nothing. */}
            {hasHolds ? (
              <>
                {/* Two lines' room whatever the latest line takes, so
                    the row keeps one height as its chat starts work,
                    starts a task, and settles on a reply of one line. */}
                <Peek chat={chat} className="mt-0.5 min-h-10" />
                <div className="mt-1 flex items-end gap-2">
                  <HoldsInChat chatSessionId={chat.id}>
                    <HoldMarks
                      appsBySlug={appsBySlug}
                      className="min-w-0 flex-1 gap-1"
                      holds={chat.holds}
                      namedFiles
                      wrap={false}
                    />
                  </HoldsInChat>
                  {time}
                </div>
              </>
            ) : (
              // Two lines' room whatever the latest line takes, so the
              // time sits under the corner's bar rather than beneath it
              // while the pointer is on the row, and the row keeps one
              // height as the line changes. The line starts under the
              // title, as it does in a row that holds something.
              <div className="mt-0.5 flex min-h-10 items-start gap-2">
                <Peek chat={chat} className="min-w-0 flex-1" />
                <span className="ml-auto flex shrink-0 self-end">{time}</span>
              </div>
            )}
          </div>
          <RowActionBar
            actions={actions}
            isHeld={isPickerLeaving}
            leading={tagControl}
          />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onOpen}>Open</ContextMenuItem>
        <ContextMenuSeparator />
        {groups.marks.map(item)}
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <TagIcon className="size-4" />
            Topics
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="flex w-56 flex-col p-0">
            <MenuScrollArea className="max-h-80">
              {topics
                .filter((entry) => !entry.retired)
                .map((entry) => (
                  <ContextMenuCheckboxItem
                    checked={chat.topics.includes(entry.id)}
                    key={entry.id}
                    // A chat can be under several topics, so a pick leaves
                    // the list up for the next.
                    onSelect={(event) => {
                      event.preventDefault();
                      toggleTopic(entry.id);
                    }}
                  >
                    <TopicMark topic={entry} />
                    <span className="truncate">{entry.name}</span>
                  </ContextMenuCheckboxItem>
                ))}
            </MenuScrollArea>
            <div className="shrink-0 border-t border-border p-1">
              <ContextMenuItem
                onSelect={() => {
                  onNewTopic();
                }}
              >
                <PlusIcon className="size-4" />
                New topic…
              </ContextMenuItem>
            </div>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        {groups.files.map(item)}
        <ContextMenuSeparator />
        {groups.put.map(item)}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * A topic the chat is filed under, as a pill in its tint no taller than
 * the line it sits on: its emoji, or its mark's tile where it has none, then
 * its name, or the mark alone when the pill is compact and the name is its
 * tooltip. Clicking it opens the chat's topic list rather than the chat;
 * given nothing to open, it is the name alone and no control.
 */
export function TopicPill({
  compact = false,
  onPick,
  topic,
}: {
  /** The mark alone, for a topic past the first on a row with a title to keep; `"narrow"` is the mark alone only on a narrow chat head. */
  compact?: "narrow" | boolean;
  onPick?: () => void;
  topic: Topic;
}) {
  // `leading-4` rather than none: the name's box has to hold its descenders,
  // or the clip that truncates it cuts them off.
  const className = cn(
    "inline-flex h-5 max-w-32 shrink-0 items-center gap-1 rounded-full bg-(--topic-tint-surface) pl-1 text-[11px] leading-4 text-foreground/90 topic-tint",
    compact === true
      ? "pr-1"
      : compact === "narrow"
        ? "pr-1.5 @max-sm/chathead:pr-1"
        : "pr-1.5",
  );
  const inside = (
    <>
      {topic.emoji ? (
        <span className="text-[10px]">{topic.emoji}</span>
      ) : (
        <TopicMark className="size-3.5 text-[10px]" topic={topic} />
      )}
      {compact !== true && (
        <span
          className={cn(
            "truncate",
            compact === "narrow" && "@max-sm/chathead:hidden",
          )}
        >
          {topic.name}
        </span>
      )}
    </>
  );
  if (!onPick) {
    return (
      <span
        className={className}
        style={topicTint(topicColor(topic))}
        title={compact === false ? undefined : topic.name}
      >
        {inside}
      </span>
    );
  }
  return (
    <button
      className={cn(
        className,
        "hover:bg-(--topic-tint-edge) hover:text-foreground",
      )}
      onAuxClick={stopHere}
      onClick={(event) => {
        stopHere(event);
        onPick();
      }}
      style={topicTint(topicColor(topic))}
      title={compact === false ? "Topics" : topic.name}
      type="button"
    >
      {inside}
    </button>
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
  chatSessionId,
  children,
}: {
  chatSessionId: StoreId.Session;
  children: ReactNode;
}) {
  const appWindow = useWindow();
  const inChat = { group: chatSessionId, ownTab: true, show: true };
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
 * The agent's latest line: the step while it works, in brand; the question
 * while it waits, behind an amber glyph with the words themselves in gray;
 * and the last reply's first words otherwise, in muted. Nothing when an idle
 * chat has said nothing yet. Two lines that clamp.
 */
function Peek({ chat, className }: { chat: Chat; className?: string }) {
  const isWaiting = chat.state === "waiting";
  const isWorking = chat.state === "working";
  if (!chat.latest && !isWaiting && !isWorking) {
    return null;
  }
  return (
    <span
      className={cn(
        "flex items-start gap-1.5 text-[12px] leading-5",
        className,
      )}
    >
      {isWorking ? (
        <WorkingPeek chat={chat} />
      ) : isWaiting ? (
        <>
          <QuestionIcon
            className="mt-[3px] size-3.5 shrink-0 text-warning-700 dark:text-warning-300"
            weight="bold"
          />
          <span className="line-clamp-2 min-w-0 text-foreground/80">
            {chat.latest?.text || "Waiting on you"}
          </span>
        </>
      ) : (
        <span className="line-clamp-2 min-w-0 text-muted-foreground">
          {chat.latest?.text}
        </span>
      )}
    </span>
  );
}

/**
 * The control that files the chat, first in the corner's bar: the topic
 * picker every filing shares. The row keeps its open state, so the bar stays
 * in the flow while the list is up and the list keeps its anchor as it
 * closes.
 */
function TagControl({
  chat,
  isOpen,
  onNewTopic,
  onOpenChange,
  onToggle,
  topics,
}: {
  chat: Chat;
  isOpen: boolean;
  onNewTopic: (name: string) => void;
  onOpenChange: (open: boolean) => void;
  onToggle: (id: string) => void;
  topics: Topic[];
}) {
  return (
    // The list is drawn elsewhere on the page but is this span's in React's
    // eyes, so a pick inside it stops here rather than opening the chat. A
    // right click on the control is the row's, and raises the row's menu
    // like a right click on the words.
    <span className="flex shrink-0" onAuxClick={stopHere} onClick={stopHere}>
      <TopicPicker
        align="end"
        chosen={new Set(chat.topics)}
        isOpen={isOpen}
        onNew={onNewTopic}
        onOpenChange={onOpenChange}
        onToggle={onToggle}
        topics={topics}
      >
        <button
          aria-label="Topics"
          className="grid size-5 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-foreground/8 hover:text-foreground data-[state=open]:bg-foreground/8 data-[state=open]:text-foreground"
          title="Topics"
          type="button"
        >
          <TagIcon className="size-3.5" />
        </button>
      </TopicPicker>
    </span>
  );
}

/**
 * What a working chat is doing: the task at work by its title and under it
 * the step it is on, each held to one line, so the row keeps its height as
 * the step changes with every call; the step line says Instrument is working
 * until the task's first call lands. With no task at work, the chat's own
 * agent is, and the user's message it is answering goes under it.
 */
function WorkingPeek({ chat }: { chat: Chat }) {
  const working = chat.runningTasks.filter((task) => !task.waiting);
  const lead = working.find((task) => task.step) ?? working[0];
  // `brand-shiny-text` is an inline-block, which a parent's truncate cannot
  // shrink, so each line carries its own.
  if (!lead) {
    const status = (
      <span className="brand-shiny-text min-w-0 truncate">
        Instrument is working
      </span>
    );
    // What it is answering under it, so the second line says what the wait
    // is for rather than standing empty until a task starts.
    if (!chat.lastAsk) {
      return status;
    }
    return (
      <span className="flex min-w-0 flex-col">
        {status}
        <span className="min-w-0 truncate text-muted-foreground">
          You: {chat.lastAsk}
        </span>
      </span>
    );
  }
  return (
    <span className="flex min-w-0 flex-col">
      <span className="min-w-0 truncate text-foreground/80">
        {lead.title}
        {working.length > 1 && (
          <span className="text-muted-foreground">
            {" "}
            and {working.length - 1} more
          </span>
        )}
      </span>
      <span className="brand-shiny-text min-w-0 truncate">
        {lead.step ?? "Instrument is working"}
      </span>
    </span>
  );
}
