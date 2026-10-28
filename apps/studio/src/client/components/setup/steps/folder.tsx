import {
  showRefusal,
  useFolderPick,
} from "@/client/components/instrument-folder";
import {
  type Destination,
  destinationStep,
  type MoveRefusal,
  suggestedDestination,
} from "@/client/components/instrument-folder-steps";
import { TermsFooter } from "@/client/components/terms-footer";
import { Button } from "@/client/components/ui/button";
import { Spinner } from "@/client/components/ui/spinner";
import { folderOf } from "@/client/components/window/host-path";
import { toast } from "@/client/lib/toast";
import { isMacOS } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { FolderLocation, FolderNote } from "../kit/folder-row";
import { SetupFooter, SetupPage } from "../kit/setup-page";
import { SetupPageSwitch } from "../kit/setup-page-switch";
import { PackedFolder } from "../folder-illustration";
import { type SetupStepProps } from "../step-props";
import { useSetupState } from "../use-setup-state";
import { WelcomeBurst } from "../welcome-burst";
import { LostFolderPage } from "./lost-folder";

/** How long the page saying the app restarts shows before the restart. */
const RESTART_NOTICE_MS = 3000;

/** A note under the folder, for what Continue ran into. */
type Note = { kind: "denied" } | { kind: "unfinished" };

