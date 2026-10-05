import { AppFront } from "@/client/components/window/app-front";
import { useGroupTab } from "@/client/components/window/group-tab";
import {
  createFileRoute,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";

export const Route = createFileRoute("/_app/apps/$slug")({
  component: AppRoute,
});

function AppRoute() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const router = useRouter();
  // Beside a chat an app's front goes back to the apps it was picked from,
  // and says nothing of itself.
  const groupTab = useGroupTab();
  return (
    <AppFront
      onToApps={() => {
        if (groupTab && router.history.canGoBack()) {
          router.history.back();
        } else {
          void navigate({ to: "/apps" });
        }
      }}
      reportsScreen={groupTab === null}
      slug={slug}
    />
  );
}
