import { cn } from "@/client/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { type ReactNode } from "react";

import { chatListOptions } from "./chat-list-query";
import { Peek } from "./chat-row";
import { hasWords, matchesSearch } from "./chats";
import { SearchField } from "./search-field";
import { useShell } from "./shell-context";
import {
  type HistoryEntry,
  historyKeyOf,
  historyTitleOf,
  lastActiveAt,
  useOpenGroups,
} from "./tab-groups";
import { chatHref, newChatHref } from "./window-href";

/**
 * History as a page: every chat and kept draft no window has open, most
 * recently active first, under the day each last had something happen, as
 * the sidebar listed them. A click on one, or its Open, opens it in this
 * tab, as a link would, and back returns here. The words in the field
 * narrow it.
 *
 * Showing chats alone, it is the index of every chat, open in a window or
 * not, most recently active first: a click on one opens it here as History
 * does, whatever tabs it has already. Its field is the one the chord for searching
 * chats puts the caret in (`data-chats-search`).
 */
export function HistoryPage({
  onSearch,
  project,
  q,
  show,
}: {
  onSearch: (q: string) => void;
  /** Only what is filed under this project, by its id. */
  project?: string;
  q: string;
  show?: "chats" | undefined;
}) {
  const closed = useOpenGroups().history;
  const chats = useQuery(chatListOptions()).data;
  const history =
    show === "chats"
      ? (chats ?? [])
          .map((chat): HistoryEntry => ({ chat, kind: "chat" }))
          .toSorted((a, b) => lastActiveAt(b) - lastActiveAt(a))
      : closed;
  const shell = useShell();
  const router = useRouter();
  const projectNames = new Map(
    shell.projects.map((each) => [each.id, each.name]),
  );
  const filed = history.filter(
    (entry) =>
      project === undefined ||
      (entry.kind === "chat"
        ? entry.chat.project === project
        : entry.draft.projectId === project),
  );
  const shown = filed.filter((entry) =>
    entry.kind === "chat"
      ? matchesSearch(entry.chat, q, projectNames)
      : hasWords(q, [entry.draft.words]),
  );
  const projectName =
    project === undefined ? undefined : projectNames.get(project);
  const open = (entry: HistoryEntry) => {
    router.history.push(
      entry.kind === "chat"
        ? chatHref(entry.chat.id)
        : newChatHref(entry.draft.id),
    );
  };
  return (
    // The page is worked from its content, which the keys scroll.
    <main
      className="@container/history h-full min-h-0 overflow-y-auto bg-background outline-none"
      data-keyboard-home
      tabIndex={-1}
    >
      <div className="mx-auto flex max-w-2xl flex-col gap-3 p-4 @min-[640px]/history:p-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="mr-1 text-base font-semibold">
            {projectName ?? (show === "chats" ? "Chats" : "History")}
          </h1>
          <div
            className="flex min-w-48 flex-1"
            data-chats-search={show === "chats" ? "" : undefined}
          >
            <SearchField
              label={show === "chats" ? "Search chats" : "Search history"}
              onChange={onSearch}
              placeholder={show === "chats" ? "Search chats" : "Search history"}
              value={q}
            />
          </div>
        </div>
        {filed.length === 0 ? (
          <p className="py-2 text-[13px] text-muted-foreground">
            {projectName !== undefined
              ? "Chats filed under this project show up here."
              : show === "chats"
                ? "Your chats show up here."
                : "Chats you close show up here."}
          </p>
        ) : shown.length === 0 ? (
          <p className="py-2 text-[13px] text-muted-foreground">
            {show === "chats"
              ? `No chats match “${q}”.`
              : `Nothing in History matches “${q}”.`}
          </p>
        ) : (
          <HistoryList
            history={shown}
            row={(entry) => (
              <HistoryRow
                entry={entry}
                key={historyKeyOf(entry)}
                onOpen={() => {
                  open(entry);
                }}
              />
            )}
          />
        )}
      </div>
    </main>
  );
}

/** The chats and drafts in History, most recently active first, under the day each last had something happen. */
function HistoryList({
  history,
  row,
}: {
  history: HistoryEntry[];
  row: (entry: HistoryEntry) => ReactNode;
}) {
  const days = new Map<string, HistoryEntry[]>();
  for (const entry of history) {
    const day = dayLabel(lastActiveAt(entry));
    days.set(day, [...(days.get(day) ?? []), entry]);
  }
  return (
    <>
      {[...days].map(([day, entries]) => (
        <div className="flex flex-col gap-0.5" key={day}>
          <p className="px-2.5 pt-3 pb-1 text-xs font-medium text-muted-foreground">
            {day}
          </p>
          {entries.map(row)}
        </div>
      ))}
    </>
  );
}

/**
 * One chat or draft in History as two lines: its title, bold while the chat
 * has something not yet seen; then the chat's latest line, or "Draft". It
 * opens on a click anywhere on it, and its Open button says so on hover.
 */
function HistoryRow({
  entry,
  onOpen,
}: {
  entry: HistoryEntry;
  onOpen: () => void;
}) {
  const isUnread = entry.kind === "chat" && entry.chat.unread;
  return (
    <div
      className="group/row flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-foreground/[0.04]"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          onOpen();
        }
      }}
      role="presentation"
    >
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "h-5 truncate text-[13px] leading-5",
            isUnread
              ? "font-semibold text-foreground"
              : "font-medium text-foreground/85",
          )}
        >
          {historyTitleOf(entry)}
        </p>
        <div className="flex h-5 min-w-0 items-center">
          {entry.kind === "chat" ? (
            <Peek chat={entry.chat} />
          ) : (
            <span className="text-[12px] leading-5 text-muted-foreground">
              Draft
            </span>
          )}
        </div>
      </div>
      <button
        className="ml-auto flex h-6 shrink-0 items-center rounded-md bg-background px-2 text-xs font-medium opacity-0 shadow-xs ring-1 ring-border group-hover/row:opacity-100 focus-visible:opacity-100"
        onClick={(event) => {
          event.stopPropagation();
          onOpen();
        }}
        type="button"
      >
        Open
      </button>
    </div>
  );
}

function dayLabel(at: number): string {
  const day = new Date(at);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (day.toDateString() === today.toDateString()) {
    return "Today";
  }
  if (day.toDateString() === yesterday.toDateString()) {
    return "Yesterday";
  }
  return day.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    ...(day.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  });
}
