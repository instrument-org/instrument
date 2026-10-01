import { settingsModalAtom } from "@/client/atoms/settings-modal";
import { SkillDetail } from "@/client/components/skills/skill-detail";
import { SkillList } from "@/client/components/skills/skill-list";
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
import { WindowContext } from "@/client/components/window/context";
import { GlyphButton } from "@/client/components/window/glyph-button";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { skillMentionToken } from "@instrument-org/shared/skill-mention";
import { ArrowLeftIcon } from "@phosphor-icons/react/ArrowLeft";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { useContext, useState } from "react";
import { toast } from "sonner";

/** The system skill that knows how a skill is packaged, placed and checked. */
const SKILL_CREATOR = skillMentionToken("skill-creator");

type Skill = RPCOutput["workspace"]["skill"]["byName"];

/**
 * The skills a task can load, and one of them: a list that opens a skill's
 * page in place, with a way back. Making a skill and changing one are asks
 * like any other, so both open a draft with the start of the sentence in it
 * and close Settings, since the draft is written on the window under it.
 */
export function SkillsSection() {
  const [openName, setOpenName] = useState<null | string>(null);
  const ask = useAsk();

  if (openName !== null) {
    return (
      <div className="space-y-6">
        <button
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          onClick={() => {
            setOpenName(null);
          }}
          type="button"
        >
          <ArrowLeftIcon className="size-4" />
          All skills
        </button>
        <SkillDetail
          actions={(skill) =>
            skill.editable ? (
              <SkillActions
                onDeleted={() => {
                  setOpenName(null);
                }}
                onEdit={
                  ask
                    ? () => {
                        ask(
                          `Use ${SKILL_CREATOR} to change ${skillMentionToken(skill.id)} so that `,
                        );
                      }
                    : undefined
                }
                skill={skill}
              />
            ) : null
          }
          name={openName}
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold">Skills</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {`What ${APP_NAME} knows how to do beyond the basics, and where each skill comes from`}
          </p>
        </div>
        {ask ? (
          <GlyphButton
            onClick={() => {
              ask(`Use ${SKILL_CREATOR} to make a skill that `);
            }}
            size="sm"
          >
            New skill
          </GlyphButton>
        ) : null}
      </div>
      <SkillList
        onOpen={(skill) => {
          setOpenName(skill.id);
        }}
      />
    </div>
  );
}

/** Edit and Delete, for a skill of the workspace's own. */
function SkillActions({
  onDeleted,
  onEdit,
  skill,
}: {
  onDeleted: () => void;
  onEdit: (() => void) | undefined;
  skill: Skill;
}) {
  const queryClient = useQueryClient();
  const remove = useMutation(
    rpcClient.workspace.skill.remove.mutationOptions(),
  );
  const [isConfirming, setConfirming] = useState(false);

  const confirmDelete = async () => {
    try {
      await remove.mutateAsync({ name: skill.id });
      await queryClient.invalidateQueries({
        queryKey: rpcClient.workspace.skill.key(),
      });
      setConfirming(false);
      toast.success(`Deleted “${skill.title}”`);
      onDeleted();
    } catch (error) {
      toast.error("Could not delete the skill", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    }
  };

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Button
        onClick={() => {
          setConfirming(true);
        }}
        size="sm"
        variant="ghost"
      >
        Delete
      </Button>
      {onEdit ? (
        <GlyphButton onClick={onEdit} size="sm">
          Edit skill
        </GlyphButton>
      ) : null}
      <AlertDialog onOpenChange={setConfirming} open={isConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{`Delete “${skill.title}”?`}</AlertDialogTitle>
            <AlertDialogDescription>
              Permanently deletes this skill folder from the workspace.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={(event) => {
                // Held open until the delete lands, so a failure is said
                // over the dialog it came from.
                event.preventDefault();
                void confirmDelete();
              }}
            >
              Delete skill
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * Opens a draft with the words in it and closes Settings, or `undefined`
 * outside the app window, where there is no draft to open.
 */
function useAsk() {
  const appWindow = useContext(WindowContext);
  const closeSettings = useSetAtom(settingsModalAtom);
  if (!appWindow) {
    return;
  }
  return (words: string) => {
    closeSettings(null);
    appWindow.ask(words);
  };
}
