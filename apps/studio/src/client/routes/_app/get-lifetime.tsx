import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/get-lifetime")({
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ search: { dialog: "lifetime" }, to: "/new-tab" });
  },
});
