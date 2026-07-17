import { UpdateRecoveryActions } from "@/client/components/update-recovery-actions";
import { WindowControls } from "@/client/components/window-controls";
import { APP_NAME } from "@instrument-org/shared";
import { ArrowCircleUpIcon } from "@phosphor-icons/react";

// Full-screen block shown in place of the normal chrome when the running build
// is below the server-enforced minimum supported version. Update actions come
// from the shared UpdateRecoveryActions; `downloadUrl` is the server escape hatch.
export function UpdateRequiredScreen({
  downloadUrl,
  message,
  showWindowChrome = true,
}: {
  downloadUrl: string;
  message?: string;
  // The debug components page embeds this screen as a preview, where real
  // window controls would minimize or close the host window.
  showWindowChrome?: boolean;
}) {
  // The frameless window's drag region and custom window controls normally live
  // in the toolbar this screen replaces, so it supplies its own: a draggable
  // strip up top and, on Windows/Linux, the minimize/maximize/close buttons.
  return (
    <div className="flex h-full w-full flex-col bg-background">
      {showWindowChrome && (
        <div className="flex h-10 shrink-0 items-stretch justify-end [-webkit-app-region:drag]">
          <WindowControls />
        </div>
      )}
      <div className="flex min-h-0 flex-1 items-center justify-center p-8">
        <div className="flex max-w-md flex-col items-center gap-6 text-center">
          <ArrowCircleUpIcon
            className="size-12 text-muted-foreground"
            weight="thin"
          />
          <div className="space-y-2">
            <h1 className="text-xl font-semibold text-foreground">
              Update required
            </h1>
            <p className="text-sm text-muted-foreground">
              {message ??
                `This version of ${APP_NAME} is no longer supported. Update to the latest version to continue.`}
            </p>
          </div>
          <UpdateRecoveryActions
            alwaysShowManualDownload
            downloadRef="update-required"
            manualDownloadUrl={downloadUrl}
          />
        </div>
      </div>
    </div>
  );
}
