import { ShowInFolderIcon } from "@/client/components/icons/reveal-in-folder";
import { settingAnchor } from "@/client/components/settings/settings-index";
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
import { showInFolder, showInFolderLabel } from "@/client/lib/show-in-files";
import { osConventions } from "@/client/lib/utils";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { APP_NAME, typedHostPath } from "@instrument-org/shared";
import { DotsThreeOutlineVerticalIcon } from "@phosphor-icons/react/DotsThreeOutlineVertical";
import { FolderIcon } from "@phosphor-icons/react/Folder";
import { TrashIcon } from "@phosphor-icons/react/Trash";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "@/client/lib/toast";
import {
  FOLDER_REFUSAL_COPY,
  folderRefusalSentence,
  folderWarningSentence,
} from "@/shared/workspace-folder-refusal";

type InvalidFolder =
  RPCOutput["workspace"]["storage"]["invalidFolders"]["list"][number];

export function StorageSection() {
  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-base font-semibold">Storage</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Where {APP_NAME} keeps your chats, topics, and memories
        </p>
      </div>
      <InstrumentFolder />
      <UnrecognizedFolders />
    </div>
  );
}

function FolderGroup({
  folders,
  onReveal,
  onTrash,
}: {
  folders: InvalidFolder[];
  onReveal: (folder: InvalidFolder) => void;
  onTrash: (folder: InvalidFolder) => void;
}) {
  return (
    <div className="divide-y overflow-hidden rounded-lg border">
      {folders.map((folder) => (
        <div className="flex items-center gap-3 p-3" key={folder.path}>
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="truncate text-sm">{folder.name}</div>
            <p className="text-xs text-muted-foreground">{folder.reason}</p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="ghost">
                <DotsThreeOutlineVerticalIcon
                  className="size-4"
                  weight="fill"
                />
                <span className="sr-only">{`Actions for ${folder.name}`}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => {
                  onReveal(folder);
                }}
              >
                <ShowInFolderIcon
                  className="size-4 text-muted-foreground"
                  kind="folder"
                />
                <span>{showInFolderLabel("folder")}</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  onTrash(folder);
                }}
                variant="destructive"
              >
                <TrashIcon className="size-4" />
                <span>Move to {osConventions().trash}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ))}
    </div>
  );
}

