import { openPathOnComputer } from "@/electron-main/lib/open-path";
import { app, type Extension, type Session, shell } from "electron";
import { type ElectronChromeExtensions } from "electron-chrome-extensions";
import fs from "node:fs";
import { z } from "zod";

import {
  allDownloads,
  cancelDownload,
  removeDownload,
  watchDownloads,
} from "./download-list";
import { downloadForExtension } from "./downloads";
import {
  type ChromeDownload,
  downloadDelta,
  DownloadQuerySchema,
  downloadSubpath,
  searchDownloads,
  toChromeDownload,
} from "./extension-downloads";

/** How long a download an extension asked for may take to begin before the ask fails. */
const START_TIMEOUT_MS = 30_000;

const DownloadOptionsSchema = z.object({
  body: z.string().optional(),
  conflictAction: z.enum(["overwrite", "prompt", "uniquify"]).optional(),
  filename: z.string().optional(),
  headers: z
    .array(z.object({ name: z.string(), value: z.string() }))
    .optional(),
  method: z.enum(["GET", "POST"]).optional(),
  saveAs: z.boolean().optional(),
  url: z.string(),
});

const DownloadIdSchema = z.number().int();

const FileIconOptionsSchema = z
  .object({ size: z.union([z.literal(16), z.literal(32)]).optional() })
  .catch({});

const PermissionsManifestSchema = z.object({
  permissions: z.array(z.unknown()).catch([]),
});

/** Whether the extension's manifest asks for the permission. */
export function asks(
  extension: Pick<Extension, "manifest">,
  permission: string,
) {
  return PermissionsManifestSchema.catch({ permissions: [] })
    .parse(extension.manifest)
    .permissions.includes(permission);
}

/**
 * `chrome.downloads` over the browser's own download list, which stays the
 * one record: a download an extension starts goes where a person's does
 * (`downloadForExtension`), onto the list, and the list's changes reach
 * every extension with the `downloads` permission as `onCreated`,
 * `onChanged` and `onErased`. An extension sees the person's downloads,
 * never the agent's, which the list marks as such. Ids are numbers for
 * this run, oldest lowest, since the list keeps its own as strings.
 * `open` needs `downloads.open` too, as in Chrome, but no click before it,
 * which Electron does not tell the main process of. `removeFile` moves the
 * file to the Trash. `acceptDanger`, `setUiOptions` and
 * `onDeterminingFilename` stay the library's stand-ins: nothing here marks
 * a download dangerous, there is no shelf to hide, and the save path is
 * settled before any extension could answer.
 */
