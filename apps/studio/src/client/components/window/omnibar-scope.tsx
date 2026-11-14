import { EntryIcon } from "@/client/components/activity/activity-icons";
import { useModelName } from "@/client/components/activity/activity-requests";
import {
  entriesShown,
  entryText,
  timelineOf,
} from "@/client/components/activity/activity-timeline";
import { type SettingsTab } from "@/client/atoms/settings-modal";
import { memoryMatches } from "@/client/components/settings/memory-groups";
import { settingsHrefOf } from "@/client/components/settings/settings-href";
import { useSettingsSearch } from "@/client/components/settings/use-settings-search";
import { useSettingsTabs } from "@/client/components/settings/use-settings-tabs";
import { AppIcon } from "@/client/components/window/app-icon";
import { useAppsBySlug } from "@/client/components/window/apps-by-slug";
import { matchSkills } from "@/client/lib/skill-search";
import { cn, osConventions } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { fileHref, folderHref } from "@/shared/computer-href";
import { SCREENS } from "@/shared/instrument-screens";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { useQuery } from "@tanstack/react-query";
import {
  type ReactNode,
  type Ref,
  useContext,
  useImperativeHandle,
} from "react";

import { AppMark } from "./app-chip";
import { chatListOptions } from "./chat-list-query";
import { hasWords, matchesSearch } from "./chats";
import { matchNames } from "./omnibar-match";
import { ShellContext } from "./shell-context";
import { type FieldScope, type TabLocation } from "./tab-location";
import { useOpenGroups } from "./tab-groups";
import { CHATS_INDEX_HREF, chatHref } from "./window-href";

/** One row under the address field: what the words in it could mean. */
export interface OmniRow {
  /** Muted after the name: a page's address, what Enter does with the words. */
  detail?: string | undefined;
  /**
   * What the field says while the row is picked with the arrows, and what Tab
   * writes into it to go on typing from there: a page's address, a folder's
   * path ending in a separator.
   */
  fill?: string;
  icon: ReactNode;
  /** What the row stands for, unique across the list: the key React keeps its element by. */
  id: string;
  /**
   * Whether the row puts the field away itself, once it knows it has gone
   * somewhere: a path is looked for first, and the words stay when nothing is
   * there.
   */
  leavesItself?: boolean;
  name: string;
  run: () => void;
}

/** What a scoped field says it is for, empty and to a screen reader. */
export const SCOPE_PROMPTS: Record<FieldScope, string> = {
  activity: "Search activity",
  apps: "Search apps",
  chat: "Search chats",
  history: "Search history",
  memory: "Search memories",
  settings: "Search settings",
  skills: "Search skills",
};

/** Rows past which a scope's list stops, before its search row: enough to choose from, few enough to read. */
const SCOPE_ROWS_SHOWN = 6;

/** How many of each Activity log the field searches: the newest, which the page opens with too. */
const ACTIVITY_READ = 200;

/** The pages Settings' search reaches that are pages of their own. */
const PAGES_OF_THEIR_OWN: SettingsTab[] = ["Memory", "Skills"];

/**
 * What the field does with a row: takes this tab somewhere (`visit`, which
 * walks a chat's tab nowhere and opens right after it instead), or asks the
 * window for something wherever it is (`openScreen`).
 */
interface ScopeOpeners {
  openScreen: (href: string) => void;
  visit: (href: string) => void;
}

/**
 * The rows of a field searching one app, for the words typed: the app's own
 * entries that match, best first, then, for a page that keeps its search in
 * its address, the search itself on that page. A row does what pressing
 * that entry on its page does: a chat comes up where it is open, and opens
 * as History opens it otherwise, except from a chat's own field, where it
 * opens as a tab right after that chat; a part of Settings, an Activity row,
 * a memory, a skill or an app goes in this tab.
 *
 * Mounted only while the list shows, so nothing is read for a field at
 * rest.
 */
