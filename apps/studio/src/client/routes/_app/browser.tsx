import { WebStart } from "@/client/components/window/compose-zero-state";
import { useWindow } from "@/client/components/window/context";
import { useOnScreen } from "@/client/components/window/on-screen";
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
  useOnScreen({ screen: "home" });
  return (
    <WebStart
      onOpenPage={(url) => {
        openPage(url);
      }}
    />
  );
}
