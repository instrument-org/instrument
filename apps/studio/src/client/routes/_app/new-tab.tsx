import {
  pendingComposePromptAtom,
  promptDraftAtom,
} from "@/client/atoms/prompt-value";
import { openWelcome } from "@/client/atoms/welcome-modal";
import { AnimatedOutlineBrandIconGlyph } from "@/client/components/brand-icon";
import { PromptInput } from "@/client/components/prompt-input";
import { useTabId } from "@/client/hooks/use-active-tab";
import { useDefaultModelURI } from "@/client/hooks/use-default-model-uri";
import { useTabActions } from "@/client/hooks/use-tab-actions";
import { Route as TaskRoute } from "@/client/routes/_app/tasks/$id/index";
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
import { useStore } from "jotai";
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

    openWelcome();

    // oxlint-disable-next-line typescript/only-throw-error
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
  const tabId = useTabId();
  const promptInputRef = useRef<{ clear: () => void; focus: () => void }>(null);
  const createTaskMutation = useMutation(
    rpcClient.workspace.task.create.mutationOptions(),
  );

  useEffect(() => {
    // Preload the task route chunk for faster navigation
    void router.loadRouteChunk(TaskRoute);
  }, [router]);

  // Consume a one-shot prompt handed in by "Set up" on a connector, etc.
  const store = useStore();
  useEffect(() => {
    const pending = store.get(pendingComposePromptAtom);
    if (pending === null) {
      return;
    }
    store.set(pendingComposePromptAtom, null);
    store.set(promptDraftAtom({ scope: "compose", tabId }), pending);
  }, [store, tabId]);

  return (
    <div className="grid h-full w-full flex-1 place-items-center px-8">
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
          autoFocus
          autoResizeMaxHeight={300}
          draftKey={{ scope: "compose", tabId }}
          isLoading={createTaskMutation.isPending}
          modelURI={selectedModelURI}
          onModelChange={setSelectedModelURI}
          onSubmit={({
            files,
            folders,
            modelURI,
            openInNewTab,
            projectId,
            prompt,
          }) => {
            saveSelectedModelURI(modelURI);

            createTaskMutation.mutate(
              { files, folders, modelURI, projectId, prompt },
              {
                onError: (error) => {
                  toast.error(
                    `There was an error starting your task: ${error.message}`,
                  );
                },
                onSuccess: ({ id, sessionId }) => {
                  promptInputRef.current?.clear();
                  if (openInNewTab) {
                    void addTab(
                      {
                        params: { id },
                        search: { selectedSessionId: sessionId },
                        to: "/tasks/$id",
                      },
                      { select: false },
                    );
                  } else {
                    void navigate({
                      params: { id },
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
          showProjectSelector
        />
      </div>
    </div>
  );
}
