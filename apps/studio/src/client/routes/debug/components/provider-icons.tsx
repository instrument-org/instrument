import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/debug/components/provider-icons")({
  beforeLoad: () => {
    // oxlint-disable-next-line typescript/only-throw-error
    throw redirect({
      search: { tab: "providers" },
      to: "/debug/components/icons",
    });
  },
});
