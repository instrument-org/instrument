import { REFUSALS } from "@/client/components/settings/storage-section";
import { Spinner } from "@/client/components/ui/spinner";
import { folderOf, nameOf } from "@/client/components/window/host-path";
import { toast } from "@/client/lib/toast";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { FolderLocation, FolderNote } from "./kit/folder-row";
import { SetupFooter, SetupPage } from "./kit/setup-page";
import { PackedFolder } from "./folder-illustration";
import { count, folderAction } from "./folder-flow";
import { type SetupPageProps } from "./setup-page-props";
import { useSetupState } from "./use-setup-state";

/** A note under the folder, for the folder it was found in. */
type Note =
  | { chats: number; kind: "earlier" }
  | { items: number; kind: "exists"; moving: number }
  | { kind: "denied" };

/**
 * Where the Instrument folder lives (frames 05 to 09). Documents is
 * suggested, and nothing touches it until Continue, which is when a Mac that
 * guards Documents asks. A refusal falls back to the home folder with a note
 * and Fix; a folder with things in it, or one that is already an Instrument
 * folder, says so before the next Continue goes on. Moving restarts the app,
 * so the page says that first and holds the step on screen meanwhile.
 */
export function FolderPage({ hold, onBack, onContinue }: SetupPageProps) {
  const { data: folder } = useQuery(rpcClient.workspaces.folder.queryOptions());
  const usedBefore = useSetupState()?.facts.usedBefore ?? false;
  const [picked, setPicked] = useState<null | string>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [busy, setBusy] = useState(false);
  const [moving, setMoving] = useState(false);

  if (moving) {
    return <MovingPage usedBefore={usedBefore} />;
  }
  if (!folder) {
    return <SetupPage title="Where should your Instrument folder live?" />;
  }
  const target = picked ?? folder.inDocuments;

  const pick = (path: string) => {
    setPicked(path);
    setNote(null);
  };

  /** Moves into `path` (or opens it), restarting the app. */
  const go = async (
    path: string,
    how: { create: boolean; type: "move" } | { type: "open" },
  ) => {
    hold();
    setMoving(true);
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
          if (moved.reason === "unwritable" && path === folder.inDocuments) {
            setMoving(false);
            setPicked(folder.inHome);
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
    setMoving(false);
  };

  const proceed = async () => {
    setBusy(true);
    try {
      const [verdict, summary] = await Promise.all([
        rpcClient.workspaces.checkFolder.call({ path: target }),
        rpcClient.workspaces.summary.call({ path: target }),
      ]);
      const action = folderAction({
        seen:
          note?.kind === "earlier" || note?.kind === "exists"
            ? note.kind
            : null,
        summary,
        verdict,
      });
      switch (action.type) {
        case "move":
        case "open": {
          await go(target, action);
          return;
        }
        case "exists": {
          const current = usedBefore
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
    void rpcClient.utils.openFolder.call({ folderPath: target });
  };

  return (
    <SetupPage
      footer={
        <SetupFooter
          onBack={onBack}
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
          onChange={() => {
            void choose(folderOf(target));
          }}
          path={target}
        >
          {note?.kind === "denied" && (
            <FolderNote
              action={{
                label: "Fix",
                onClick: () => {
                  void choose(folderOf(folder.inDocuments));
                },
              }}
              line="Most users place their Instrument folder in Documents. If you don't allow access, we'll place it in your home folder instead."
              title={`${APP_NAME} was denied access to your Documents folder.`}
            />
          )}
          {note?.kind === "exists" && (
            <FolderNote
              action={{ label: "Show folder", onClick: showFolder }}
              line={
                note.moving > 0
                  ? `It has ${count(note.items, "item")}. We'll move your ${count(note.moving, "chat")} in beside them.`
                  : `It has ${count(note.items, "item")}. We'll keep everything in it and add your chats and files alongside.`
              }
              title={`There's already a folder called ${nameOf(target)} here.`}
            />
          )}
          {note?.kind === "earlier" && (
            <FolderNote
              action={{ label: "Show folder", onClick: showFolder }}
              line="We'll open them, so you can pick up where you left off."
              title={`This folder already has ${count(note.chats, "chat")} from ${APP_NAME}.`}
            />
          )}
        </FolderLocation>
      </div>
    </SetupPage>
  );
}

/** What shows while the move restarts the app: the restart is said before it happens. */
function MovingPage({ usedBefore }: { usedBefore: boolean }) {
  return (
    <SetupPage
      align="center"
      hero={<Spinner className="size-6 text-muted-foreground" />}
      subtitle={`${APP_NAME} restarts once to finish, then picks up right here.`}
      title={usedBefore ? "Moving your chats" : "Setting up your folder"}
    />
  );
}
