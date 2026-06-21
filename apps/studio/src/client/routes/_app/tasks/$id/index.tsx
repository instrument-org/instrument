import { promptValueAtomFamily } from "@/client/atoms/prompt-value";
import { ProjectDeleteDialog } from "@/client/components/project/delete-dialog";
import { DuplicateProjectModal } from "@/client/components/project/duplicate-modal";
import { ProjectSettingsDialog } from "@/client/components/project/settings-dialog";
import { ProjectSidebarModeSchema } from "@/client/components/project/sidebar";
import { ProjectView } from "@/client/components/project/view";
import { useAutoOpenOutputArtifact } from "@/client/hooks/use-auto-open-output-artifact";
import { useProjectRouteSync } from "@/client/hooks/use-project-route-sync";
import { rpcClient } from "@/client/rpc/client";
import { artifactPanelSchema } from "@/client/schemas/artifact-panel";
import { createIconMeta, createProjectSubdomainMeta } from "@/shared/tabs";
import {
  StoreId,
  type Task,
  TaskIdSchema,
} from "@instrument-org/workspace/client";
import { safe } from "@orpc/client";
import {
  CancelledError,
  keepPreviousData,
  useQuery,
} from "@tanstack/react-query";
import {
  createFileRoute,
  notFound,
  redirect,
  useMatchRoute,
  useNavigate,
} from "@tanstack/react-router";
import { z } from "zod";

const projectSearchSchema = z.object({
  // `.catch(undefined)` drops legacy persisted artifactPanel values (old
  // `{ type: "app" }` panels and pre-`modifiedAt` file panels) instead of
  // throwing in validateSearch. Safe to remove ~2026-07 once stale URLs/router
  // state have aged out.
  // eslint-disable-next-line unicorn/prefer-top-level-await
  artifactPanel: artifactPanelSchema.optional().catch(undefined),
  selectedSessionId: StoreId.SessionSchema.optional(),
  showDelete: z.boolean().optional(),
  showDuplicate: z.boolean().optional(),
  showSettings: z.boolean().optional(),
  sidebar: ProjectSidebarModeSchema.optional(),
});

function title(project?: Task) {
  return project?.title ?? "Not Found";
}

/* eslint-disable perfectionist/sort-objects */
export const Route = createFileRoute("/_app/tasks/$id/")({
  // Must come before component for type inference
  params: {
    parse: (rawParams) => {
      return {
        id: TaskIdSchema.parse(rawParams.id),
      };
    },
  },
  context: () => ({
    disableHotkeyReload: true,
  }),
  onLeave: ({ params }) => {
    // Garbage collect project atoms
    promptValueAtomFamily.remove(params.id);
  },
  beforeLoad: async ({ context, params, search }) => {
    const needsSessionDefault = !search.selectedSessionId;

    const [sessionError, sessions, isDefined] = await safe(
      rpcClient.workspace.session.list.call({
        subdomain: params.id,
      }),
    );

    if (sessionError) {
      if (isDefined && sessionError.code === "NOT_FOUND") {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw notFound();
      }
      // Allow route to load if not defined or not a NOT_FOUND error
      return;
    }

    context.queryClient.setQueryData(
      rpcClient.workspace.session.live.list.experimental_liveKey({
        input: { subdomain: params.id },
      }),
      sessions,
    );

    void rpcClient.preferences.ensureProjectDefaultModelURI
      .call({ subdomain: params.id })
      .then((result) => {
        if (!result.modelURI) {
          return;
        }

        void context.queryClient.invalidateQueries({
          queryKey: rpcClient.workspace.task.state.get.queryOptions({
            input: { subdomain: params.id },
          }).queryKey,
        });
      })
      .catch(() => {
        // The project page can still load with no selected model.
      });

    const newestSession = sessions.at(-1);

    if (needsSessionDefault && newestSession) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw redirect({
        params: { id: params.id },
        search: (prev) => ({
          ...prev,
          selectedSessionId: newestSession.id,
        }),
        to: "/tasks/$id",
      });
    }
  },
  component: RouteComponent,
  head: async ({ params }) => {
    const project = await safe(
      rpcClient.workspace.task.bySubdomain.call({
        subdomain: params.id,
      }),
    );

    return {
      meta: [
        {
          title: title(project.data),
        },
        ...(project.data?.iconName
          ? [createIconMeta(project.data.iconName)]
          : []),
        createProjectSubdomainMeta(params.id),
      ],
    };
  },
  validateSearch: projectSearchSchema,
});
/* eslint-enable perfectionist/sort-objects */

