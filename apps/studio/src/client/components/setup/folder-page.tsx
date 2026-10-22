import { REFUSALS } from "@/client/components/settings/storage-section";
import { Spinner } from "@/client/components/ui/spinner";
import { folderOf } from "@/client/components/window/host-path";
import { toast } from "@/client/lib/toast";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { folderWarningSentence } from "@/shared/workspace-folder-refusal";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { FolderLocation, FolderNote } from "./kit/folder-row";
import { SetupFooter, SetupPage } from "./kit/setup-page";
import { SetupPageSwitch } from "./kit/setup-page-switch";
import { PackedFolder } from "./folder-illustration";
import {
  count,
  folderAction,
  type FoundNote,
  foundNote,
  them,
} from "./folder-flow";
import { type SetupPageProps } from "./setup-page-props";
import { useSetupState } from "./use-setup-state";

/** How long the page saying the app restarts shows before the restart. */
const RESTART_NOTICE_MS = 3000;

/** A note under the folder, for the folder it was found in. */
type Note = FoundNote | { kind: "denied" } | { kind: "unfinished" };

/**
 * Where the Instrument folder lives (frames 05 to 09). Documents is
 * suggested, and nothing is made there until Continue, which is when a Mac
 * that guards Documents asks. A refusal falls back to the home folder with a note
 * and Fix; a folder with things in it, or one that is already an Instrument
 * folder, says so as soon as it is on screen, and Continue goes on past it.
 * Moving the folder, or opening one that is already an Instrument folder,
 * restarts the app, so the page says that first and holds the step on screen
 * meanwhile.
 */
