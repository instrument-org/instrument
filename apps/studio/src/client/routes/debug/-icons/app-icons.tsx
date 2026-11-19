import { AppMention, AppMenuRow } from "@/client/components/app-mention";
import { FaviconFallback } from "@/client/components/favicon";
import {
  AppChipIcon,
  ChipBody,
  INLINE_CHIP_CLASS_NAME,
} from "@/client/components/inline-link";
import {
  ToolCard,
  ToolCardSection,
} from "@/client/components/message-part/tool-card";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { AppIcon } from "@/client/components/window/app-icon";
import { useAppsBySlug } from "@/client/components/window/apps-by-slug";
import { cn } from "@/client/lib/utils";
import { type ReactNode, useState } from "react";

import { DebugState } from "../-shell";

/**
 * Services whose marks have given trouble on one surface or another: dark
 * ink, a square of their own, or a color close to a ground they sit on.
 */
const FEATURED = [
  "gmail",
  "intercom",
  "lucid",
  "similarweb",
  "brex",
  "square",
  "github",
  "notion",
  "slack",
  "linear",
];

/** How many apps a search draws in full, however many match. */
const MAX_FOUND = 6;

type DrawnApp = {
  icon?: string | undefined;
  name: string;
  site?: string | undefined;
  slug: string;
};

/**
 * Every ground a small app icon is drawn on, as the class that paints it. The
 * user bubble's tint is the one `user-message.tsx` gives the chat's bubble.
 * The chip is drawn as the chat draws one, since its class is an inline box
 * that no pill around it can be.
 */
const GROUNDS: { className: string; isChip?: true; label: string }[] = [
  { className: "bg-background", label: "Page" },
  { className: "bg-card", label: "Card" },
  { className: "bg-popover", label: "Menu" },
  { className: INLINE_CHIP_CLASS_NAME, isChip: true, label: "Chip" },
  {
    className:
      "bg-[oklch(from_var(--color-brand-500)_0.85_0.05_h)] dark:bg-[oklch(from_var(--color-brand-500)_0.36_0.06_h)]",
    label: "Chat bubble",
  },
  {
    className: "bg-card button-sheen shadow-sm dark:bg-gray-700",
    label: "Button",
  },
];

const SIZES = ["sm", "md", "lg", "xl"] as const;

