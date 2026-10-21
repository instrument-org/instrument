import { settingsModalAtom } from "@/client/atoms/settings-modal";
import { settingAnchor } from "@/client/components/settings/settings-index";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { WindowContext } from "@/client/components/window/context";
import { GlyphButton } from "@/client/components/window/glyph-button";
import { showInFolder } from "@/client/lib/show-in-files";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { skillMentionToken } from "@instrument-org/shared/skill-mention";
import { DotsThreeIcon } from "@phosphor-icons/react/DotsThree";
import { TrashIcon } from "@phosphor-icons/react/Trash";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { useContext, useState } from "react";
import { toast } from "@/client/lib/toast";

/** The system skill that knows how a skill is packaged, placed and checked. */
const SKILL_CREATOR = skillMentionToken("skill-creator");

type Skill = RPCOutput["workspace"]["skill"]["list"][number];

/**
 * The skills a task can load. A skill is a folder, so a row opens that
 * folder in Files, where it can be read, changed, or handed to a chat.
 * Making a skill is an ask like any other: it opens a draft with the start
 * of the sentence in it and closes Settings, since the draft is written on
 * the window under it.
 */
export function SkillsSection() {
  const ask = useAsk();
  return (
    <div className="space-y-8">
      <div className="flex items-start gap-4" {...settingAnchor("new-skill")}>
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
        menu={(skill) => (skill.editable ? <SkillMenu skill={skill} /> : null)}
        onOpen={(skill) => {
          void showInFolder(skill.path, { kind: "folder" });
        }}
      />
    </div>
  );
}

/** The "⋯" on a row of the workspace's own skills, the ones it can delete. */
function SkillMenu({ skill }: { skill: Skill }) {
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
    } catch (error) {
      toast.error(`Couldn't delete “${skill.title}”`, { cause: error });
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost">
            <DotsThreeIcon className="size-4" weight="bold" />
            <span className="sr-only">{`More for ${skill.title}`}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => {
              setConfirming(true);
            }}
            variant="destructive"
          >
            <TrashIcon className="size-4" />
            <span>Delete…</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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
    </>
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
