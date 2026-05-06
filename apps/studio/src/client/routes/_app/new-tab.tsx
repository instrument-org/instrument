import { PromptInput } from "@/client/components/prompt-input";
import { AnimatedOutlineAppIconGlyph } from "@/client/components/studio-icon";
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
    <div className="grid min-h-screen w-full flex-1 place-items-center px-8">
      <div className="relative w-full max-w-2xl">
        <div className="absolute bottom-full left-1/2 mb-8 flex -translate-x-1/2 flex-col items-center gap-y-5">
          <div className="text-brown-300/34 dark:text-brown-900/34">
            <AnimatedOutlineAppIconGlyph className="size-18" />
          </div>
          <h1 className="font-serif text-2xl leading-none font-normal tracking-[-0.03em] whitespace-nowrap text-foreground sm:text-3xl md:text-4xl">
            How can I help?
          </h1>
        </div>
        <PromptInput
          allowOpenInNewTab
          atomKey="$$new-tab$$"
          autoFocus
          autoResizeMaxHeight={300}
          isLoading={createProjectMutation.isPending}
          modelURI={selectedModelURI}
          onModelChange={setSelectedModelURI}
          onSubmit={({ files, folders, modelURI, openInNewTab, prompt }) => {
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
      </div>
    </div>
  );
}
