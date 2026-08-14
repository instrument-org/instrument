import { setPromptDraftAtom } from "@/client/atoms/prompt-value";
import { openEditSkill } from "@/client/atoms/skill-modal";
import { CopyButton } from "@/client/components/copy-button";
import { FileIcon } from "@/client/components/file-icon";
import { InternalLink } from "@/client/components/internal-link";
import { Markdown } from "@/client/components/markdown";
import {
  PromptInput,
  type PromptInputRef,
} from "@/client/components/prompt-input";
import { RevealPath } from "@/client/components/reveal-path";
import { SkillBadges } from "@/client/components/skill-badges";
import { SkillFileView } from "@/client/components/skill-file-view";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/client/components/ui/alert-dialog";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { useTabId } from "@/client/hooks/use-active-tab";
import { useDefaultModelURI } from "@/client/hooks/use-default-model-uri";
import { useTabActions } from "@/client/hooks/use-tab-actions";
import { useTimedFlag } from "@/client/hooks/use-timed-flag";
import {
  isProvidedSource,
  readOnlySkillReason,
  skillSourceLabel,
} from "@/client/lib/skill-source";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { skillMentionToken } from "@instrument-org/shared/skill-mention";
import { safe } from "@orpc/client";
import { ArrowLeftIcon } from "@phosphor-icons/react/ArrowLeft";
import { DotsThreeOutlineVerticalIcon } from "@phosphor-icons/react/DotsThreeOutlineVertical";
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple";
import { TrashIcon } from "@phosphor-icons/react/Trash";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useSetAtom } from "jotai";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const SKILL_FILE = "SKILL.md";