function useScopeRows({
  location,
  open,
  scope,
  words,
}: {
  location: TabLocation;
  open: ScopeOpeners;
  scope: FieldScope;
  words: string;
}): { empty?: string; rows: OmniRow[] } {
  const typed = words.trim();
  const shell = useContext(ShellContext);
  const { history } = useOpenGroups();
  const chats = useQuery({
    ...chatListOptions(),
    enabled: scope === "chat",
  }).data;
  const settingsTabs = useSettingsTabs();
  const settings = useSettingsSearch({
    query: scope === "settings" ? typed : "",
    tabs: [...settingsTabs, ...PAGES_OF_THEIR_OWN],
  });
  const activity = useActivityEntries(scope === "activity" ? typed : "");
  const memories = useQuery(
    rpcClient.workspace.memory.live.list.experimental_liveOptions({
      enabled: scope === "memory",
    }),
  ).data?.memories;
  const skills = useQuery(
    rpcClient.workspace.skill.list.queryOptions({
      enabled: scope === "skills",
      input: { fileCounts: true },
    }),
  ).data;
  const appsBySlug = useAppsBySlug();

  const searchRow = (name: string, href: string): OmniRow => ({
    icon: <MagnifyingGlassIcon className="size-4" />,
    id: "scope-search",
    name,
    run: () => {
      open.visit(href);
    },
  });
  const searched = `q=${encodeURIComponent(typed)}`;
  const projectNames = new Map(
    (shell?.projects ?? []).map((project) => [project.id, project.name]),
  );

  switch (scope) {
    case "activity": {
      return {
        rows: [
          ...activity.slice(0, SCOPE_ROWS_SHOWN).map(
            ({ entry, text }): OmniRow => ({
              detail: text.title ? text.context : undefined,
              icon: <EntryIcon className="size-4" entry={entry} />,
              id: `activity:${entry.id}`,
              name: text.title || text.context,
              run: () => {
                open.visit(
                  `${SCREENS.activity.href}?item=${encodeURIComponent(entry.id)}`,
                );
              },
            }),
          ),
          searchRow(
            `Search activity for “${typed}”`,
            `${SCREENS.activity.href}?${searched}`,
          ),
        ],
      };
    }
    case "apps": {
      const matched = matchNames(
        typed,
        [...appsBySlug],
        ([, app]) => app.name,
      ).slice(0, SCOPE_ROWS_SHOWN);
      return {
        empty: `No apps match “${typed}”.`,
        rows: matched.map(([slug, app]) => ({
          icon: (
            <AppIcon
              icon={app.icon}
              name={app.name}
              site={app.site}
              size="sm"
            />
          ),
          id: `app:${slug}`,
          name: app.name,
          run: () => {
            open.visit(`/apps/${slug}`);
          },
        })),
      };
    }
    case "chat": {
      const closed = new Set(
        history.flatMap((entry) =>
          entry.kind === "chat" ? [entry.chat.id] : [],
        ),
      );
      const found = (chats ?? [])
        .filter((chat) => matchesSearch(chat, typed, projectNames))
        .toSorted((a, b) => b.lastUserMessageAt - a.lastUserMessageAt)
        .slice(0, SCOPE_ROWS_SHOWN);
      return {
        rows: [
          ...found.map(
            (chat): OmniRow => ({
              detail:
                chat.project === undefined
                  ? undefined
                  : projectNames.get(chat.project),
              icon: <AppMark app="chat" className="size-4" />,
              id: `chat:${chat.id}`,
              name: chat.title,
              run: () => {
                if (closed.has(chat.id) && location.kind === "chat") {
                  open.visit(chatHref(chat.id));
                } else {
                  open.openScreen(chatHref(chat.id));
                }
              },
            }),
          ),
          searchRow(
            `Search chats for “${typed}”`,
            `${CHATS_INDEX_HREF}&${searched}`,
          ),
        ],
      };
    }
    case "history": {
      const found = history
        .filter((entry) =>
          entry.kind === "chat"
            ? matchesSearch(entry.chat, typed, projectNames)
            : hasWords(typed, [
                entry.title,
                entry.kind === "draft" ? entry.draft.words : "",
              ]),
        )
        .slice(0, SCOPE_ROWS_SHOWN);
      return {
        rows: [
          ...found.map(
            (entry): OmniRow => ({
              detail: entry.kind === "draft" ? "Draft" : undefined,
              icon: <AppMark app="chat" className="size-4" />,
              id: `history:${entry.group}`,
              name: entry.title,
              run: () => {
                if (entry.kind === "chat") {
                  open.openScreen(chatHref(entry.chat.id));
                } else if (entry.kind === "draft") {
                  shell?.showDraft(entry.draft.id);
                }
              },
            }),
          ),
          searchRow(
            `Search history for “${typed}”`,
            `${SCREENS.history.href}?${searched}`,
          ),
        ],
      };
    }
    case "memory": {
      const found = (memories ?? [])
        .filter((memory) => memoryMatches(memory, typed))
        .slice(0, SCOPE_ROWS_SHOWN);
      return {
        empty: `No memories match “${typed}”.`,
        rows: found.map((memory) => ({
          detail: memory.text.split("\n").find((line) => line.trim() !== ""),
          icon: <AppMark app="memory" className="size-4" />,
          id: `memory:${memory.name}`,
          name: memory.name,
          run: () => {
            open.visit(fileHref(memory.path));
          },
        })),
      };
    }
    case "settings": {
      const part = location.kind === "builtin" ? location.part : undefined;
      const section = (part ?? "General").toLowerCase();
      return {
        rows: [
          ...settings.matches.slice(0, SCOPE_ROWS_SHOWN).map(
            ({ entry }): OmniRow => ({
              detail: entry.page ? undefined : entry.tab,
              icon: (
                <AppMark
                  app={
                    entry.tab === "Memory"
                      ? "memory"
                      : entry.tab === "Skills"
                        ? "skills"
                        : "settings"
                  }
                  className="size-4"
                />
              ),
              id: `setting:${entry.id}`,
              name: entry.title,
              run: () => {
                open.visit(
                  settingsHrefOf(
                    entry.page ? { tab: entry.tab } : { setting: entry.id },
                  ),
                );
              },
            }),
          ),
          searchRow(
            `Search settings for “${typed}”`,
            `/settings/${section}?${searched}`,
          ),
        ],
      };
    }
    case "skills": {
      const found = matchSkills(skills ?? [], typed, {
        limit: SCOPE_ROWS_SHOWN,
        scope: "name-and-description",
      });
      return {
        empty: `No skills match “${typed}”.`,
        rows: found.map(({ skill }) => ({
          detail: skill.description,
          icon: <AppMark app="skills" className="size-4" />,
          id: `skill:${skill.id}`,
          name: skill.name,
          run: () => {
            open.visit(folderHref(skill.path));
          },
        })),
      };
    }
  }
}

