import { createSkillModalAtom } from "@/client/atoms/create-skill-modal";
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
 * App-wide create-skill modal, mounted once at the app-chrome root. Reads
 * `createSkillModalAtom` (opened via `openCreateSkill`); traps tab navigation
 * while open.
 */
export function CreateSkillModal() {
  const [state, setState] = useAtom(createSkillModalAtom);
  const isOpen = state !== null;
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
          <DialogTitle>Create a skill</DialogTitle>
          <DialogDescription>
            Describe the capability or workflow you want to reuse. The agent
            shapes it with you and saves it to this workspace.
          </DialogDescription>
        </DialogHeader>
        <PromptInput
          allowOpenInNewTab
          autoFocus
          autoResizeMaxHeight={240}
          draftKey={{ id: "create-skill", scope: "transient" }}
          isLoading={createTaskMutation.isPending}
          modelURI={selectedModelURI}
          onModelChange={setSelectedModelURI}
          onSubmit={({ files, folders, modelURI, openInNewTab, prompt }) => {
            saveSelectedModelURI(modelURI);
            createTaskMutation.mutate(
              {
                files,
                folders,
                intent: CREATE_SKILL_INTENT,
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
          placeholder="Describe the skill you want to create"
        />
      </DialogContent>
    </Dialog>
  );
}
