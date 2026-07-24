import { FileIcon } from "@/client/components/file-icon";
import { PromptInput } from "@/client/components/prompt-input";
import { RevealPath } from "@/client/components/reveal-path";
import { SessionMarkdown } from "@/client/components/session-markdown";
import { SkillFileView } from "@/client/components/skill-file-view";
import { useDefaultModelURI } from "@/client/hooks/use-default-model-uri";
import { useTabActions } from "@/client/hooks/use-tab-actions";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { safe } from "@orpc/client";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { toast } from "sonner";

const SKILL_FILE = "SKILL.md";

const isProvided = (source: string) =>
  source === "registry" || source === "system";

export const Route = createFileRoute("/_app/skills/$name")({
  component: SkillPage,
  head: async ({ params }) => {
    const skillResult = await safe(
      rpcClient.workspace.skill.byName.call({ name: params.name }),
    );
    return { meta: [{ title: skillResult.data?.title ?? "Skill" }] };
  },
  staticData: { tabIcon: "graduation-cap" },
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
  // Keyed by skill so navigating between skills starts back at SKILL.md
  // without an effect to reset it.
  const [selection, setSelection] = useState({ file: SKILL_FILE, skill: name });
  const selectedFile = selection.skill === name ? selection.file : SKILL_FILE;

  if (isLoading || !skill) {
    return (
      <div className="grid h-full place-items-center text-sm text-muted-foreground">
        {isLoading ? "Loading skill…" : "Skill not found"}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto scroll-fade-y">
      <div className="mx-auto w-full max-w-4xl px-8 pt-10 pb-12">
        <Link
          className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          to="/skills"
        >
          <ArrowLeftIcon className="size-4" />
          All skills
        </Link>
        <h1 className="font-serif text-3xl tracking-tight">{skill.title}</h1>
        {isProvided(skill.source) ? (
          // Where our own skills sit on disk is an implementation detail to
          // everyone but us; the provenance is the part worth stating.
          <p className="mt-2 text-xs text-muted-foreground">
            Provided by {APP_NAME}
          </p>
        ) : (
          <RevealPath className="mt-2" path={skill.path} />
        )}
        <p className="mt-4 text-base/relaxed text-muted-foreground">
          {skill.description}
        </p>

        <div className="mt-8">
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
            placeholder={`Ask ${skill.title} to do something`}
            ref={promptInputRef}
            showProjectSelector
          />
        </div>

        {/* Two columns only when there is a rail to show; a skill with no
            bundled files should not leave a dead gutter. */}
        <div
          className={cn(
            "mt-12",
            skill.files.length > 0 &&
              "grid gap-10 lg:grid-cols-[minmax(0,1fr)_14rem]",
          )}
        >
          <article className="min-w-0">
            {selectedFile === SKILL_FILE ? (
              <SessionMarkdown
                className="text-[15px]"
                markdown={skill.content}
              />
            ) : (
              <SkillFileView file={selectedFile} skillName={skill.name} />
            )}
          </article>

          {skill.files.length > 0 ? (
            <aside className="min-w-0 lg:sticky lg:top-10 lg:self-start">
              <div className="overflow-hidden rounded-lg bg-card shadow-xs">
                <div className="border-b px-3 py-2">
                  <h2 className="text-xs font-medium">Files</h2>
                </div>
                <div className="grid max-h-96 gap-0.5 overflow-y-auto scroll-fade-y p-1.5 text-xs">
                  {skill.files.map((file) => (
                    <button
                      className={cn(
                        "flex min-w-0 items-center gap-2 rounded-sm px-1.5 py-1 text-left hover:bg-accent/50",
                        file === selectedFile &&
                          "bg-accent text-accent-foreground",
                      )}
                      key={file}
                      onClick={() => {
                        setSelection({ file, skill: name });
                      }}
                      type="button"
                    >
                      <FileIcon
                        className="size-4 shrink-0 text-muted-foreground"
                        filename={file}
                      />
                      <span className="truncate font-mono">{file}</span>
                    </button>
                  ))}
                  {skill.filesTruncated ? (
                    <span className="px-1.5 py-1 text-muted-foreground">…</span>
                  ) : null}
                </div>
              </div>
            </aside>
          ) : null}
        </div>
      </div>
    </div>
  );
}
