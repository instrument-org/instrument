import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    // oxlint-disable-next-line typescript/only-throw-error
    throw redirect({ to: "/chats" });
  },
  component: RouteComponent,
});

function RouteComponent() {
  return null;
}
