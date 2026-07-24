import { skillModalAtom } from "@/client/atoms/skill-modal";
import { ExternalLink } from "@/client/components/external-link";
import { PromptInput } from "@/client/components/prompt-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { useBlockTabNavigation } from "@/client/hooks/use-block-tab-navigation";
import { useDefaultModelURI } from "@/client/hooks/use-default-model-uri";
import { useTabActions } from "@/client/hooks/use-tab-actions";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME, SKILLS_MARKETPLACE_URL } from "@instrument-org/shared";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useAtom } from "jotai";
import { toast } from "sonner";

/**
 * Briefing sent alongside whatever the user types, so the agent knows the task
 * is a skill-authoring one without the user having to say so or a skill token
 * having to be prefilled into the composer.
 */
const CREATE_SKILL_INTENT = [
  "The user started this task from the Skills area to create a new skill.",
  "Load the skill-creator skill and follow it: interview them only as far as the",
  "answers would change the skill, then write the package to /skills/<name>/.",
].join(" ");

/**
 * App-wide skill modal, mounted once at the app-chrome root. Reads
 * `skillModalAtom` (opened via `openCreateSkill` / `openEditSkill`); creating
 * and editing are the same flow with a different briefing, so they share this
 * one dialog. Traps tab navigation while open.
 */
export function SkillModal() {
  const [state, setState] = useAtom(skillModalAtom);
  const isOpen = state !== null;
  const isEdit = state?.mode === "edit";
  const [selectedModelURI, setSelectedModelURI, saveSelectedModelURI] =
    useDefaultModelURI();
  const createTaskMutation = useMutation(
    rpcClient.workspace.task.create.mutationOptions(),
  );
  const navigate = useNavigate();
  const { addTab } = useTabActions();

  useBlockTabNavigation(isOpen);

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          setState(null);
        }
      }}
      open={isOpen}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `Edit ${state.title}` : "Create a skill"}
          </DialogTitle>
          <DialogDescription>
            {isEdit ? (
              `Describe the change you want. ${APP_NAME} revises the skill with you and saves it back to this workspace.`
            ) : (
              <>
                Describe the know-how you want to reuse. {APP_NAME} shapes it
                with you and saves it to this workspace, or browse ready-made
                skills to install from{" "}
                <ExternalLink
                  className="underline underline-offset-2 hover:text-foreground"
                  href={SKILLS_MARKETPLACE_URL}
                >
                  skills.sh
                </ExternalLink>
                .
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <PromptInput
          allowOpenInNewTab
          autoFocus
          autoResizeMaxHeight={240}
          draftKey={{
            id: isEdit ? `edit-skill:${state.name}` : "create-skill",
            scope: "transient",
          }}
          isLoading={createTaskMutation.isPending}
          modelURI={selectedModelURI}
          onModelChange={setSelectedModelURI}
          onSubmit={({ files, folders, modelURI, openInNewTab, prompt }) => {
            saveSelectedModelURI(modelURI);
            createTaskMutation.mutate(
              {
                files,
                folders,
                intent: isEdit
                  ? editSkillIntent(state.name)
                  : CREATE_SKILL_INTENT,
                modelURI,
                name: isEdit ? `Edit ${state.title}` : "Create a skill",
                projectId: null,
                prompt,
              },
              {
                onError: (error) => {
                  toast.error(
                    isEdit
                      ? `There was an error starting skill editing: ${error.message}`
                      : `There was an error starting skill creation: ${error.message}`,
                  );
                },
                onSuccess: ({ id, sessionId }) => {
                  setState(null);
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
          placeholder={
            isEdit
              ? "Describe the change you want to make"
              : "Describe the skill you want to create"
          }
        />
      </DialogContent>
    </Dialog>
  );
}

/**
 * Edit counterpart to `CREATE_SKILL_INTENT`, naming the skill so the agent
 * revises the existing package in place rather than starting a new one. The
 * name is the directory slug, which is what `/skills/<name>/` addresses.
 */
function editSkillIntent(name: string) {
  return [
    `The user opened the "${name}" skill from the Skills area to edit it.`,
    "Load the skill-creator skill and follow it to revise the existing package",
    `at /skills/${name}/: interview them only as far as the answers would change`,
    "the skill, then apply the edits.",
  ].join(" ");
}
