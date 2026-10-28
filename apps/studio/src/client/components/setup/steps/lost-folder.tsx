import { Button } from "@/client/components/ui/button";
import { Spinner } from "@/client/components/ui/spinner";
import { isMacOS, osConventions } from "@/client/lib/utils";
import { toast } from "@/client/lib/toast";
import { rpcClient } from "@/client/rpc/client";
import { type LostFolder, type LostReason } from "@/shared/setup";
import { APP_NAME } from "@instrument-org/shared";
import { useEffect, useState } from "react";

import { FolderLocation, FolderNote } from "../kit/folder-row";
import { SetupFooter, SetupPage } from "../kit/setup-page";
import { PackedFolder } from "../folder-illustration";

/**
 * Whether `path` is in iCloud Drive, where its path alone says so. A folder
 * kept in iCloud through Desktop and Documents has no such path, and is
 * said as kept online.
 */
function inICloudDrive(path: string): boolean {
  return path.includes("/Library/Mobile Documents/");
}

/** A quiet link under the folder's card, to a way on other than Continue. */
function QuietLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      className="mx-auto mt-3 h-9 px-3 text-sm text-muted-foreground"
      onClick={onClick}
      variant="ghost"
    >
      {label}
    </Button>
  );
}

/**
 * The folder step when the launch couldn't open the workspace's folder:
 * what happened to it, said for the reason (`LostReason`), and the one
 * thing to do about it. A folder kept in the cloud is downloaded as soon
 * as the page shows, and opens by itself once it is back; one that is
 * there but can't be read now opens again with Continue. Finding the
 * folder somewhere else, or starting over in a new one, goes back to the
 * ordinary folder step (`onFind`, `onStartOver`).
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
   * once, so a page shown again after an open that failed waits for
   * Continue rather than trying the same open over and over.
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
  const iCloud = inICloudDrive(lost.path);
  const keptIn = iCloud ? "in iCloud" : "online";
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
      onContinue={() => {
        void reach();
      }}
      pending={reaching}
    />
  );

  if (reaching && reason === "cloud") {
    return (
      <SetupPage
        align="center"
        hero={<PackedFolder />}
        subtitle={`To save space, your ${computerKind} moved your Instrument folder off this computer. It’s safe ${keptIn}, and ${APP_NAME} is downloading it now.`}
        title="Finding your Instrument folder"
      >
        <div className="mt-10 flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          Downloading
        </div>
      </SetupPage>
    );
  }

  if (reason === "missing") {
    return (
      <SetupPage
        footer={<SetupFooter back={false} next="off" />}
        hero={<PackedFolder />}
        subtitle={`If you moved or renamed it, update the location so ${APP_NAME} can access it.`}
        title="Your Instrument folder is missing"
      >
        <div className="mt-8 flex w-140 max-w-full flex-col">
          <FolderLocation
            changeLabel="Update"
            dim
            onChange={onFind}
            path={lost.path}
          />
        </div>
      </SetupPage>
    );
  }

  if (reason === "refused") {
    return (
      <SetupPage
        footer={
          <SetupFooter
            back={false}
            label="Choose Folder…"
            onContinue={onFind}
            skip={{ label: "Start Over", onClick: onStartOver }}
          />
        }
        hero={<PackedFolder />}
        subtitle={`${APP_NAME} can’t keep your folder there anymore. Choose where it should live instead.`}
        title="Your Instrument folder can’t stay there"
      >
        <div className="mt-8 flex w-140 max-w-full flex-col">
          <FolderLocation path={lost.path} />
        </div>
      </SetupPage>
    );
  }

  if (reason === "denied") {
    return (
      <SetupPage
        footer={tryAgain}
        hero={<PackedFolder />}
        subtitle={`Your ${computerKind} prevented access. Turn it back on to continue.`}
        title={
          iCloud
            ? `${APP_NAME} needs permission to access your Instrument folder in iCloud`
            : `${APP_NAME} needs permission to access your Instrument folder`
        }
      >
        <div className="mt-8 flex w-140 max-w-full flex-col">
          <FolderLocation dim path={lost.path}>
            {isMacOS() && (
              <FolderNote
                action={{
                  label: "Open Settings",
                  onClick: () => {
                    void rpcClient.features.openPrivacySettings.call({
                      pane: "FilesAndFolders",
                    });
                  },
                }}
                // oxlint-disable-next-line studio/no-os-words -- shown only on macOS
                line={`Turn on ${iCloud ? "iCloud Drive" : "access"} for ${APP_NAME} in Privacy & Security › Files & Folders.`}
                title={`${APP_NAME} couldn’t access the folder`}
              />
            )}
          </FolderLocation>
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
          ? `To save space, your ${computerKind} moved your Instrument folder off this computer. It’s safe ${keptIn}.`
          : `It’s still there, but ${APP_NAME} couldn’t read it just now. Try again in a moment.`
      }
      title={
        reason === "cloud"
          ? "Finding your Instrument folder"
          : `${APP_NAME} couldn’t read your folder`
      }
    >
      <div className="mt-8 flex w-140 max-w-full flex-col">
        <FolderLocation dim path={lost.path}>
          {reason === "cloud" && (
            <FolderNote
              line={`Check that you’re online and that your ${computerKind} has free space.`}
              title={`${APP_NAME} couldn’t download the folder`}
            />
          )}
        </FolderLocation>
        <QuietLink
          label="Use a different folder…"
          onClick={reason === "cloud" ? onStartOver : onFind}
        />
      </div>
    </SetupPage>
  );
}