export const Route = createFileRoute("/_app/skills/$name")({
  /**
   * A transcript card or a kept tab outlives the skill it points at, so this
   * route is reachable for one that has been deleted or renamed. There is
   * nothing to show and nothing to do on such a page, so hand the list back
   * with a note instead. Replaces the history entry, since going back would
   * otherwise land here again.
   *
   * Reads through the query cache the component reads, so the page it does
   * render costs no second fetch. `byName` keeps the default staleTime of 0,
   * so this is always a fresh answer rather than a cached one.
   */
  beforeLoad: async ({ context, params, preload }) => {
    const skill = await context.queryClient
      .ensureQueryData(
        rpcClient.workspace.skill.byName.queryOptions({
          input: { name: params.name },
        }),
      )
      .catch(() => null);
    // Preload runs this too, where a toast and a navigation would fire from a
    // hover. No skill link opts into preload today; the guard keeps that from
    // becoming a trap for whoever adds the first one.
    if (skill || preload) {
      return;
    }
    toast.info(`No skill named "${params.name}" in this workspace`, {
      id: `skill-missing:${params.name}`,
    });
    // oxlint-disable-next-line typescript/only-throw-error
    throw redirect({ replace: true, to: "/skills" });
  },
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
  const queryClient = useQueryClient();
  const createTaskMutation = useMutation(
    rpcClient.workspace.task.create.mutationOptions(),
  );
  const deleteSkillMutation = useMutation(
    rpcClient.workspace.skill.remove.mutationOptions(),
  );
  const navigate = useNavigate();
  const { addTab } = useTabActions();
  const tabId = useTabId();
  const promptInputRef = useRef<PromptInputRef>(null);
  // Keyed by skill so navigating between skills starts back at SKILL.md
  // without an effect to reset it.
  const [selection, setSelection] = useState({ file: SKILL_FILE, skill: name });
  const selectedFile = selection.skill === name ? selection.file : SKILL_FILE;

  // The id is held on its own because the prefill effect below needs a
  // dependency that only changes when the draft does, which the key object
  // rebuilt on every render is not.
  const draftId = `skill:${tabId}:${name}`;
  const draftKey = { id: draftId, scope: "transient" } as const;
  const setDraft = useSetAtom(setPromptDraftAtom);
  const [isDeleteDialogOpen, setDeleteDialogOpen] = useState(false);
  // Seed the compose box once per skill, showing what invoking it looks like and
  // leaving the user somewhere to keep typing. The route owns this so the shared
  // composer stays skill-agnostic. Guarded by a ref, not the draft's emptiness,
  // so clearing or submitting can't retrigger the prefill.
  const seededSkillRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!skill?.userInvocable) {
      return;
    }
    if (seededSkillRef.current === skill.id) {
      return;
    }
    seededSkillRef.current = skill.id;
    setDraft({
      key: { id: draftId, scope: "transient" },
      update: (current) =>
        current.trim() ? current : `Use ${skillMentionToken(skill.id)} to…`,
    });
  }, [draftId, setDraft, skill?.id, skill?.userInvocable]);

  // `beforeLoad` has already redirected away from a skill that is not here, so
  // this covers the load itself rather than a missing skill.
  if (isLoading || !skill) {
    return (
      <div className="grid h-full place-items-center text-sm text-muted-foreground">
        Loading skill…
      </div>
    );
  }

  const confirmDelete = async () => {
    try {
      await deleteSkillMutation.mutateAsync({ name: skill.id });
      await queryClient.invalidateQueries({
        queryKey: rpcClient.workspace.skill.list.key(),
      });
      setDeleteDialogOpen(false);
      toast.success(`Deleted "${skill.title}"`);
      await navigate({ to: "/skills" });
    } catch (error) {
      toast.error("Failed to delete skill", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    }
  };

  return (
    <div className="h-full overflow-y-auto scroll-fade-y">
      <div className="mx-auto w-full max-w-5xl px-8 py-12">
        <InternalLink
          className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          to="/skills"
        >
          <ArrowLeftIcon className="size-4" />
          All skills
        </InternalLink>
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="group flex flex-wrap items-center gap-2">
              <SkillTitle skill={skill} />
              <SkillBadges className="flex flex-wrap gap-2" skill={skill} />
            </div>
          </div>
          {skill.editable ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="shrink-0" size="icon-sm" variant="ghost">
                  <DotsThreeOutlineVerticalIcon
                    className="size-4"
                    weight="fill"
                  />
                  <span className="sr-only">Skill actions</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => {
                    openEditSkill({
                      name: skill.id,
                      title: skill.title,
                    });
                  }}
                >
                  <PencilSimpleIcon className="size-4 text-muted-foreground" />
                  <span>Edit skill</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => {
                    setDeleteDialogOpen(true);
                  }}
                  variant="destructive"
                >
                  <TrashIcon className="size-4" />
                  <span>Delete skill</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <span className="inline-flex shrink-0">
                  <Button disabled size="icon-sm" variant="ghost">
                    <DotsThreeOutlineVerticalIcon
                      className="size-4"
                      weight="fill"
                    />
                    <span className="sr-only">Skill actions unavailable</span>
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-60">
                {readOnlySkillReason(skill.source)}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        <div className="mt-8">
          <PromptInput
            allowOpenInNewTab
            allowWorkInProject
            autoResizeMaxHeight={240}
            draftKey={draftKey}
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
                {
                  files,
                  folders,
                  intent: skillPageIntent({
                    name: skill.id,
                    title: skill.title,
                    userInvocable: skill.userInvocable,
                  }),
                  modelURI,
                  projectId,
                  prompt,
                },
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
            placeholder="Describe the task"
            ref={promptInputRef}
            showWorkInFolder
          />
        </div>
        <p className="mt-4 max-h-24 overflow-y-auto pr-2 text-sm/relaxed text-muted-foreground">
          {skill.description}
        </p>
        <div className="mt-6">
          <div className="grid gap-1 text-xs text-muted-foreground">
            <span>{`Source: ${skillSourceLabel(skill.source)}`}</span>
            {isProvidedSource(skill.source) ? null : (
              <RevealPath
                allowWrap
                className="max-w-full"
                hideIcon
                path={skill.path}
              />
            )}
          </div>
        </div>

        <AlertDialog
          onOpenChange={(open) => {
            setDeleteDialogOpen(open);
          }}
          open={isDeleteDialogOpen}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{`Delete "${skill.title}"?`}</AlertDialogTitle>
              <AlertDialogDescription>
                Permanently deletes this skill folder from the workspace.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteSkillMutation.isPending}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={deleteSkillMutation.isPending}
                onClick={() => {
                  void confirmDelete();
                }}
              >
                Delete skill
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Two columns only when there is a rail to show; a skill with no
            bundled files should not leave a dead gutter. */}
        <div
          className={cn(
            "mt-8 border-t pt-8",
            skill.files.length > 0 &&
              "grid gap-10 lg:grid-cols-[minmax(0,1fr)_14rem]",
          )}
        >
          <article className="min-w-0">
            {selectedFile === SKILL_FILE ? (
              <div className="overflow-hidden rounded-lg bg-card">
                <div className="border-b bg-muted/20">
                  <div className="flex items-center justify-between gap-3 px-3 py-2">
                    <h2 className="font-mono text-xs font-medium">
                      {SKILL_FILE}
                    </h2>
                    <CopyButton
                      className="rounded-sm p-1 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                      iconSize={14}
                      onCopy={() =>
                        navigator.clipboard.writeText(skill.rawSkillFile)
                      }
                    />
                  </div>
                  {skill.frontmatter ? (
                    <pre className="overflow-x-auto border-t px-4 py-3 text-xs text-muted-foreground">
                      {skill.frontmatter}
                    </pre>
                  ) : null}
                </div>
                <div className="prose prose-custom max-w-none px-4 py-4 text-sm/relaxed wrap-break-word dark:prose-invert prose-figcaption:text-sm prose-kbd:text-inherit prose-code:text-inherit prose-pre:text-sm prose-table:text-sm">
                  <Markdown markdown={skill.content} />
                </div>
              </div>
            ) : (
              <SkillFileView file={selectedFile} skillName={skill.id} />
            )}
          </article>

          {skill.files.length > 0 ? (
            <aside className="min-w-0 lg:sticky lg:top-10 lg:self-start">
              <div className="overflow-hidden rounded-lg bg-card shadow-xs">
                <div className="border-b px-3 py-2">
                  <h2 className="text-xs font-medium">Skill files</h2>
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

function skillPageIntent({
  name,
  title,
  userInvocable,
}: {
  name: string;
  title: string;
  userInvocable: boolean;
}) {
  return userInvocable
    ? [
        `The user started this task from the "${title}" skill page in the Skills area.`,
        `They were looking at the /${name} skill specifically, so prefer using it if it fits their request.`,
      ].join(" ")
    : [
        `The user started this task from the "${title}" skill page in the Skills area.`,
        "Treat that skill as especially relevant context if it matches their request.",
      ].join(" ");
}

function SkillTitle({
  skill,
}: {
  skill: { id: string; name: string; userInvocable: boolean };
}) {
  const { active: showCopied, trigger } = useTimedFlag();
  const [isTooltipOpen, setTooltipOpen] = useState(false);
  const label = skill.userInvocable ? `/${skill.name}` : skill.name;
  const stableLabel = `/${skill.id}`;

  if (!skill.userInvocable) {
    return <h1 className="font-serif text-3xl tracking-tight">{label}</h1>;
  }

  return (
    // Pointer and focus drive the tooltip directly: Radix closes a tooltip when
    // its trigger is clicked, which is the moment the "Copied" confirmation has
    // to appear, and its open delay would hide what clicking the title does.
    <Tooltip open={isTooltipOpen}>
      <TooltipTrigger asChild>
        <button
          className="rounded-sm font-serif text-3xl tracking-tight hover:bg-accent/40 focus-visible:bg-accent/40"
          onBlur={() => {
            setTooltipOpen(false);
          }}
          onClick={() => {
            void navigator.clipboard.writeText(stableLabel);
            trigger();
          }}
          onFocus={() => {
            setTooltipOpen(true);
          }}
          onPointerEnter={() => {
            setTooltipOpen(true);
          }}
          onPointerLeave={() => {
            setTooltipOpen(false);
          }}
          type="button"
        >
          {label}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {showCopied ? "Copied" : `Copy ${stableLabel}`}
      </TooltipContent>
    </Tooltip>
  );
}
