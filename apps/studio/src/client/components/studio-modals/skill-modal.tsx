import { setPromptDraftAtom } from "@/client/atoms/prompt-value";
import { skillModalAtom } from "@/client/atoms/skill-modal";
import { ExternalLink } from "@/client/components/external-link";
import { FileDropRegion } from "@/client/components/file-drop-region";
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
import { skillMentionToken } from "@instrument-org/shared/skill-mention";
import { TASK_FOLDER_NAMES } from "@instrument-org/workspace/client";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useAtom, useSetAtom } from "jotai";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

/**
 * Briefing sent alongside whatever the user types, so the agent knows the task
 * is a skill-authoring one without the user having to say so or a skill token
 * having to be prefilled into the composer.
 */
const SKILL_CREATOR_SKILL_NAME = "skill-creator";
const SKILLS_DIR_TEMPLATE = `/${TASK_FOLDER_NAMES.skills}/<name>`;

const CREATE_SKILL_INTENT = [
  "The user started this task from the Skills area to add a skill to this workspace.",
  `Always load the ${SKILL_CREATOR_SKILL_NAME} skill first.`,
  "Use it for the required packaging, placement, and validation steps so the",
  `result is installed correctly in ${SKILLS_DIR_TEMPLATE}.`,
  "If the user is describing a new skill, create it.",
  "If they pasted instructions, a command, or a link for an existing skill,",
  "treat that as an install/import request instead of inventing a new skill.",
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
  // The id is held on its own because the prefill effect below needs a
  // dependency that only changes when the draft does, which the key object
  // rebuilt on every render is not.
  const draftId = isEdit ? `edit-skill:${state.name}` : "create-skill";
  const draftKey = { id: draftId, scope: "transient" } as const;
  const setDraft = useSetAtom(setPromptDraftAtom);
  const [selectedModelURI, setSelectedModelURI, saveSelectedModelURI] =
    useDefaultModelURI();
  const createTaskMutation = useMutation(
    rpcClient.workspace.task.create.mutationOptions(),
  );
  const navigate = useNavigate();
  const { addTab } = useTabActions();
  const seededEditSkillRef = useRef<string | undefined>(undefined);

  useBlockTabNavigation(isOpen);

  useEffect(() => {
    if (!isEdit) {
      seededEditSkillRef.current = undefined;
      return;
    }
    if (seededEditSkillRef.current === state.name) {
      return;
    }
    seededEditSkillRef.current = state.name;
    setDraft({
      key: { id: draftId, scope: "transient" },
      update: (current) =>
        current.trim() ? current : `Edit ${skillMentionToken(state.name)} to…`,
    });
  }, [draftId, isEdit, setDraft, state]);

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && !createTaskMutation.isPending) {
          setState(null);
        }
      }}
      open={isOpen}
    >
      <DialogContent className="p-0" maxWidth="42rem">
        <FileDropRegion className="grid gap-4 p-6">
          <DialogHeader>
            <DialogTitle>
              {isEdit ? "Edit skill" : "Create a skill"}
            </DialogTitle>
            <DialogDescription>
              {isEdit ? (
                `${APP_NAME} revises the skill with you and saves it back to this workspace.`
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
            draftKey={draftKey}
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
                        ? "Failed to start skill editing"
                        : "Failed to start skill creation",
                      { description: error.message },
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
        </FileDropRegion>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Edit counterpart to `CREATE_SKILL_INTENT`, naming the skill so the agent
 * revises the existing package in place rather than starting a new one. The
 * name is the directory slug under the shared skills directory.
 */
function editSkillIntent(name: string) {
  return [
    `The user opened the "${name}" skill from the Skills area to edit it.`,
    `Load the ${SKILL_CREATOR_SKILL_NAME} skill and follow it to revise the existing package`,
    `at /${TASK_FOLDER_NAMES.skills}/${name}/: interview them only as far as the answers would change`,
    "the skill, then apply the edits.",
  ].join(" ");
}
