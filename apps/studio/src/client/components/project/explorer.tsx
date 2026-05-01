import { type ProjectFileViewerFile } from "@/client/atoms/project-file-viewer";
import { appendToPromptAtom } from "@/client/atoms/prompt-value";
import { FileIcon } from "@/client/components/file-icon";
import { RevealInFolderIcon } from "@/client/components/icons/reveal-in-folder";
import { ImageWithFallback } from "@/client/components/image-with-fallback";
import { getAssetUrl } from "@/client/lib/get-asset-url";
import { getFileType } from "@/client/lib/get-file-type";
import {
  hasVisibleProjectFiles,
  isProjectFileSrcFile,
  shouldFilterProjectFile,
} from "@/client/lib/project-file-groups";
import { cn, getRevealInFolderLabel } from "@/client/lib/utils";
import { type RPCOutput } from "@/client/rpc/client";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import {
  APP_FOLDER_NAMES,
  type ProjectSubdomain,
  type WorkspaceAppProject,
} from "@instrument-org/workspace/client";
import { safe } from "@orpc/client";
import {
  CaretRightIcon,
  ChatTextIcon,
  DotsThreeOutlineVerticalIcon,
  FolderOpenIcon,
  FolderSimpleIcon,
  GlobeIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { FileActionsMenuItems } from "../file-actions-menu";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "../ui/sidebar";

type AttachedFolder = NonNullable<
  RPCOutput["workspace"]["project"]["state"]["get"]["attachedFolders"]
>[string];

type FileTreeNode =
  | { children: FileTreeNode[]; kind: "dir"; name: string }
  | { file: ProjectFileViewerFile; kind: "file" };

export function ProjectFiles({
  activeFilePath,
  attachedFolders,
  files,
  isAppViewOpen,
  onAppSelect,
  onFileSelect,
  project,
  showAppEntry,
}: {
  activeFilePath: null | string;
  attachedFolders: RPCOutput["workspace"]["project"]["state"]["get"]["attachedFolders"];
  files: RPCOutput["workspace"]["project"]["git"]["listFiles"] | undefined;
  isAppViewOpen: boolean;
  onAppSelect: () => void;
  onFileSelect: (file: ProjectFileViewerFile) => void;
  project: WorkspaceAppProject;
  showAppEntry: boolean;
}) {
  const appendToPrompt = useSetAtom(appendToPromptAtom);

  const computed = useMemo(() => {
    if (!files) {
      return null;
    }

    const toViewerFile = (
      f: (typeof files)[number],
    ): ProjectFileViewerFile => ({
      ...f,
      projectSubdomain: project.subdomain,
      url: getAssetUrl({
        assetBase: project.urls.assetBase,
        filePath: f.filePath,
      }),
    });

    const visibleFiles: ProjectFileViewerFile[] = [];
    const hiddenFiles: ProjectFileViewerFile[] = [];

    for (const f of files) {
      if (
        isProjectFileSrcFile(f.filePath) ||
        shouldFilterProjectFile(f.filePath)
      ) {
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
  }, [files, project.subdomain, project.urls.assetBase]);

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

  const hasSrcInProject = computed.hiddenFiles.some((f) =>
    isProjectFileSrcFile(f.filePath),
  );

  if (
    !hasVisibleProjectFiles(files) &&
    folderEntries.length === 0 &&
    !showAppEntry &&
    !hasSrcInProject
  ) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">
        There are no files yet.
      </div>
    );
  }

  const appAddToChatLabel = `the app in ${APP_FOLDER_NAMES.src}/`;

  const handleAppAddToChat = () => {
    appendToPrompt({ key: project.subdomain, update: appAddToChatLabel });
  };

  return (
    <SidebarProvider
      className="flex min-h-0 flex-1 flex-col overflow-y-auto px-1 py-1"
      style={{ "--sidebar-width": "100%" } as React.CSSProperties}
    >
      {showAppEntry && (
        <SidebarMenu>
          <SidebarMenuItem>
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <SidebarMenuButton
                  className={cn(
                    "h-7 min-w-0 flex-1 gap-1.5 rounded-md px-2 text-xs font-medium",
                    isAppViewOpen
                      ? "bg-sidebar-accent text-foreground"
                      : "text-muted-foreground",
                  )}
                  onClick={onAppSelect}
                >
                  <GlobeIcon className="size-3.5! shrink-0" />
                  <span className="truncate">App</span>
                </SidebarMenuButton>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onClick={handleAppAddToChat}>
                  <ChatTextIcon className="size-4" />
                  <span>Add to chat</span>
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
            <FilesItemMenu>
              <DropdownMenuItem onClick={handleAppAddToChat}>
                <ChatTextIcon className="size-4" />
                <span>Add to chat</span>
              </DropdownMenuItem>
            </FilesItemMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      )}
      <SidebarMenu>
        {computed.tree.map((node, i) => (
          <TreeNode
            activeFilePath={activeFilePath}
            defaultOpen={
              node.kind === "dir" &&
              (node.name === APP_FOLDER_NAMES.userProvided ||
                node.name === APP_FOLDER_NAMES.output)
            }
            key={i}
            node={node}
            onFileClick={onFileSelect}
          />
        ))}
        {folderEntries.length > 0 && (
          <SidebarMenuItem>
            <CollapsibleTreeSection defaultOpen label="Attached folders">
              {folderEntries.map((folder) => (
                <AttachedFolderRow
                  folder={folder}
                  key={folder.id}
                  projectSubdomain={project.subdomain}
                />
              ))}
            </CollapsibleTreeSection>
          </SidebarMenuItem>
        )}
        {computed.hiddenTree.length > 0 && (
          <SidebarMenuItem>
            <CollapsibleTreeSection
              forceOpen={computed.hiddenFiles.some(
                (f) => f.filePath === activeFilePath,
              )}
              label="Other Files"
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

function AttachedFolderMenuItems({
  onAddToChat,
  onReveal,
  variant,
}: {
  onAddToChat: () => void;
  onReveal: () => void;
  variant: "context" | "dropdown";
}) {
  const Item = variant === "context" ? ContextMenuItem : DropdownMenuItem;
  const Separator =
    variant === "context" ? ContextMenuSeparator : DropdownMenuSeparator;

  return (
    <>
      <Item onClick={onAddToChat}>
        <ChatTextIcon className="size-4" />
        <span>Add to chat</span>
      </Item>
      <Separator />
      <Item onClick={onReveal}>
        <RevealInFolderIcon className="size-4" />
        <span>{getRevealInFolderLabel()}</span>
      </Item>
    </>
  );
}

function AttachedFolderRow({
  folder,
  projectSubdomain,
}: {
  folder: AttachedFolder;
  projectSubdomain: ProjectSubdomain;
}) {
  const appendToPrompt = useSetAtom(appendToPromptAtom);

  const revealMutation = useMutation(
    rpcClient.utils.showFileInFolder.mutationOptions({
      onError: (error) => {
        toast.error(`Failed to ${getRevealInFolderLabel().toLowerCase()}`, {
          description: error.message,
        });
      },
    }),
  );

  const handleClick = async () => {
    const [error] = await safe(
      rpcClient.utils.openFolder.call({ folderPath: folder.path }),
    );
    if (error) {
      toast.error("Failed to open folder", { description: error.message });
    }
  };

  const handleAddToChat = () => {
    appendToPrompt({
      key: projectSubdomain,
      update: `the attached folder "${folder.name}"`,
    });
  };

  const handleReveal = () => {
    revealMutation.mutate({ filepath: folder.path });
  };

  return (
    <SidebarMenuItem>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <SidebarMenuButton
            className="h-auto min-h-14 items-stretch gap-2.5 px-3 py-2 text-xs hover:bg-muted/50"
            isActive={false}
            onClick={() => void handleClick()}
          >
            <ExplorerFolderThumbnail />
            <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 text-left">
              <span className="truncate font-medium text-foreground/90">
                {folder.name}
              </span>
              <span className="truncate text-muted-foreground">
                Folder · {explorerStubRelativeDate()}
              </span>
            </div>
          </SidebarMenuButton>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <AttachedFolderMenuItems
            onAddToChat={handleAddToChat}
            onReveal={handleReveal}
            variant="context"
          />
        </ContextMenuContent>
      </ContextMenu>
      <FilesItemMenu>
        <AttachedFolderMenuItems
          onAddToChat={handleAddToChat}
          onReveal={handleReveal}
          variant="dropdown"
        />
      </FilesItemMenu>
    </SidebarMenuItem>
  );
}

function buildTree(files: ProjectFileViewerFile[]): FileTreeNode[] {
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
  if (dirName === APP_FOLDER_NAMES.output) {
    return `Made by ${APP_NAME}`;
  }
  if (dirName === APP_FOLDER_NAMES.userProvided) {
    return "Attached files";
  }
  return dirName;
}

function explorerFileKindLabel(file: ProjectFileViewerFile) {
  switch (getFileType(file)) {
    case "audio": {
      return "Audio";
    }
    case "code": {
      return "Code";
    }
    case "html": {
      return "HTML";
    }
    case "image": {
      return "Image";
    }
    case "markdown": {
      return "Markdown";
    }
    case "pdf": {
      return "PDF";
    }
    case "text": {
      return "Text file";
    }
    case "video": {
      return "Video";
    }
    default: {
      return "File";
    }
  }
}

function ExplorerFileThumbnail({
  file,
  isActive,
}: {
  file: ProjectFileViewerFile;
  isActive: boolean;
}) {
  const kind = getFileType(file);

  if (kind === "image") {
    return (
      <ThumbnailFrame isActive={isActive}>
        <ImageWithFallback
          alt=""
          className="size-full object-contain"
          draggable={false}
          fallback={
            <div className="flex size-full items-center justify-center">
              <FileIcon
                className={thumbnailIconClass(isActive)}
                filename={file.filename}
                mimeType={file.mimeType}
              />
            </div>
          }
          filename={file.filename}
          showCheckerboard
          src={file.url}
        />
      </ThumbnailFrame>
    );
  }

  if (kind === "markdown" || kind === "text" || kind === "code") {
    return (
      <ThumbnailFrame className="flex flex-col p-1" isActive={isActive}>
        <div className="flex flex-1 flex-col justify-center gap-px">
          {[0.85, 0.72, 0.9, 0.55].map((w) => (
            <div
              className={cn(
                "h-px min-w-0 rounded-full",
                isActive
                  ? "bg-sidebar-accent-foreground/35"
                  : "bg-muted-foreground/20",
              )}
              key={w}
              style={{ width: `${w * 100}%` }}
            />
          ))}
        </div>
      </ThumbnailFrame>
    );
  }

  return (
    <ThumbnailFrame
      className="flex items-center justify-center"
      isActive={isActive}
    >
      <FileIcon
        className={thumbnailIconClass(isActive)}
        filename={file.filename}
        mimeType={file.mimeType}
      />
    </ThumbnailFrame>
  );
}

function ExplorerFolderThumbnail({ isActive }: { isActive?: boolean }) {
  return (
    <ThumbnailFrame
      className="flex items-center justify-center"
      isActive={isActive}
    >
      <FolderOpenIcon className={thumbnailIconClass(isActive)} />
    </ThumbnailFrame>
  );
}

function explorerStubRelativeDate() {
  return "just now";
}

function FileRow({
  file,
  isActive,
  onClick,
}: {
  file: ProjectFileViewerFile;
  isActive: boolean;
  onClick: () => void;
}) {
  const appendToPrompt = useSetAtom(appendToPromptAtom);

  const handleAddToChat = () => {
    appendToPrompt({
      key: file.projectSubdomain,
      update: file.filePath,
    });
  };

  return (
    <SidebarMenuItem>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <SidebarMenuButton
            className={cn(
              "h-auto min-h-14 items-stretch gap-2.5 px-3 py-2 text-xs",
              isActive
                ? "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                : "hover:bg-muted/50",
            )}
            isActive={isActive}
            onClick={onClick}
          >
            <ExplorerFileThumbnail file={file} isActive={isActive} />
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
                {explorerFileKindLabel(file)} · {explorerStubRelativeDate()}
              </span>
            </div>
          </SidebarMenuButton>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <FileActionsMenuItems
            file={file}
            onAddToChat={handleAddToChat}
            variant="context"
          />
        </ContextMenuContent>
      </ContextMenu>
      <FilesItemMenu>
        <FileActionsMenuItems
          file={file}
          onAddToChat={handleAddToChat}
          variant="dropdown"
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

function ThumbnailFrame({
  children,
  className,
  isActive,
}: {
  children: React.ReactNode;
  className?: string;
  isActive?: boolean;
}) {
  return (
    <div
      className={cn(
        "h-10 w-8 shrink-0 overflow-hidden rounded-md border border-border bg-background shadow-sm",
        isActive &&
          "border-sidebar-accent-foreground/20 bg-sidebar-accent-foreground/10",
        className,
      )}
    >
      {children}
    </div>
  );
}

function thumbnailIconClass(isActive?: boolean) {
  return cn(
    "size-4 shrink-0",
    isActive ? "text-sidebar-accent-foreground" : "text-muted-foreground",
  );
}

const DIR_RANK: Record<string, number> = {
  [APP_FOLDER_NAMES.output]: 0,
  [APP_FOLDER_NAMES.userProvided]: 1,
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
  icon?: Icon;
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
    <Collapsible
      className="group/collapsible"
      onOpenChange={setOpen}
      open={open}
    >
      <CollapsibleTrigger asChild>
        <SidebarMenuButton
          className={cn(
            "h-auto min-h-8 gap-2 px-3 py-2 text-xs font-medium text-foreground",
            labelClassName,
          )}
        >
          {Icon && <Icon className="size-3.5 shrink-0 text-muted-foreground" />}
          <span className="min-w-0 flex-1 truncate text-left">{label}</span>
          <CaretRightIcon className="size-3! shrink-0 text-muted-foreground transition-transform group-data-[state=open]/collapsible:rotate-90" />
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
  onFileClick: (file: ProjectFileViewerFile) => void;
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
    (node.name === APP_FOLDER_NAMES.output ||
      node.name === APP_FOLDER_NAMES.userProvided);

  return (
    <SidebarMenuItem>
      <CollapsibleTreeSection
        defaultOpen={defaultOpen}
        forceOpen={containsActive}
        icon={isTopSpecialSection ? undefined : FolderSimpleIcon}
        label={directorySectionLabel(node.name)}
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