/** The Icons page's apps: every surface that draws an app's icon. */
export function AppIconsTab() {
  const appsBySlug = useAppsBySlug();
  const [picked, setPicked] = useState<string[]>(FEATURED);
  const all: DrawnApp[] = [...appsBySlug]
    .map(([slug, app]) => ({ ...app, slug }))
    .toSorted((a, b) => a.name.localeCompare(b.name));
  const chosen = picked.flatMap((slug) => {
    const app = appsBySlug.get(slug);
    return app ? [{ ...app, slug }] : [];
  });

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 p-8">
      <p className="text-sm text-muted-foreground">
        Every surface that draws an app&apos;s icon, with the services picked
        below, then any app you look up on every ground and at every size.
        Switch the theme to check the other one: the themed directory SVGs
        follow the window&apos;s color scheme, so a forced dark panel here would
        not show them truly.
      </p>

      <section className="flex flex-col gap-3">
        <SectionTitle>Shown on the surfaces</SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          {all.map((app) => {
            const on = picked.includes(app.slug);
            return (
              <button
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs",
                  on
                    ? "border-foreground/30 bg-foreground/10 text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
                key={app.slug}
                onClick={() => {
                  setPicked((current) =>
                    on
                      ? current.filter((slug) => slug !== app.slug)
                      : [...current, app.slug],
                  );
                }}
                type="button"
              >
                <AppIcon {...app} size="sm" />
                {app.name}
              </button>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <SectionTitle>Small, on what holds it</SectionTitle>
        <Surface
          id="open-button"
          label="Open button, default variant"
          source="window/app-front.tsx"
        >
          {chosen.map((app) => (
            <Button key={app.slug} size="sm">
              <AppIcon {...app} size="sm" />
              <span className="truncate">Open {app.name}</span>
            </Button>
          ))}
        </Surface>
        <Surface
          id="open-button-bordered"
          label="Open button, bordered"
          source="window/app-front.tsx"
        >
          {chosen.map((app) => (
            <button
              className="inline-flex h-8 shrink-0 items-center gap-2 rounded-lg border border-border bg-card px-2.5 text-xs font-medium text-foreground shadow-xs hover:bg-accent"
              key={app.slug}
              type="button"
            >
              <AppIcon {...app} size="sm" />
              <span className="truncate">Open {app.name}</span>
            </button>
          ))}
        </Surface>
        <Surface
          id="chip-in-reply"
          label="Chip in an assistant reply"
          source="inline-link.tsx"
        >
          <p className="text-sm leading-6">
            {chosen.map((app) => (
              <span key={app.slug}>
                Look in <AppChip app={app} /> for it.{" "}
              </span>
            ))}
          </p>
        </Surface>
        <Surface
          id="chip-in-chat-bubble"
          label="Chip in the chat's user bubble"
          source="user-message.tsx, app-mention.tsx"
        >
          <div className="max-w-xl rounded-2xl rounded-br-md bg-[oklch(from_var(--color-brand-500)_0.85_0.05_h)] px-3.5 py-2 text-sm leading-6 dark:bg-[oklch(from_var(--color-brand-500)_0.36_0.06_h)]">
            {chosen.map((app) => (
              <span key={app.slug}>
                Check <AppMention app={app} />{" "}
              </span>
            ))}
          </div>
        </Surface>
        <Surface
          id="chip-in-task-bubble"
          label="Chip in a task page's user bubble"
          source="user-message.tsx"
        >
          <div className="max-w-xl rounded-xl rounded-tr bg-linear-to-b from-card to-gray-25 px-4 py-3 text-sm leading-6 shadow-sm dark:from-card dark:to-card">
            {chosen.map((app) => (
              <span key={app.slug}>
                Check <AppMention app={app} />{" "}
              </span>
            ))}
          </div>
        </Surface>
        <Surface
          id="slash-menu-rows"
          label="Slash menu rows"
          source="app-mention.tsx"
        >
          <div className="w-64 rounded-lg border bg-popover p-1 text-popover-foreground shadow-float-md">
            {chosen.map((app, index) => (
              <div
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                  index === 0 && "bg-accent text-accent-foreground",
                )}
                key={app.slug}
              >
                <AppMenuRow app={app} ranges={null} />
              </div>
            ))}
          </div>
        </Surface>
        <Surface
          id="menu-rows"
          label="Menu rows: add menu, omnibar, command menu, hold marks"
          source="composer-add-menu.tsx, omnibar.tsx, command-menu.tsx, hold-marks.tsx"
        >
          <div className="w-64 rounded-lg border bg-popover p-1 text-popover-foreground shadow-float-md">
            {chosen.map((app, index) => (
              <div
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                  index === 0 && "bg-accent text-accent-foreground",
                )}
                key={app.slug}
              >
                <AppIcon {...app} size="sm" />
                <span className="min-w-0 flex-1 truncate">{app.name}</span>
              </div>
            ))}
          </div>
        </Surface>
        <Surface
          id="tab-location-row"
          label="Tab and location row"
          source="tab-location-row.tsx, screen-presentation.tsx"
        >
          {chosen.map((app) => (
            <span
              className="inline-flex h-7 items-center gap-1.5 rounded-md bg-muted px-2 text-xs"
              key={app.slug}
            >
              <span className="flex size-3.5 shrink-0 items-center justify-center [&_img]:size-3.5 [&_svg]:size-3.5">
                <AppIcon {...app} size="sm" />
              </span>
              {app.name}
            </span>
          ))}
        </Surface>
      </section>

      <section className="flex flex-col gap-6">
        <SectionTitle>At the larger sizes</SectionTitle>
        <Surface
          id="connect-card"
          label="Connect card in the transcript (md)"
          source="message-part/tool-connect-app.tsx"
        >
          <div className="grid w-full gap-3 md:grid-cols-2">
            {chosen.map((app) => (
              <ToolCard key={app.slug}>
                <ToolCardSection collapsedHeight={320}>
                  <div className="flex items-center gap-3">
                    <AppIcon {...app} />
                    <p className="text-sm font-medium">Connect {app.name}</p>
                  </div>
                </ToolCardSection>
              </ToolCard>
            ))}
          </div>
        </Surface>
        <Surface
          id="app-page-header"
          label="App page header (lg)"
          source="window/app-front.tsx"
        >
          {chosen.map((app) => (
            <div className="flex items-center gap-3" key={app.slug}>
              <AppIcon {...app} size="lg" />
              <h2 className="text-lg font-semibold">{app.name}</h2>
            </div>
          ))}
        </Surface>
        <Surface
          id="apps-home-marks"
          label="Apps and zero-state marks (xl)"
          source="window/apps-home.tsx, window/web-start.tsx"
        >
          {chosen.map((app) => (
            <div
              className="group flex w-24 flex-col items-center gap-1.5 rounded-xl py-2 text-center hover:bg-accent/50"
              key={app.slug}
            >
              <AppIcon
                {...app}
                className="transition-shadow group-hover:shadow-md"
                size="xl"
              />
              <span className="w-full truncate text-[13px] leading-4 font-medium">
                {app.name}
              </span>
            </div>
          ))}
        </Surface>
        <Surface
          id="catalog-tile"
          label="Catalog tile, mark filling its box"
          source="window/apps-home.tsx"
        >
          {chosen.map((app) => (
            <div
              className="flex h-18 w-64 items-center gap-3 rounded-2xl bg-card px-5 shadow-xs"
              key={app.slug}
            >
              <AppIcon {...app} className="size-9 rounded-lg p-0" />
              <span className="truncate text-[15px] leading-snug font-medium">
                {app.name}
              </span>
            </div>
          ))}
        </Surface>
        <Surface
          id="app-without-icon"
          label="No icon anywhere"
          source="window/app-icon.tsx"
        >
          <AppIcon name="Unknown" size="sm" />
          <AppIcon name="Unknown" />
          <AppIcon name="Unknown" size="lg" />
          <AppIcon name="Unknown" size="xl" />
          <FaviconFallback className="size-4" label="example.com" />
        </Surface>
      </section>

      <AppSearch all={all} />
    </div>
  );
}

