import { BrowserStartControls } from "@/client/components/window/browser-start-controls";
import { WebStart } from "@/client/components/window/web-start";
import { useWindow } from "@/client/components/window/context";
import { useGroupTab } from "@/client/components/window/group-tab";
import { createFileRoute } from "@tanstack/react-router";

/**
 * The web opened beside a chat from its plus: the sites kept and lately seen,
 * under the tab's own address bar, and the page chosen takes this tab's
 * place.
 */
export const Route = createFileRoute("/_app/browser")({
  component: WebRoute,
});

function WebRoute() {
  const { openPage } = useWindow();
  const groupTab = useGroupTab();
  const open = (url: string) => {
    if (groupTab) {
      groupTab.showPage(url);
    } else {
      openPage(url);
    }
  };
  return (
    <>
      <BrowserStartControls onOpenPage={open} />
      <WebStart onOpenPage={open} />
    </>
  );
}
