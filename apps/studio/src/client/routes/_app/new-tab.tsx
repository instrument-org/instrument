import { AnimatedOutlineBrandIconGlyph } from "@/client/components/brand-icon";
import { PromptInput } from "@/client/components/prompt-input";
import { useDefaultModelURI } from "@/client/hooks/use-default-model-uri";
import { useTabActions } from "@/client/hooks/use-tab-actions";
import { rpcClient } from "@/client/rpc/client";
import { PRIVATE_BETA_SEARCH_PARAM } from "@/shared/constants";
import { APP_NAME } from "@instrument-org/shared";
import { useMutation } from "@tanstack/react-query";
import {
  createFileRoute,
  redirect,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { z } from "zod";

const UrlBoolSchema = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .optional()
  .transform((value) => value === true || value === "true");

const NewTabSearchSchema = z.object({
  [PRIVATE_BETA_SEARCH_PARAM]: UrlBoolSchema,
});

export const Route = createFileRoute("/_app/new-tab")({
  beforeLoad: ({ search }) => {
    if (!search[PRIVATE_BETA_SEARCH_PARAM]) {
      return;
    }

    void rpcClient.studioOverlay.show.call({ kind: "welcome" });

    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ replace: true, search: {}, to: "/new-tab" });
  },
  component: RouteComponent,
  head: () => {
    return { meta: [{ title: "New tab" }] };
  },
  validateSearch: NewTabSearchSchema,
});

function RouteComponent() {
  const [selectedModelURI, setSelectedModelURI, saveSelectedModelURI] =
    useDefaultModelURI();
  const navigate = useNavigate({ from: "/new-tab" });
  const router = useRouter();
  const { addTab } = useTabActions();
  const promptInputRef = useRef<{ clear: () => void; focus: () => void }>(null);
  const createProjectMutation = useMutation(
    rpcClient.workspace.task.create.mutationOptions(),
  );

  useEffect(() => {
    // Preload the project route chunk for faster navigation
    async function preloadRouteChunks() {
      const projectRoute = router.routesByPath["/tasks/$id"];
      await router.loadRouteChunk(projectRoute);
    }

    void preloadRouteChunks();
  }, [router]);

  return (
    <div className="grid min-h-screen w-full flex-1 place-items-center px-8">
      <div className="relative w-full max-w-2xl">
        <div className="absolute bottom-full left-1/2 mb-12 flex -translate-x-1/2 flex-col items-center gap-y-5">
          <div className="text-brown-300/34 dark:text-brown-900/34">
            <AnimatedOutlineBrandIconGlyph className="size-18" />
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
                    `There was an error starting your task: ${error.message}`,
                  );
                },
                onSuccess: ({ sessionId, subdomain }) => {
                  promptInputRef.current?.clear();
                  if (openInNewTab) {
                    void addTab(
                      {
                        params: { id: subdomain },
                        search: { selectedSessionId: sessionId },
                        to: "/tasks/$id",
                      },
                      { select: false },
                    );
                  } else {
                    void navigate({
                      params: { id: subdomain },
                      search: { selectedSessionId: sessionId },
                      to: "/tasks/$id",
                    });
                  }
                },
              },
            );
          }}
          placeholder={`Talk to ${APP_NAME}`}
          ref={promptInputRef}
        />
      </div>
    </div>
  );
}
