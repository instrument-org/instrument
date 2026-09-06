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
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { CompassIcon } from "@phosphor-icons/react/Compass";
import { EyeIcon } from "@phosphor-icons/react/Eye";
import { HouseIcon } from "@phosphor-icons/react/House";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import ms from "ms";
import { type ReactNode } from "react";

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
  const isThinking =
    status.data?.some((entry) =>
      entry.sessionActors.some((actor) => actor.tags.includes("agent.alive")),
    ) ?? false;
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
  return (
    <div className="mb-2 flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
      <EyeIcon className="size-3.5 shrink-0" />
      <span className="flex min-w-0 items-center gap-1.5 rounded-md bg-foreground/5 px-1.5 py-0.5">
        <span className="flex size-3.5 shrink-0 items-center justify-center">
          {chip.icon}
        </span>
        <span className="truncate">{chip.title}</span>
      </span>
    </div>
  );

  function describe(): undefined | { icon: ReactNode; title: string } {
    if (!view) {
      return;
    }
    switch (view.screen) {
      case "apps": {
        return { icon: <AppWindowIcon className="size-3.5" />, title: "Apps" };
      }
      case "browser": {
        const tab = tabs.find((entry) => entry.id === activeId) ?? tabs[0];
        if (!tab) {
          return;
        }
        return {
          icon: <SiteIcon favicon={tab.favicon} />,
          title: tab.title || tab.url || "New tab",
        };
      }
      case "computer": {
        const display = view.folder?.display ?? "This Mac";
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
