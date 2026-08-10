import { err, ok, ResultAsync, safeTry } from "neverthrow";
import fs from "node:fs/promises";
import path from "node:path";
import { ulid } from "ulid";

import { TASK_FOLDER_NAMES } from "../constants";
import { type FileUpload } from "../schemas/file-upload";
import { FolderAttachment } from "../schemas/folder-attachment";
import {
  type AbsolutePath,
  AbsolutePathSchema,
  type RelativePath,
  RelativePathSchema,
  type TaskDir,
} from "../schemas/paths";
import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { absolutePathJoin } from "./absolute-path-join";
import { assignMountNames } from "./assign-mount-names";
import { TypedError } from "./errors";
import { findAvailableName } from "./find-available-name";
import { getCurrentDate } from "./get-current-date";
import { getMimeType } from "./get-mime-type";
import { normalizePath } from "./normalize-path";
import { pathExists } from "./path-exists";
import { sanitizeFilename } from "./sanitize-filename";
import { getTaskAttachmentsDir } from "./task-dir-utils";
import { getTaskState, setTaskState } from "./task-state-store";

type PathFileUpload = Extract<FileUpload.Type, { path: string }>;
interface PreparedUploadedFile {
  filename: string;
  filePath: AbsolutePath;
  input: FileUpload.Type;
  // A source the task already holds is attached where it lies, so there is
  // nothing to write and `filePath` names the file itself.
  isInTask: boolean;
  mimeType: string;
  relativePath: RelativePath;
}

export async function writeUploadedAttachments({
  dir,
  files,
  folders,
  messageId,
  sessionId,
}: {
  dir: TaskDir;
  files?: FileUpload.Type[];
  folders?: {
    access?: FolderAttachment.Access;
    path: string;
    source?: FolderAttachment.Source;
  }[];
  messageId: StoreId.Message;
  sessionId: StoreId.Session;
}) {
  return safeTry(async function* () {
    const fileInfos: SessionMessageDataPart.FileAttachmentDataPart[] = [];
    const folderAttachments: FolderAttachment.Type[] = [];

    if (files && files.length > 0) {
      const preparedFiles = yield* await prepareUploadedFiles({
        dir,
        files,
      });

      for (const preparedFile of preparedFiles) {
        if (!preparedFile.isInTask) {
          if ("path" in preparedFile.input) {
            yield* ResultAsync.fromPromise(
              fs.copyFile(preparedFile.input.path, preparedFile.filePath),
              (error) =>
                new TypedError.FileSystem(
                  error instanceof Error ? error.message : "Unknown error",
                  { cause: error },
                ),
            );
          } else {
            const buffer = Buffer.from(preparedFile.input.content, "base64");
            yield* ResultAsync.fromPromise(
              fs.writeFile(preparedFile.filePath, buffer),
              (error) =>
                new TypedError.FileSystem(
                  error instanceof Error ? error.message : "Unknown error",
                  { cause: error },
                ),
            );
          }
        }

        const stats = yield* ResultAsync.fromPromise(
          fs.stat(preparedFile.filePath),
          (error) =>
            new TypedError.FileSystem(
              error instanceof Error ? error.message : "Unknown error",
              { cause: error },
            ),
        );

        if (
          !preparedFile.isInTask &&
          "path" in preparedFile.input &&
          stats.size !== preparedFile.input.size
        ) {
          yield* err(
            new TypedError.FileSystem(
              `Uploaded file size changed during copy: ${preparedFile.input.filename}`,
            ),
          );
        }

        fileInfos.push({
          filename: preparedFile.filename,
          filePath: preparedFile.relativePath,
          mimeType: preparedFile.mimeType,
          modifiedAt: stats.mtimeMs,
          size: stats.size,
        });
      }
    }

    if (folders && folders.length > 0) {
      const taskState = await getTaskState(dir);
      const existingFolders = Object.values(taskState.attachedFolders ?? {});

      // A path already attached is not attached twice: two mounts over one
      // directory get two names and can disagree about access, and the agent
      // would be free to write through the permissive one. Re-attaching can
      // still tighten access -- an explicit read-only attach is the user
      // narrowing the grant -- but never widen it silently.
      const existingByPath = new Map(
        existingFolders.map((folder) => [folder.path, folder]),
      );
      const newFolders: FolderAttachment.Type[] = [];
      const tightened = new Map<string, FolderAttachment.Access>();
      for (const folder of folders) {
        const folderPath = AbsolutePathSchema.parse(folder.path);
        const access = folder.access ?? "read-only";
        const existing = existingByPath.get(folderPath);
        if (existing) {
          if (existing.access === "read-write" && access === "read-only") {
            tightened.set(folderPath, access);
          }
          continue;
        }
        newFolders.push({
          access,
          createdAt: getCurrentDate().getTime(),
          id: FolderAttachment.IdSchema.parse(ulid()),
          mountName: "",
          path: folderPath,
          source: folder.source ?? "user",
        });
      }

      const allFolders = [
        ...existingFolders.map((folder) => {
          const access = tightened.get(folder.path);
          return access ? { ...folder, access } : folder;
        }),
        ...newFolders,
      ].sort((a, b) => a.createdAt - b.createdAt);
      const names = assignMountNames(allFolders);

      const nextFolders: Record<string, FolderAttachment.Type> = {};
      for (const folder of allFolders) {
        const mountName = names.get(folder.id) ?? folder.mountName;
        nextFolders[mountName] = { ...folder, mountName };
      }
      await setTaskState(dir, { attachedFolders: nextFolders });

      for (const folder of newFolders) {
        const mountName = names.get(folder.id) ?? folder.mountName;
        folderAttachments.push({ ...folder, mountName });
      }
    }

    const fileMetadata: SessionMessageDataPart.FileAttachmentDataPart[] =
      fileInfos.map((file) => ({ ...file }));

    const part: SessionMessagePart.Type = {
      data: {
        files: fileMetadata,
        folders: folderAttachments.length > 0 ? folderAttachments : undefined,
      },
      metadata: {
        createdAt: new Date(),
        id: StoreId.newPartId(),
        messageId,
        sessionId,
      },
      type: "data-attachments",
    };

    return ok({ part });
  });
}

