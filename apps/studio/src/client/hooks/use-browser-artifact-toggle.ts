import { getRouteApi } from "@tanstack/react-router";

const taskRoute = getRouteApi("/_app/tasks/$id/");

/**
 * Open/close the task page's browser artifact panel (where the agent browser is
 * shown). Single source of truth for the toggle, shared by the task toolbar and
 * the prompt input. Only valid inside the task route.
 */
export function useBrowserArtifactToggle() {
  const navigate = taskRoute.useNavigate();
  const { artifactPanel } = taskRoute.useSearch();

  return {
    open: artifactPanel?.type === "browser",
    toggle: () => {
      void navigate({
        replace: true,
        search: (prev) => ({
          ...prev,
          artifactPanel:
            prev.artifactPanel?.type === "browser"
              ? undefined
              : { type: "browser" },
        }),
      });
    },
  };
}
