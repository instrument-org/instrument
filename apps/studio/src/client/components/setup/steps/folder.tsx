import { REFUSALS } from "@/client/components/settings/storage-section";
import { Spinner } from "@/client/components/ui/spinner";
import { folderOf } from "@/client/components/window/host-path";
import { toast } from "@/client/lib/toast";
import { displayPath } from "@/client/lib/path-utils";
import { isMacOS } from "@/client/lib/utils";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { folderWarningSentence } from "@/shared/workspace-folder-refusal";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { FolderLocation, FolderNote } from "../kit/folder-row";
import { SetupFooter, SetupPage } from "../kit/setup-page";
import { SetupPageSwitch } from "../kit/setup-page-switch";
import { PackedFolder } from "../folder-illustration";
import {
  count,
  folderAction,
  type FoundNote,
  foundNote,
  them,
} from "../folder-flow";
import { type SetupStepProps } from "../step-props";
import { useSetupState } from "../use-setup-state";
import { WelcomeBurst } from "../welcome-burst";

/** How long the page saying the app restarts shows before the restart. */
const RESTART_NOTICE_MS = 3000;

/** A note under the folder, for the folder it was found in. */
type Note = FoundNote | { kind: "denied" } | { kind: "unfinished" };

/** Why Continue can't keep the folder where it is on screen. */
type Refusal = Extract<
  RPCOutput["workspaces"]["move"],
  { kind: "refused" }
>["reason"];

/**
 * Where the Instrument folder lives (frames 05 to 09). Documents is
 * suggested, and nothing is made there until Continue, which is when a Mac
 * that guards Documents asks. A refusal falls back to the home folder with a note
 * and Fix; a folder with things in it, or one that is already an Instrument
 * folder, says so as soon as it is on screen, and Continue goes on past it.
 *
 * On a first launch it is setup's first page, Welcome with the folder
 * (frame 26): Continue makes the folder there, or opens the Instrument
 * folder already in it, and the app starts in it with no restart; the
 * window loads again on the next step. When the folder a workspace had went
 * missing, or can't be read, the page says where it was, and the person
 * finds it (Choose Folder…) or makes a new one the same way. For a workspace already running
 * from the app's own data, moving it, or opening one that is already an
 * Instrument folder, restarts the app, so the page says that first and
 * holds the step on screen meanwhile.
 */
