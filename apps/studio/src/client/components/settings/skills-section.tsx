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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { WindowContext } from "@/client/components/window/context";
import { useGroupTab } from "@/client/components/window/group-tab";
import { showInFolder, showInFolderLabel } from "@/client/lib/show-in-files";
import { ShowInFolderIcon } from "@/client/components/icons/reveal-in-folder";
import { joinHostPath } from "@/client/components/window/host-path";
import { useWorkspaceFolder } from "@/client/lib/output-folder";
import { SKILLS_FOLDER_NAME } from "@instrument-org/workspace/client";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { DotsThreeIcon } from "@phosphor-icons/react/DotsThree";
import { TrashIcon } from "@phosphor-icons/react/Trash";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useContext, useState } from "react";
import { NEW_SKILL_ASK } from "@/client/lib/new-skill-ask";
import { skillMentionToken } from "@instrument-org/shared/skill-mention";
import { toast } from "@/client/lib/toast";
import { refreshSkills } from "@/client/hooks/use-refresh-skills-on-change";
import { osConventions } from "@/client/lib/utils";
import {
  toastWithUndo,
  withdrawUndoOffer,
} from "@/client/components/window/undo-offers";

type Skill = RPCOutput["workspace"]["skill"]["list"][number];

/**
 * The skills a task can load, the person's own first. A skill is a folder,
 * so a row of one the app doesn't ship opens that folder in Files, where it
 * can be read, changed, or handed to a chat.
 * Making a skill is an ask like any other: it opens a draft with the start
 * of the sentence in it.
 */
export function SkillsSection() {
  const ask = useAsk();
  const workspaceFolder = useWorkspaceFolder();
  const newSkill = ask
    ? () => {
        ask(NEW_SKILL_ASK);
      }
    : undefined;
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
            {`A skill teaches ${APP_NAME} how to do one kind of work, such as a weekly report.`}
          </p>
        </div>
        {newSkill ? (
          <Button
            className="text-foreground"
            onClick={newSkill}
            size="sm"
            variant="outline"
          >
            New skill
          </Button>
        ) : null}
      </div>
      <SkippedSkillFolders />
      <BrokenSkills ask={ask} />
      <SkillList
        empty={
          <NoSkills
            onNewSkill={newSkill}
            skillsFolder={
              workspaceFolder === undefined
                ? undefined
                : joinHostPath(workspaceFolder, SKILLS_FOLDER_NAME)
            }
          />
        }
        menu={(skill) => (skill.editable ? <SkillMenu skill={skill} /> : null)}
        onOpen={(skill) => {
          void showInFolder(skill.path, { kind: "folder" });
        }}
      />
    </div>
  );
}

