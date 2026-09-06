import { screenViewAtom, windowTabsAtom } from "@/client/atoms/orchestrator";
import { FileSystemFolderGlyph } from "@/client/components/extend/file-system";
import { FileIcon } from "@/client/components/file-icon";
import { PlanningDotIcon } from "@/client/components/icons/planning-dot";
import { InstrumentGlyph } from "@/client/components/wordmark";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { CompassIcon } from "@phosphor-icons/react/Compass";
import { HouseIcon } from "@phosphor-icons/react/House";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import ms from "ms";
import { type ReactNode, useState } from "react";

import { AppIcon } from "./app-icon";
import { computerName } from "./computer-name";
import { useOrchestrator } from "./context";
import { SiteIcon } from "./sidebar";

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
 * The chip on the composer that says what the conversation can see: the
 * screen that is up, named and drawn the way the sidebar draws it, so the
 * user knows "this" will land where they think before they send.
 */
export function ViewChip() {
  const view = useAtomValue(screenViewAtom);
  const { activeId, tabs } = useAtomValue(windowTabsAtom);
  if (!view) {
    return null;
  }
  const chip = describe();
  if (!chip) {
    return null;
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

  function describe(): undefined | { icon: ReactNode; title: string } {
    if (!view) {
      return;
    }
    switch (view.screen) {
      case "apps": {
        // An app's page is that app; the directory is the screen.
        return view.app
          ? {
              icon: <AppIcon site={view.app.site} size="sm" />,
              title: view.app.name,
            }
          : { icon: <AppWindowIcon className="size-3.5" />, title: "Apps" };
      }
      case "browser": {
        const tab = tabs.find((entry) => entry.id === activeId);
        if (tab?.kind !== "page") {
          return;
        }
        return {
          icon: <SiteIcon favicon={tab.favicon} url={tab.url} />,
          title: tab.title || tab.url || "New tab",
        };
      }
      case "computer": {
        const display = view.folder?.display ?? computerName();
        return {
          icon: <FileSystemFolderGlyph className="h-3 w-auto" />,
          title:
            display === "~" ? "Home" : (display.split("/").at(-1) ?? display),
        };
      }
      case "discover": {
        return {
          icon: <CompassIcon className="size-3.5" />,
          title: "Discover",
        };
      }
      case "file": {
        const name = view.file?.name ?? "File";
        return {
          icon: <FileIcon className="size-3.5" filename={name} />,
          title: name,
        };
      }
      case "home": {
        return { icon: <HouseIcon className="size-3.5" />, title: "New tab" };
      }
      case "task": {
        return {
          icon: <InstrumentGlyph className="size-3.5" />,
          title: view.task?.title ?? "Task",
        };
      }
      case "tasks": {
        return {
          icon: <InstrumentGlyph className="size-3.5" />,
          title: "Tasks",
        };
      }
    }
  }
}

function Chip({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <span
      className="flex h-7 max-w-64 items-center gap-1.5 rounded-lg bg-foreground/5 px-2 text-xs text-muted-foreground"
      title="Instrument sees this when you send"
    >
      <span className="flex size-3.5 shrink-0 items-center justify-center">
        {icon}
      </span>
      <span className="truncate">{title}</span>
    </span>
  );
}
