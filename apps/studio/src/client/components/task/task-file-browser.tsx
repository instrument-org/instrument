import { appendToPromptAtom } from "@/client/atoms/prompt-value";
import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import {
  FileSystem,
  type FileSystemFileItem,
  type FileSystemItem,
} from "@/client/components/document-viewers/file-system";
import { FolderAttachmentRow } from "@/client/components/folder-attachment-row";
import { useOpenTaskFile } from "@/client/hooks/use-open-task-file";
import { getAssetBaseUrl } from "@/client/lib/asset-base-url";
import { getAssetUrl } from "@/client/lib/get-asset-url";
import { getFileType } from "@/client/lib/get-file-type";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { type Task, type TaskId } from "@instrument-org/workspace/client";
import { ChatTextIcon } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { toast } from "sonner";

type AttachedFolder = NonNullable<
  RPCOutput["workspace"]["task"]["state"]["get"]["attachedFolders"]
>[string];

export function TaskFileBrowser({
  attachedFolders,
  files,
  onFileSelect,
  task,
}: {
  attachedFolders: RPCOutput["workspace"]["task"]["state"]["get"]["attachedFolders"];
  files: RPCOutput["workspace"]["task"]["files"]["list"] | undefined;
  onFileSelect: (file: TaskFileViewerFile) => void;
  task: Task;
}) {
  const assetBaseUrl = getAssetBaseUrl(task.id);
  const openTaskFile = useOpenTaskFile();

  const viewerFilesByPath = new Map<string, TaskFileViewerFile>();
  const items: FileSystemItem[] = [];

  for (const file of files ?? []) {
    if (isHiddenTaskFile(file.filePath)) {
      continue;
    }

    const viewerFile: TaskFileViewerFile = {
      ...file,
      taskId: task.id,
      url: getAssetUrl({
        assetBase: assetBaseUrl,
        filePath: file.filePath,
        version: file.modifiedAt,
      }),
    };

    viewerFilesByPath.set(file.filePath, viewerFile);
    // Each item carries its own version-stamped URL rather than leaving one to
    // be resolved through `getFileUrl`, which the browser caches per path and
    // would pin a file to the bytes it had when it was first opened.
    items.push({
      contentType: file.mimeType,
      kind: "file",
      name: file.filename,
      path: file.filePath,
      size: file.size,
      updatedAt: new Date(file.modifiedAt).toISOString(),
      url: viewerFile.url,
    });
  }

  const folderEntries = attachedFolders ? Object.values(attachedFolders) : [];

  const handleFileOpen = (item: FileSystemFileItem) => {
    const file = viewerFilesByPath.get(item.path);
    if (!file) {
      return;
    }

    // Studio's artifact panel previews more formats than the browser's own
    // viewers do (markdown, code, audio, video); anything it cannot render
    // hands off to the OS-associated application.
    if (getFileType(file) === "unknown") {
      openTaskFile(file);
      return;
    }

    onFileSelect(file);
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <FileSystem
        className="min-h-0 flex-1 rounded-none border-0"
        defaultView="list"
        items={items}
        onFileOpen={handleFileOpen}
      />
      {folderEntries.length > 0 && (
        <div className="shrink-0 border-t">
          <div className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground">
            Attached folders
          </div>
          <ul className="flex flex-col pb-1">
            {folderEntries.map((folder) => (
              <li key={folder.id}>
                <AttachedFolderRow folder={folder} taskId={task.id} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function AttachedFolderRow({
  folder,
  taskId,
}: {
  folder: AttachedFolder;
  taskId: TaskId;
}) {
  const appendToPrompt = useSetAtom(appendToPromptAtom);

  const { mutate: removeFolder } = useMutation(
    rpcClient.workspace.task.state.removeFolder.mutationOptions({
      onError: (error) => {
        toast.error("Failed to remove folder", { description: error.message });
      },
    }),
  );

  return (
    <FolderAttachmentRow
      additionalMenuItems={[
        {
          icon: <ChatTextIcon className="size-4" />,
          label: "Add to chat",
          onSelect: () => {
            appendToPrompt({
              key: { scope: "task", taskId },
              update: `the attached folder "${folder.name}"`,
            });
          },
        },
      ]}
      name={folder.name}
      onRemove={() => {
        removeFolder({ folderId: folder.id, id: taskId });
      }}
      path={folder.path}
      removeLabel="Remove from task"
    />
  );
}

/**
 * The server-side file index already drops `.git`, `node_modules` and the
 * task's private dir, but dot-prefixed entries (such as the `.gitignore`
 * written during task setup) still reach the client. Those are plumbing, not
 * deliverables. Nothing else is filtered: the folder hierarchy the browser
 * renders is what keeps the agent's scratch work out of the way, so an
 * allowlist of prominent top-level dirs is no longer needed.
 */
function isHiddenTaskFile(filePath: string) {
  return filePath.split("/").some((segment) => segment.startsWith("."));
}
