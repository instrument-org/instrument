import { createFileRoute } from "@tanstack/react-router";

/** No task open: the column beside is the whole screen. */
export const Route = createFileRoute("/orchestrator/tasks/")({
  component: () => (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      Pick a task to look over its shoulder.
    </div>
  ),
});
