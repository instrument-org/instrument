import { createFileRoute, redirect } from "@tanstack/react-router";

/** Everything made here: the Instrument folder, opened on This Mac. */
export const Route = createFileRoute("/orchestrator/library")({
  beforeLoad: () => {
    // oxlint-disable-next-line typescript/only-throw-error
    throw redirect({
      search: { path: "Instrument/" },
      to: "/orchestrator/computer",
    });
  },
});
