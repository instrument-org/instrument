import { FolderTrail } from "@/client/components/folder-trail";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/client/components/ui/alert-dialog";
import { Button } from "@/client/components/ui/button";
import { FolderMark } from "@/client/components/window/folder-mark";
import { folderOf, nameOf } from "@/client/components/window/host-path";
import { locationCrumbs } from "@/client/components/window/tab-location";
import { useComputerVolumes } from "@/client/components/window/computer-volumes";
import {
  type Destination,
  type FolderPick,
  type MoveRefusal,
  refusalToast,
} from "@/client/components/instrument-folder-steps";
import { toast } from "@/client/lib/toast";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { folderWarningSentence } from "@/shared/workspace-folder-refusal";
import { APP_NAME } from "@instrument-org/shared";
import { EyeIcon } from "@phosphor-icons/react/Eye";
import { skipToken, useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

/**
 * Where the Instrument folder goes, the same in setup's folder step and in
 * Settings › Storage: a pick in the system's folder panel puts it in a
 * folder named for it inside the pick (`workspaces.checkPick`), and the one
 * question a pick can raise is asked in a small dialog straight after it.
 */

/** Says why a folder can't take the Instrument folder, in a toast (`refusalToast`). */
export function showRefusal(
  reason: MoveRefusal,
  where: { current: string | undefined; path: string },
) {
  const { description, title, tone } = refusalToast(reason, where);
  if (tone === "info") {
    toast.info(title, { description });
  } else {
    toast.error(title, { description });
  }
}

/** A folder's name as Files names it: iCloud Drive rather than its folder on disk. */
function useFolderName(path: string) {
  const volumes = useComputerVolumes();
  const crumbs = locationCrumbs(
    { kind: "folder", path },
    { home: window.api.homeDir, ...(volumes ? { volumes } : {}) },
  );
  const name = crumbs.at(-1)?.label ?? nameOf(path);
  // A place the computer names (iCloud Drive, a disk) is said as it is; a
  // folder the person named is quoted.
  const isPlace = volumes?.some((volume) => volume.path === path) ?? false;
  return isPlace ? name : `“${name}”`;
}

/**
 * What a destination already is, under its path: a folder still to be made,
 * an empty one, one with other files in it, or an Instrument folder and its
 * chats; and what the place is warned of, where that wasn't asked already.
 */
function DestinationLine({
  className,
  destination,
}: {
  className?: string;
  destination: Destination;
}) {
  const isWorkspace = destination.verdict.kind === "workspace";
  const { data: summary } = useQuery(
    rpcClient.workspaces.summary.queryOptions({
      input: isWorkspace ? { path: destination.path } : skipToken,
    }),
  );
  const chats = summary?.chats ?? 0;
  const line = isWorkspace
    ? chats > 0
      ? `${APP_NAME} folder with ${String(chats)} ${chats === 1 ? "chat" : "chats"}`
      : `${APP_NAME} folder`
    : {
        empty: "Empty folder",
        files: "Has other files in it",
        new: "New folder",
      }[destination.contents];
  const { warning } = destination.verdict;
  return (
    <span className={cn("flex flex-col gap-0.5 text-xs", className)}>
      <span className="text-muted-foreground">{line}</span>
      {warning !== undefined && warning !== "personal" ? (
        <span className="text-warning-700 dark:text-warning-300">
          {folderWarningSentence(warning)}
        </span>
      ) : null}
    </span>
  );
}

/**
 * A destination as one row, the same in setup's Location card, the move
 * confirmation and the questions: its mark, its whole path, what it already
 * is, and `end` (Change, or Show in a question). A `path` with no
 * `destination` is one not looked at yet, which says nothing under it.
 */
export function DestinationRow({
  className,
  destination,
  end,
  path,
  trailClassName,
}: {
  className?: string;
  destination?: Destination | undefined;
  end?: ReactNode;
  path: string;
  trailClassName?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-3 p-3", className)}>
      <span className="flex w-7 shrink-0 justify-center">
        <FolderMark path={path} size="row" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <FolderTrail className={cn("text-sm", trailClassName)} path={path} />
        {destination === undefined ? null : (
          <DestinationLine destination={destination} />
        )}
      </span>
      {end}
    </div>
  );
}

/** Shows a folder that is there in the system's file manager, from a question about it. */
function ShowButton({ path }: { path: string }) {
  return (
    <Button
      onClick={() => {
        void rpcClient.utils.openFolder.call({ folderPath: path });
      }}
      size="sm"
      variant="outline"
    >
      <EyeIcon className="size-3.5" />
      Show
    </Button>
  );
}

/** The question a pick raised, and the folders it is about. */
type Asking =
  | { folder: Destination; itself: Destination; kind: "make" }
  | { folder: Destination; kind: "has-files"; picked: string };

/**
 * Picking where the Instrument folder goes: the system's panel, the check
 * of the pick, and the question it raises, if any, before `onPicked` hears
 * the folder to use. A pick with other files in it and no folder named for
 * the app inside asks whether to make one; a folder to use that already has
 * other files asks before the app's files go in beside them, and Choose
 * Another… opens the panel again. Refusals reach `onPicked` as they are, for
 * the screen to say in its own way. `settle` answers a check made without
 * the panel, which setup's suggested folder is.
 */
export function useFolderPick(onPicked: (destination: Destination) => void) {
  const [asking, setAsking] = useState<Asking | null>(null);

  const settle = (pick: FolderPick, picked: string) => {
    const { folder, itself } = pick;
    if (itself !== undefined) {
      setAsking({ folder, itself, kind: "make" });
    } else if (
      folder.contents === "files" &&
      folder.verdict.kind === "movable"
    ) {
      setAsking({ folder, kind: "has-files", picked });
    } else {
      onPicked(folder);
    }
  };

  const choose = async (startingAt: string) => {
    const choice = await rpcClient.utils.showFolderPicker.call({
      buttonLabel: "Choose",
      message: `Choose where to put your ${APP_NAME} folder.`,
      startingAt,
    });
    if (!choice) {
      return;
    }
    settle(
      await rpcClient.workspaces.checkPick.call({ path: choice.path }),
      choice.path,
    );
  };

  const answer = (destination: Destination) => {
    setAsking(null);
    onPicked(destination);
  };

  const dialog = (
    <AlertDialog
      onOpenChange={(open) => {
        if (!open) {
          setAsking(null);
        }
      }}
      open={asking !== null}
    >
      <AlertDialogContent>
        {asking?.kind === "make" ? (
          <MakeQuestion
            itself={asking.itself}
            onMake={() => {
              answer(asking.folder);
            }}
            onUseItself={() => {
              answer(asking.itself);
            }}
          />
        ) : asking?.kind === "has-files" ? (
          <HasFilesQuestion
            folder={asking.folder}
            onChooseAnother={() => {
              setAsking(null);
              void choose(folderOf(asking.picked));
            }}
            onUse={() => {
              answer(asking.folder);
            }}
            picked={asking.picked}
          />
        ) : null}
      </AlertDialogContent>
    </AlertDialog>
  );

  return { choose, dialog, settle };
}

/** Whether to make a folder for the app inside a pick that has other files in it. */
function MakeQuestion({
  itself,
  onMake,
  onUseItself,
}: {
  itself: Destination;
  onMake: () => void;
  onUseItself: () => void;
}) {
  const name = useFolderName(itself.path);
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>
          Make a folder for {APP_NAME} in {name}?
        </AlertDialogTitle>
        <AlertDialogDescription>
          {name} has other files in it. A folder of its own keeps {APP_NAME}’s
          files apart from yours.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <div className="overflow-hidden rounded-lg border">
        <DestinationRow
          destination={itself}
          end={<ShowButton path={itself.path} />}
          path={itself.path}
        />
      </div>
      <AlertDialogFooter>
        <AlertDialogAction onClick={onUseItself} variant="outline">
          Don’t Make One
        </AlertDialogAction>
        <AlertDialogAction onClick={onMake}>Make Folder</AlertDialogAction>
      </AlertDialogFooter>
    </>
  );
}

/** Whether to use a folder that already has other files in it. */
function HasFilesQuestion({
  folder,
  onChooseAnother,
  onUse,
  picked,
}: {
  folder: Destination;
  onChooseAnother: () => void;
  onUse: () => void;
  picked: string;
}) {
  const pickedName = useFolderName(picked);
  const folderName = useFolderName(folder.path);
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>
          {folder.path === picked
            ? `${folderName} already has other files in it`
            : `${pickedName} already has a folder named ${folderName}`}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {folder.path === picked
            ? `${APP_NAME}’s files would go in beside them.`
            : `It has other files in it, and ${APP_NAME}’s files would go in beside them.`}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <div className="overflow-hidden rounded-lg border">
        <DestinationRow
          destination={folder}
          end={<ShowButton path={folder.path} />}
          path={folder.path}
        />
      </div>
      <AlertDialogFooter>
        <AlertDialogAction onClick={onChooseAnother} variant="outline">
          Choose Another…
        </AlertDialogAction>
        <AlertDialogAction onClick={onUse}>Use It Anyway</AlertDialogAction>
      </AlertDialogFooter>
    </>
  );
}
