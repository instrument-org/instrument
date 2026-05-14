import { AISetupView } from "@/client/components/ai-setup-view";
import { createIconMeta } from "@/shared/tabs";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/_not_authenticated/login")({
  component: RouteComponent,
  head: () => {
    return {
      meta: [
        {
          title: "Log in",
        },
        createIconMeta("our-app"),
      ],
    };
  },
});

function RouteComponent() {
  return <AISetupView mode="login" />;
}
