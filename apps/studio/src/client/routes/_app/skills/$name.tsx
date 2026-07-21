import { PromptInput } from "@/client/components/prompt-input";
import { SessionMarkdown } from "@/client/components/session-markdown";
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
  const promptInputRef = useRef<{ clear: () => void; focus: () => void }>(null);

  if (isLoading || !skill) {
    return (
      <div className="grid h-full place-items-center text-sm text-muted-foreground">
        {isLoading ? "Loading skill…" : "Skill not found"}
      </div>
    );
  }

  return (
    <div className="scroll-fade-y h-full overflow-y-auto">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-8 pt-10 pb-12 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <article className="min-w-0">
          <Link
            className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            to="/skills"
          >
            <ArrowLeftIcon className="size-4" />
            All skills
          </Link>
          <h1 className="font-mono text-2xl font-semibold">/{skill.name}</h1>
          <p className="mt-3 text-base/relaxed text-muted-foreground">
            {skill.description}
          </p>
          <div className="my-10 h-px bg-border" />
          <SessionMarkdown className="text-[15px]" markdown={skill.content} />
        </article>

        <aside className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-10 lg:self-start">
          <PromptInput
            allowOpenInNewTab
            autoResizeMaxHeight={240}
            draftKey={{ id: `skill:${skill.name}`, scope: "transient" }}
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

          <dl className="grid gap-4 rounded-xl border bg-muted/20 p-4 text-xs">
            <div className="grid gap-1">
              <dt className="font-medium text-muted-foreground">Source</dt>
              <dd className="capitalize">{skill.source}</dd>
            </div>
            <div className="grid min-w-0 gap-1">
              <dt className="font-medium text-muted-foreground">Location</dt>
              <dd className="flex min-w-0 items-center gap-2">
                <FolderOpenIcon className="size-4 shrink-0" />
                <span className="truncate font-mono">{skill.path}</span>
              </dd>
            </div>
            {skill.files.length > 0 ? (
              <div className="grid min-w-0 gap-1">
                <dt className="font-medium text-muted-foreground">Files</dt>
                <dd className="grid gap-1">
                  {skill.files.map((file) => (
                    <span
                      className="flex min-w-0 items-center gap-2"
                      key={file}
                    >
                      <FileIcon className="size-4 shrink-0" />
                      <span className="truncate font-mono">{file}</span>
                    </span>
                  ))}
                  {skill.filesTruncated ? <span>…</span> : null}
                </dd>
              </div>
            ) : null}
          </dl>
        </aside>
      </div>
    </div>
  );
}
