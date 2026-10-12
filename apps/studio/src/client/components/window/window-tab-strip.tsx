import { type WindowTab } from "@/client/atoms/window";
import { useWindowPointStyle } from "@/client/hooks/use-app-zoom";
import { useTargetAgentActivity } from "@/client/hooks/use-target-agent-activity";
import {
  type BrowserTargetId,
  encodeBrowserTargetId,
  type ChatId,
  StoreId,
  WINDOW_ID,
} from "@instrument-org/workspace/client";
import { useEffect, useState } from "react";

import { useAppsBySlug } from "./apps-by-slug";
import { TabIcon } from "./browser-tabs";
import { useComputerVolumes } from "./computer-volumes";
import { pageTabTitle } from "./file-tabs";
import { screenPresentation } from "./screen-presentation";
import { TabStrip } from "./tab-strip";

/**
 * The strip along the top of the window: every tab, whatever it holds, drawn
 * by the shared tab strip. A page carries its site's icon
 * and title; a screen is named for what it is at. A right click on any tab
 * offers to close it.
 */
export function WindowTabStrip({
  chatTitles,
  childTitles,
  groupKey,
  onClose,
  onNew,
  onReorder,
  onSelect,
  selectedId,
  tabs,
}: {
  /** Each chat's title by its id, for a tab standing on one. */
  chatTitles: Map<ChatId, string>;
  childTitles: Map<StoreId.Session, string>;
  /** Which chat's tabs these are, so a swap to another chat's is not drawn as tabs arriving. */
  groupKey: string;
  onClose: (id: string) => void;
  onNew: () => void;
  onReorder: (ids: string[]) => void;
  onSelect: (id: string) => void;
  selectedId: string | undefined;
  tabs: WindowTab[];
}) {
  const appsBySlug = useAppsBySlug();
  const volumes = useComputerVolumes();
  const [menu, setMenu] = useState<{ key: string; x: number; y: number }>();
  const menuStyle = useWindowPointStyle(menu ?? { x: 0, y: 0 });

  useEffect(() => {
    if (!menu) return;
    const close = () => {
      setMenu(undefined);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  // The strip names a tab by the place it keeps, which is the key of the tab
  // that first opened there; the tab itself is found from that.
  const idOf = (key: string) =>
    tabs.find((tab) => (tab.stripKey ?? tab.id) === key)?.id ?? key;
  const menuTab = menu && tabs.find((tab) => tab.id === idOf(menu.key));

  // Which of the window's tabs a task is driving, having been handed it or
  // opened it: those shimmer, keyed by the tab.
  const [driven, setDriven] = useState<ReadonlySet<string>>(new Set());
  const ownPageTabs = tabs.flatMap((tab) =>
    tab.kind === "page" ? [tab.id] : [],
  );
  const reportDriven = (id: string, isDriven: boolean) => {
    setDriven((current) => {
      if (current.has(id) === isDriven) return current;
      const next = new Set(current);
      if (isDriven) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  return (
    <>
      {ownPageTabs.map((id) => (
        <TargetActivityProbe
          key={id}
          onChange={reportDriven}
          tabId={id}
          targetId={encodeBrowserTargetId(
            WINDOW_ID,
            StoreId.SessionSchema.parse(id),
          )}
        />
      ))}
      <TabStrip
        // `min-w-0 flex-1`: the strip measures its own width to decide how
        // many tabs fit, so it has to be told to fill the bar rather than
        // sizing to the tabs it currently holds.
        className="min-w-0 flex-1"
        // Another chat's tabs are another set: the strip adopts them
        // silently rather than sliding each one in.
        groupKey={groupKey}
        onClose={(key) => {
          onClose(idOf(key));
        }}
        onContextMenu={(key, event) => {
          event.preventDefault();
          setMenu({ key, x: event.clientX, y: event.clientY });
        }}
        onNew={onNew}
        onReorder={onReorder}
        onSelect={(key) => {
          onSelect(idOf(key));
        }}
        selectedKey={
          tabs.find((tab) => tab.id === selectedId)?.stripKey ?? selectedId
        }
        tabs={tabs.map((tab) => ({
          key: tab.stripKey ?? tab.id,
          ...(tab.kind === "page"
            ? {
                icon: <TabIcon favicon={tab.favicon} url={tab.url} />,
                isWorking: driven.has(tab.id),
                title: tab.title || pageTabTitle(tab) || "New tab",
              }
            : screenPresentation(tab.href, {
                appsBySlug,
                chatTitles,
                taskTitles: childTitles,
                ...(volumes ? { volumes } : {}),
              })),
        }))}
      />
      {menu && menuTab && (
        <div
          className="fixed z-50 min-w-40 rounded-md border border-border bg-popover p-1 text-sm text-popover-foreground shadow-md"
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          role="menu"
          style={menuStyle}
        >
          <button
            className="flex w-full rounded-sm px-2 py-1.5 text-left hover:bg-accent"
            onClick={() => {
              onClose(menuTab.id);
              setMenu(undefined);
            }}
            role="menuitem"
            type="button"
          >
            Close tab
          </button>
        </div>
      )}
    </>
  );
}

/** Reports whether an agent is driving one guest, for the strip to shimmer its tab by. */
function TargetActivityProbe({
  onChange,
  tabId,
  targetId,
}: {
  onChange: (tabId: string, isDriven: boolean) => void;
  tabId: string;
  targetId: BrowserTargetId;
}) {
  const isDriven = useTargetAgentActivity(targetId);
  useEffect(() => {
    onChange(tabId, isDriven);
  }, [isDriven, onChange, tabId]);
  return null;
}
