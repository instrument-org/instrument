import { appendToPromptAtom } from "@/client/atoms/prompt-value";
import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import { FolderAttachmentRow } from "@/client/components/folder-attachment-row";
import { getAssetBaseUrl } from "@/client/lib/asset-base-url";
import { getAssetUrl } from "@/client/lib/get-asset-url";
import { getFileKindLabel } from "@/client/lib/get-file-type";
import { shouldFilterTaskFile } from "@/client/lib/task-file-groups";
import { cn } from "@/client/lib/utils";
import { type RPCOutput } from "@/client/rpc/client";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import {
  type Task,
  TASK_FOLDER_NAMES,
  type TaskId,
} from "@instrument-org/workspace/client";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { DotsThreeOutlineVerticalIcon } from "@phosphor-icons/react/DotsThreeOutlineVertical";
import { FolderSimpleIcon } from "@phosphor-icons/react/FolderSimple";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { FileActionsMenuItems } from "../file-actions-menu";
import { FileThumbnail } from "../file-thumbnail";
import { RelativeTime } from "../relative-time";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "../ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
  contextMenuComponents,
  dropdownMenuComponents,
} from "../ui/menu-components";
import {
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "../ui/sidebar";

type AttachedFolder = NonNullable<
  RPCOutput["workspace"]["task"]["state"]["get"]["attachedFolders"]
>[string];

type FileTreeNode =
  | { children: FileTreeNode[]; kind: "dir"; name: string }
  | { file: TaskFileViewerFile; kind: "file" };

/**
 * How often the list re-walks the task directory while it is on screen.
 *
 * The panel is the only thing that wants this list, so it is the only thing
 * that asks for it: mounted means open, and a closed panel costs nothing. That
 * is what makes a poll affordable here where a standing watcher was not, and it
 * is the shape that survives the list being pointed at a folder the user picked
 * rather than one we laid out.
 */
const REFETCH_INTERVAL_MS = 5000;

export function TaskFiles({
  activeFilePath,
  attachedFolders,
  onFileSelect,
  task,
}: {
  activeFilePath: null | string;
  attachedFolders: RPCOutput["workspace"]["task"]["state"]["get"]["attachedFolders"];
  onFileSelect: (file: TaskFileViewerFile) => void;
  task: Task;
}) {
  const { data: files } = useQuery(
    rpcClient.workspace.task.files.list.queryOptions({
      input: { taskId: task.id },
      refetchInterval: REFETCH_INTERVAL_MS,
    }),
  );
  const assetBaseUrl = getAssetBaseUrl(task.id);

  const computed = useMemo(() => {
    if (!files) {
      return null;
    }

    const toViewerFile = (f: (typeof files)[number]): TaskFileViewerFile => ({
      ...f,
      taskId: task.id,
      url: getAssetUrl({
        assetBase: assetBaseUrl,
        filePath: f.filePath,
        version: f.modifiedAt,
      }),
    });

    const visibleFiles: TaskFileViewerFile[] = [];
    const hiddenFiles: TaskFileViewerFile[] = [];

    for (const f of files) {
      if (shouldFilterTaskFile(f.filePath)) {
        hiddenFiles.push(toViewerFile(f));
      } else {
        visibleFiles.push(toViewerFile(f));
      }
    }

    const allFiles = [...visibleFiles, ...hiddenFiles];

    return {
      allFiles,
      hiddenFiles,
      hiddenTree: buildTree(hiddenFiles),
      tree: buildTree(visibleFiles),
      visibleFiles,
    };
  }, [files, task.id, assetBaseUrl]);

  if (!computed) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div className="h-5 animate-pulse rounded-sm bg-muted" key={i} />
        ))}
      </div>
    );
  }

  const folderEntries = attachedFolders ? Object.values(attachedFolders) : [];

  // Only when there is genuinely nothing to draw. This used to ask whether the
  // task had any *prominent* files, which answered "no" for a task whose work
  // so far is all under `work/` -- and then said there were no files while the
  // "Other files" section below was holding them.
  if (
    computed.tree.length === 0 &&
    computed.hiddenTree.length === 0 &&
    folderEntries.length === 0
  ) {
    return (
      // Padded rather than centered in a flex child that collapses: this panel
      // is as tall as its contents, so `flex-1` around one line of text left it
      // in a box barely taller than the line.
      <div className="px-4 py-8 text-center text-sm text-muted-foreground">
        There are no files yet.
      </div>
    );
  }

  return (
    <SidebarProvider
      className="flex min-h-0 flex-1 flex-col overflow-y-auto px-1 py-1"
      style={{ "--sidebar-width": "100%" } as React.CSSProperties}
    >
      <SidebarMenu>
        {computed.tree.map((node, i) => (
          <TreeNode
            activeFilePath={activeFilePath}
            defaultOpen={
              node.kind === "dir" &&
              (node.name === TASK_FOLDER_NAMES.attachments ||
                node.name === TASK_FOLDER_NAMES.output)
            }
            key={i}
            node={node}
            onFileClick={onFileSelect}
          />
        ))}
        {folderEntries.length > 0 && (
          <>
            <SidebarMenuItem>
              <CollapsibleTreeSection defaultOpen label="Attached folders">
                {folderEntries.map((folder) => (
                  <AttachedFolderRow
                    folder={folder}
                    key={folder.id}
                    taskId={task.id}
                  />
                ))}
              </CollapsibleTreeSection>
            </SidebarMenuItem>
            <li aria-hidden className="-mx-1 h-px bg-border/50" />
          </>
        )}
        {computed.hiddenTree.length > 0 && (
          <SidebarMenuItem>
            <CollapsibleTreeSection
              forceOpen={computed.hiddenFiles.some(
                (f) => f.filePath === activeFilePath,
              )}
              label="Other files"
              labelClassName="text-muted-foreground/60"
            >
              {computed.hiddenTree.map((node, i) => (
                <TreeNode
                  activeFilePath={activeFilePath}
                  key={i}
                  node={node}
                  onFileClick={onFileSelect}
                />
              ))}
            </CollapsibleTreeSection>
          </SidebarMenuItem>
        )}
      </SidebarMenu>
    </SidebarProvider>
  );
}

