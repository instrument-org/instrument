import { FixturePage } from "@/client/components/orchestrator/fixture-page";
import { useOnScreen } from "@/client/components/orchestrator/on-screen";
import { createFileRoute } from "@tanstack/react-router";

/** A place in the sidebar with nothing behind it yet, so the layout can be felt whole. */
export const Route = createFileRoute("/orchestrator/apps")({
  component: AppsRoute,
});

function AppsRoute() {
  useOnScreen({ screen: "apps" });
  return (
    <FixturePage title="Apps">
      The services signed in to here, each a page of its own, and a place to
      connect another.
    </FixturePage>
  );
}
