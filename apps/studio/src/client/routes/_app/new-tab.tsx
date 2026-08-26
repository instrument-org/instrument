import { openWelcome } from "@/client/atoms/welcome-modal";
import { AnimatedOutlineBrandIconGlyph } from "@/client/components/brand-icon";
import {
  PromptInput,
  type PromptInputRef,
} from "@/client/components/prompt-input";
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
import { useEffect, useRef, useState } from "react";
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
  beforeLoad: ({ preload, search }) => {
    // Opening a modal is not something a hover may do, and preload runs this
    // too.
    if (preload || !search[PRIVATE_BETA_SEARCH_PARAM]) {
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
  const promptInputRef = useRef<PromptInputRef>(null);
  const createTaskMutation = useMutation(
    rpcClient.workspace.task.create.mutationOptions(),
  );
  // The task exists once the mutation resolves, but its page has a loader to
  // run before the navigation commits. Held through that stretch so the
  // composer stays visibly busy rather than going idle over the prompt it just
  // emptied, which reads as a submit that went nowhere.
  const [isNavigating, setIsNavigating] = useState(false);

  useEffect(() => {
    // Preload the task route chunk for faster navigation
    void router.loadRouteChunk(TaskRoute);
  }, [router]);

  return (
    <div className="grid h-full w-full flex-1 place-items-center px-8">
      <div className="relative w-full max-w-2xl">
        <div className="absolute bottom-full left-1/2 mb-12 flex -translate-x-1/2 flex-col items-center gap-y-5">
          <div className="text-brown-300/34 dark:text-brown-900/34">
            <AnimatedOutlineBrandIconGlyph className="size-18" />
          </div>
          <h1 className="font-serif text-2xl leading-none font-normal tracking-[-0.03em] whitespace-nowrap text-foreground @xl/app-content:text-3xl @3xl/app-content:text-4xl">
            How can I help?
          </h1>
        </div>
        <PromptInput
          allowOpenInNewTab
          allowWorkInProject
          autoFocus
          autoResizeMaxHeight={300}
          draftKey={{ scope: "compose", tabId }}
          isLoading={createTaskMutation.isPending || isNavigating}
          modelURI={selectedModelURI}
          nudgeOnReentry
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
                  // Before navigating, not after: the ref is gone once this
                  // page unmounts, and the draft would outlive the task it was
                  // sent to.
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
                    return;
                  }
                  setIsNavigating(true);
                  void navigate({
                    params: { id },
                    search: { selectedSessionId: sessionId },
                    to: "/tasks/$id",
                  }).finally(() => {
                    // Only reached when the navigation fails, since committing
                    // one unmounts this page.
                    setIsNavigating(false);
                  });
                },
              },
            );
          }}
          placeholder={`Talk to ${APP_NAME}`}
          ref={promptInputRef}
          showWorkInFolder
        />
      </div>
    </div>
  );
}
