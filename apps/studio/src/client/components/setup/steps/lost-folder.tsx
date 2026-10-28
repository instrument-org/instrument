import { Spinner } from "@/client/components/ui/spinner";
import { isMacOS, osConventions } from "@/client/lib/utils";
import { toast } from "@/client/lib/toast";
import { rpcClient } from "@/client/rpc/client";
import { type LostFolder, type LostReason } from "@/shared/setup";
import { APP_NAME } from "@instrument-org/shared";
import { CloudArrowDownIcon } from "@phosphor-icons/react/CloudArrowDown";
import { LockKeyIcon } from "@phosphor-icons/react/LockKey";
import { useEffect, useState } from "react";

import { FolderLocation, FolderNote } from "../kit/folder-row";
import { SetupFooter, SetupPage } from "../kit/setup-page";
import { PackedFolder } from "../folder-illustration";

/**
 * The cloud service that keeps `path`, where its path alone says so. A
 * folder kept in iCloud through Desktop and Documents has no such path, and
 * is said as kept online.
 */
function cloudOf(path: string): string | undefined {
  return path.includes("/Library/Mobile Documents/")
    ? "iCloud Drive"
    : undefined;
}

/**
 * The folder step when the launch couldn't open the workspace's folder:
 * what happened to it, said for the reason (`LostReason`), and the one
 * thing to do about it. A folder kept in the cloud is downloaded as soon
 * as the page shows, and opens by itself once it is back; one that is
 * there but can't be read now has Try Again. Finding the folder somewhere
 * else, or starting over in a new one, goes back to the ordinary folder
 * step (`onFind`, `onStartOver`).
 */
export function LostFolderPage({
  autoReach,
  lost,
  onFind,
  onOpen,
  onStartOver,
}: {
  /**
   * Whether a folder kept in the cloud is downloaded as the page shows:
   * once, so a page shown again after an open that failed waits for Try
   * Again rather than trying the same open over and over.
   */
  autoReach: boolean;
  lost: LostFolder;
  /** Picks where the folder is now, or another folder. */
  onFind: () => void;
  /** Opens the folder, now that it can be read. */
  onOpen: () => Promise<void>;
  onStartOver: () => void;
}) {
  const [reason, setReason] = useState<LostReason>(lost.reason);
  const [reaching, setReaching] = useState(
    lost.reason === "cloud" && autoReach,
  );
  const cloud = cloudOf(lost.path);
  const { computerKind } = osConventions();

  const reach = async () => {
    setReaching(true);
    try {
      const reached = await rpcClient.workspaces.reachLost.call();
      if (reached.kind === "ready") {
        await onOpen();
        return;
      }
      setReason(reached.reason);
    } catch (error) {
      toast.error(`${APP_NAME} couldn’t open your folder`, { cause: error });
    } finally {
      setReaching(false);
    }
  };

  useEffect(() => {
    if (lost.reason === "cloud" && autoReach) {
      void reach();
    }
    // Once, for the folder the launch found in the cloud.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tryAgain = (
    <SetupFooter
      back={false}
      label="Try Again"
      onContinue={() => {
        void reach();
      }}
      pending={reaching}
      skip={{ label: "Use a Different Folder…", onClick: onFind }}
    />
  );

  if (reaching && reason === "cloud") {
    return (
      <SetupPage
        align="center"
        hero={<PackedFolder />}
        subtitle={
          cloud
            ? `Your ${computerKind} made room by keeping some of your Instrument folder only in ${cloud}. It’ll open as soon as it’s back.`
            : `Your ${computerKind} made room by keeping some of your Instrument folder only online. It’ll open as soon as it’s back.`
        }
        title={
          cloud
            ? `Getting your folder from ${cloud}`
            : "Downloading your folder"
        }
      >
        <Spinner className="mt-10 size-6 text-muted-foreground" />
      </SetupPage>
    );
  }

  if (reason === "missing" || reason === "refused") {
    return (
      <SetupPage
        footer={
          <SetupFooter
            back={false}
            label={reason === "missing" ? "Find It…" : "Choose Folder…"}
            onContinue={onFind}
            skip={{ label: "Start Over", onClick: onStartOver }}
          />
        }
        hero={<PackedFolder />}
        subtitle={
          reason === "missing"
            ? `It’s not where it was last time. If you moved or renamed it, show ${APP_NAME} where it is now.`
            : `${APP_NAME} can’t keep your folder there anymore. Choose where it should live instead.`
        }
        title={
          reason === "missing"
            ? "Where did your Instrument folder go?"
            : "Your Instrument folder can’t stay there"
        }
      >
        <div className="mt-8 flex w-140 max-w-full flex-col">
          <FolderLocation path={lost.path} />
        </div>
      </SetupPage>
    );
  }

  return (
    <SetupPage
      footer={tryAgain}
      hero={<PackedFolder />}
      subtitle={
        reason === "cloud"
          ? `Its files aren’t on this ${computerKind} right now, so ${APP_NAME} can’t open it yet.`
          : reason === "denied"
            ? `Your ${computerKind} stopped letting ${APP_NAME} read it. Turn access back on, then try again.`
            : `It’s still there, but ${APP_NAME} couldn’t read it just now. Try again in a moment.`
      }
      title={
        reason === "cloud"
          ? cloud
            ? `Your Instrument folder is in ${cloud}`
            : "Your Instrument folder is kept online"
          : reason === "denied"
            ? `${APP_NAME} needs permission to open your folder`
            : `${APP_NAME} couldn’t read your folder`
      }
    >
      <div className="mt-8 flex w-140 max-w-full flex-col">
        <FolderLocation path={lost.path}>
          {reason === "cloud" && (
            <FolderNote
              icon={<CloudArrowDownIcon />}
              line={`Check that you’re online and that your ${computerKind} has free space, then try again.`}
              title={`${cloud ?? `Your ${computerKind}`} couldn’t download it.`}
            />
          )}
          {reason === "denied" && isMacOS() && (
            <FolderNote
              action={{
                label: "Open Settings",
                onClick: () => {
                  void rpcClient.features.openPrivacySettings.call({
                    pane: "FilesAndFolders",
                  });
                },
              }}
              icon={<LockKeyIcon />}
              line={`Turn on access for ${APP_NAME} under Files & Folders.`}
              title={`${APP_NAME} isn’t allowed to open it.`}
            />
          )}
        </FolderLocation>
      </div>
    </SetupPage>
  );
}
