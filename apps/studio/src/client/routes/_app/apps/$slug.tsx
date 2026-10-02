import { AppFront } from "@/client/components/window/app-front";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/apps/$slug")({
  component: AppRoute,
});

function AppRoute() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  return (
    <AppFront
      onToApps={() => {
        void navigate({ to: "/apps" });
      }}
      slug={slug}
    />
  );
}
