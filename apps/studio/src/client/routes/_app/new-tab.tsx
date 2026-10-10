import { NewTabPage } from "@/client/components/window/new-tab-page";
import { createFileRoute, useLocation } from "@tanstack/react-router";

/**
 * A window tab opened with Cmd+T or the strip's plus, before it is
 * anything: the command menu, and whatever is picked there takes its place.
 */
export const Route = createFileRoute("/_app/new-tab")({
  component: NewTabRoute,
});

function NewTabRoute() {
  const { searchStr } = useLocation();
  return <NewTabPage search={new URLSearchParams(searchStr)} />;
}
