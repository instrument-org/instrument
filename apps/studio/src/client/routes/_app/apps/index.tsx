import { AppsHome } from "@/client/components/window/apps-home";
import { useGroupTab } from "@/client/components/window/group-tab";
import { useTabSurface } from "@/client/components/window/tab-surface";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

/**
 * The Apps place's new tab: the apps this workspace reaches as marks, the
 * pages you were on lately across all of them, and the services still to
 * connect. Pressing an app shows its own front; pressing a page opens it in
 * this tab. Nothing here is written by the agent: the marks are the apps
 * and Recent is the window's own browsing, so the place is already yours the
 * first time you open it.
 */
export const Route = createFileRoute("/_app/apps/")({
  component: AppsRoute,
});

function AppsRoute() {
  const groupTab = useGroupTab();
  useTabSurface("view", groupTab ? null : { screen: "apps" });
  const navigate = useNavigate();
  return (
    <AppsHome
      onOpenApp={(slug) => {
        void navigate({ params: { slug }, to: "/apps/$slug" });
      }}
    />
  );
}
