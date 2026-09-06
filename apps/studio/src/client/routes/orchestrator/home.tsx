import {
  orchestratorRecentsAtom,
  originOf,
  siteFaviconsAtom,
} from "@/client/atoms/orchestrator";
import { useOrchestrator } from "@/client/components/orchestrator/context";
import { useOnScreen } from "@/client/components/orchestrator/on-screen";
import { RecentIcon, SiteIcon } from "@/client/components/orchestrator/sidebar";
import { InstrumentGlyph } from "@/client/components/wordmark";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import uFuzzy from "@leeoniya/ufuzzy";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { LaptopIcon } from "@phosphor-icons/react/Laptop";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { type ComponentType, type ReactNode, useState } from "react";

/**
 * Home: the mark, one box that reaches every screen and every app and, failing
 * those, asks Instrument, and beneath it where the user was last. The box is
 * the wireframes' omnibox; its list is screens, then apps, then the two
 * fallbacks, and typing filters it.
 */
export const Route = createFileRoute("/orchestrator/home")({
  component: HomeRoute,
});

/** Services pinned as web apps; the sidebar's fixtures, reached from here too. */
const APPS = [
  { name: "Gmail", url: "https://mail.google.com/" },
  { name: "Notion", url: "https://www.notion.so/" },
  { name: "Linear", url: "https://linear.app/" },
];

