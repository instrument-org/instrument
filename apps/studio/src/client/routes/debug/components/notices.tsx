import { createFileRoute } from "@tanstack/react-router";
import { type ComponentType } from "react";

import { getDebugPage } from "../-debug-routes";
import { Alerts } from "../-notices/alerts";
import { ErrorCards } from "../-notices/error-card";
import { ModelNotices } from "../-notices/model-notices";
import { Toasts } from "../-notices/toasts";
import { DebugPageScroller } from "../-page-scroller";
import { DebugTabBar, useDebugTab } from "../-shell";

export const Route = createFileRoute("/debug/components/notices")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: getDebugPage("notices").label }],
  }),
});

/** What each of the page's tabs draws, by the tab's id. */
const tabs: Record<string, ComponentType | undefined> = {
  alerts: Alerts,
  "error-card": ErrorCards,
  "model-notices": ModelNotices,
  toasts: Toasts,
};

function RouteComponent() {
  const Tab = tabs[useDebugTab("notices")] ?? ModelNotices;
  return (
    <div className="flex h-full flex-col">
      <DebugTabBar pageId="notices" />
      <DebugPageScroller className="min-h-0 flex-1 overflow-y-auto">
        <Tab />
      </DebugPageScroller>
    </div>
  );
}
