import {
  NEW_TAB_HREF,
  screenViewAtom,
  windowTabsAtom,
} from "@/client/atoms/orchestrator";
import { FileIcon } from "@/client/components/file-icon";
import { PlanningDotIcon } from "@/client/components/icons/planning-dot";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import ms from "ms";
import { type ReactNode, useState } from "react";

import { useOrchestrator } from "./context";
import { screenPresentation } from "./screen-presentation";
import { SiteIcon } from "./sidebar";
import { parseHref } from "./window-tabs";

/** How often the tasks' standing is re-read for the row under the transcript. */
const REFRESH_MS = ms("2 seconds");

/**
 * The banner between the transcript and the composer while tasks work: the
 * place they are followed from, since inline cards scroll away. Shut, it is
 * one shimmering line carrying the latest step of whichever task moved last;
 * open, every running task with its step, each a way to its screen.
 */
export function TasksWorkingRow() {
  const { openScreen, taskId } = useOrchestrator();
  const [isOpen, setIsOpen] = useState(false);
  const activity = useQuery(
    rpcClient.workspace.orchestrator.activity.queryOptions({
      input: { id: taskId },
      refetchInterval: REFRESH_MS,
    }),
  );
  const running = activity.data?.running ?? [];
  if (running.length === 0) {
    return null;
  }
  const latest = running.find((entry) => entry.step) ?? running[0];
  const doing = latest?.step ?? latest?.title ?? "Working";
  // One task has nothing to fold: the banner is that task's row, and a click
  // is a way to its screen.
  const only = running.length === 1 ? running[0] : undefined;
  if (only) {
    return (
      <div className="mx-auto w-full max-w-3xl px-3 pb-1">
        <button
          className="flex w-full items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-left text-sm hover:bg-accent/50"
          onClick={() => {
            openScreen(`/orchestrator/tasks/${only.taskId}`);
          }}
          type="button"
        >
          <PlanningDotIcon />
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium">{only.title}</span>
            <span className="brand-shiny-text">
              {" "}
              · {only.step ?? "Working"}
            </span>
          </span>
        </button>
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-3xl px-3 pb-1">
      <div className="rounded-lg border border-border bg-background text-sm">
        <button
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left"
          onClick={() => {
            setIsOpen((open) => !open);
          }}
          type="button"
        >
          <PlanningDotIcon />
          <span className="brand-shiny-text min-w-0 flex-1 truncate">
            {running.length > 1 ? `${running.length} tasks · ` : ""}
            {doing}
          </span>
          <CaretRightIcon
            className={cn(
              "size-3 shrink-0 text-muted-foreground transition-transform",
              isOpen && "rotate-90",
            )}
          />
        </button>
        {isOpen && (
          <ul className="flex flex-col border-t border-border py-1">
            {running.map((entry) => (
              <li key={entry.taskId}>
                <button
                  className="flex w-full flex-col px-3 py-1 text-left hover:bg-accent/50"
                  onClick={() => {
                    openScreen(`/orchestrator/tasks/${entry.taskId}`);
                  }}
                  type="button"
                >
                  <span className="truncate font-medium">{entry.title}</span>
                  <span className="brand-shiny-text truncate text-xs">
                    {entry.step ?? "Working"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * The chip on the composer that says what the conversation can see: the tab
 * on screen, named and drawn exactly as the strip draws it, so the user knows
 * "this" will land where they think before they send. A new tab is no chip:
 * the conversation is told, but there is nothing there worth reminding the
 * user of.
 */
export function ViewChip() {
  const view = useAtomValue(screenViewAtom);
  const { activeId, tabs } = useAtomValue(windowTabsAtom);
  const { taskId } = useOrchestrator();
  const apps = useQuery(rpcClient.apps.live.list.experimental_liveOptions());
  const children = useQuery(
    rpcClient.workspace.orchestrator.children.queryOptions({
      input: { id: taskId },
    }),
  );
  if (!view) {
    return null;
  }
  const active = tabs.find((tab) => tab.id === activeId);
  if (!active) {
    return null;
  }
  let chip: { icon: ReactNode; title: string };
  if (active.kind === "page") {
    chip = {
      icon: <SiteIcon favicon={active.favicon} url={active.url} />,
      title: active.title || active.url || "New tab",
    };
  } else {
    if (parseHref(active.href).pathname === parseHref(NEW_TAB_HREF).pathname) {
      return null;
    }
    chip = screenPresentation(active.href, {
      appsBySlug: new Map(
        (apps.data?.apps ?? []).map((app) => [
          app.slug,
          { name: app.name, site: app.site },
        ]),
      ),
      childTitles: new Map(
        children.data?.map((child) => [child.id, child.title]) ?? [],
      ),
    });
  }
  // The folder, and then what is selected in it: "this" is the selection
  // when there is one, and the chip says so.
  const selected =
    view.screen === "computer" ? (view.folder?.selected ?? []).slice(0, 2) : [];
  return (
    <>
      <Chip icon={chip.icon} title={chip.title} />
      {selected.map((name) => (
        <Chip
          icon={<FileIcon className="size-3.5" filename={name} />}
          key={name}
          title={name}
        />
      ))}
    </>
  );
}

function Chip({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <span
      // `min-w-0`: a flex item's floor is its content, and a chip that cannot
      // shrink walks over whatever shares its row.
      className="flex h-7 max-w-64 min-w-0 items-center gap-1.5 rounded-lg bg-foreground/5 px-2 text-xs text-muted-foreground"
      title="Instrument sees this when you send"
    >
      <span className="flex size-3.5 shrink-0 items-center justify-center">
        {icon}
      </span>
      <span className="truncate">{title}</span>
    </span>
  );
}
