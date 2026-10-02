import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    const to =
      window.api.windowType === "onboarding" ? "/onboarding" : "/chats";
    // oxlint-disable-next-line typescript/only-throw-error
    throw redirect({ to });
  },
  component: RouteComponent,
});

function RouteComponent() {
  return null;
}
