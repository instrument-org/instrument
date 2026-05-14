import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/_not_authenticated/login")({
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ search: { showLoginDialog: true }, to: "/new-tab" });
  },
});
