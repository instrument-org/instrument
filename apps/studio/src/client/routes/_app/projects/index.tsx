import { createFileRoute, redirect } from "@tanstack/react-router";

// Backward-compat: the task list moved from /projects to /tasks.
export const Route = createFileRoute("/_app/projects/")({
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ replace: true, to: "/tasks" });
  },
});
