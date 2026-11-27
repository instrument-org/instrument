import { FolderRow } from "@/client/components/folder-row";
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
import { useGroupTab } from "@/client/components/window/group-tab";
import { showInFolder } from "@/client/lib/show-in-files";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { DotsThreeIcon } from "@phosphor-icons/react/DotsThree";
import { TrashIcon } from "@phosphor-icons/react/Trash";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useContext, useState } from "react";
import { NEW_SKILL_ASK } from "@/client/lib/new-skill-ask";
import { toast } from "@/client/lib/toast";

type Skill = RPCOutput["workspace"]["skill"]["list"][number];

/**
 * The skills a task can load. A skill is a folder, so a row of one the app
 * doesn't ship opens that folder in Files, where it can be read, changed, or
 * handed to a chat.
 * Making a skill is an ask like any other: it opens a draft with the start
 * of the sentence in it.
 */
export function SkillsSection() {
  const ask = useAsk();
  return (
    <div className="space-y-8">
      {/* New skill drops under the words when both don't fit. */}
      <div
        className="flex flex-wrap items-start gap-x-4 gap-y-3"
        {...settingAnchor("new-skill")}
      >
        <div className="min-w-0 flex-1 basis-56">
          <h3 className="text-base font-semibold">Skills</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {`What ${APP_NAME} knows how to do beyond the basics, and where each skill comes from`}
          </p>
        </div>
        {ask ? (
          <Button
            className="text-foreground"
            onClick={() => {
              ask(NEW_SKILL_ASK);
            }}
            size="sm"
            variant="outline"
          >
            New skill
          </Button>
        ) : null}
      </div>
      <SkippedSkillFolders />
      <SkillList
        menu={(skill) => (skill.editable ? <SkillMenu skill={skill} /> : null)}
        onOpen={(skill) => {
          void showInFolder(skill.path, { kind: "folder" });
        }}
      />
    </div>
  );
}

// oxlint-disable studio/no-os-words -- a skills folder is skipped this way on macOS alone
/**
 * Skills folders the app leaves unread because they really are in a place
 * macOS guards, such as a `~/.claude/skills` linked into Documents. Load
 * looks inside one, which is when macOS asks, beside the button pressed.
 */
function SkippedSkillFolders() {
  const queryClient = useQueryClient();
  const skipped = useQuery(
    rpcClient.workspace.skill.skippedFolders.queryOptions(),
  );
  const load = useMutation(
    rpcClient.workspace.skill.loadFolder.mutationOptions(),
  );
  if (!skipped.data?.length) {
    return null;
  }
  const loadFolder = async (folder: string) => {
    const name = folder.split("/").at(-1) ?? folder;
    try {
      const { loaded } = await load.mutateAsync({ folder });
      await queryClient.invalidateQueries({
        queryKey: rpcClient.workspace.skill.key(),
      });
      if (!loaded) {
        toast(`Your Mac didn’t let Instrument read “${name}”`, {
          description:
            "You can allow it under Files and Folders in System Settings.",
        });
      }
    } catch (error) {
      toast.error(`Couldn't load “${name}”`, { cause: error });
    }
  };
  return (
    <section className="space-y-2">
      <h4 className="text-sm font-medium text-muted-foreground">
        Waiting to load
      </h4>
      <p className="text-sm text-muted-foreground">
        Your Mac requires permission before these skills can load.
      </p>
      <div className="divide-y overflow-hidden rounded-lg border">
        {skipped.data.map(({ folder }) => (
          <FolderRow
            className="p-3"
            end={
              <Button
                disabled={load.isPending}
                onClick={() => {
                  void loadFolder(folder);
                }}
                size="sm"
                variant="outline"
              >
                Load
              </Button>
            }
            key={folder}
            path={folder}
          />
        ))}
      </div>
    </section>
  );
}
// oxlint-enable studio/no-os-words

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
 * Opens a draft with the words in it, beside the tab Settings is in, or
 * `undefined` outside the app window, where there is no draft to open.
 */
function useAsk() {
  const appWindow = useContext(WindowContext);
  const from = useGroupTab()?.id;
  if (!appWindow) {
    return;
  }
  return (words: string) => {
    appWindow.ask(words, { from });
  };
}
