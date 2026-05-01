import { NewTabHelpMessage } from "@/client/components/new-tab-help-message";
import { PromptInput } from "@/client/components/prompt-input";
import { useDefaultModelURI } from "@/client/hooks/use-default-model-uri";
import { useTabActions } from "@/client/hooks/use-tab-actions";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { useMutation } from "@tanstack/react-query";
import {
  createFileRoute,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/new-tab")({
  component: RouteComponent,
  head: () => ({
    meta: [
      {
        title: "New tab",
      },
    ],
  }),
  loader: async ({ context }) => {
    const hasToken = await rpcClient.auth.hasToken.call();
    // Ensures the UI doesn't flicker by pre-loading the hasToken data
    // Using a raw RPC call because it's a live query, which means
    // `.ensureQueryData` would never resolve.
    context.queryClient.setQueryData(
      rpcClient.auth.live.hasToken.experimental_liveKey(),
      hasToken,
    );
  },
});

function RouteComponent() {
  const [selectedModelURI, setSelectedModelURI, saveSelectedModelURI] =
    useDefaultModelURI();
  const navigate = useNavigate({ from: "/new-tab" });
  const router = useRouter();
  const { addTab } = useTabActions();
  const createProjectMutation = useMutation(
    rpcClient.workspace.project.create.mutationOptions(),
  );

  useEffect(() => {
    // Preload the project route chunk for faster navigation
    async function preloadRouteChunks() {
      const projectRoute = router.routesByPath["/projects/$subdomain"];
      await router.loadRouteChunk(projectRoute);
    }

    void preloadRouteChunks();
  }, [router]);

  return (
    <div className="relative flex min-h-screen w-full flex-1 flex-col items-center">
      <div className="flex w-full items-center justify-center">
        <div className="w-full max-w-2xl space-y-8 px-8 pt-36">
          <div>
            <PromptInput
              allowOpenInNewTab
              atomKey="$$new-tab$$"
              autoFocus
              autoResizeMaxHeight={300}
              isLoading={createProjectMutation.isPending}
              modelURI={selectedModelURI}
              onModelChange={setSelectedModelURI}
              onSubmit={({
                files,
                folders,
                modelURI,
                openInNewTab,
                prompt,
              }) => {
                saveSelectedModelURI(modelURI);

                createProjectMutation.mutate(
                  { files, folders, modelURI, prompt },
                  {
                    onError: (error) => {
                      toast.error(
                        `There was an error starting your project: ${error.message}`,
                      );
                    },
                    onSuccess: ({ sessionId, subdomain }) => {
                      if (openInNewTab) {
                        void addTab(
                          {
                            params: { subdomain },
                            search: { selectedSessionId: sessionId },
                            to: "/projects/$subdomain",
                          },
                          { select: false },
                        );
                      } else {
                        void navigate({
                          params: { subdomain },
                          search: { selectedSessionId: sessionId },
                          to: "/projects/$subdomain",
                        });
                      }
                    },
                  },
                );
              }}
              placeholder={`Talk to ${APP_NAME}`}
            />
            <div className="mt-2 flex items-center justify-end">
              <NewTabHelpMessage />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
