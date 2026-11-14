import { useQuery } from "@tanstack/react-query";
import { type ReactNode } from "react";

import { chatListOptions } from "./chat-list-query";
import { hasWords, matchesSearch } from "./chats";
import { GroupRow } from "./group-sidebar";
import { SearchField } from "./search-field";
import { useShell } from "./shell-context";
import {
  lastActiveAt,
  type TabGroup,
  useOpenGroups,
  useTabGroupActions,
} from "./tab-groups";

/**
 * History as a page: every chat and kept draft no window has open, most
 * recently active first, under the day each last had something happen, as
 * the sidebar listed them. A click on one, or its Open, opens it as a tab
 * group of its own at the top of the sidebar, and the window moves to it;
 * this tab stays where it was. The words in the field narrow it, as the
 * sidebar's search does.
 *
 * Showing chats alone, it is the index of every chat, open in a window or
 * not, most recently active first: a click on one brings up its tab, or
 * opens it as History does.
 */
export function HistoryPage({
  onSearch,
  q,
  show,
}: {
  onSearch: (q: string) => void;
  q: string;
  show?: "chats" | undefined;
}) {
  const closed = useOpenGroups().history;
  const chats = useQuery(chatListOptions()).data;
  const history =
    show === "chats"
      ? (chats ?? [])
          .map(
            (chat): TabGroup => ({
              chat,
              group: chat.id,
              kind: "chat",
              pinned: false,
              title: chat.title,
            }),
          )
          .toSorted((a, b) => lastActiveAt(b) - lastActiveAt(a))
      : closed;
  const shell = useShell();
  const groups = useTabGroupActions();
  const projectNames = new Map(
    shell.projects.map((project) => [project.id, project.name]),
  );
  const shown = history.filter((entry) =>
    entry.kind === "chat"
      ? matchesSearch(entry.chat, q, projectNames) ||
        (entry.name !== undefined && hasWords(q, [entry.name]))
      : hasWords(q, [
          entry.title,
          entry.kind === "draft" ? entry.draft.words : "",
          entry.name ?? "",
        ]),
  );
  const open = (entry: TabGroup) => {
    groups.restore(entry);
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
            {show === "chats" ? "Chats" : "History"}
          </h1>
          <div className="flex min-w-48 flex-1">
            <SearchField
              label={show === "chats" ? "Search chats" : "Search history"}
              onChange={onSearch}
              placeholder={show === "chats" ? "Search chats" : "Search history"}
              value={q}
            />
          </div>
        </div>
        {history.length === 0 ? (
          <p className="py-2 text-[13px] text-muted-foreground">
            {show === "chats"
              ? "Your chats show up here."
              : "Tab groups you close show up here."}
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
              // The row opens on a click anywhere on it; its Open button
              // says so on hover.
              <div
                className="rounded-lg"
                key={entry.group}
                onClick={() => {
                  open(entry);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    open(entry);
                  }
                }}
                role="presentation"
              >
                <GroupRow
                  chatTitles={shell.chatTitles}
                  entry={entry}
                  isUp={false}
                  restore={() => {
                    open(entry);
                  }}
                />
              </div>
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
  history: TabGroup[];
  row: (entry: TabGroup) => ReactNode;
}) {
  const days = new Map<string, TabGroup[]>();
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