function UnrecognizedFolders() {
  const queryClient = useQueryClient();
  const { data: folders } = useQuery(
    rpcClient.workspace.storage.invalidFolders.list.queryOptions(),
  );
  const trashMutation = useMutation(
    rpcClient.workspace.storage.invalidFolders.trash.mutationOptions(),
  );
  const [folderToTrash, setFolderToTrash] = useState<InvalidFolder | null>(
    null,
  );

  const confirmTrash = async () => {
    if (!folderToTrash) {
      return;
    }
    const folder = folderToTrash;
    setFolderToTrash(null);
    try {
      await trashMutation.mutateAsync({ name: folder.name });
      await queryClient.invalidateQueries({
        queryKey: rpcClient.workspace.storage.invalidFolders.list.key(),
      });
      toast.success(`Moved “${folder.name}” to the ${osConventions().trash}`);
    } catch (error) {
      toast.error(
        `Couldn't move “${folder.name}” to the ${osConventions().trash}`,
        {
          cause: error,
        },
      );
    }
  };

  if (!folders || folders.length === 0) {
    return null;
  }

  return (
    <section className="space-y-4" {...settingAnchor("broken-folders")}>
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <FolderIcon className="size-4" />
          <h4 className="text-sm font-medium">Chats that can’t be opened</h4>
        </div>
        <p className="text-sm text-muted-foreground">
          {APP_NAME} can’t open these chats because something in their folders
          is missing or damaged. You can find them on your computer or move them
          to the {osConventions().trash}.
        </p>
      </div>
      <FolderGroup
        folders={folders}
        onReveal={(folder) => {
          void showInFolder(folder.path, { kind: "folder" });
        }}
        onTrash={setFolderToTrash}
      />
      <AlertDialog
        onOpenChange={(open) => {
          if (!open) {
            setFolderToTrash(null);
          }
        }}
        open={folderToTrash !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {folderToTrash
                ? `Move “${folderToTrash.name}” to the ${osConventions().trash}?`
                : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              The folder goes to the {osConventions().trash}, so you can still
              get it back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void confirmTrash();
              }}
            >
              Move to {osConventions().trash}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

type FolderVerdict = RPCOutput["workspaces"]["checkFolder"];
type MoveRefusal = Extract<FolderVerdict, { kind: "refused" }>["reason"];

/** Why a folder the person picked can't take their Instrument folder, said to them. */
const REFUSALS: Record<MoveRefusal, string> = {
  home: folderRefusalSentence("home"),
  "other-workspace": folderRefusalSentence("other-workspace"),
  "own-data": folderRefusalSentence("own-data"),
  current: "That’s your Instrument folder, or a folder inside it or around it.",
  missing: "That folder isn’t there anymore.",
  "not-absolute": "That folder isn’t there anymore.",
  pinned: `This copy of ${APP_NAME} is set to keep its folder where it is.`,
  taken: `It already has a folder named .instrument that ${APP_NAME} didn’t make.`,
  unfinished: `${APP_NAME} is still updating your folder from an earlier version. Quit and reopen ${APP_NAME}, then try again.`,
  unwritable: `${APP_NAME} doesn’t have permission to save files there.`,
};

/**
 * Where the person's Instrument folder is, and moving it: a folder picked
 * in the system's own panel, then a confirmation that the app restarts to
 * move it there, or to open the Instrument folder already in it, which
 * leads with the warning when the place is a risky one. Where there is an
 * obvious better folder (`~/Instrument` for the home folder, a new folder
 * inside Documents), using it is the main choice, and a refused folder with
 * one is offered it rather than only refused.
 */
function InstrumentFolder() {
  const { data: folder } = useQuery(rpcClient.workspaces.folder.queryOptions());
  const [picked, setPicked] = useState<null | {
    path: string;
    verdict: FolderVerdict;
  }>(null);
  // Held from the confirmation until the app quits: the restart begins only
  // after the running-agent prompt and the quit teardown, a few seconds in
  // which a closed dialog would read as nothing happening.
  const [restarting, setRestarting] = useState(false);

  if (!folder) {
    return null;
  }

  const refuse = (reason: MoveRefusal) => {
    toast.error(`${APP_NAME} can’t move your folder there`, {
      description: REFUSALS[reason],
    });
  };

  const choose = async () => {
    const choice = await rpcClient.utils.showFolderPicker.call({
      buttonLabel: "Choose",
      message: "Choose where to keep your Instrument folder.",
      startingAt: folder.suggested,
    });
    if (!choice) {
      return;
    }
    const verdict = await rpcClient.workspaces.checkFolder.call({
      path: choice.path,
    });
    if (verdict.kind === "refused" && verdict.instead === undefined) {
      refuse(verdict.reason);
      return;
    }
    setPicked({ path: choice.path, verdict });
  };

  /** Moves to, or opens, the folder picked or the better one offered. */
  const confirm = async (choice: "instead" | "picked") => {
    if (!picked) {
      return;
    }
    const { instead } = picked.verdict;
    const target =
      choice === "instead" && instead !== undefined
        ? {
            create: true,
            opens: instead.holds === "workspace",
            path: instead.path,
          }
        : {
            create: false,
            opens: picked.verdict.kind === "workspace",
            path: picked.path,
          };
    setRestarting(true);
    try {
      if (!target.opens) {
        const moved = await rpcClient.workspaces.move.call({
          create: target.create,
          path: target.path,
        });
        if (moved.kind === "refused") {
          refuse(moved.reason);
        } else if (moved.kind === "on-next-launch") {
          toast.info(`Quit ${APP_NAME} and open it again to move your folder.`);
        }
        if (moved.kind !== "relaunching") {
          setPicked(null);
          setRestarting(false);
        }
        return;
      }
      const opened = await rpcClient.workspaces.open.call({
        path: target.path,
      });
      const { outcome } = opened;
      if (opened.outcome === "refused") {
        toast.error(`${APP_NAME} can’t open that folder`, {
          description: folderRefusalSentence(opened.reason),
        });
      } else if (outcome === "unsupported") {
        toast.info(
          `Quit ${APP_NAME} and open it again to switch to that folder.`,
        );
      }
      if (outcome !== "relaunching") {
        setPicked(null);
        setRestarting(false);
      }
    } catch (error) {
      toast.error(`${APP_NAME} couldn’t move your folder`, { cause: error });
      setPicked(null);
      setRestarting(false);
    }
  };

  // Where the folder is rather than its name: the suggested folder is
  // itself called Instrument, and "Move your Instrument folder to
  // “Instrument”" reads as moving it into itself.
  const where = picked ? typedHostPath(picked.path, window.api.homeDir) : "";
  const opensInstead = picked?.verdict.kind === "workspace";
  const warning = picked?.verdict.warning;
  const refusal =
    picked?.verdict.kind === "refused" ? picked.verdict.reason : undefined;
  const instead = picked?.verdict.instead;
  const insteadWhere = instead
    ? typedHostPath(instead.path, window.api.homeDir)
    : "";
  // A refused folder is shown only with a better one to offer, so the
  // dialog is about that one: why the pick won't do, then what the better
  // folder has in it already.
  const why =
    refusal === "home"
      ? `${FOLDER_REFUSAL_COPY.home.why}, so ${APP_NAME} needs a folder of its own inside it.`
      : warning !== undefined
        ? folderWarningSentence(warning)
        : refusal === "other-workspace" || refusal === "own-data"
          ? `${FOLDER_REFUSAL_COPY[refusal].why}.`
          : refusal !== undefined
            ? REFUSALS[refusal]
            : undefined;
  const offer =
    instead === undefined
      ? undefined
      : refusal !== undefined
        ? {
            files: `That folder already has files in it. ${APP_NAME} will restart and move your Instrument folder in beside them.`,
            nothing: `${APP_NAME} will make that folder, then restart and move your Instrument folder there.`,
            workspace: `That folder is already an Instrument folder. ${APP_NAME} will restart and open it, and your current folder stays where it is.`,
          }[instead.holds]
        : {
            files: `“${insteadWhere}” already has files in it, and your chats can go in beside them.`,
            nothing: `A new folder, “${insteadWhere}”, keeps your chats apart from everything else.`,
            workspace: `“${insteadWhere}” is already an Instrument folder, so you can open it instead.`,
          }[instead.holds];

  return (
    <section className="space-y-2" {...settingAnchor("instrument-folder")}>
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-medium text-muted-foreground">
          Instrument folder
        </h4>
        <div className="flex shrink-0 gap-2">
          <Button
            onClick={() => {
              void showInFolder(folder.path, { kind: "folder" });
            }}
            size="sm"
            variant="outline"
          >
            <ShowInFolderIcon className="size-4" kind="folder" />
            {showInFolderLabel("folder")}
          </Button>
          {!folder.pinned && (
            <Button
              onClick={() => {
                void choose();
              }}
              size="sm"
              variant="outline"
            >
              Move…
            </Button>
          )}
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        {folder.inAppData
          ? `Your chats, topics, and memories are kept here, with ${APP_NAME}’s own data. You can move them to a folder you choose, and what ${APP_NAME} makes for you will go there too.`
          : `Your chats, topics, and memories are kept here, and what ${APP_NAME} makes for you goes here too.`}
      </p>
      <div className="rounded-lg border bg-muted/40 px-3 py-2 select-text">
        <code className="font-mono text-xs break-all text-foreground">
          {typedHostPath(folder.path, window.api.homeDir)}
        </code>
      </div>
      <AlertDialog
        onOpenChange={(open) => {
          if (!open && !restarting) {
            setPicked(null);
          }
        }}
        open={picked !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {refusal !== undefined
                ? `Use “${insteadWhere}” instead?`
                : opensInstead
                  ? `“${where}” is already an Instrument folder`
                  : `Move your Instrument folder to “${where}”?`}
            </AlertDialogTitle>
            {why !== undefined && (
              <AlertDialogDescription className="text-warning-700 dark:text-warning-300">
                {why}
              </AlertDialogDescription>
            )}
            <AlertDialogDescription>
              {offer ??
                (opensInstead
                  ? `It has its own chats and memories. ${APP_NAME} can restart and open it instead, and your current folder stays where it is.`
                  : `${APP_NAME} will restart and move everything in your Instrument folder there, including any files of your own. What ${APP_NAME} makes for you will go there too.`)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restarting}>Cancel</AlertDialogCancel>
            {instead !== undefined && refusal === undefined && (
              <AlertDialogAction
                disabled={restarting}
                onClick={(event) => {
                  event.preventDefault();
                  void confirm("picked");
                }}
                variant="outline"
              >
                {opensInstead ? "Open Anyway" : "Move Anyway"}
              </AlertDialogAction>
            )}
            <AlertDialogAction
              disabled={restarting}
              onClick={(event) => {
                event.preventDefault();
                void confirm(instead === undefined ? "picked" : "instead");
              }}
            >
              {restarting
                ? "Restarting…"
                : instead !== undefined
                  ? `${instead.holds === "workspace" ? "Open" : "Use"} ${insteadWhere}`
                  : warning !== undefined
                    ? opensInstead
                      ? "Open Anyway"
                      : "Move Anyway"
                    : opensInstead
                      ? "Restart and Open"
                      : "Restart and Move"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
