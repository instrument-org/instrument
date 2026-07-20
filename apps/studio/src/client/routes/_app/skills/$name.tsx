import { PromptInput } from "@/client/components/prompt-input";
import { SessionMarkdown } from "@/client/components/session-markdown";
import { useTabId } from "@/client/hooks/use-active-tab";
import { useDefaultModelURI } from "@/client/hooks/use-default-model-uri";
import { useTabActions } from "@/client/hooks/use-tab-actions";
import { rpcClient } from "@/client/rpc/client";
import { ArrowLeftIcon, FileIcon, FolderOpenIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useRef } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/skills/$name")({
  component: SkillPage,
  head: ({ params }) => ({ meta: [{ title: `/${params.name}` }] }),
});

function SkillPage() {
  const { name } = Route.useParams();
  const { data: skill, isLoading } = useQuery(
    rpcClient.workspace.skill.byName.queryOptions({ input: { name } }),
  );
  const [selectedModelURI, setSelectedModelURI, saveSelectedModelURI] =
    useDefaultModelURI();
  const createTaskMutation = useMutation(
    rpcClient.workspace.task.create.mutationOptions(),
  );
  const navigate = useNavigate();
  const { addTab } = useTabActions();
  const tabId = useTabId();
  const promptInputRef = useRef<{ clear: () => void; focus: () => void }>(null);

  if (isLoading || !skill) {
    return (
      <div className="grid h-full place-items-center text-sm text-muted-foreground">
        {isLoading ? "Loading skill…" : "Skill not found"}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <main className="scroll-fade-y min-h-0 flex-1 overflow-y-auto">
        <article className="mx-auto w-full max-w-3xl px-8 pt-10 pb-12">
          <Link
            className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            to="/skills"
          >
            <ArrowLeftIcon className="size-4" />
            All skills
          </Link>
          <div className="flex items-start justify-between gap-6">
            <div>
              <h1 className="font-mono text-2xl font-semibold">
                /{skill.name}
              </h1>
              <p className="mt-3 max-w-2xl text-base/relaxed text-muted-foreground">
                {skill.description}
              </p>
            </div>
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground capitalize">
              {skill.source}
            </span>
          </div>

          <div className="mt-8 grid gap-3 rounded-xl border bg-muted/20 p-4 text-xs text-muted-foreground">
            <div className="flex min-w-0 items-center gap-2">
              <FolderOpenIcon className="size-4 shrink-0" />
              <span className="truncate font-mono">{skill.path}</span>
            </div>
            {skill.files.length > 0 ? (
              <div className="flex items-start gap-2">
                <FileIcon className="mt-0.5 size-4 shrink-0" />
                <span>
                  {skill.files.slice(0, 6).join(", ")}
                  {skill.files.length > 6 || skill.filesTruncated ? "…" : ""}
                </span>
              </div>
            ) : null}
          </div>

          <div className="my-10 h-px bg-border" />
          <SessionMarkdown className="text-[15px]" markdown={skill.content} />
        </article>
      </main>

      <div className="border-t bg-background/95 px-8 py-4 backdrop-blur">
        <div className="mx-auto w-full max-w-3xl">
          <PromptInput
            allowOpenInNewTab
            autoResizeMaxHeight={240}
            draftKey={{ scope: "compose", tabId }}
            initialSkillName={skill.name}
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
            placeholder={`Ask with /${skill.name}`}
            ref={promptInputRef}
            showProjectSelector
          />
        </div>
      </div>
    </div>
  );
}
