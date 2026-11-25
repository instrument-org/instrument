import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/chats" });
  },
  component: RouteComponent,
});

function RouteComponent() {
  return null;
}
