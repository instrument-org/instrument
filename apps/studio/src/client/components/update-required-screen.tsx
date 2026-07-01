import { UpdateRecoveryActions } from "@/client/components/update-recovery-actions";
import { APP_NAME } from "@instrument-org/shared";
import { ArrowCircleUpIcon } from "@phosphor-icons/react";

// Full-screen block shown in place of the normal chrome when the running build
// is below the server-enforced minimum supported version. Update actions come
// from the shared UpdateRecoveryActions; `downloadUrl` is the server escape hatch.
export function UpdateRequiredScreen({
  downloadUrl,
  message,
}: {
  downloadUrl: string;
  message?: string;
}) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-background p-8">
      <div className="flex max-w-md flex-col items-center gap-6 text-center">
        <ArrowCircleUpIcon className="size-12 text-muted-foreground" weight="thin" />
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
          downloadRef="update-required"
          manualDownloadUrl={downloadUrl}
        />
      </div>
    </div>
  );
}
