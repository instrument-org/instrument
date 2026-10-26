import { copyFolderPath, FolderRow } from "@/client/components/folder-row";
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
import { folderOf } from "@/client/components/window/host-path";
import { folderLabel } from "@/client/lib/path-utils";
import { showInFolder, showInFolderLabel } from "@/client/lib/show-in-files";
import { osConventions } from "@/client/lib/utils";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { ArrowRightIcon } from "@phosphor-icons/react/ArrowRight";
import { ClipboardTextIcon } from "@phosphor-icons/react/ClipboardText";
import { DotsThreeOutlineVerticalIcon } from "@phosphor-icons/react/DotsThreeOutlineVertical";
import { FolderIcon } from "@phosphor-icons/react/Folder";
import { TrashIcon } from "@phosphor-icons/react/Trash";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "@/client/lib/toast";
import { folderRefusalSentence } from "@/shared/workspace-folder-refusal";
import {
  type Destination,
  DestinationRow,
  useFolderPick,
} from "@/client/components/instrument-folder";
import { ProhibitIcon } from "@phosphor-icons/react/Prohibit";

type InvalidFolder =
  RPCOutput["workspace"]["storage"]["invalidFolders"]["list"][number];

export function StorageSection() {
  return (
    <div className="space-y-8">
      <h3 className="text-base font-semibold">Storage</h3>
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
        <FolderRow
          end={
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
                <DropdownMenuItem
                  onSelect={() => {
                    void copyFolderPath(folder.path);
                  }}
                >
                  <ClipboardTextIcon className="size-4 text-muted-foreground" />
                  <span>Copy Path</span>
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
          }
          key={folder.path}
          menu={[
            {
              destructive: true,
              icon: <TrashIcon className="size-4" />,
              label: `Move to ${osConventions().trash}`,
              onSelect: () => {
                onTrash(folder);
              },
            },
          ]}
          name={folder.name}
          note={folder.reason}
          path={folder.path}
        />
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
export type MoveRefusal = Extract<FolderVerdict, { kind: "refused" }>["reason"];

/** Why a folder the person picked can't take their Instrument folder, said to them. */
export const REFUSALS: Record<MoveRefusal, string> = {
  home: folderRefusalSentence("home"),
  "other-workspace": folderRefusalSentence("other-workspace"),
  "own-data": folderRefusalSentence("own-data"),
  around: "Your Instrument folder is inside that folder.",
  current: "That’s where your Instrument folder already is.",
  inside: "That folder is inside your Instrument folder.",
  missing: "That folder isn’t there anymore.",
  newer: `A newer version of ${APP_NAME} made that folder. Update ${APP_NAME} to open it.`,
  "not-absolute": "That folder isn’t there anymore.",
  pinned: `This copy of ${APP_NAME} is set to keep its folder where it is.`,
  taken: `It already has a folder named .instrument that ${APP_NAME} didn’t make.`,
  unfinished: `${APP_NAME} is still updating your folder from an earlier version. Quit and reopen ${APP_NAME}, then try again.`,
  unwritable: `${APP_NAME} doesn’t have permission to save files there.`,
};

/**
 * Where the person's Instrument folder is, and moving it: a folder picked
 * in the system's own panel puts it in a folder named for it inside the
 * pick (`useFolderPick`), then a confirmation from where to where, with
 * Change to pick again, that the app restarts to move it there. A pick that
 * is already an Instrument folder can't take this one, which the
 * confirmation says with the move turned off; Open another folder… is how
 * one is opened instead.
 */
function InstrumentFolder() {
  const { data: folder } = useQuery(rpcClient.workspaces.folder.queryOptions());
  const [to, setTo] = useState<Destination | null>(null);
  const [opening, setOpening] = useState<null | string>(null);
  // Held from the confirmation until the app quits: the restart begins only
  // after the running-agent prompt and the quit teardown, a few seconds in
  // which a closed dialog would read as nothing happening.
  const [restarting, setRestarting] = useState(false);
  const pick = useFolderPick((destination) => {
    const { verdict } = destination;
    if (verdict.kind === "refused" && folder) {
      refuse(verdict.reason, destination.path, folder.path);
      return;
    }
    setTo(destination);
  });

  if (!folder) {
    return null;
  }

  /**
   * Another Instrument folder to switch to, which a confirmation opens with
   * one restart. Both folders stay as they are.
   */
  const chooseAnother = async () => {
    const choice = await rpcClient.utils.showFolderPicker.call({
      buttonLabel: "Open",
      message: "Choose an Instrument folder to open.",
      startingAt: folder.suggested,
    });
    if (!choice) {
      return;
    }
    const verdict = await rpcClient.workspaces.checkFolder.call({
      path: choice.path,
    });
    if (verdict.kind === "workspace") {
      setOpening(choice.path);
    } else if (verdict.kind === "refused" && verdict.reason !== "missing") {
      refuse(verdict.reason, choice.path, folder.path);
    } else {
      toast.error(`“${folderLabel(choice.path)}” isn’t an Instrument folder`, {
        description: "Choose the folder that has your chats in it.",
      });
    }
  };

  const moveThere = async (destination: Destination) => {
    setRestarting(true);
    try {
      const moved = await rpcClient.workspaces.move.call({
        create: destination.contents === "new",
        path: destination.path,
      });
      if (moved.kind === "refused") {
        refuse(moved.reason, destination.path, folder.path);
      } else if (moved.kind === "on-next-launch") {
        toast.info(`Quit ${APP_NAME} and open it again to move your folder.`);
      }
      if (moved.kind !== "relaunching") {
        setTo(null);
        setRestarting(false);
      }
    } catch (error) {
      toast.error(`${APP_NAME} couldn’t move your folder`, { cause: error });
      setTo(null);
      setRestarting(false);
    }
  };

  const openThere = async (path: string) => {
    setRestarting(true);
    try {
      const opened = await rpcClient.workspaces.open.call({ path });
      if (opened.outcome === "refused") {
        toast.error(`${APP_NAME} can’t open that folder`, {
          description: folderRefusalSentence(opened.reason),
        });
      } else if (opened.outcome === "unsupported") {
        toast.info(
          `Quit ${APP_NAME} and open it again to switch to that folder.`,
        );
      }
      if (opened.outcome !== "relaunching") {
        setOpening(null);
        setRestarting(false);
      }
    } catch (error) {
      toast.error(`${APP_NAME} couldn’t open that folder`, { cause: error });
      setOpening(null);
      setRestarting(false);
    }
  };

  const isOtherWorkspace = to?.verdict.kind === "workspace";
  const choose = () => {
    void pick.choose(to ? folderOf(to.path) : folder.suggested);
  };

  return (
    <section className="space-y-2" {...settingAnchor("instrument-folder")}>
      <h4 className="text-sm font-medium text-muted-foreground">
        Instrument folder
      </h4>
      <p className="text-sm text-muted-foreground">
        {folder.inAppData
          ? `Your chats, topics and memories are kept in your Instrument folder, with ${APP_NAME}’s own data. You can move it to a folder you choose, and what ${APP_NAME} makes for you will go there too.`
          : `Your chats, topics and memories are kept in your Instrument folder, and what ${APP_NAME} makes for you goes there too.`}
      </p>
      <div className="overflow-hidden rounded-lg border">
        <FolderRow
          end={
            folder.pinned ? null : (
              <Button onClick={choose} size="sm" variant="outline">
                Move…
              </Button>
            )
          }
          menu={
            folder.pinned
              ? []
              : [
                  {
                    icon: <ArrowRightIcon className="size-4" />,
                    label: "Move…",
                    onSelect: choose,
                  },
                ]
          }
          path={folder.path}
        />
      </div>
      {!folder.pinned && (
        <Button
          className="h-auto px-0 text-muted-foreground"
          onClick={() => {
            void chooseAnother();
          }}
          size="sm"
          variant="link"
        >
          Open another folder…
        </Button>
      )}
      {pick.dialog}
      <AlertDialog
        onOpenChange={(open) => {
          if (!open && !restarting) {
            setTo(null);
          }
        }}
        open={to !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move your Instrument folder?</AlertDialogTitle>
            <AlertDialogDescription>
              {to?.contents === "new"
                ? `${APP_NAME} will make this folder, then restart to move your chats there.`
                : `${APP_NAME} will restart to move your chats there.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">From</p>
            <div className="overflow-hidden rounded-lg border">
              <FolderRow actions={false} path={folder.path} />
            </div>
            <p className="pt-1 text-xs font-medium text-muted-foreground">To</p>
            {to === null ? null : (
              <div className="overflow-hidden rounded-lg border">
                <DestinationRow
                  destination={to}
                  end={
                    <Button
                      disabled={restarting}
                      onClick={choose}
                      size="sm"
                      variant="ghost"
                    >
                      Change
                    </Button>
                  }
                />
              </div>
            )}
          </div>
          {isOtherWorkspace ? (
            <p className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <ProhibitIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
              You can’t move one Instrument folder into another. Choose a
              different place for yours.
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restarting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={restarting || isOtherWorkspace}
              onClick={(event) => {
                event.preventDefault();
                if (to) {
                  void moveThere(to);
                }
              }}
            >
              {restarting ? "Restarting…" : "Restart and Move"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        onOpenChange={(open) => {
          if (!open && !restarting) {
            setOpening(null);
          }
        }}
        open={opening !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Open “{opening ? folderLabel(opening) : ""}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              It has its own chats and memories. {APP_NAME} will restart and
              open it, and the folder you’re using now stays where it is.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {opening === null ? null : (
            <div className="overflow-hidden rounded-lg border">
              <FolderRow actions={false} path={opening} />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restarting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={restarting}
              onClick={(event) => {
                event.preventDefault();
                if (opening) {
                  void openThere(opening);
                }
              }}
            >
              {restarting ? "Restarting…" : "Restart and Open"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/**
 * Says why a folder can't take the Instrument folder. Where the folder
 * already is is nothing to do rather than a refusal, and the two folders
 * that can't take it by where they are say which one was picked.
 */
function refuse(reason: MoveRefusal, picked: string, current: string) {
  const name = folderLabel(picked);
  switch (reason) {
    case "current": {
      toast.info(
        `Your Instrument folder is already in “${folderLabel(folderOf(current))}”.`,
      );
      return;
    }
    case "inside": {
      toast.error("Choose a folder outside your Instrument folder", {
        description: `“${name}” is inside it.`,
      });
      return;
    }
    case "around": {
      toast.error(`${APP_NAME} can’t move your folder there`, {
        description: `Your Instrument folder is inside “${name}”.`,
      });
      return;
    }
    default: {
      toast.error(`${APP_NAME} can’t move your folder there`, {
        description: REFUSALS[reason],
      });
    }
  }
}
