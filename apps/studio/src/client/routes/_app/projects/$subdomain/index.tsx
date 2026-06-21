import { TaskIdSchema } from "@instrument-org/workspace/client";
import { createFileRoute, redirect } from "@tanstack/react-router";

// Backward-compat: task detail moved from /projects/$subdomain to /tasks/$id.
// Open tabs/bookmarks at the old URL land here and redirect, preserving search.
export const Route = createFileRoute("/_app/projects/$subdomain/")({
  beforeLoad: ({ params, search }) => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({
      params: { id: TaskIdSchema.parse(params.subdomain) },
      replace: true,
      search,
      to: "/tasks/$id",
    });
  },
});
