import { FileSystemFolderGlyph } from "@/client/components/extend/file-system";
import { Button } from "@/client/components/ui/button";
import { rpcClient } from "@/client/rpc/client";
import { type ComputerRefusal } from "@instrument-org/workspace/client";
import { useMutation } from "@tanstack/react-query";

import { segmentsOf } from "./host-path";

/**
 * The folder the system would not let this app read, and what can be done
 * about it. A refusal by the Mac's privacy controls has two ways back. The
 * system's own panel is the graceful one: a folder picked there is the
 * person's intent, which the Mac honors from then on without asking again,
 * so the panel opens at the folder itself and the answer is one press. The
 * settings pane is where a declined ask is undone for good. A refusal by the
 * folder's own permissions has neither, so it only says whose they are. A
 * package (a Photos library) has neither either: the panel will not pick one,
 * and what guards it is the app's own permission, so the way in is to open it
 * in its app. The app's own data has no way in from here at all.
 */
export function NotPermitted({
  onGranted,
  refusal,
}: {
  /** The folder the person picked in the panel, which is usually this one. */
  onGranted: (hostPath: string) => void;
  refusal: ComputerRefusal;
}) {
  // The folder that refused, which is one above this when the account cannot
  // pass through it.
  const shut = refusal.refusedBy ?? refusal.path;
  const name = segmentsOf(shut).at(-1) ?? shut;
  const choose = useMutation({
    mutationFn: () =>
      rpcClient.utils.showFolderPicker.call({
        buttonLabel: "Open",
        message: `Instrument can’t read “${name}” until you open it here.`,
        startingAt: shut,
      }),
    onSuccess: (picked) => {
      if (picked) {
        onGranted(picked.path);
      }
    },
  });
  const openSettings = useMutation(
    rpcClient.features.openPrivacySettings.mutationOptions(),
  );
  const openInApp = useMutation(rpcClient.utils.openPath.mutationOptions());
  const isSystem = refusal.reason === "system";
  if (refusal.reason === "app") {
    return (
      <div className="flex size-full items-center justify-center p-8">
        <div className="flex max-w-sm flex-col items-center gap-4 text-center">
          <FileSystemFolderGlyph className="h-10 w-auto opacity-60" />
          <div>
            <p className="text-sm font-medium">{`“${name}” is protected`}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              It has Instrument’s data and can’t be opened here.
            </p>
          </div>
        </div>
      </div>
    );
  }
  if (isSystem && refusal.package) {
    return (
      <div className="flex size-full items-center justify-center p-8">
        <div className="flex max-w-sm flex-col items-center gap-4 text-center">
          <FileSystemFolderGlyph className="h-10 w-auto opacity-60" />
          <div>
            <p className="text-sm font-medium">
              {`macOS hasn’t let Instrument look inside “${name}”`}
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              It belongs to another app, so you can open it there instead.
            </p>
          </div>
          <Button
            onClick={() => {
              openInApp.mutate({ filepath: refusal.path });
            }}
            size="sm"
          >
            Open
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex size-full items-center justify-center p-8">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <FileSystemFolderGlyph className="h-10 w-auto opacity-60" />
        <div>
          <p className="text-sm font-medium">
            {isSystem
              ? `macOS hasn’t let Instrument read “${name}”`
              : `You don’t have permission to open “${name}”`}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {isSystem
              ? // oxlint-disable-next-line studio/no-os-words -- a system refusal is macOS privacy, so only a Mac shows it
                "Open the folder in the system’s own panel to read it now, or allow it under Files and Folders in System Settings."
              : "Ask its owner for access."}
          </p>
        </div>
        {isSystem && (
          <div className="flex items-center gap-2">
            <Button
              onClick={() => {
                choose.mutate();
              }}
              size="sm"
            >
              Choose the folder…
            </Button>
            <Button
              onClick={() => {
                openSettings.mutate({ pane: "FilesAndFolders" });
              }}
              size="sm"
              variant="outline"
            >
              {/* oxlint-disable-next-line studio/no-os-words -- a system refusal is macOS privacy, so only a Mac shows it */}
              Open System Settings
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