export function FolderStep({ hold, onBack, onContinue }: SetupStepProps) {
  const facts = useSetupState()?.facts;
  const hasChats = facts?.hasChats ?? false;
  // No workspace yet: this page places it. A first launch, or a folder lost.
  const isUnplaced = facts?.hasWorkspace === false;
  const lostFolder = facts?.lostFolder ?? null;
  const isFirst = isUnplaced && lostFolder === null;
  const { data: offered } = useQuery(
    rpcClient.workspaces.offered.queryOptions(),
  );
  // Where the folder is now, for the chats a move would bring along.
  const { data: folder } = useQuery({
    ...rpcClient.workspaces.folder.queryOptions(),
    enabled: hasChats,
  });
  const [picked, setPicked] = useState<null | string>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [busy, setBusy] = useState(false);
  // What Continue is doing to the folder while it is made, or while the app
  // restarts for it.
  const [moving, setMoving] = useState<"move" | "open" | null>(null);

  // The folder on screen: the one picked, or the one in Documents setup
  // suggests, once the offered folders have loaded.
  const target = picked ?? offered?.inDocuments;
  // A risky place (Documents itself, a temporary folder) is said under it,
  // and Continue can still go past it. On a first launch on a Mac, the
  // folder suggested in Documents is looked at only on Continue: a folder
  // the app makes there needs no asking, and one already there makes the
  // Mac ask, which should follow the person's press rather than the page.
  const looksOnContinue = isUnplaced && isMacOS() && picked === null;
  const { data: targetCheck } = useQuery(
    rpcClient.workspaces.checkFolder.queryOptions({
      input:
        target === undefined || looksOnContinue ? skipToken : { path: target },
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

  /** What Continue does with a folder it can't take: a note where the page has one, else a toast. */
  const refuse = (
    current: { inDocuments: string; inHome: string },
    path: string,
    reason: Refusal,
  ) => {
    setMoving(null);
    if (reason === "unfinished") {
      setNote({ kind: "unfinished" });
    } else if (reason === "unwritable" && path === current.inDocuments) {
      setPicked(current.inHome);
      setNote({ kind: "denied" });
    } else if (reason === "missing" && path === current.inDocuments) {
      // A computer with no Documents folder (some Linux desktops): the
      // home folder is where it goes instead.
      setPicked(current.inHome);
      setNote(null);
    } else {
      toast.error(`${APP_NAME} can’t keep your folder there`, {
        description: REFUSALS[reason],
      });
    }
  };

  /**
   * Places a first launch's workspace in `path`, made there or opened,
   * then loads the window again, where setup goes on at the next step.
   */
  const place = async (
    current: { inDocuments: string; inHome: string },
    path: string,
    how: { create: boolean; type: "move" } | { type: "open" },
  ) => {
    hold();
    setMoving(how.type);
    try {
      const placed = await rpcClient.workspaces.place.call({
        create: how.type === "move" && how.create,
        path,
      });
      if (placed.kind === "placed") {
        window.location.reload();
        return;
      }
      // Another workspace, opened by a restart (`choosePlacement`).
      if (placed.kind === "relaunching" || placed.kind === "on-next-launch") {
        return;
      }
      if (placed.kind === "refused") {
        refuse(current, path, placed.reason);
        return;
      }
    } catch (error) {
      toast.error(`${APP_NAME} couldn’t set up your folder`, { cause: error });
    }
    setMoving(null);
  };

  /** Moves into `path` (or opens it), restarting the app. */
  const go = async (
    current: { inDocuments: string; inHome: string },
    path: string,
    how: { create: boolean; type: "move" } | { type: "open" },
  ) => {
    if (isUnplaced) {
      await place(current, path, how);
      return;
    }
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
          refuse(current, path, moved.reason);
          return;
        }
      }
    } catch (error) {
      toast.error(`${APP_NAME} couldn’t move your folder`, { cause: error });
    }
    setMoving(null);
  };

  const proceed = async () => {
    if (!offered || target === undefined) {
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
          await go(offered, target, action);
          return;
        }
        case "exists": {
          const current =
            hasChats && folder
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
          if (target === offered.inDocuments) {
            setPicked(offered.inHome);
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
        <MovingPage how={moving} hasChats={hasChats} restarts={!isUnplaced} />
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
          hero={
            isFirst ? (
              <div className="mb-2">
                <WelcomeBurst />
              </div>
            ) : (
              <PackedFolder />
            )
          }
          subtitle={
            isFirst
              ? `First, choose where ${APP_NAME} keeps your chats, topics and the files it makes.`
              : `This is where ${APP_NAME} keeps your chats, topics and the files it makes.`
          }
          title={
            isFirst
              ? `Welcome to ${APP_NAME}`
              : "Where should your Instrument folder live?"
          }
        >
          <div className="mt-8 flex w-140 max-w-full flex-col">
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
              {shown === null && lostFolder !== null && (
                <FolderNote
                  action={{
                    label: "Choose Folder…",
                    onClick: () => {
                      void choose(folderOf(lostFolder));
                    },
                  }}
                  line={`It was in ${displayPath(lostFolder)}. If you moved it, choose where it is now. Or continue to make a new one.`}
                  title={`${APP_NAME} can’t find your Instrument folder.`}
                />
              )}
              {shown?.kind === "denied" && (
                <FolderNote
                  action={{
                    label: "Fix",
                    onClick: () => {
                      if (offered) {
                        void choose(folderOf(offered.inDocuments));
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
                  line={
                    shown.chats > 0
                      ? `We'll open ${them(shown.chats)}, so you can pick up where you left off.`
                      : "We'll open it, so you can pick up where you left off."
                  }
                  title={
                    shown.chats > 0
                      ? `This folder has ${count(shown.chats, "chat")} from ${APP_NAME}.`
                      : `This is an ${APP_NAME} folder you used before.`
                  }
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
              {shown === null &&
                lostFolder === null &&
                warning !== undefined && (
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
 * What shows while Continue makes or opens the folder. Where that restarts
 * the app (a move, or the open of a folder that is already an Instrument
 * folder, with a workspace already running), the restart is said before it
 * happens.
 */
function MovingPage({
  how,
  hasChats,
  restarts,
}: {
  how: "move" | "open";
  hasChats: boolean;
  restarts: boolean;
}) {
  return (
    <SetupPage
      align="center"
      hero={<Spinner className="size-6 text-muted-foreground" />}
      subtitle={
        !restarts
          ? undefined
          : how === "open"
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
