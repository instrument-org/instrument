import {
  orchestratorRecentsAtom,
  visitedPagesAtom,
} from "@/client/atoms/orchestrator";
import { AppIcon } from "@/client/components/orchestrator/app-icon";
import { computerName } from "@/client/components/orchestrator/computer-name";
import { useOrchestrator } from "@/client/components/orchestrator/context";
import { RecentIcon, SiteIcon } from "@/client/components/orchestrator/sidebar";
import { InstrumentGlyph } from "@/client/components/wordmark";
import { isTypingTarget } from "@/client/lib/is-typing-target";
import { siteFromWords } from "@/client/lib/site-from-words";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import uFuzzy from "@leeoniya/ufuzzy";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { LaptopIcon } from "@phosphor-icons/react/Laptop";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import {
  type ComponentType,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

const SCREENS: {
  icon: ComponentType<{ className?: string }>;
  name: string;
  open: (navigate: ReturnType<typeof useNavigate>) => void;
}[] = [
  {
    icon: LaptopIcon,
    name: computerName(),
    open: (navigate) =>
      void navigate({
        search: { path: "", root: "~" },
        to: "/orchestrator/computer",
      }),
  },
  {
    icon: InstrumentGlyph,
    name: "Tasks",
    open: (navigate) => void navigate({ to: "/orchestrator/tasks" }),
  },
  {
    icon: AppWindowIcon,
    name: "Apps",
    open: (navigate) => void navigate({ to: "/orchestrator/apps" }),
  },
];

const RECENTS_SHOWN = 6;
const TASKS_SHOWN = 5;
const SCREENS_SHOWN = 4;

const fuzzy = new uFuzzy({ intraMode: 1 });

interface OmniRow {
  group: string;
  icon: ReactNode;
  name: string;
  note: string;
  run: () => void;
}

/**
 * The one box that reaches everything: every screen, every app, any site, a
 * task or a place the window has been, and failing those, the conversation.
 * It lives in the row above a new tab, where a browser keeps its address
 * field, so a new tab is the field with nothing in it yet rather than a page
 * with a second field drawn on it.
 */
export function Omnibar({
  initial = "",
  resting,
}: {
  /** What the field says when it is edited: the place, ready to be typed over. */
  initial?: string;
  /**
   * What the field shows until it is pressed: the place, in its own marks.
   * Absent on a new tab, which has nowhere to show and takes the caret at once.
   */
  resting?: ReactNode;
}) {
  const { ask, openPage, taskId } = useOrchestrator();
  const navigate = useNavigate();
  const router = useRouter();
  const recents = useAtomValue(orchestratorRecentsAtom);
  const visited = useAtomValue(visitedPagesAtom);
  const [query, setQuery] = useState(initial);
  const [highlight, setHighlight] = useState(0);
  const [isEditing, setEditing] = useState(resting === undefined);
  // What was typed over the place, which is what the rows answer to; the
  // place itself, left as it was, asks for nothing.
  const typed = query.trim() === initial.trim() ? "" : query.trim();
  const words = typed.toLowerCase();
  const input = useRef<HTMLInputElement>(null);
  // A new tab the user opened should be ready to type in, but this field also
  // appears when a channel with no tabs is switched to, and there the caret
  // belongs in that channel's composer. So it takes the keyboard as it
  // arrives and only while nothing else is holding it.
  useEffect(() => {
    if (resting === undefined && !isTypingTarget(document.activeElement)) {
      input.current?.focus();
    }
    // Once, as the field arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const children = useQuery(
    rpcClient.workspace.orchestrator.children.queryOptions({
      input: { id: taskId },
    }),
  );
  const appList = useQuery(rpcClient.apps.live.list.experimental_liveOptions());
  const catalog = useQuery(rpcClient.apps.catalog.queryOptions());
  // The matcher the model picker uses: typed letters in order, close
  // together, so "lsbn" finds lisbon.md and "pel news" the pelican task.
  const matches = (name: string) =>
    !words || (fuzzy.filter([name], typed)?.length ?? 0) > 0;
  const typedSite = siteFromWords(typed);

  const screens = SCREENS.filter((screen) => matches(screen.name)).slice(
    0,
    words ? SCREENS_SHOWN : SCREENS.length,
  );
  // The apps this workspace has, each opening its page; then what the
  // directory knows, each a request to connect it.
  const known = new Set((appList.data?.apps ?? []).map((app) => app.slug));
  const apps = [
    ...(appList.data?.apps ?? []).map((app) => ({
      name: app.name,
      note: app.standing === "connected" ? "App" : "Setting up",
      run: () => {
        void navigate({
          params: { slug: app.slug },
          to: "/orchestrator/apps/$slug",
        });
      },
      site: app.site,
    })),
    ...(catalog.data ?? [])
      .filter((entry) => !known.has(entry.slug))
      .map((entry) => ({
        name: entry.name,
        note: "Connect",
        run: () => {
          ask(`Connect ${entry.name}`);
          setQuery("");
        },
        site: `https://${entry.domain}`,
      })),
  ].filter((app) => matches(app.name));
  // A task's id is made from its brief, so words in the brief find it too.
  const tasks = (children.data ?? [])
    .filter(
      (child) => matches(child.title) || matches(child.id.replaceAll("-", " ")),
    )
    .slice(0, words ? TASKS_SHOWN : 0);
  // Where the window has been: the screens it landed on and the pages the
  // browser showed, newest first, as one list.
  const wasAt = [
    ...recents.map((entry) => ({
      at: entry.at,
      icon: <RecentIcon recent={entry} />,
      note: { browser: "Page", file: "File", folder: "Folder", task: "Task" }[
        entry.kind
      ],
      run: () => {
        router.history.push(entry.href);
      },
      title: entry.title,
    })),
    ...visited.map((page) => ({
      at: page.at,
      icon: <SiteIcon favicon={page.favicon} url={page.url} />,
      note: "Page",
      run: () => {
        openPage(page.url);
      },
      title: page.title || page.url,
    })),
  ].sort((a, b) => b.at - a.at);
  const recentRows = wasAt
    .filter((entry) => matches(entry.title))
    .slice(0, words ? RECENTS_SHOWN : 0);
  const rows: OmniRow[] = [
    ...(typedSite
      ? [
          {
            group: "Site",
            icon: <GlobeIcon className="size-4" />,
            name: `Open ${typedSite.host}`,
            note: "Site",
            run: () => {
              openPage(typedSite.url);
            },
          },
        ]
      : []),
    // What the words can be used with, first: searching the web and asking
    // the conversation are what typed words most often mean, and the rows
    // that matched them follow.
    ...(words
      ? [
          {
            group: `Use “${typed}” with`,
            icon: <MagnifyingGlassIcon className="size-4" />,
            name: "Search the web",
            note: "Browser",
            run: () => {
              openPage(
                `https://www.google.com/search?q=${encodeURIComponent(typed)}`,
              );
              setQuery("");
            },
          },
          {
            group: `Use “${typed}” with`,
            icon: <InstrumentGlyph className="size-4" />,
            name: "Ask Instrument",
            note: "Agent",
            run: () => {
              ask(typed);
              setQuery("");
            },
          },
        ]
      : []),
    ...screens.map((screen) => ({
      group: "Screens",
      icon: <screen.icon className="size-4" />,
      name: screen.name,
      note: "Screen",
      run: () => {
        screen.open(navigate);
      },
    })),
    ...tasks.map((child) => ({
      group: "Tasks",
      icon: <InstrumentGlyph className="size-4" />,
      name: child.title,
      note: "Task",
      run: () => {
        void navigate({
          params: { id: child.id },
          to: "/orchestrator/tasks/$id",
        });
      },
    })),
    ...recentRows.map((entry) => ({
      group: "Recent",
      icon: entry.icon,
      name: entry.title,
      note: entry.note,
      run: entry.run,
    })),
    ...apps.map((app) => ({
      group: "Apps",
      icon: <AppIcon site={app.site} size="sm" />,
      name: app.name,
      note: app.note,
      run: app.run,
    })),
  ];
  const current = Math.min(highlight, Math.max(0, rows.length - 1));

  return (
    <>
      {isEditing || resting === undefined ? (
        <MagnifyingGlassIcon className="size-3.5 shrink-0 text-muted-foreground" />
      ) : (
        resting
      )}
      <input
        aria-label="Search or ask"
        className={cn(
          "h-full min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground",
          // Kept in the box while the place is shown, so a press on the box
          // has something to put the caret in; it takes the box over on focus.
          !isEditing && resting !== undefined && "absolute inset-0 opacity-0",
        )}
        onBlur={() => {
          if (resting !== undefined) {
            setEditing(false);
            setQuery(initial);
          }
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setHighlight(0);
        }}
        onFocus={(event) => {
          setEditing(true);
          // The place, selected whole, so typing replaces it the way it does
          // in a browser's address bar.
          event.currentTarget.select();
        }}
        onKeyDown={(event) => {
          switch (event.key) {
            case "ArrowDown": {
              event.preventDefault();
              setHighlight((value) => Math.min(rows.length - 1, value + 1));
              break;
            }
            case "ArrowUp": {
              event.preventDefault();
              setHighlight((value) => Math.max(0, value - 1));
              break;
            }
            case "Enter": {
              event.preventDefault();
              rows[current]?.run();
              break;
            }
            case "Escape": {
              if (resting === undefined) {
                setQuery("");
              } else {
                event.currentTarget.blur();
              }
              break;
            }
            // No default
          }
        }}
        placeholder="Search, open a file, or ask Instrument"
        ref={input}
        spellCheck={false}
        type="text"
        value={query}
      />
      {words ? (
        <div className="absolute inset-x-0 top-full z-20 mt-1.5 max-h-[calc(60vh/var(--app-zoom))] overflow-y-auto rounded-xl border border-border bg-popover shadow-lg">
          {rows.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              Nothing by that name.
            </p>
          ) : (
            rows.map((row, index) => (
              <div key={`${row.group}:${row.name}`}>
                {index === 0 || rows[index - 1]?.group !== row.group ? (
                  <p className="px-4 pt-3 pb-1 text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
                    {row.group}
                  </p>
                ) : null}
                <button
                  className={cn(
                    "flex w-full items-center gap-3 px-4 py-2 text-left text-sm",
                    index === current ? "bg-accent" : "hover:bg-accent/50",
                  )}
                  onClick={row.run}
                  onMouseEnter={() => {
                    setHighlight(index);
                  }}
                  // The arrows move the highlight past the list's fold; the
                  // list follows, so the row picked is the row seen.
                  ref={(element) => {
                    if (index === current) {
                      element?.scrollIntoView({ block: "nearest" });
                    }
                  }}
                  type="button"
                >
                  <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
                    {row.icon}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{row.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {row.note}
                  </span>
                </button>
              </div>
            ))
          )}
        </div>
      ) : null}
    </>
  );
}