function AttachedFolderRow({
  folder,
  taskId,
}: {
  folder: AttachedFolder;
  taskId: TaskId;
}) {
  const { mutate: removeFolder } = useMutation(
    rpcClient.workspace.task.state.removeFolder.mutationOptions({
      onError: (error) => {
        toast.error("Failed to remove folder", { description: error.message });
      },
    }),
  );
  const { mutate: setFolderAccess } = useMutation(
    rpcClient.workspace.task.state.setFolderAccess.mutationOptions({
      onError: (error) => {
        toast.error("Failed to change folder access", {
          description: error.message,
        });
      },
    }),
  );

  // Every folder the task carries, including the ones it inherited: a task is
  // where the work happens, so what it may reach is decided here as well as in
  // the project. The project's later edits still arrive (see
  // `projectFolderBaseline`), which is what keeps editing the project the way
  // to change every task at once.
  return (
    <SidebarMenuItem>
      <FolderAttachmentRow
        access={folder.access}
        onAccessChange={(access) => {
          setFolderAccess({ access, folderId: folder.id, id: taskId });
        }}
        onRemove={() => {
          removeFolder({ folderId: folder.id, id: taskId });
        }}
        path={folder.path}
        removeLabel="Remove from task"
      />
    </SidebarMenuItem>
  );
}

function buildTree(files: TaskFileViewerFile[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];

  for (const file of files) {
    const parts = file.filePath.split("/");
    let nodes = root;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!part || part === ".") {
        continue;
      }
      let dir = nodes.find(
        (n): n is Extract<FileTreeNode, { kind: "dir" }> =>
          n.kind === "dir" && n.name === part,
      );
      if (!dir) {
        dir = { children: [], kind: "dir", name: part };
        nodes.push(dir);
      }
      nodes = dir.children;
    }

    nodes.push({ file, kind: "file" });
  }

  root.sort((a, b) => rankTreeNode(a) - rankTreeNode(b));

  return root;
}

function directorySectionLabel(dirName: string) {
  if (dirName === TASK_FOLDER_NAMES.output) {
    return `Made by ${APP_NAME}`;
  }
  if (dirName === TASK_FOLDER_NAMES.attachments) {
    return "Attached files";
  }
  return dirName;
}

function FileRow({
  file,
  isActive,
  onClick,
}: {
  file: TaskFileViewerFile;
  isActive: boolean;
  onClick: () => void;
}) {
  const appendToPrompt = useSetAtom(appendToPromptAtom);

  const handleAddToChat = () => {
    appendToPrompt({
      key: { scope: "task", taskId: file.taskId },
      update: file.filePath,
    });
  };

  return (
    <SidebarMenuItem>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <SidebarMenuButton
            className={cn(
              "h-auto min-h-14 items-stretch gap-3 px-3 py-2 text-xs",
              isActive
                ? "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                : "hover:bg-muted/50",
            )}
            isActive={isActive}
            onClick={onClick}
          >
            <FileThumbnail file={file} isActive={isActive} />
            <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 text-left">
              <span className="truncate font-medium">{file.filename}</span>
              <span
                className={cn(
                  "truncate",
                  isActive
                    ? "text-sidebar-accent-foreground/70"
                    : "text-muted-foreground",
                )}
              >
                {getFileKindLabel(file)}
                {file.modifiedAt !== undefined && (
                  <>
                    {" · "}
                    <RelativeTime date={new Date(file.modifiedAt)} />
                  </>
                )}
              </span>
            </div>
          </SidebarMenuButton>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <FileActionsMenuItems
            file={file}
            menuComponents={contextMenuComponents}
            onAddToChat={handleAddToChat}
          />
        </ContextMenuContent>
      </ContextMenu>
      <FilesItemMenu>
        <FileActionsMenuItems
          file={file}
          menuComponents={dropdownMenuComponents}
          onAddToChat={handleAddToChat}
        />
      </FilesItemMenu>
    </SidebarMenuItem>
  );
}

