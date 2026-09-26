import { type ScreenView } from "@/client/atoms/orchestrator";
import { FileViewer } from "@/client/components/file-viewer";
import { getComputerFileUrl } from "@/client/lib/computer-file-url";
import { useEffect, useState } from "react";

import { ComputerPage, type FolderOnScreen } from "./computer-page";
import { segmentsOf } from "./host-path";

/**
 * This Mac inside a draft's band: the folder browser, or a file in its
 * viewer, drawn from the tab's address rather than the router's, since the
 * router follows the thread behind the draft and never this window. Walking
 * the folders writes the tab's own address back; a file opened lands in the
 * band as a tab of its own. What is on screen is reported up, so the thread
 * the draft starts is told what its writer was looking at.
 */
export function ComposeFiles({
  file,
  onLeaveFile,
  onLocationChange,
  onOpenFile,
  onViewChange,
  path,
  root,
}: {
  /** The file this tab shows, by where it is on the computer; the folder when absent. */
  file: string | undefined;
  /** The way out of a file: back to the folder, or the tab closed. */
  onLeaveFile: () => void;
  onLocationChange: (location: { path: string; root: string }) => void;
  onOpenFile: (hostPath: string) => void;
  /** What the tab has on it, as the conversation is told it. */
  onViewChange: (view: ScreenView) => void;
  path: string;
  root: string;
}) {
  const [folder, setFolder] = useState<FolderOnScreen | null>(null);
  const fileName = file === undefined ? undefined : segmentsOf(file).at(-1);
  // By value: the screen builds a fresh object each render.
  const viewKey = JSON.stringify({ file, folder });
  useEffect(() => {
    onViewChange(
      file === undefined
        ? folder
          ? {
              folder: {
                ...(folder.access ? { access: folder.access } : {}),
                display: folder.display,
                ...(folder.mount ? { mount: folder.mount } : {}),
                selected: folder.selected,
              },
              screen: "computer",
            }
          : { screen: "computer" }
        : { file: { name: fileName ?? file, path: file }, screen: "file" },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey]);

  if (file !== undefined) {
    return (
      <div className="h-full p-2">
        <FileViewer
          className="h-full"
          editable
          file={{
            filename: fileName ?? file,
            hostPath: file,
            url: getComputerFileUrl({ hostPath: file }),
          }}
          key={file}
          onClose={onLeaveFile}
        />
      </div>
    );
  }
  return (
    <ComputerPage
      onFolderChange={(next) => {
        setFolder((current) =>
          JSON.stringify(current) === JSON.stringify(next) ? current : next,
        );
      }}
      onLocationChange={onLocationChange}
      onOpenFile={(tab) => {
        onOpenFile(tab.hostPath);
      }}
      path={path}
      root={root}
    />
  );
}
