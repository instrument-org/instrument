import { err, ok, ResultAsync, safeTry } from "neverthrow";
import fs from "node:fs/promises";
import path from "node:path";

import { CHAT_FOLDER_NAMES } from "../constants";
import { type FileUpload } from "../schemas/file-upload";
import {
  type AbsolutePath,
  type InWorkspacePath,
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
import { chatFolderTheyOpen } from "./chat/output-folder";
import { draftsFolderDir } from "./drafts/draft-folder";
import { chatOwnFolder } from "./record-folders";
import { pathExists } from "./path-exists";
import { pathIsWithin } from "./path-is-within";
import { getWorkspaceConfig, hasWorkspaceConfig } from "./workspace-config";
import { inWorkspacePath } from "./workspace-relative-path";
import { sanitizeFilename } from "./sanitize-filename";
import { shellPath } from "./shell-path";

type PathFileUpload = Extract<FileUpload.Type, { path: string }>;
interface PreparedUploadedFile {
  filename: string;
  filePath: AbsolutePath;
  input: FileUpload.Type;
  // A file the person attached by path is read where it lies, so there is
  // nothing to write and `filePath` names the file itself.
  inPlace: boolean;
  mimeType: string;
  storedPath: AbsolutePath | InWorkspacePath | RelativePath;
}

export async function writeUploadedAttachments({
  files,
  messageId,
  recordDir,
  sessionId,
}: {
  files?: FileUpload.Type[];
  /** The chat whose folder pasted bytes land in, named by its record folder. */
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
        // A file pasted into a draft, copied out of the folder that is about
        // to go.
        if (!preparedFile.inPlace && "path" in preparedFile.input) {
          const from = preparedFile.input.path;
          yield* ResultAsync.fromPromise(
            fs.copyFile(from, preparedFile.filePath),
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
          agentPath: shellPath(preparedFile.filePath),
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

/**
 * The folders a message is sent with, each one in a draft's folder copied
 * into the chat's `attachments/` beside its files and named by that copy.
 * A folder the person pointed at elsewhere is sent where it lies; one in a
 * draft's folder goes with the draft once the message is written, so a
 * message left pointing at it would point at nothing.
 */
export async function copyDraftFolders({
  folders,
  recordDir,
}: {
  folders: { path: string }[];
  recordDir: ChatDir;
}): Promise<{ path: string }[]> {
  if (!folders.some((folder) => pastedIntoADraft(folder.path))) {
    return folders;
  }
  const sentTo = chatFolderTheyOpen(chatOwnFolder(recordDir)) ?? recordDir;
  const inputDir = absolutePathJoin(sentTo, CHAT_FOLDER_NAMES.attachments);
  const takenIn = [
    ...new Set([
      inputDir,
      absolutePathJoin(recordDir, CHAT_FOLDER_NAMES.attachments),
    ]),
  ];
  await fs.mkdir(inputDir, { recursive: true });
  const reserved = new Set<string>();
  const copied: { path: string }[] = [];
  for (const folder of folders) {
    if (!pastedIntoADraft(folder.path)) {
      copied.push(folder);
      continue;
    }
    const name = await getUniqueFilename(
      takenIn,
      sanitizeFilename(path.basename(folder.path)),
      reserved,
    );
    reserved.add(name);
    const to = path.join(inputDir, name);
    // Links inside are copied as links rather than followed out of the folder.
    await fs.cp(folder.path, to, {
      errorOnExist: true,
      force: false,
      recursive: true,
      verbatimSymlinks: true,
    });
    copied.push({ path: to });
  }
  return copied;
}

function fileSystemError(error: unknown) {
  return new TypedError.FileSystem(
    error instanceof Error ? error.message : "Unknown error",
    { cause: error },
  );
}

async function getUniqueFilename(
  inputDirs: AbsolutePath[],
  filename: string,
  reservedFilenames: ReadonlySet<string>,
): Promise<string> {
  const { name } = await findAvailableName({
    isTaken: async (candidate) =>
      reservedFilenames.has(candidate) ||
      (
        await Promise.all(
          inputDirs.map((dir) => pathExists(absolutePathJoin(dir, candidate))),
        )
      ).some(Boolean),
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
    // Into the chat's own folder under `Chats/`, beside the transcript the
    // person reads, so what they sent is theirs to open rather than
    // something in the records.
    //
    // Unless that folder is not one they open: a workspace kept in the
    // app's own data is inside the folder the rules close to every command,
    // so a file written there is refused outright, with no card to allow
    // it, and the agent cannot read what the person just sent it. Those
    // keep it in the record folder, which the rules open for reading. The
    // stored path is `attachments/<name>` either way, so what resolves it
    // is which folder holds them and nothing stored has to change.
    const sentTo = chatFolderTheyOpen(chatOwnFolder(recordDir)) ?? recordDir;
    const inputDir = absolutePathJoin(sentTo, CHAT_FOLDER_NAMES.attachments);
    // A name what the chat was sent before still has in the record folder
    // is taken too: both are `attachments/<name>` to the records, and those
    // files move in beside these when the chat's folder is next written.
    const takenIn = [
      ...new Set([
        inputDir,
        absolutePathJoin(recordDir, CHAT_FOLDER_NAMES.attachments),
      ]),
    ];
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
      //
      // What they pasted into a draft is the exception. The app wrote that
      // file itself, into the draft's own folder, and sending the draft takes
      // that folder away, so a message left pointing at it would point at
      // nothing. It is copied into the chat like the bytes it came from.
      if ("path" in file && !pastedIntoADraft(file.path)) {
        yield* await validatePathUpload({ file });

        preparedFiles.push({
          filename: file.filename,
          filePath: file.path,
          input: file,
          inPlace: true,
          mimeType: file.mimeType,
          storedPath: attachedInPlaceStoredPath(file.path),
        });
        continue;
      }
      if ("path" in file) {
        yield* await validatePathUpload({ file });
      }

      const sanitized = sanitizeFilename(file.filename);
      const uniqueFilename = yield* ResultAsync.fromPromise(
        getUniqueFilename(takenIn, sanitized, reservedFilenames),
        fileSystemError,
      );

      reservedFilenames.add(uniqueFilename);

      const relativePath = RelativePathSchema.parse(
        `${CHAT_FOLDER_NAMES.attachments}/${uniqueFilename}`,
      );

      preparedFiles.push({
        filename: uniqueFilename,
        filePath: absolutePathJoin(sentTo, relativePath),
        input: file,
        inPlace: false,
        mimeType: getMimeType(uniqueFilename),
        storedPath: relativePath,
      });
    }

    return ok(preparedFiles);
  });
}

/**
 * How the message keeps a file attached where it lies. The record syncs with
 * the workspace and is never rewritten, so a file in the workspace is kept by
 * its place there, which names it on another computer and after the
 * workspace moves; a file outside it has only its absolute path.
 */
function attachedInPlaceStoredPath(
  given: AbsolutePath,
): AbsolutePath | InWorkspacePath {
  if (!hasWorkspaceConfig()) {
    return given;
  }
  return (
    inWorkspacePath(
      path.resolve(given),
      path.resolve(getWorkspaceConfig().rootDir),
    ) ?? given
  );
}

/**
 * Whether a path names a file in the drafts folder, which is the app's own
 * copy of something pasted rather than a file of the person's that it may
 * point at where it lies.
 */
function pastedIntoADraft(given: string): boolean {
  if (!hasWorkspaceConfig()) {
    return false;
  }
  return pathIsWithin(given, draftsFolderDir(getWorkspaceConfig().rootDir));
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