/** Any app in the catalog, looked up by name, on every ground and size. */
function AppSearch({ all }: { all: DrawnApp[] }) {
  const [filter, setFilter] = useState("");
  const query = filter.trim().toLowerCase();
  const found = query
    ? all.filter(
        (app) =>
          app.name.toLowerCase().includes(query) || app.slug.includes(query),
      )
    : [];
  const shown = found.slice(0, MAX_FOUND);

  return (
    <DebugState id="app-search">
      <section className="flex flex-col gap-4">
        <SectionTitle>Any app, on every ground</SectionTitle>
        <div className="flex flex-wrap items-center gap-3">
          <Input
            className="w-64"
            onChange={(event) => {
              setFilter(event.target.value);
            }}
            placeholder="Find an app"
            value={filter}
          />
          <p className="text-sm text-muted-foreground">
            {foundLine(query, found.length, all.length)}
          </p>
        </div>
        {shown.map((app) => (
          <FoundApp app={app} key={app.slug} />
        ))}
      </section>
    </DebugState>
  );
}

function foundLine(query: string, found: number, total: number): string {
  if (!query) {
    return `Look up any of the ${total} apps in the catalog.`;
  }
  if (found === 0) {
    return "No app matches that.";
  }
  if (found > MAX_FOUND) {
    return `${found} apps match, so here are the first ${MAX_FOUND}.`;
  }
  return found === 1 ? "One app matches." : `${found} apps match.`;
}

function FoundApp({ app }: { app: DrawnApp }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-medium">{app.name}</span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {app.slug}
        </span>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        {GROUNDS.map((ground) => (
          <Labeled key={ground.label} label={ground.label}>
            {ground.isChip ? (
              <span className="text-sm whitespace-nowrap">
                <AppChip app={app} />
              </span>
            ) : (
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border border-border/50 px-2 py-1 text-xs",
                  ground.className,
                )}
              >
                <AppIcon {...app} size="sm" />
                <span className="max-w-20 truncate">{app.name}</span>
              </span>
            )}
          </Labeled>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-4">
        {SIZES.map((size) => (
          <Labeled key={size} label={size}>
            <AppIcon {...app} size={size} />
          </Labeled>
        ))}
      </div>
    </div>
  );
}

/** An app as the chat's inline chip draws it, its box and all. */
function AppChip({ app }: { app: DrawnApp }) {
  return (
    <span className={INLINE_CHIP_CLASS_NAME}>
      <ChipBody icon={<AppChipIcon slug={app.slug} />}>{app.name}</ChipBody>
    </span>
  );
}

function Labeled({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-start gap-1.5">
      {children}
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
      {children}
    </h2>
  );
}

/** One place the app draws icons, named with the file that draws it there. */
function Surface({
  children,
  id,
  label,
  source,
}: {
  children: ReactNode;
  id: string;
  label: string;
  source: string;
}) {
  return (
    <DebugState id={id}>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h3 className="text-sm font-medium">{label}</h3>
          <span className="font-mono text-[11px] text-muted-foreground">
            {source}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">{children}</div>
      </div>
    </DebugState>
  );
}
