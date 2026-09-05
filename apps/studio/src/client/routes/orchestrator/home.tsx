import { orchestratorRecentsAtom } from "@/client/atoms/orchestrator";
import { useOrchestrator } from "@/client/components/orchestrator/context";
import { InstrumentGlyph } from "@/client/components/wordmark";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { FileIcon } from "@phosphor-icons/react/File";
import { FolderIcon } from "@phosphor-icons/react/Folder";
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
import { type ComponentType, useState } from "react";

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

const RECENT_ICONS = {
  browser: GlobeIcon,
  file: FileIcon,
  folder: FolderIcon,
  task: InstrumentGlyph,
};

function HomeRoute() {
  const { ask, taskId } = useOrchestrator();
  const navigate = useNavigate();
  const router = useRouter();
  const recents = useAtomValue(orchestratorRecentsAtom);
  const places = useQuery(rpcClient.workspace.computer.places.queryOptions());
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const words = query.trim().toLowerCase();

  const screens = SCREENS.filter(
    (screen) => !words || screen.name.toLowerCase().includes(words),
  );
  const apps = APPS.filter(
    (app) => !words || app.name.toLowerCase().includes(words),
  );
  const rows: {
    group: string;
    icon: ComponentType<{ className?: string }>;
    name: string;
    note: string;
    run: () => void;
  }[] = [
    ...screens.map((screen) => ({
      group: "Screens",
      icon: screen.icon,
      name: screen.name,
      note: "Screen",
      run: () => {
        void navigate({
          search: screen.search ?? {},
          to: screen.to as "/orchestrator/browser",
        });
      },
    })),
    ...apps.map((app) => ({
      group: "Apps",
      icon: GlobeIcon,
      name: app.name,
      note: "App",
      run: () => {
        void navigate({
          search: { url: app.url },
          to: "/orchestrator/browser",
        });
      },
    })),
    ...(words
      ? [
          {
            group: "Or",
            icon: InstrumentGlyph,
            name: `Ask Instrument: “${query.trim()}”`,
            note: "Agent",
            run: () => {
              ask(query.trim());
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
          <div className="absolute inset-x-0 top-full z-10 mt-2 overflow-hidden rounded-xl border border-border bg-popover shadow-lg">
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
                    <row.icon className="size-4 shrink-0 text-muted-foreground" />
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
            {recents.slice(0, RECENTS_SHOWN).map((recent) => {
              const Icon = RECENT_ICONS[recent.kind];
              return (
                <li key={recent.href}>
                  <button
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-accent/50"
                    onClick={() => {
                      router.history.push(recent.href);
                    }}
                    type="button"
                  >
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{recent.title}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      <p className="sr-only">{taskId}</p>
    </div>
  );
}