/** Where the person's own skills would be listed while they have none. */
function NoSkills({
  onNewSkill,
  skillsFolder,
}: {
  onNewSkill: (() => void) | undefined;
  skillsFolder: string | undefined;
}) {
  return (
    <div className="rounded-xl border border-dashed px-6 py-7 text-center @max-sm/app-content:px-4">
      <p className="text-sm font-medium">No skills yet</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Skills you make, or add to your Skills folder, show here.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {onNewSkill ? (
          <Button
            className="text-foreground"
            onClick={onNewSkill}
            size="sm"
            variant="outline"
          >
            New skill
          </Button>
        ) : null}
        {skillsFolder === undefined ? null : (
          <Button
            className="text-foreground"
            onClick={() => {
              void showInFolder(skillsFolder, { kind: "folder" });
            }}
            size="sm"
            variant="outline"
          >
            <ShowInFolderIcon kind="folder" />
            {showInFolderLabel("folder")}
          </Button>
        )}
      </div>
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
      await refreshSkills(queryClient);
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

type BrokenSkill = RPCOutput["workspace"]["skill"]["broken"][number];

/** What is wrong with a skill no chat can load, as a person fixing it reads it. */
const BROKEN_SKILL_PROBLEMS: Record<BrokenSkill["problem"], string> = {
  "no-description": "SKILL.md has no description",
  "no-frontmatter": "SKILL.md doesn’t start with a name and description",
  "no-skill-file": "This folder has no SKILL.md",
  unparsable: "The header at the top of SKILL.md can’t be read",
  unterminated: "The header at the top of SKILL.md has no closing ---",
};

/**
 * Folders in the workspace's Skills folder that no chat can load, each with
 * what is wrong and a draft asking a chat to fix it. Only here: the agent's
 * list and the composer's menus leave them out.
 */
function BrokenSkills({ ask }: { ask: ((words: string) => void) | undefined }) {
  const broken = useQuery(rpcClient.workspace.skill.broken.queryOptions());
  if (!broken.data?.length) {
    return null;
  }
  return (
    <section className="space-y-2">
      <h4 className="text-sm font-medium text-muted-foreground">Can’t load</h4>
      <p className="text-sm text-muted-foreground">
        Chats can’t use these skills until they’re fixed.
      </p>
      <div className="divide-y overflow-hidden rounded-lg border">
        {broken.data.map((skill) => (
          <FolderRow
            // At the narrowest the words take the row and Fix in chat goes under them.
            className="p-3 @max-sm/app-content:flex-wrap @max-sm/app-content:[&>button]:basis-full"
            end={
              ask ? (
                <Button
                  onClick={() => {
                    ask(fixSkillAsk(skill));
                  }}
                  size="sm"
                  variant="outline"
                >
                  Fix in chat
                </Button>
              ) : null
            }
            key={skill.folder}
            line={BROKEN_SKILL_PROBLEMS[skill.problem]}
            onOpen={() => {
              void showInFolder(skill.folder, { kind: "folder" });
            }}
            path={skill.folder}
          />
        ))}
      </div>
    </section>
  );
}

/** The message that asks a chat to fix a skill, naming the skill that knows how one is written. */
function fixSkillAsk(skill: BrokenSkill) {
  return `Use ${skillMentionToken("skill-creator")} to fix the “${skill.name}” skill in Skills. ${BROKEN_SKILL_PROBLEMS[skill.problem]}.`;
}

/**
 * The "⋯" on a row of the workspace's own skills, the ones it can move to the
 * Trash: it opens the skill's folder, or moves the skill to the Trash as
 * Files moves a folder there, so the toast's Undo, or ⌘Z in Files, puts it
 * back.
 */
function SkillMenu({ skill }: { skill: Skill }) {
  const queryClient = useQueryClient();
  const trash = useMutation(rpcClient.files.trash.mutationOptions());
  const [isConfirming, setConfirming] = useState(false);
  const trashName = osConventions().trash;

  const putBack = async (journalId: string) => {
    try {
      const undone = await rpcClient.files.undo.call({ journalId });
      withdrawUndoOffer(undone.journalId);
    } catch (error) {
      toast.error("Couldn't put that back", { cause: error });
    }
    await refreshSkills(queryClient);
  };

  const confirmTrash = async () => {
    let journalId: string | null;
    try {
      ({ journalId } = await trash.mutateAsync({ path: skill.path }));
      await refreshSkills(queryClient);
    } catch (error) {
      toast.error(`Couldn't move “${skill.title}” to the ${trashName}`, {
        cause: error,
      });
      return;
    }
    setConfirming(false);
    toastWithUndo(
      `Moved “${skill.title}” to the ${trashName}`,
      journalId === null
        ? null
        : {
            journalIds: [journalId],
            undo: () => {
              void putBack(journalId);
            },
          },
    );
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
              void showInFolder(skill.path, { kind: "folder" });
            }}
          >
            <ShowInFolderIcon className="size-4" kind="folder" />
            <span>{showInFolderLabel("folder")}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              setConfirming(true);
            }}
            variant="destructive"
          >
            <TrashIcon className="size-4" />
            <span>{`Move to ${trashName}…`}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog onOpenChange={setConfirming} open={isConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{`Move “${skill.title}” to the ${trashName}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {`Chats stop using it. You can put it back from the ${trashName}.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={trash.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={trash.isPending}
              onClick={(event) => {
                // Held open until the move lands, so a failure is said
                // over the dialog it came from.
                event.preventDefault();
                void confirmTrash();
              }}
            >
              {`Move to ${trashName}`}
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