function FilesItemMenu({ children }: { children: React.ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuAction showOnHover>
          <DotsThreeOutlineVerticalIcon weight="fill" />
          <span className="sr-only">More</span>
        </SidebarMenuAction>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="bottom">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const DIR_RANK: Record<string, number> = {
  [TASK_FOLDER_NAMES.attachments]: 1,
  [TASK_FOLDER_NAMES.output]: 0,
};

function CollapsibleTreeSection({
  children,
  defaultOpen = false,
  forceOpen,
  icon: Icon,
  label,
  labelClassName,
}: {
  children: React.ReactNode;
  defaultOpen?: boolean;
  forceOpen?: boolean;
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  labelClassName?: string;
}) {
  const [open, setOpen] = useState(defaultOpen || (forceOpen ?? false));
  const [prevForceOpen, setPrevForceOpen] = useState(forceOpen);

  if (forceOpen && forceOpen !== prevForceOpen) {
    setPrevForceOpen(forceOpen);
    setOpen(true);
  }

  return (
    <Collapsible onOpenChange={setOpen} open={open}>
      <CollapsibleTrigger asChild>
        <SidebarMenuButton
          className={cn(
            "group/collapsible-trigger h-auto min-h-8 gap-2 px-3 py-2 text-xs font-medium text-foreground",
            labelClassName,
          )}
        >
          {Icon && <Icon className="size-3.5! shrink-0" />}
          <span className="min-w-0 flex-1 truncate text-left">{label}</span>
          <CaretRightIcon className="size-3! shrink-0 text-muted-foreground transition-transform group-data-[state=open]/collapsible-trigger:rotate-90" />
        </SidebarMenuButton>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="flex min-w-0 flex-col overflow-hidden">{children}</ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

function dirContainsActive(
  node: Extract<FileTreeNode, { kind: "dir" }>,
  activeFilePath: null | string,
): boolean {
  if (!activeFilePath) {
    return false;
  }
  for (const child of node.children) {
    if (child.kind === "file") {
      if (child.file.filePath === activeFilePath) {
        return true;
      }
    } else if (dirContainsActive(child, activeFilePath)) {
      return true;
    }
  }
  return false;
}

function rankTreeNode(node: FileTreeNode) {
  return node.kind === "dir" ? (DIR_RANK[node.name] ?? 2) : 2;
}

function TreeNode({
  activeFilePath,
  defaultOpen = false,
  node,
  onFileClick,
  treeDepth = 0,
}: {
  activeFilePath: null | string;
  defaultOpen?: boolean;
  node: FileTreeNode;
  onFileClick: (file: TaskFileViewerFile) => void;
  treeDepth?: number;
}) {
  if (node.kind === "file") {
    return (
      <FileRow
        file={node.file}
        isActive={node.file.filePath === activeFilePath}
        onClick={() => {
          onFileClick(node.file);
        }}
      />
    );
  }

  const containsActive = dirContainsActive(node, activeFilePath);
  const isTopSpecialSection =
    treeDepth === 0 &&
    (node.name === TASK_FOLDER_NAMES.output ||
      node.name === TASK_FOLDER_NAMES.attachments);

  return (
    <SidebarMenuItem>
      <CollapsibleTreeSection
        defaultOpen={defaultOpen}
        forceOpen={containsActive}
        icon={isTopSpecialSection ? undefined : FolderSimpleIcon}
        label={directorySectionLabel(node.name)}
        labelClassName={
          isTopSpecialSection ? undefined : "text-muted-foreground/60"
        }
      >
        {node.children.map((child, i) => (
          <TreeNode
            activeFilePath={activeFilePath}
            key={i}
            node={child}
            onFileClick={onFileClick}
            treeDepth={treeDepth + 1}
          />
        ))}
      </CollapsibleTreeSection>
    </SidebarMenuItem>
  );
}
