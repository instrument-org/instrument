import { WebStart } from "@/client/components/orchestrator/compose-zero-state";
import { useOrchestrator } from "@/client/components/orchestrator/context";
import { useOnScreen } from "@/client/components/orchestrator/on-screen";
import { createFileRoute } from "@tanstack/react-router";

/**
 * The web opened beside a chat from its plus: the sites kept and lately seen,
 * under the tab's own address bar, and the page chosen takes this tab's
 * place.
 */
export const Route = createFileRoute("/orchestrator/web")({
  component: WebRoute,
});

function WebRoute() {
  const { openPage } = useOrchestrator();
  useOnScreen({ screen: "home" });
  return (
    <WebStart
      hasAddressField={false}
      onOpenPage={(url) => {
        openPage(url);
      }}
    />
  );
}