function RouteComponent() {
  const { id: subdomain } = Route.useParams();
  const {
    artifactPanel,
    selectedSessionId,
    showDelete,
    showDuplicate,
    showSettings,
    sidebar,
  } = Route.useSearch();
  const navigate = useNavigate();
  const matchRoute = useMatchRoute();

  const handleDeleteDialogChange = (open: boolean) => {
    // After a successful delete, trashApp has already navigated the tab away.
    // Guard against calling navigate with from: "/tasks/$id" when
    // this route is no longer matched -- the match is gone and it would throw.
    if (!matchRoute({ params: { id: subdomain }, to: "/tasks/$id" })) {
      return;
    }
    void navigate({
      from: "/tasks/$id",
      params: { id: subdomain },
      replace: true,
      search: (prev) => ({ ...prev, showDelete: open || undefined }),
    });
  };

  const handleDuplicateDialogChange = (open: boolean) => {
    void navigate({
      from: "/tasks/$id",
      params: { id: subdomain },
      replace: true,
      search: (prev) => ({ ...prev, showDuplicate: open || undefined }),
    });
  };

  const handleSettingsDialogChange = (open: boolean) => {
    void navigate({
      from: "/tasks/$id",
      params: { id: subdomain },
      replace: true,
      search: (prev) => ({ ...prev, showSettings: open || undefined }),
    });
  };

  const {
    data: project,
    error: projectError,
    isLoading: isProjectLoading,
  } = useQuery(
    rpcClient.workspace.task.live.bySubdomain.experimental_liveOptions({
      input: { subdomain },
      placeholderData: keepPreviousData,
    }),
  );

  useProjectRouteSync(project);

  const {
    data: projectState,
    error: projectStateError,
    isLoading: isProjectStateLoading,
  } = useQuery(
    rpcClient.workspace.task.state.get.queryOptions({
      input: { subdomain },
      placeholderData: keepPreviousData,
    }),
  );

  const { data: files } = useQuery(
    rpcClient.workspace.task.files.live.list.experimental_liveOptions({
      input: { projectSubdomain: subdomain },
      placeholderData: keepPreviousData,
    }),
  );

  useQuery(
    rpcClient.workspace.browser.live.presence.experimental_liveOptions({
      input: { subdomain },
    }),
  );

  // Focuses output artifacts produced by the active turn.
  useAutoOpenOutputArtifact({
    artifactPanel,
    selectedSessionId,
    subdomain,
  });

  const isLoading = isProjectLoading || isProjectStateLoading;

  const error = projectError ?? projectStateError;

  if (isLoading) {
    return null;
  }

  if (error && !(error instanceof CancelledError)) {
    return <div>{error.message}</div>;
  }

  // Should never happen since both queries are required to load successfully
  if (!project || !projectState) {
    return null;
  }

  return (
    <>
      <ProjectView
        artifactPanel={artifactPanel}
        attachedFolders={projectState.attachedFolders}
        files={files}
        project={project}
        selectedModelURI={projectState.selectedModelURI}
        selectedSessionId={selectedSessionId}
        showTutorial={projectState.showTutorial}
        sidebar={sidebar ?? "chat"}
      />

      <ProjectDeleteDialog
        navigateOnDelete
        onOpenChange={handleDeleteDialogChange}
        open={showDelete ?? false}
        project={project}
      />

      <DuplicateProjectModal
        isOpen={showDuplicate ?? false}
        onClose={() => {
          handleDuplicateDialogChange(false);
        }}
        project={project}
      />

      <ProjectSettingsDialog
        onOpenChange={handleSettingsDialogChange}
        open={showSettings ?? false}
        project={project}
      />
    </>
  );
}
