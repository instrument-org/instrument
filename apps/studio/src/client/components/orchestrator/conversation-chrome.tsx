import {
  NEW_TAB_HREF,
  screenViewAtom,
  windowTabsAtom,
} from "@/client/atoms/orchestrator";
import { FileIcon } from "@/client/components/file-icon";
import { rpcClient } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { type ReactNode } from "react";

import { useAppsBySlug } from "./apps-by-slug";
import { useOrchestrator } from "./context";
import { screenPresentation } from "./screen-presentation";
import { SiteIcon } from "./sidebar";
import { parseHref } from "./window-tabs";

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
  const appsBySlug = useAppsBySlug();
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
      appsBySlug,
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
