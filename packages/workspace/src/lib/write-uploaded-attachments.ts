import { err, ok, ResultAsync, safeTry } from "neverthrow";
import fs from "node:fs/promises";
import path from "node:path";

import { CHAT_FOLDER_NAMES } from "../constants";
import { type FileUpload } from "../schemas/file-upload";
import {
  type AbsolutePath,
  type RelativePath,
  RelativePathSchema,
  type ChatDir,
} from "../schemas/paths";
import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { absolutePathJoin } from "./absolute-path-join";
import { TypedError } from "./errors";
import { findAvailableName } from "./find-available-name";
import { getMimeType } from "./get-mime-type";
import { pathExists } from "./path-exists";
import { sanitizeFilename } from "./sanitize-filename";
import { getChatAttachmentsDir } from "./chat-dir-utils";

type PathFileUpload = Extract<FileUpload.Type, { path: string }>;
interface PreparedUploadedFile {
  filename: string;
  filePath: AbsolutePath;
  input: FileUpload.Type;
  // A file the person attached by path is read where it lies, so there is
  // nothing to write and `filePath` names the file itself.
  inPlace: boolean;
  mimeType: string;
  storedPath: AbsolutePath | RelativePath;
}

export async function writeUploadedAttachments({
  files,
  messageId,
  recordDir,
  sessionId,
}: {
  files?: FileUpload.Type[];
  /** The chat's record folder, whose `attachments/` pasted bytes land in. */
  recordDir: ChatDir;
  messageId: StoreId.Message;
  sessionId: StoreId.Session;
}) {
  return safeTry(async function* () {
    const fileInfos: SessionMessageDataPart.FileAttachmentDataPart[] = [];

    if (files && files.length > 0) {
      const preparedFiles = yield* await prepareUploadedFiles({
        files,
        recordDir,
      });

      for (const preparedFile of preparedFiles) {
        // Pasted bytes are all there is to write: a file attached by path is
        // already on disk at `filePath`.
        if (!preparedFile.inPlace && "content" in preparedFile.input) {
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

        const stats = yield* ResultAsync.fromPromise(
          fs.stat(preparedFile.filePath),
          (error) =>
            new TypedError.FileSystem(
              error instanceof Error ? error.message : "Unknown error",
              { cause: error },
            ),
        );

        fileInfos.push({
          filename: preparedFile.filename,
          filePath: preparedFile.storedPath,
          mimeType: preparedFile.mimeType,
          modifiedAt: stats.mtimeMs,
          size: stats.size,
        });
      }
    }

    const fileMetadata: SessionMessageDataPart.FileAttachmentDataPart[] =
      fileInfos.map((file) => ({ ...file }));

    const part: SessionMessagePart.Type = {
      data: { files: fileMetadata },
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
  files,
  recordDir,
}: {
  files: FileUpload.Type[];
  recordDir: ChatDir;
}) {
  return safeTry(async function* () {
    const inputDir = getChatAttachmentsDir(recordDir);
    yield* ResultAsync.fromPromise(
      fs.mkdir(inputDir, { recursive: true }),
      fileSystemError,
    );

    const preparedFiles: PreparedUploadedFile[] = [];
    const reservedFilenames = new Set<string>();

    for (const file of files) {
      // A file the person pointed at is attached where it lies, wherever that
      // is. Copying it into `attachments/` would fork it: the agent would work
      // on the copy while the original the user pointed at silently went
      // stale, and a 2 GB video would be cloned to say so.
      if ("path" in file) {
        yield* await validatePathUpload({ file });

        preparedFiles.push({
          filename: file.filename,
          filePath: file.path,
          input: file,
          inPlace: true,
          mimeType: file.mimeType,
          storedPath: file.path,
        });
        continue;
      }

      const sanitized = sanitizeFilename(file.filename);
      const uniqueFilename = yield* ResultAsync.fromPromise(
        getUniqueFilename(inputDir, sanitized, reservedFilenames),
        fileSystemError,
      );

      reservedFilenames.add(uniqueFilename);

      const relativePath = RelativePathSchema.parse(
        `${CHAT_FOLDER_NAMES.attachments}/${uniqueFilename}`,
      );

      preparedFiles.push({
        filename: uniqueFilename,
        filePath: absolutePathJoin(recordDir, relativePath),
        input: file,
        inPlace: false,
        mimeType: getMimeType(uniqueFilename),
        storedPath: relativePath,
      });
    }

    return ok(preparedFiles);
  });
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
        new TypedError.FileSystem(`Uploaded path is not a file: ${file.path}`),
      );
    }
    if (sourceStats.size !== file.size) {
      yield* err(
        new TypedError.FileSystem(
          `Uploaded file size changed since it was picked: ${file.filename}`,
        ),
      );
    }

    return ok(undefined);
  });
}
