import { createFileRoute } from "@tanstack/react-router";

import { getDebugPage } from "../-debug-routes";
import { AppIconsTab } from "../-icons/app-icons";
import { FileIconsTab } from "../-icons/file-icons";
import { ProviderIconsTab } from "../-icons/provider-icons";
import { DebugPageScroller } from "../-page-scroller";
import { DebugTabBar, useDebugTab } from "../-shell";

export const Route = createFileRoute("/debug/components/icons")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: getDebugPage("icons").label }],
  }),
});

function RouteComponent() {
  const tab = useDebugTab("icons");
  return (
    <div className="flex size-full flex-col">
      <DebugTabBar pageId="icons" />
      <DebugPageScroller className="min-h-0 flex-1 overflow-y-auto">
        {tab === "providers" ? (
          <ProviderIconsTab />
        ) : tab === "files" ? (
          <FileIconsTab />
        ) : (
          <AppIconsTab />
        )}
      </DebugPageScroller>
    </div>
  );
}
