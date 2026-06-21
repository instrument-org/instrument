import {
  type Task,
} from "@instrument-org/workspace/client";
import {
  useRouter,
} from "@tanstack/react-router";
import {
  useEffect,
} from "react";

// Ensures TanStack Router re-renders meta tags so the tab title and icon are updated
export function useProjectRouteSync(project?: Task) {
  const router = useRouter();

  useEffect(() => {
    if (!project) {
      return;
    }
    void router.invalidate({
      filter: (m) =>
        m.routeId === "/_app/tasks/$id/" &&
        m.params.id === project.subdomain,
    });
  }, [router, project]);
}
