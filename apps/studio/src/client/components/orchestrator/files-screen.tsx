import { type FileTab } from "@/client/atoms/orchestrator";
import { FileIcon } from "@/client/components/file-icon";
import { FileOpenContext } from "@/client/components/file-open-context";
import { FileViewer } from "@/client/components/file-viewer";
import { getComputerFileUrl } from "@/client/lib/computer-file-url";
import { fileUrlOf } from "@/client/lib/file-url";
import { getFileType } from "@/client/lib/get-file-type";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { Fragment, useEffect, useState } from "react";
import { toast } from "sonner";

import { ComputerPage, type FolderOnScreen } from "./computer-page";
import { useOrchestrator } from "./context";
import { fileHref, folderHref, mountOfHostPath } from "./file-tabs";
import { FileTree } from "./file-tree";
import { folderOf, segmentsOf } from "./host-path";
import { useOnScreen } from "./on-screen";
import { useQuickLook } from "./quick-look";
import { locationCrumbs } from "./tab-location";
import { useWindowTabs } from "./window-tabs";

/**
 * This Mac shows a folder or file in the current tab. Back returns to the
 * folder after opening a file; Space previews the selection in Quick Look.
 *
 * A file opened from the Finder gets a tab of its own with the Finder's
 * folder as a tree at its left and the file's crumbs over it, so the files
 * of a folder can be leafed through, and a link between two documents
 * followed, without going back to the Finder. A row in the tree or a link
 * in the document swaps the file in the same tab.
 *
 * A page's file (HTML) is not shown here at all: it is what a browser is for,
 * so this tab becomes a page tab showing the file at its `file://` address,
 * with the browser's own semantics for a local file. Asked for its source,
 * the tab keeps the file and shows its text.
 */
