import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    // The main window renders MainWindow directly and never mounts this
    // router, so only the onboarding and orchestrator windows reach here.
    const to =
      window.api.windowType === "onboarding"
        ? "/onboarding"
        : window.api.windowType === "orchestrator"
          ? "/orchestrator"
          : "/new-tab";
    // oxlint-disable-next-line typescript/only-throw-error
    throw redirect({ to });
  },
  component: RouteComponent,
});

function RouteComponent() {
  return null;
}
