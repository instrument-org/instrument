import {
  orchestratorTabsAtom,
  screenViewAtom,
} from "@/client/atoms/orchestrator";
import { FileSystemFolderGlyph } from "@/client/components/extend/file-system";
import { FileIcon } from "@/client/components/file-icon";
import { PlanningDotIcon } from "@/client/components/icons/planning-dot";
import {
  STEP_RUN,
  TRANSCRIPT_ROW,
} from "@/client/components/message-part/transcript-group";
import { InstrumentGlyph } from "@/client/components/wordmark";
import { hasLiveAgent } from "@/client/lib/agent-status";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { CompassIcon } from "@phosphor-icons/react/Compass";
import { HouseIcon } from "@phosphor-icons/react/House";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import ms from "ms";
import { type ReactNode } from "react";

import { AppIcon } from "./app-icon";
import { computerName } from "./computer-name";
import { useOrchestrator } from "./context";
import { SiteIcon } from "./sidebar";

/** How often the tasks' standing is re-read for the row under the transcript. */
const REFRESH_MS = ms("2 seconds");

/**
 * The row under the last turn while tasks work and the conversation itself
 * is idle: the same shape as the row the agent's own steps take, carrying
 * the latest step of whichever task moved last, so the transcript reads as
 * still going rather than finished.
 */
export function TasksWorkingRow() {
  const { taskId } = useOrchestrator();
  const activity = useQuery(
    rpcClient.workspace.orchestrator.activity.queryOptions({
      input: { id: taskId },
      refetchInterval: REFRESH_MS,
    }),
  );
  const status = useQuery(
    rpcClient.workspace.task.agentStatus.byIds.queryOptions({
      input: { ids: [taskId] },
      refetchInterval: REFRESH_MS,
    }),
  );
  const isThinking = status.data?.some(hasLiveAgent) ?? false;
  const running = activity.data?.running ?? [];
  if (isThinking || running.length === 0) {
    return null;
  }
  const latest = running.find((entry) => entry.step) ?? running[0];
  const doing = latest?.step ?? latest?.title ?? "Working";
  return (
    <div className={STEP_RUN}>
      <div className={cn(TRANSCRIPT_ROW, "animate-in fill-mode-both fade-in")}>
        <PlanningDotIcon />
        <span className="brand-shiny-text truncate text-sm">
          {running.length > 1 ? `${running.length} tasks · ` : ""}
          {doing}
        </span>
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
  const { activeId, tabs } = useAtomValue(orchestratorTabsAtom);
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
        const tab = tabs.find((entry) => entry.id === activeId) ?? tabs[0];
        if (!tab) {
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
        return { icon: <HouseIcon className="size-3.5" />, title: "Home" };
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