const SCREENS: {
  icon: ComponentType<{ className?: string }>;
  name: string;
  search?: Record<string, string>;
  to: string;
}[] = [
  {
    icon: LaptopIcon,
    name: "This Mac",
    search: { path: "", root: "~" },
    to: "/orchestrator/computer",
  },
  { icon: GlobeIcon, name: "Browser", to: "/orchestrator/browser" },
  { icon: InstrumentGlyph, name: "Tasks", to: "/orchestrator/tasks" },
  { icon: AppWindowIcon, name: "Apps", to: "/orchestrator/apps" },
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

function HomeRoute() {
  const { ask, browser, taskId } = useOrchestrator();
  useOnScreen({ screen: "home" });
  const navigate = useNavigate();
  const router = useRouter();
  const recents = useAtomValue(orchestratorRecentsAtom);
  const places = useQuery(rpcClient.workspace.computer.places.queryOptions());
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const words = query.trim().toLowerCase();

  const children = useQuery(
    rpcClient.workspace.orchestrator.children.queryOptions({
      input: { id: taskId },
    }),
  );
  const siteFavicons = useAtomValue(siteFaviconsAtom);
  // The matcher the model picker uses: typed letters in order, close
  // together, so "lsbn" finds lisbon.md and "pel news" the pelican task.
  const matches = (name: string) =>
    !words || (fuzzy.filter([name], query.trim())?.length ?? 0) > 0;
  const typedSite = siteFromWords(query.trim());

  const screens = SCREENS.filter((screen) => matches(screen.name)).slice(
    0,
    words ? SCREENS_SHOWN : SCREENS.length,
  );
  const apps = APPS.filter((app) => matches(app.name));
  const tasks = (children.data ?? [])
    .filter((child) => matches(child.title))
    .slice(0, words ? TASKS_SHOWN : 0);
  const recentRows = recents
    .filter((entry) => matches(entry.title))
    .slice(0, words ? RECENTS_SHOWN : 0);
  const openSite = (url: string) => {
    browser?.openOrFocus(url);
    void navigate({ to: "/orchestrator/browser" });
  };
  const rows: OmniRow[] = [
    ...(typedSite
      ? [
          {
            group: "Site",
            icon: <GlobeIcon className="size-4" />,
            name: `Open ${typedSite.host}`,
            note: "Site",
            run: () => {
              openSite(typedSite.url);
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
        void navigate({
          search: screen.search ?? {},
          to: screen.to as "/orchestrator/browser",
        });
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
      icon: <RecentIcon recent={entry} />,
      name: entry.title,
      note: { browser: "Page", file: "File", folder: "Folder", task: "Task" }[
        entry.kind
      ],
      run: () => {
        router.history.push(entry.href);
      },
    })),
    ...apps.map((app) => ({
      group: "Apps",
      icon: (
        <SiteIcon
          favicon={siteFavicons[originOf(app.url) ?? ""]}
          url={app.url}
        />
      ),
      name: app.name,
      note: "App",
      run: () => {
        openSite(app.url);
      },
    })),
    ...(words
      ? [
          {
            group: "Or",
            icon: <InstrumentGlyph className="size-4" />,
            name: `Ask Instrument: “${query.trim()}”`,
            note: "Agent",
            run: () => {
              ask(query.trim());
              setQuery("");
            },
          },
          {
            group: "Or",
            icon: <MagnifyingGlassIcon className="size-4" />,
            name: `Search the web for “${query.trim()}”`,
            note: "Browser",
            run: () => {
              openSite(
                `https://www.google.com/search?q=${encodeURIComponent(query.trim())}`,
              );
              setQuery("");
            },
          },
        ]
      : []),
  ];
  const current = Math.min(highlight, Math.max(0, rows.length - 1));

  return (
    <div className="flex h-full min-h-0 flex-col items-center overflow-y-auto px-8 pt-16 pb-10">
      <InstrumentGlyph className="size-9 text-foreground" />
      <div className="relative mt-6 w-full max-w-xl">
        <div className="flex h-11 items-center gap-2 rounded-full border border-border bg-card px-4 shadow-sm focus-within:border-foreground/30">
          <MagnifyingGlassIcon className="size-4 shrink-0 text-muted-foreground" />
          <input
            aria-label="Search or ask"
            autoFocus
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlight(0);
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
                  setQuery("");

                  break;
                }
                // No default
              }
            }}
            placeholder="Search, open, or ask Instrument"
            spellCheck={false}
            type="text"
            value={query}
          />
        </div>
        {words ? (
          <div className="absolute inset-x-0 top-full z-10 mt-2 max-h-[60vh] overflow-y-auto rounded-xl border border-border bg-popover shadow-lg">
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
      </div>

      <div className="mt-10 grid w-full max-w-3xl gap-4 sm:grid-cols-2">
        <button
          className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 text-left shadow-sm hover:bg-accent/30"
          onClick={() => {
            void navigate({
              search: { path: "", root: "~" },
              to: "/orchestrator/computer",
            });
          }}
          type="button"
        >
          <LaptopIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <span className="min-w-0">
            <span className="block text-sm font-medium">This Mac</span>
            <span className="block truncate text-xs text-muted-foreground">
              {places.data?.favorites.map((place) => place.name).join(", ") ??
                "Your folders"}
            </span>
          </span>
        </button>
        <button
          className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 text-left shadow-sm hover:bg-accent/30"
          onClick={() => {
            void navigate({ to: "/orchestrator/tasks" });
          }}
          type="button"
        >
          <InstrumentGlyph className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <span className="min-w-0">
            <span className="block text-sm font-medium">Tasks</span>
            <span className="block truncate text-xs text-muted-foreground">
              What Instrument has done and is doing for you
            </span>
          </span>
        </button>
      </div>

      {recents.length > 0 ? (
        <div className="mt-10 w-full max-w-3xl">
          <p className="text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase">
            Recent
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {recents.slice(0, RECENTS_SHOWN).map((recent) => (
              <li key={recent.href}>
                <button
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-accent/50"
                  onClick={() => {
                    router.history.push(recent.href);
                  }}
                  type="button"
                >
                  <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
                    <RecentIcon recent={recent} />
                  </span>
                  <span className="truncate">{recent.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="sr-only">{taskId}</p>
    </div>
  );
}

/**
 * What typed words are when they are an address: a scheme, or a host with a
 * dot in it and no spaces, the way a browser's own box reads them.
 */
function siteFromWords(
  words: string,
): undefined | { host: string; url: string } {
  if (!words || /\s/.test(words)) {
    return;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(words)
    ? words
    : /^[\w-]+(?:\.[\w-]+)+(?::\d+)?(?:\/.*)?$/.test(words)
      ? `https://${words}`
      : undefined;
  if (!withScheme) {
    return;
  }
  try {
    const url = new URL(withScheme);
    return { host: url.host, url: url.href };
  } catch {
    return;
  }
}
