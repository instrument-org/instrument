import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    // The main window renders MainWindow directly and never mounts this
    // router, so only the onboarding window reaches here.
    const to =
      window.api.windowType === "onboarding" ? "/onboarding" : "/new-tab";
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to });
  },
  component: RouteComponent,
});

function RouteComponent() {
  return null;
}