/**
 * The newest of what Activity keeps, both logs, that has the words in it,
 * with what each row says: what the field offers searching Activity. Read
 * only while there are words.
 */
function useActivityEntries(words: string) {
  const modelName = useModelName();
  const isOn = words !== "";
  const actions = useQuery(
    rpcClient.actions.list.queryOptions({
      enabled: isOn,
      input: { limit: ACTIVITY_READ, since: 0 },
    }),
  ).data?.actions;
  const requests = useQuery(
    rpcClient.workspace.activity.list.queryOptions({
      enabled: isOn,
      input: {
        filter: {},
        limit: ACTIVITY_READ,
        offset: 0,
        sort: { column: "startedAt", direction: "desc" },
      },
    }),
  ).data;
  if (!isOn) {
    return [];
  }
  const textWords = { trash: osConventions().trash };
  const { entries } = timelineOf({
    actions: { complete: true, items: actions ?? [] },
    requests: { complete: true, items: requests ?? [] },
    view: "all",
  });
  return entriesShown(entries, {
    modelName,
    q: words,
    show: undefined,
    words: textWords,
  }).map((entry) => ({
    entry,
    text: entryText(entry, { modelName, words: textWords }),
  }));
}

/** What the field asks of a scoped list while its caret is in the box. */
export interface ScopeListHandle {
  /** The rows as they stand, which the arrows and Enter go by. */
  rows: () => OmniRow[];
}

/**
 * The list under a field searching one app (`FieldScope`): the rows for the
 * words typed, the arrows' pick lit. The field keeps the pick and the keys;
 * the list says what rows there are through `ref`.
 */
export function ScopeList({
  current,
  id,
  location,
  onRun,
  open,
  ref,
  scope,
  words,
}: {
  current: number;
  id: string;
  location: TabLocation;
  onRun: (row: OmniRow) => void;
  open: ScopeOpeners;
  ref: Ref<ScopeListHandle>;
  scope: FieldScope;
  words: string;
}) {
  const { empty, rows } = useScopeRows({ location, open, scope, words });
  useImperativeHandle(ref, () => ({ rows: () => rows }), [rows]);
  return (
    <OmniList
      current={Math.min(current, Math.max(0, rows.length - 1))}
      empty={empty}
      id={id}
      onRun={onRun}
      rows={rows}
    />
  );
}

/**
 * The rows under the address field, the one the arrows are on lit. A press
 * on a row must not take the caret first: the box would blur, the list
 * would go, and the click would land on nothing.
 */
export function OmniList({
  current,
  empty,
  id,
  notice,
  onRun,
  rows,
}: {
  current: number;
  empty?: string | undefined;
  id: string;
  /** What is said over the rows: why a path typed led nowhere. */
  notice?: ReactNode;
  onRun: (row: OmniRow) => void;
  rows: OmniRow[];
}) {
  if (rows.length === 0 && !empty && !notice) {
    return null;
  }
  return (
    <div
      className="absolute inset-x-0 top-full z-20 mt-1.5 max-h-[calc(60vh/var(--app-zoom))] overflow-y-auto rounded-xl border border-border bg-popover py-1 shadow-float-lg"
      id={id}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      role="listbox"
    >
      {notice ? (
        <p className="px-3 py-2 text-sm text-muted-foreground">{notice}</p>
      ) : null}
      {rows.length === 0 ? (
        <p className="px-3 py-2 text-sm text-muted-foreground">{empty}</p>
      ) : (
        rows.map((row, index) => (
          <button
            aria-selected={index === current}
            className={cn(
              "flex h-8 w-full items-center gap-2.5 px-3 text-left text-sm",
              index === current ? "bg-accent" : "hover:bg-accent/50",
            )}
            id={`${id}-${index}`}
            key={row.id}
            onClick={() => {
              onRun(row);
            }}
            // The arrows move the highlight past the list's fold; the
            // list follows, so the row picked is the row seen.
            ref={(element) => {
              if (index === current) {
                element?.scrollIntoView({ block: "nearest" });
              }
            }}
            role="option"
            tabIndex={-1}
            type="button"
          >
            <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
              {row.icon}
            </span>
            <span className="min-w-0 flex-1 truncate">
              {row.name}
              {row.detail ? (
                <span className="ml-2 text-xs text-muted-foreground">
                  {row.detail}
                </span>
              ) : null}
            </span>
          </button>
        ))
      )}
    </div>
  );
}
