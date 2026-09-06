import { FixturePage } from "@/client/components/orchestrator/fixture-page";
import { useOnScreen } from "@/client/components/orchestrator/on-screen";
import { createFileRoute } from "@tanstack/react-router";

/** A place in the sidebar with nothing behind it yet, so the layout can be felt whole. */
export const Route = createFileRoute("/orchestrator/discover")({
  component: DiscoverRoute,
});

function DiscoverRoute() {
  useOnScreen({ screen: "discover" });
  return (
    <FixturePage title="Discover">
      What Instrument can do with what is on this Mac, and things to try.
    </FixturePage>
  );
}
