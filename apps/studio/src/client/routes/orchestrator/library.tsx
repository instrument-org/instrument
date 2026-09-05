import { createFileRoute, redirect } from "@tanstack/react-router";

/** Everything made here: the folder Instrument keeps its outcomes in. */
export const Route = createFileRoute("/orchestrator/library")({
  beforeLoad: () => {
    // oxlint-disable-next-line typescript/only-throw-error
    throw redirect({
      search: { path: "", root: "instrument" },
      to: "/orchestrator/computer",
    });
  },
});