export function FilesScreen({
  file,
  path,
  root,
  source,
  tree,
}: {
  /** The file this tab shows, by where it is on the computer; the folder when absent. */
  file: string | undefined;
  path: string;
  root: string;
  /** Whether a page's file is shown as its text rather than as the page. */
  source: boolean;
  /** The folder the tab's own tree is rooted at, for a file opened from the Finder. */
  tree: string | undefined;
}) {
  const { browser, openPage, openScreen, taskId } = useOrchestrator();
  const { closeActive, step, stepVisit } = useWindowTabs();
  const router = useRouter();
  const navigate = useNavigate();
  const leaveFile = () => {
    const href = step(-1);
    if (href !== undefined) {
      router.history.push(href);
    } else if (!stepVisit(-1)) {
      closeActive();
    }
  };
  const state = useQuery(
    rpcClient.workspace.task.state.get.queryOptions({ input: { id: taskId } }),
  );
  const [folder, setFolder] = useState<FolderOnScreen | null>(null);
  // A file opened from the Finder carries the folder the Finder stood in,
  // which is where its tab's tree is rooted; the recents stand in no folder,
  // so a file opened there is rooted at its own.
  const openFile = (tab: FileTab) => {
    openScreen(
      fileHref(tab.hostPath, {
        tree: folder?.hostPath ?? folderOf(tab.hostPath),
      }),
    );
  };
  const quickLook = useQuickLook({ openFile });
  /** Another file in this tab's place: the tree and the crumbs follow it. */
  const showFile = (hostPath: string) => {
    void navigate({
      search: {
        file: hostPath,
        path,
        root,
        ...(tree === undefined ? {} : { tree }),
      },
      to: "/orchestrator/computer",
    });
  };
  const activeFile: FileTab | undefined = file
    ? { hostPath: file, name: segmentsOf(file).at(-1) ?? file }
    : undefined;
  const pageFile =
    activeFile !== undefined &&
    !source &&
    getFileType({ filename: activeFile.name }) === "html"
      ? activeFile.hostPath
      : undefined;
  const opensAsPage = pageFile !== undefined;
  // The browser is mounted by the layout and may arrive after this screen
  // does, as it does when the window opens on a file: the page is asked for
  // once there is a browser to show it.
  const hasBrowser = browser !== null;
  useEffect(() => {
    if (pageFile !== undefined && hasBrowser) {
      openPage(fileUrlOf(pageFile));
    }
    // Once per file the tab arrives at; the page takes the tab over from here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageFile, hasBrowser]);
  // How the agent reaches the file, when a granted folder covers it: the one
  // thing the conversation is told about the file that the person is not.
  const activeMount = activeFile
    ? mountOfHostPath(activeFile.hostPath, state.data?.attachedFolders ?? {})
    : undefined;

  useOnScreen(
    activeFile
      ? {
          file: {
            ...(activeMount === undefined ? {} : { mount: activeMount }),
            name: activeFile.name,
            path: activeFile.hostPath,
          },
          screen: "file",
        }
      : folder
        ? {
            folder: {
              ...(folder.access ? { access: folder.access } : {}),
              display: folder.display,
              ...(folder.mount ? { mount: folder.mount } : {}),
              selected: folder.selected,
            },
            screen: "computer",
          }
        : // The computer with no folder on it: the recents with nothing
          // selected, or a folder not yet read. Said as such, so the answer
          // is never a screen or a folder the user has left.
          { screen: "computer" },
  );

  // A missing file returns to the preceding visit, or closes its dedicated tab.
  useEffect(() => {
    if (!file) {
      return;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(getComputerFileUrl({ hostPath: file }), {
          headers: { Range: "bytes=0-0" },
          signal: controller.signal,
        });
        if (response.status === 404 && !controller.signal.aborted) {
          toast(`${segmentsOf(file).at(-1) ?? file} is no longer there`);
          leaveFile();
        }
      } catch {
        // The channel is not up, or the request was cut off: not the file's
        // absence, so the tab stays.
      }
    })();
    return () => {
      controller.abort();
    };
    // Once per file the tab shows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);
  const viewerFile = (tab: FileTab) => ({
    filename: tab.name,
    hostPath: tab.hostPath,
    url: getComputerFileUrl({ hostPath: tab.hostPath }),
  });

  if (opensAsPage) {
    return null;
  }

  if (activeFile && tree !== undefined) {
    return (
      // What the document links to opens where the tree's rows do: in this
      // tab, unless a tab of its own is asked for; a folder opens as the
      // Finder standing in it.
      <FileOpenContext
        value={(hostPath, options) => {
          if (hostPath.endsWith("/")) {
            openScreen(folderHref(hostPath.slice(0, -1)), options);
          } else if (options?.newTab) {
            openScreen(fileHref(hostPath, { tree }), options);
          } else {
            showFile(hostPath);
          }
        }}
      >
        <div className="flex h-full min-h-0">
          <aside className="w-60 shrink-0 border-r border-border bg-muted/40">
            <FileTree
              onOpen={showFile}
              root={tree}
              selected={activeFile.hostPath}
            />
          </aside>
          <div className="min-h-0 min-w-0 flex-1 p-3">
            <FileViewer
              className="h-full"
              file={viewerFile(activeFile)}
              key={activeFile.hostPath}
              lead={<FileCrumbs file={activeFile} />}
              // The close is the way back to the Finder: the tab goes, and
              // the Finder is the tab beside it.
              onClose={closeActive}
            />
          </div>
        </div>
      </FileOpenContext>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative min-h-0 flex-1">
        {activeFile ? (
          // Where the file sits on the Mac is the row above, which every tab
          // wears, so the viewer is the whole of the tab.
          <div className="h-full p-3">
            <FileViewer
              className="h-full"
              file={viewerFile(activeFile)}
              key={activeFile.hostPath}
              onClose={leaveFile}
            />
          </div>
        ) : (
          <ComputerPage
            onFolderChange={(next) => {
              setFolder((current) =>
                JSON.stringify(current) === JSON.stringify(next)
                  ? current
                  : next,
              );
            }}
            onOpenFile={openFile}
            path={path}
            root={root}
            {...quickLook.props}
          />
        )}
      </div>
      {quickLook.dialog}
    </div>
  );
}

/**
 * Where the file is, as the head of its viewer: the folders above it each a
 * way there, quiet, and the file itself last with its mark. The tab wears no
 * row of its own over a file with a tree, so this is the one place the path
 * is read.
 */
function FileCrumbs({ file }: { file: FileTab }) {
  const { openScreen } = useOrchestrator();
  const places = useQuery(rpcClient.workspace.computer.places.queryOptions());
  const home = places.data?.favorites.find(
    (place) => place.name === "Home",
  )?.path;
  const crumbs = locationCrumbs(
    { kind: "file", name: file.name, path: file.hostPath },
    { home },
  );
  return (
    <span className="flex min-w-0 items-center gap-0.5 text-xs">
      {crumbs.map((crumb, index) => {
        const isHere = index === crumbs.length - 1;
        return (
          <Fragment key={`${index}:${crumb.label}`}>
            {index > 0 && (
              <CaretRightIcon className="size-3 shrink-0 text-muted-foreground/50" />
            )}
            {isHere ? (
              <span className="flex min-w-0 items-center gap-1.5 font-medium">
                <FileIcon className="size-3.5 shrink-0" filename={file.name} />
                <span className="truncate">{crumb.label}</span>
              </span>
            ) : (
              <button
                className={cn(
                  "min-w-6 truncate rounded px-1 py-0.5 text-muted-foreground",
                  crumb.to && "hover:bg-foreground/8 hover:text-foreground",
                )}
                disabled={crumb.to === undefined}
                onClick={() => {
                  if (crumb.to?.kind === "screen") {
                    openScreen(crumb.to.href);
                  }
                }}
                type="button"
              >
                {crumb.label}
              </button>
            )}
          </Fragment>
        );
      })}
    </span>
  );
}