export function answerDownloadCalls(
  extensions: ElectronChromeExtensions,
  guestSession: Session,
): void {
  const numbers = new Map<string, number>();
  const listIds = new Map<number, string>();
  const madeBy = new Map<string, { id: string; name: string }>();
  // What each download's server said it is, which only its transfer knows.
  const mimes = new Map<string, string>();
  // Whether each finished download's file was there when last looked for.
  const existing = new Map<string, boolean>();

  const numberOf = (listId: string) => {
    let number = numbers.get(listId);
    if (number === undefined) {
      number = numbers.size + 1;
      numbers.set(listId, number);
      listIds.set(number, listId);
    }
    return number;
  };

  /** The list as extensions read it, oldest first; `look` checks each file again. */
  const read = (look: boolean): ChromeDownload[] =>
    allDownloads()
      .filter((download) => download.agent !== true)
      .toReversed()
      .map((download) => {
        if (download.running) {
          mimes.set(download.id, download.running.getMimeType());
        }
        let exists = false;
        if (download.state === "completed" && download.path !== null) {
          const known = existing.get(download.id);
          exists =
            !look && known !== undefined ? known : fs.existsSync(download.path);
          existing.set(download.id, exists);
        }
        const by = madeBy.get(download.id);
        return toChromeDownload(download, {
          ...(by ? { by } : {}),
          exists,
          id: numberOf(download.id),
          live: {
            mime: mimes.get(download.id) ?? "",
            paused: download.running?.isPaused() ?? false,
          },
        });
      });

  const tell = (eventName: string, ...args: unknown[]) => {
    for (const extension of guestSession.extensions.getAllExtensions()) {
      if (asks(extension, "downloads")) {
        extensions.sendExtensionEvent(extension.id, eventName, ...args);
      }
    }
  };

  let known = new Map(read(true).map((download) => [download.id, download]));
  const tellChanges = () => {
    const now = new Map(read(false).map((download) => [download.id, download]));
    for (const [id, download] of now) {
      const before = known.get(id);
      const delta = before && downloadDelta(before, download);
      if (!before) {
        tell("downloads.onCreated", download);
      } else if (delta) {
        tell("downloads.onChanged", delta);
      }
    }
    for (const id of known.keys()) {
      if (!now.has(id)) {
        tell("downloads.onErased", id);
      }
    }
    known = now;
  };
  // After the change's own turn, so a download an extension started is
  // told with its name on it (`madeBy`).
  watchDownloads(() => {
    queueMicrotask(tellChanges);
  });

  const downloadOf = (id: unknown) => {
    const number = DownloadIdSchema.safeParse(id);
    const listId = number.success ? listIds.get(number.data) : undefined;
    const download = allDownloads().find((each) => each.id === listId);
    if (!download) {
      throw new Error(`Invalid download id ${String(id)}`);
    }
    return download;
  };
  const savedFileOf = (id: unknown) => {
    const download = downloadOf(id);
    if (download.state !== "completed" || download.path === null) {
      throw new Error("Download must be complete");
    }
    return { download, path: download.path };
  };

  const answer = (
    name: string,
    callback: (
      event: Parameters<Parameters<typeof extensions.handleApiCall>[1]>[0],
      ...args: unknown[]
    ) => unknown,
  ) => {
    extensions.handleApiCall(`downloads.${name}`, callback, {
      permission: "downloads",
    });
  };

  answer("download", async (event, options) => {
    const asked = DownloadOptionsSchema.parse(options);
    const url = new URL(asked.url);
    const fromPage = url.protocol === "blob:" && event.type === "frame";
    if (!["data:", "http:", "https:"].includes(url.protocol) && !fromPage) {
      throw new Error(`Downloads from ${url.protocol} are not allowed`);
    }
    if (asked.method === "POST" || asked.body !== undefined) {
      throw new Error("Only GET downloads are supported");
    }
    const filename =
      asked.filename === undefined
        ? undefined
        : downloadSubpath(asked.filename);
    if (filename === null) {
      throw new Error("Invalid filename");
    }
    const { id, name } = event.extension;
    return await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => {
        takeBack();
        reject(new Error("The download did not start"));
      }, START_TIMEOUT_MS);
      const takeBack = downloadForExtension(
        fromPage ? event.sender : guestSession,
        url.href,
        Object.fromEntries(
          (asked.headers ?? []).map((header) => [header.name, header.value]),
        ),
        {
          conflictAction: asked.conflictAction ?? "uniquify",
          extensionId: id,
          ...(filename === undefined ? {} : { filename }),
          saveAs: asked.saveAs ?? false,
          started: (listId) => {
            clearTimeout(timer);
            madeBy.set(listId, { id, name });
            resolve(numberOf(listId));
          },
        },
      );
    });
  });

  answer("search", (_event, query) =>
    searchDownloads(read(true), DownloadQuerySchema.parse(query ?? {})),
  );

  answer("pause", (_event, id) => {
    const item = downloadOf(id).running;
    if (!item) {
      throw new Error("Download must be in progress");
    }
    item.pause();
    queueMicrotask(tellChanges);
  });

  answer("resume", (_event, id) => {
    const item = downloadOf(id).running;
    if (!item?.canResume()) {
      throw new Error("Download must be resumable");
    }
    item.resume();
    queueMicrotask(tellChanges);
  });

  answer("cancel", (_event, id) => {
    cancelDownload(downloadOf(id).id);
  });

  answer("open", async ({ extension }, id) => {
    if (!asks(extension, "downloads.open")) {
      throw new Error("downloads.open requires the downloads.open permission");
    }
    const failure = await openPathOnComputer(savedFileOf(id).path);
    if (failure) {
      throw new Error(failure);
    }
  });

  answer("show", (_event, id) => {
    const { path } = downloadOf(id);
    if (path === null) {
      throw new Error("Download has no file");
    }
    shell.showItemInFolder(path);
    return true;
  });

  answer("showDefaultFolder", async () => {
    await openPathOnComputer(app.getPath("downloads"));
  });

  answer("erase", (_event, query) => {
    const erased = searchDownloads(
      read(true),
      DownloadQuerySchema.parse(query ?? {}),
    ).flatMap(({ id }) => {
      const download = downloadOf(id);
      if (download.running) {
        return [];
      }
      removeDownload(download.id);
      return [id];
    });
    return erased;
  });

  answer("removeFile", async (_event, id) => {
    const { download, path } = savedFileOf(id);
    if (fs.existsSync(path)) {
      await shell.trashItem(path);
    }
    existing.set(download.id, false);
    queueMicrotask(tellChanges);
  });

  answer("getFileIcon", async (_event, id, options) => {
    const { path } = downloadOf(id);
    if (path === null) {
      throw new Error("Download has no file");
    }
    const { size } = FileIconOptionsSchema.parse(options);
    const icon = await app.getFileIcon(path, {
      size: size === 16 ? "small" : "normal",
    });
    return icon.toDataURL();
  });
}