function fileSystemError(error: unknown) {
  return new TypedError.FileSystem(
    error instanceof Error ? error.message : "Unknown error",
    { cause: error },
  );
}

async function getUniqueFilename(
  inputDir: AbsolutePath,
  filename: string,
  reservedFilenames: ReadonlySet<string>,
): Promise<string> {
  const { name } = await findAvailableName({
    isTaken: (candidate) =>
      reservedFilenames.has(candidate) ||
      pathExists(absolutePathJoin(inputDir, candidate)),
    name: filename,
    splitExtension: true,
    startAt: 1,
  });
  return name;
}

function prepareUploadedFiles({
  dir,
  files,
}: {
  dir: TaskDir;
  files: FileUpload.Type[];
}) {
  return safeTry(async function* () {
    const inputDir = getTaskAttachmentsDir(dir);
    yield* ResultAsync.fromPromise(
      fs.mkdir(inputDir, { recursive: true }),
      fileSystemError,
    );

    const preparedFiles: PreparedUploadedFile[] = [];
    const reservedFilenames = new Set<string>();

    for (const file of files) {
      if ("path" in file) {
        yield* await validatePathUpload({ file });

        // A file the task already holds is attached where it lies. Copying it
        // into `attachments/` would fork it: the agent would work on the copy
        // while the original the user pointed at silently went stale.
        const inTaskPath = taskAttachmentPath({ dir, filePath: file.path });
        if (inTaskPath) {
          preparedFiles.push({
            filename: file.filename,
            filePath: file.path,
            input: file,
            isInTask: true,
            mimeType: file.mimeType,
            relativePath: inTaskPath,
          });
          continue;
        }
      }

      const sanitized = sanitizeFilename(file.filename);
      const uniqueFilename = yield* ResultAsync.fromPromise(
        getUniqueFilename(inputDir, sanitized, reservedFilenames),
        fileSystemError,
      );

      reservedFilenames.add(uniqueFilename);

      const relativePath = RelativePathSchema.parse(
        `${TASK_FOLDER_NAMES.attachments}/${uniqueFilename}`,
      );

      preparedFiles.push({
        filename: uniqueFilename,
        filePath: absolutePathJoin(dir, relativePath),
        input: file,
        isInTask: false,
        mimeType: "path" in file ? file.mimeType : getMimeType(uniqueFilename),
        relativePath,
      });
    }

    return ok(preparedFiles);
  });
}

/**
 * The task-relative spelling of a path already inside the task, or undefined
 * for one outside it. The private dir counts as outside: the agent may not read
 * it, so a file dragged out of there is copied in like any other outside file.
 */
function taskAttachmentPath({
  dir,
  filePath,
}: {
  dir: TaskDir;
  filePath: AbsolutePath;
}): RelativePath | undefined {
  const relative = normalizePath(path.relative(dir, filePath));
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith("../") ||
    path.isAbsolute(relative) ||
    relative.split("/")[0] === TASK_FOLDER_NAMES.private
  ) {
    return undefined;
  }
  return RelativePathSchema.parse(relative);
}

function validatePathUpload({ file }: { file: PathFileUpload }) {
  return safeTry(async function* () {
    if (!path.isAbsolute(file.path)) {
      yield* err(
        new TypedError.FileSystem(
          `Uploaded file path is not absolute: ${file.filename}`,
        ),
      );
    }

    const sourceFilename = path.basename(file.path);
    if (sourceFilename !== file.filename) {
      yield* err(
        new TypedError.FileSystem(
          `Uploaded file path does not match filename: ${file.filename}`,
        ),
      );
    }

    const sourceStats = yield* ResultAsync.fromPromise(
      fs.stat(file.path),
      fileSystemError,
    );
    if (!sourceStats.isFile()) {
      yield* err(
        new TypedError.FileSystem(
          `Uploaded path is not a file: ${file.filename}`,
        ),
      );
    }
    if (sourceStats.size !== file.size) {
      yield* err(
        new TypedError.FileSystem(
          `Uploaded file size changed before copy: ${file.filename}`,
        ),
      );
    }

    return ok(undefined);
  });
}
