import { createFileRoute } from "@tanstack/react-router";

import { FormElementsTab } from "../-controls/form-elements";
import { SpinnerTab } from "../-controls/spinner";
import { getDebugPage } from "../-debug-routes";
import { DebugPageScroller } from "../-page-scroller";
import { DebugTabBar, useDebugTab } from "../-shell";

export const Route = createFileRoute("/debug/components/controls")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: getDebugPage("controls").label }],
  }),
});

function RouteComponent() {
  const tab = useDebugTab("controls");
  return (
    <div className="flex size-full flex-col">
      <DebugTabBar pageId="controls" />
      <DebugPageScroller className="min-h-0 flex-1 overflow-y-auto">
        {tab === "spinner" ? <SpinnerTab /> : <FormElementsTab />}
      </DebugPageScroller>
    </div>
  );
}
