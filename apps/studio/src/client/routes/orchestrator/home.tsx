import { FixturePage } from "@/client/components/orchestrator/fixture-page";
import { createFileRoute } from "@tanstack/react-router";

/** A place in the sidebar with nothing behind it yet, so the layout can be felt whole. */
export const Route = createFileRoute("/orchestrator/home")({
  component: () => (
    <FixturePage title="Home">
      Where the day starts: what is new since you were last here, and what
      Instrument is doing now.
    </FixturePage>
  ),
});
