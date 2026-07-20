import { PromptInput } from "@/client/components/prompt-input";
import { useTabId } from "@/client/hooks/use-active-tab";
import { useDefaultModelURI } from "@/client/hooks/use-default-model-uri";
import { useTabActions } from "@/client/hooks/use-tab-actions";
import { rpcClient } from "@/client/rpc/client";
import { ArrowLeftIcon, SparkleIcon } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useRef } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/skills/new")({
  component: NewSkillPage,
  head: () => ({ meta: [{ title: "Create skill" }] }),
});

function NewSkillPage() {
  const [selectedModelURI, setSelectedModelURI, saveSelectedModelURI] =
    useDefaultModelURI();
  const createTaskMutation = useMutation(
    rpcClient.workspace.task.create.mutationOptions(),
  );
  const navigate = useNavigate();
  const { addTab } = useTabActions();
  const tabId = useTabId();
  const promptInputRef = useRef<{ clear: () => void; focus: () => void }>(null);

  return (
    <main className="grid h-full place-items-center overflow-y-auto px-8 py-12">
      <div className="w-full max-w-2xl">
        <Link
          className="mb-12 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          to="/skills"
        >
          <ArrowLeftIcon className="size-4" />
          All skills
        </Link>

        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex size-12 items-center justify-center rounded-xl bg-brown-100 text-brown-700 dark:bg-brown-900/60 dark:text-brown-200">
            <SparkleIcon className="size-6" weight="duotone" />
          </div>
          <h1 className="font-serif text-3xl tracking-tight">Create a skill</h1>
          <p className="mx-auto mt-3 max-w-lg text-sm/relaxed text-muted-foreground">
            Describe the capability or workflow you want to reuse. The agent
            will help shape it and save the finished skill to this workspace.
          </p>
        </div>

        <PromptInput
          allowOpenInNewTab
          autoFocus
          autoResizeMaxHeight={300}
          draftKey={{ scope: "compose", tabId }}
          initialSkillName="skill-creator"
          isLoading={createTaskMutation.isPending}
          modelURI={selectedModelURI}
          onModelChange={setSelectedModelURI}
          onSubmit={({ files, folders, modelURI, openInNewTab, prompt }) => {
            saveSelectedModelURI(modelURI);
            createTaskMutation.mutate(
              {
                files,
                folders,
                modelURI,
                name: "Create a skill",
                projectId: null,
                prompt,
              },
              {
                onError: (error) => {
                  toast.error(
                    `There was an error starting skill creation: ${error.message}`,
                  );
                },
                onSuccess: ({ id, sessionId }) => {
                  promptInputRef.current?.clear();
                  const destination = {
                    params: { id },
                    search: { selectedSessionId: sessionId },
                    to: "/tasks/$id" as const,
                  };
                  if (openInNewTab) {
                    void addTab(destination, { select: false });
                  } else {
                    void navigate(destination);
                  }
                },
              },
            );
          }}
          placeholder="Describe the skill you want to create"
          ref={promptInputRef}
        />
        <p className="mt-4 text-center text-xs text-muted-foreground">
          New skills are saved under the workspace’s skills folder.
        </p>
      </div>
    </main>
  );
}