/**
 * Where the Instrument folder lives (frames 05 to 09). A new folder in
 * Documents is suggested, and nothing is made there until Continue, which is
 * when a Mac that guards Documents asks. Change picks another place the way
 * Settings › Storage does (`useFolderPick`): a folder named for the app
 * inside the pick, with the one question a pick can raise asked straight
 * after it. A refusal of Documents falls back to the home folder with a note
 * and Fix; an Instrument folder already there is opened rather than moved
 * into, and Continue says Open.
 *
 * On a first launch it is setup's first step, and opens on Welcome, what
 * the app is with Get started, before the folder: Continue makes the folder
 * there, or opens the Instrument
 * folder already in it, and the app starts in it with no restart; the
 * window loads again on the next step. When the launch couldn't open the
 * folder a workspace had, the page says why first (`LostFolderPage`), and
 * the person gets it back, finds it, or starts over in a new one, which
 * picks as a first launch does. For a workspace already running
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
  const [picked, setPicked] = useState<Destination | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [busy, setBusy] = useState(false);
  // What Continue is doing to the folder while it is made, or while the app
  // restarts for it.
  const [moving, setMoving] = useState<"move" | "open" | null>(null);
  // A first launch opens on Welcome, and Get started brings the folder.
  const [started, setStarted] = useState(!isFirst);
  // Past the page saying why a lost folder couldn't be opened: picking where
  // it is now or another folder, or starting over in a new one.
  const [lostPast, setLostPast] = useState<"found" | "new" | null>(null);
  const pick = useFolderPick((destination) => {
    setPicked(destination);
    setNote(null);
    setLostPast((past) => past ?? "found");
  });

  // On a first launch on a Mac, the folder suggested in Documents is looked
  // at only on Continue: a folder the app makes there needs no asking, and
  // one already there makes the Mac ask, which should follow the person's
  // press rather than the page.
  const looksOnContinue = isUnplaced && isMacOS() && picked === null;
  const { data: suggestedPick } = useQuery(
    rpcClient.workspaces.checkPick.queryOptions({
      input:
        offered === undefined || picked !== null || looksOnContinue
          ? skipToken
          : { path: offered.inDocuments },
    }),
  );
  const suggested = suggestedPick && suggestedDestination(suggestedPick.folder);
  // The folder on screen: the one picked, or the one in Documents setup
  // suggests, once the offered folders have loaded.
  const shown = picked ?? suggested;
  const target = shown?.path ?? offered?.inDocuments;

  /** What Continue does with a folder it can't take: a note where the page has one, else a toast. */
  const refuse = async (
    current: { inDocuments: string; inHome: string },
    path: string,
    reason: MoveRefusal,
  ) => {
    setMoving(null);
    if (reason === "unfinished") {
      setNote({ kind: "unfinished" });
    } else if (
      (reason === "unwritable" || reason === "missing") &&
      path === current.inDocuments
    ) {
      // Documents refused, or a computer with no Documents folder (some
      // Linux desktops): the home folder is where it goes instead.
      const home = await rpcClient.workspaces.checkPick.call({
        path: folderOf(current.inHome),
      });
      setPicked(home.folder);
      setNote(reason === "unwritable" ? { kind: "denied" } : null);
    } else {
      showRefusal(reason, { current: undefined, path });
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
        await refuse(current, path, placed.reason);
        return;
      }
      if (placed.kind === "unreachable") {
        toast.error(`${APP_NAME} can’t read that folder right now`);
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
          await refuse(current, path, moved.reason);
          return;
        }
      }
    } catch (error) {
      toast.error(`${APP_NAME} couldn’t move your folder`, { cause: error });
    }
    setMoving(null);
  };

  /**
   * Continue: the folder on screen made, moved into or opened. The
   * suggested folder is looked at here when it wasn't before, and what it
   * turns out to be (an Instrument folder, or one with other files in it)
   * is said first, so the next Continue goes on.
   */
  const proceed = async () => {
    if (!offered) {
      return;
    }
    setBusy(true);
    try {
      const seen = picked ?? suggested;
      const destination =
        seen ??
        suggestedDestination(
          (
            await rpcClient.workspaces.checkPick.call({
              path: offered.inDocuments,
            })
          ).folder,
        );
      const step = destinationStep(destination, { opens: true });
      if (step.type === "refused") {
        await refuse(offered, destination.path, step.reason);
        return;
      }
      if (seen === undefined && step.type === "open") {
        setPicked(destination);
        return;
      }
      if (seen === undefined && destination.contents === "files") {
        pick.settle({ folder: destination }, folderOf(destination.path));
        return;
      }
      if (step.type === "open" || step.type === "move") {
        await go(offered, destination.path, step);
      }
    } catch (error) {
      toast.error(`${APP_NAME} couldn’t check that folder`, { cause: error });
    } finally {
      setBusy(false);
    }
  };

  const opens =
    shown !== undefined &&
    destinationStep(shown, { opens: true }).type === "open";
  return (
    <SetupPageSwitch
      depth={!started ? 0 : moving === null ? 1 : 2}
      page={!started ? "welcome" : moving === null ? "folder" : "moving"}
    >
      {!started ? (
        <WelcomePage
          onStart={() => {
            setStarted(true);
          }}
        />
      ) : moving !== null ? (
        <MovingPage how={moving} hasChats={hasChats} restarts={!isUnplaced} />
      ) : lostFolder !== null && lostPast === null && offered ? (
        <>
          <LostFolderPage
            lost={lostFolder}
            onFind={() => {
              void pick.choose(folderOf(lostFolder.path));
            }}
            onOpen={() => place(offered, lostFolder.path, { type: "open" })}
            onStartOver={() => {
              setLostPast("new");
            }}
          />
          {pick.dialog}
        </>
      ) : (
        <SetupPage
          footer={
            <SetupFooter
              label={opens ? "Open" : "Continue"}
              next={target === undefined ? "off" : "primary"}
              onBack={
                isFirst
                  ? () => {
                      setStarted(false);
                    }
                  : lostPast !== null
                    ? () => {
                        setLostPast(null);
                        setPicked(null);
                        setNote(null);
                      }
                    : onBack
              }
              onContinue={() => {
                void proceed();
              }}
              pending={busy}
            />
          }
          hero={<PackedFolder />}
          subtitle={
            lostPast === "new" && picked === null
              ? `${APP_NAME} starts fresh there. Your old chats stay in your old folder, so you can open it again if it turns up.`
              : `This is where ${APP_NAME} keeps your chats, topics and the files it makes. Most people put it in their Documents folder.`
          }
          title={
            lostPast === "new" && picked === null
              ? "Where should your new Instrument folder live?"
              : "Where should your Instrument folder live?"
          }
        >
          <div className="mt-8 flex w-140 max-w-full flex-col">
            <FolderLocation
              destination={shown}
              onChange={
                target === undefined
                  ? undefined
                  : () => {
                      void pick.choose(folderOf(target));
                    }
              }
              path={target}
            >
              {note?.kind === "denied" && (
                <FolderNote
                  action={{
                    label: "Fix",
                    onClick: () => {
                      if (offered) {
                        void pick.choose(folderOf(offered.inDocuments));
                      }
                    },
                  }}
                  line="Most users place their Instrument folder in Documents. If you don't allow access, we'll place it in your home folder instead."
                  title={`${APP_NAME} was denied access to your Documents folder.`}
                />
              )}
              {note?.kind === "unfinished" && (
                <FolderNote
                  action={{
                    label: "Keep it where it is for now",
                    onClick: onContinue,
                  }}
                  line={`Quit and reopen ${APP_NAME}, then try again. Or keep your folder where it is for now, and move it later in Settings.`}
                  title={`${APP_NAME} is still updating your folder from an earlier version.`}
                />
              )}
            </FolderLocation>
          </div>
          {pick.dialog}
        </SetupPage>
      )}
    </SetupPageSwitch>
  );
}

/**
 * A first launch's first page: what the app is, and Get started, before
 * anything is asked of the person.
 */
function WelcomePage({ onStart }: { onStart: () => void }) {
  return (
    <SetupPage
      align="center"
      footer={<TermsFooter className="px-8 pt-5 pb-6" />}
      hero={
        <div className="mb-2">
          <WelcomeBurst />
        </div>
      }
      subtitle={`${APP_NAME} is a desktop app for doing your best work with AI. It works in your files and its own browser, and connects with all your favorite apps.`}
      title={`Welcome to ${APP_NAME}`}
    >
      <Button
        className="mt-10 h-10 w-95 max-w-full bg-white/30 text-base text-foreground dark:bg-white/5"
        onClick={onStart}
        variant="outline"
      >
        Get started
      </Button>
    </SetupPage>
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
