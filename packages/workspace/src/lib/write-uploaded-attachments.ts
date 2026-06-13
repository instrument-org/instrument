import { err, ok, ResultAsync, safeTry } from "neverthrow";
import fs from "node:fs/promises";
import path from "node:path";
import { ulid } from "ulid";

import { APP_FOLDER_NAMES } from "../constants";
import { type FileUpload } from "../schemas/file-upload";
import { FolderAttachment } from "../schemas/folder-attachment";
import {
  type AbsolutePath,
  AbsolutePathSchema,
  type AppDir,
  RelativePathSchema,
} from "../schemas/paths";
import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { absolutePathJoin } from "./absolute-path-join";
import { TypedError } from "./errors";
import { getCurrentDate } from "./get-current-date";
import { getMimeType } from "./get-mime-type";
import { getProjectState, setProjectState } from "./project-state-store";
import { sanitizeFilename } from "./sanitize-filename";

type FileAttachmentWithoutRef = Omit<
  SessionMessageDataPart.FileAttachmentDataPart,
  "gitRef"
>;

export async function writeUploadedAttachments({
  appDir,
  files,
  folders,
  messageId,
  sessionId,
}: {
  appDir: AppDir;
  files?: FileUpload.Type[];
  folders?: { path: string }[];
  messageId: StoreId.Message;
  sessionId: StoreId.Session;
}) {
  return safeTry(async function* () {
    const fileInfos: FileAttachmentWithoutRef[] = [];
    const folderAttachments: FolderAttachment.Type[] = [];

    if (files && files.length > 0) {
      const inputDir = absolutePathJoin(appDir, APP_FOLDER_NAMES.userProvided);
      yield* ResultAsync.fromPromise(
        fs.mkdir(inputDir, { recursive: true }),
        (error) =>
          new TypedError.FileSystem(
            error instanceof Error ? error.message : "Unknown error",
            { cause: error },
          ),
      );

      for (const file of files) {
        const sanitized = sanitizeFilename(file.filename);
        const uniqueFilename = yield* ResultAsync.fromPromise(
          getUniqueFilename(inputDir, sanitized),
          (error) =>
            new TypedError.FileSystem(
              error instanceof Error ? error.message : "Unknown error",
              { cause: error },
            ),
        );

        const relativePath = `./${APP_FOLDER_NAMES.userProvided}/${uniqueFilename}`;
        const filePath = absolutePathJoin(appDir, relativePath);
        const mimeType =
          "path" in file ? file.mimeType : getMimeType(uniqueFilename);

        if ("path" in file) {
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

          const relativeSourcePath = path.relative(appDir, file.path);
          if (
            relativeSourcePath === "" ||
            (!relativeSourcePath.startsWith("..") &&
              !path.isAbsolute(relativeSourcePath))
          ) {
            yield* err(
              new TypedError.FileSystem(
                `Uploaded file is already inside the task: ${file.filename}`,
              ),
            );
          }

          const sourceStats = yield* ResultAsync.fromPromise(
            fs.stat(file.path),
            (error) =>
              new TypedError.FileSystem(
                error instanceof Error ? error.message : "Unknown error",
                { cause: error },
              ),
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

          yield* ResultAsync.fromPromise(
            fs.copyFile(file.path, filePath),
            (error) =>
              new TypedError.FileSystem(
                error instanceof Error ? error.message : "Unknown error",
                { cause: error },
              ),
          );
        } else {
          const buffer = Buffer.from(file.content, "base64");
          yield* ResultAsync.fromPromise(
            fs.writeFile(filePath, buffer),
            (error) =>
              new TypedError.FileSystem(
                error instanceof Error ? error.message : "Unknown error",
                { cause: error },
              ),
          );
        }

        const stats = yield* ResultAsync.fromPromise(
          fs.stat(filePath),
          (error) =>
            new TypedError.FileSystem(
              error instanceof Error ? error.message : "Unknown error",
              { cause: error },
            ),
        );

        fileInfos.push({
          filename: uniqueFilename,
          filePath: RelativePathSchema.parse(relativePath),
          mimeType,
          size: stats.size,
        });
      }
    }

    if (folders && folders.length > 0) {
      const projectState = await getProjectState(appDir);
      const existingFolders = projectState.attachedFolders ?? {};

      const newFolders: Record<string, FolderAttachment.Type> = {};

      for (const folder of folders) {
        const baseName = path.basename(folder.path) || folder.path;
        const uniqueName = getUniqueFolderName(
          baseName,
          existingFolders,
          newFolders,
        );

        const folderAttachment: FolderAttachment.Type = {
          createdAt: getCurrentDate().getTime(),
          id: FolderAttachment.IdSchema.parse(ulid()),
          name: uniqueName,
          path: AbsolutePathSchema.parse(folder.path),
        };

        newFolders[uniqueName] = folderAttachment;
        folderAttachments.push(folderAttachment);
      }

      await setProjectState(appDir, {
        attachedFolders: { ...existingFolders, ...newFolders },
      });
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

async function getUniqueFilename(
  inputDir: AbsolutePath,
  filename: string,
): Promise<string> {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);

  let candidate = filename;
  let counter = 1;

  while (true) {
    const filePath = absolutePathJoin(inputDir, candidate);
    try {
      await fs.access(filePath);
      candidate = `${base}-${counter}${ext}`;
      counter++;
    } catch {
      return candidate;
    }
  }
}

function getUniqueFolderName(
  baseName: string,
  existingFolders: Record<string, FolderAttachment.Type>,
  newFolders: Record<string, FolderAttachment.Type>,
): string {
  let candidate = baseName;
  let counter = 1;

  while (candidate in existingFolders || candidate in newFolders) {
    candidate = `${baseName}-${counter}`;
    counter++;
  }

  return candidate;
}
