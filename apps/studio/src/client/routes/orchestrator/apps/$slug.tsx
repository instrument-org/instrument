import { AppFront } from "@/client/components/orchestrator/app-front";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/orchestrator/apps/$slug")({
  component: AppRoute,
});

function AppRoute() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  return (
    <AppFront
      onToApps={() => {
        void navigate({ to: "/orchestrator/apps" });
      }}
      slug={slug}
    />
  );
}