export function FolderPage({ hold, onBack, onContinue }: SetupPageProps) {
  const { data: folder } = useQuery(rpcClient.workspaces.folder.queryOptions());
  const hasChats = useSetupState()?.facts.hasChats ?? false;
  const [picked, setPicked] = useState<null | string>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [busy, setBusy] = useState(false);
  // What Continue is doing to the folder while the app restarts for it.
  const [moving, setMoving] = useState<"move" | "open" | null>(null);

  // The folder on screen: the one picked, or the one in Documents setup
  // suggests, once the current folder has loaded.
  const target = picked ?? folder?.inDocuments;
  // A risky place (Documents itself, a temporary folder) is said under it,
  // and Continue can still go past it.
  const { data: targetCheck } = useQuery(
    rpcClient.workspaces.checkFolder.queryOptions({
      input: target === undefined ? skipToken : { path: target },
    }),
  );
  // What is in it already, so an Instrument folder with chats, or a folder
  // with things in it, is said as soon as it is on screen. Read only from a
  // folder that is there, so a folder still to be made reads nothing.
  const { data: targetSummary } = useQuery(
    rpcClient.workspaces.summary.queryOptions({
      input:
        target !== undefined &&
        (targetCheck?.kind === "workspace" || targetCheck?.kind === "movable")
          ? { path: target }
          : skipToken,
    }),
  );
  // The chats a move would bring along, for a folder with things in it.
  const { data: currentSummary } = useQuery(
    rpcClient.workspaces.summary.queryOptions({
      input: hasChats && folder ? { path: folder.path } : skipToken,
    }),
  );
  const found =
    targetCheck && targetSummary !== undefined
      ? foundNote(
          folderAction({
            seen: null,
            summary: targetSummary,
            verdict: targetCheck,
          }),
          currentSummary?.chats ?? 0,
        )
      : null;
  const shown = note ?? found;

  const pick = (path: string) => {
    setPicked(path);
    setNote(null);
  };

  /** Moves into `path` (or opens it), restarting the app. */
  const go = async (
    current: { inDocuments: string; inHome: string },
    path: string,
    how: { create: boolean; type: "move" } | { type: "open" },
  ) => {
    hold();
    setMoving(how.type);
    // The restart is said long enough to read before it happens.
    await new Promise((resolve) => {
      window.setTimeout(resolve, RESTART_NOTICE_MS);
    });
    try {
      if (how.type === "open") {
        const opened = await rpcClient.workspaces.open.call({ path });
        if (
          opened.outcome === "relaunching" ||
          opened.outcome === "unsupported"
        ) {
          onContinue();
          return;
        }
        toast.error(`${APP_NAME} can’t open that folder`);
      } else {
        const moved = await rpcClient.workspaces.move.call({
          create: how.create,
          path,
        });
        if (moved.kind === "relaunching" || moved.kind === "on-next-launch") {
          onContinue();
          return;
        }
        if (moved.kind === "refused") {
          if (moved.reason === "unfinished") {
            setMoving(null);
            setNote({ kind: "unfinished" });
            return;
          }
          if (moved.reason === "unwritable" && path === current.inDocuments) {
            setMoving(null);
            setPicked(current.inHome);
            setNote({ kind: "denied" });
            return;
          }
          toast.error(`${APP_NAME} can’t keep your folder there`, {
            description: REFUSALS[moved.reason],
          });
        }
      }
    } catch (error) {
      toast.error(`${APP_NAME} couldn’t move your folder`, { cause: error });
    }
    setMoving(null);
  };

  const proceed = async () => {
    if (!folder || target === undefined) {
      return;
    }
    setBusy(true);
    try {
      const [verdict, summary] = await Promise.all([
        rpcClient.workspaces.checkFolder.call({ path: target }),
        rpcClient.workspaces.summary.call({ path: target }),
      ]);
      const action = folderAction({
        seen:
          shown?.kind === "earlier" || shown?.kind === "exists"
            ? shown.kind
            : null,
        summary,
        verdict,
      });
      switch (action.type) {
        case "move":
        case "open": {
          await go(folder, target, action);
          return;
        }
        case "exists": {
          const current = hasChats
            ? await rpcClient.workspaces.summary.call({ path: folder.path })
            : null;
          setNote({
            items: action.items,
            kind: "exists",
            moving: current?.chats ?? 0,
          });
          return;
        }
        case "earlier": {
          setNote({ chats: action.chats, kind: "earlier" });
          return;
        }
        case "denied": {
          if (target === folder.inDocuments) {
            setPicked(folder.inHome);
            setNote({ kind: "denied" });
          } else {
            toast.error(`${APP_NAME} can’t keep your folder there`, {
              description: REFUSALS.unwritable,
            });
          }
          return;
        }
        case "unfinished": {
          setNote({ kind: "unfinished" });
          return;
        }
        case "refused": {
          toast.error(`${APP_NAME} can’t keep your folder there`, {
            description: REFUSALS[action.reason],
          });
          return;
        }
      }
    } catch (error) {
      toast.error(`${APP_NAME} couldn’t check that folder`, { cause: error });
    } finally {
      setBusy(false);
    }
  };

  /** The system's own panel: picking a folder there is also how macOS gives access to it. */
  const choose = async (startingAt: string) => {
    const choice = await rpcClient.utils.showFolderPicker.call({
      buttonLabel: "Choose",
      message: "Choose where to keep your Instrument folder.",
      startingAt,
    });
    if (!choice) {
      return;
    }
    // A pick of Documents or the home folder itself means a new folder inside it.
    const verdict = await rpcClient.workspaces.checkFolder.call({
      path: choice.path,
    });
    pick(verdict.instead?.path ?? choice.path);
  };

  const showFolder = () => {
    if (target !== undefined) {
      void rpcClient.utils.openFolder.call({ folderPath: target });
    }
  };

  const warning = targetCheck?.warning;
  return (
    <SetupPageSwitch
      depth={moving === null ? 0 : 1}
      page={moving === null ? "folder" : "moving"}
    >
      {moving !== null ? (
        <MovingPage how={moving} hasChats={hasChats} />
      ) : (
        <SetupPage
          footer={
            <SetupFooter
              onBack={onBack}
              next={target === undefined ? "off" : "primary"}
              onContinue={() => {
                void proceed();
              }}
              pending={busy}
            />
          }
          hero={<PackedFolder />}
          subtitle={`This is where ${APP_NAME} keeps your chats, topics and the files it makes`}
          title="Where should your Instrument folder live?"
        >
          <div className="mt-8">
            <FolderLocation
              onChange={
                target === undefined
                  ? undefined
                  : () => {
                      void choose(folderOf(target));
                    }
              }
              path={target}
            >
              {shown?.kind === "denied" && (
                <FolderNote
                  action={{
                    label: "Fix",
                    onClick: () => {
                      if (folder) {
                        void choose(folderOf(folder.inDocuments));
                      }
                    },
                  }}
                  line="Most users place their Instrument folder in Documents. If you don't allow access, we'll place it in your home folder instead."
                  title={`${APP_NAME} was denied access to your Documents folder.`}
                />
              )}
              {shown?.kind === "exists" && (
                <FolderNote
                  action={{ label: "Show folder", onClick: showFolder }}
                  line={
                    shown.moving > 0
                      ? `We'll keep ${them(shown.items)} and move your ${count(shown.moving, "chat")} in beside ${them(shown.items)}.`
                      : `We'll keep ${them(shown.items)} and add your chats and files beside ${them(shown.items)}.`
                  }
                  title={`This folder already has ${count(shown.items, "item")}.`}
                />
              )}
              {shown?.kind === "earlier" && (
                <FolderNote
                  action={{ label: "Show folder", onClick: showFolder }}
                  line={`We'll open ${them(shown.chats)}, so you can pick up where you left off.`}
                  title={`This folder has ${count(shown.chats, "chat")} from ${APP_NAME}.`}
                />
              )}
              {shown?.kind === "unfinished" && (
                <FolderNote
                  action={{
                    label: "Keep it where it is for now",
                    onClick: onContinue,
                  }}
                  line={`Quit and reopen ${APP_NAME}, then try again. Or keep your folder where it is for now, and move it later in Settings.`}
                  title={`${APP_NAME} is still updating your folder from an earlier version.`}
                />
              )}
              {shown === null && warning !== undefined && (
                <FolderNote
                  line={folderWarningSentence(warning)}
                  title={`This might not be the best place for your ${APP_NAME} folder.`}
                />
              )}
            </FolderLocation>
          </div>
        </SetupPage>
      )}
    </SetupPageSwitch>
  );
}

/**
 * What shows while the move, or the open of a folder that is already an
 * Instrument folder, restarts the app: the restart is said before it happens.
 */
function MovingPage({
  how,
  hasChats,
}: {
  how: "move" | "open";
  hasChats: boolean;
}) {
  return (
    <SetupPage
      align="center"
      hero={<Spinner className="size-6 text-muted-foreground" />}
      subtitle={
        how === "open"
          ? `${APP_NAME} restarts once to open it, then picks up right here.`
          : `${APP_NAME} restarts once to finish, then picks up right here.`
      }
      title={
        how === "open"
          ? "Opening your folder"
          : hasChats
            ? "Moving your chats"
            : "Setting up your folder"
      }
    />
  );
}
