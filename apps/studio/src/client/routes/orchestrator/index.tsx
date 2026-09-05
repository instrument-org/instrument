import { createFileRoute, redirect } from "@tanstack/react-router";

/** The window opens on Home. */
export const Route = createFileRoute("/orchestrator/")({
  beforeLoad: () => {
    // oxlint-disable-next-line typescript/only-throw-error
    throw redirect({ to: "/orchestrator/home" });
  },
});
