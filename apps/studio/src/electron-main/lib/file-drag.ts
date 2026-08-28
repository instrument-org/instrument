import { START_FILE_DRAG_CHANNEL } from "@/shared/constants";
import {
  type AbsolutePath,
  resolveWorkspaceFilePath,
  type TaskId,
  TaskIdSchema,
  WorkspaceFilePathSchema,
} from "@instrument-org/workspace/electron";
import { app, ipcMain, type NativeImage, nativeImage } from "electron";
import path from "node:path";
import { z } from "zod";

import { captureServerException } from "./capture-server-exception";

// The drag has to be handed to the OS while the pointer is still down, and
// everything it needs is asynchronous: resolving the file's host path reads
// task state off disk, and rendering a drag image goes through QuickLook. So
// both are done ahead of the gesture, on hover and again on press, and what the
// press leaves behind is what the drag itself reads.
const MAX_ENTRIES = 128;
// Requested at twice the drag image's point size, then tagged 2x below.
const THUMBNAIL_PX = 128;
const FALLBACK_ICON_PT = 64;

// See hasLegibleThumbnail. Extensions rather than the renderer's file types,
// because the only thing this side has to go on is the path.
const THUMBNAILED_EXTENSIONS = new Set([
  ".avif",
  ".bmp",
  ".gif",
  ".heic",
  ".heif",
  ".jpeg",
  ".jpg",
  ".m4v",
  ".mov",
  ".mp4",
  ".png",
  ".svg",
  ".tif",
  ".tiff",
  ".webm",
  ".webp",
]);

const resolvedPaths = new Map<string, AbsolutePath>();
const icons = new Map<AbsolutePath, NativeImage>();
// Whatever the app icon is, resized. Only ever seen when a file is dragged
// before its own icon finished rendering, since a missing icon is not a drag
// macOS will start at all.
let fallbackIcon: NativeImage | undefined;

const FileRefSchema = z.object({
  filePath: WorkspaceFilePathSchema,
  taskId: TaskIdSchema,
});

const StartFileDragSchema = z.object({
  files: z.array(FileRefSchema).min(1),
});

type FileRef = z.output<typeof FileRefSchema>;

/**
 * Resolve a task file's host path and render its drag image, so a drag starting
 * moments from now is a synchronous lookup.
 *
 * Called on every hover and press rather than once per file: the path is
 * re-resolved each time so a file that moved does not drag its old location,
 * while the icon, which is the slow half, is kept.
 */
export async function prepareFileDrag({
  filePath,
  taskId,
}: {
  filePath: string;
  taskId: TaskId;
}) {
  const parsed = FileRefSchema.safeParse({ filePath, taskId });
  if (!parsed.success) {
    return;
  }

  const key = entryKey(parsed.data);
  const fullPath = await resolveWorkspaceFilePath(parsed.data);
  if (!fullPath) {
    // Resolves outside everything the task can reach, or is gone. Drop any
    // earlier answer rather than leaving a stale path draggable.
    resolvedPaths.delete(key);
    return;
  }

  remember(resolvedPaths, key, fullPath);

  if (!icons.has(fullPath)) {
    const icon = await buildDragImage(fullPath);
    if (icon) {
      remember(icons, fullPath, icon);
    }
  }
}

export function registerFileDragHandler() {
  void loadFallbackIcon();

  ipcMain.on(START_FILE_DRAG_CHANNEL, (event, payload: unknown) => {
    const parsed = StartFileDragSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }

    // Only paths this process resolved itself can be dragged. The renderer
    // names a file the way it already names one everywhere else, and never
    // holds or hands back the host path, so there is nothing here to point
    // somewhere it should not reach.
    const files = parsed.data.files
      .map((file) => resolvedPaths.get(entryKey(file)))
      .filter((fullPath) => fullPath !== undefined);

    const first = files[0];
    if (!first) {
      return;
    }

    const icon = icons.get(first) ?? fallbackIcon;
    if (!icon) {
      return;
    }

    event.sender.startDrag({ file: first, files, icon });
  });
}

async function buildDragImage(
  fullPath: AbsolutePath,
): Promise<NativeImage | undefined> {
  if (hasLegibleThumbnail(fullPath)) {
    // The preview Finder and Explorer show for the file itself. Unsupported on
    // Linux, and rejects for a type with no thumbnailer, so the type icon
    // below is the fallback rather than the exception.
    const thumbnail = await createThumbnail(fullPath);
    if (thumbnail && !thumbnail.isEmpty()) {
      // A drag image is sized in points, so a 128px bitmap left at 1x drags at
      // twice the size Finder uses. Re-reading it at 2x makes it 64pt and keeps
      // the detail that resizing it down would throw away.
      return nativeImage.createFromBuffer(thumbnail.toPNG(), {
        scaleFactor: 2,
      });
    }
  }

  const typeIcon = await getFileIcon(fullPath);
  return typeIcon && !typeIcon.isEmpty() ? typeIcon : undefined;
}

async function createThumbnail(fullPath: AbsolutePath) {
  try {
    return await nativeImage.createThumbnailFromPath(fullPath, {
      height: THUMBNAIL_PX,
      width: THUMBNAIL_PX,
    });
  } catch {
    return;
  }
}

function entryKey({ filePath, taskId }: FileRef) {
  return `${taskId}\u0000${filePath}`;
}

// `"normal"` is the largest size this can ask for on macOS. `"large"` maps to
// one Chromium documents as unsupported there, and its icon loader answers with
// a NOTREACHED that kills the process from a thread pool worker, where the catch
// below never sees it. So a type icon drags at 32pt against a thumbnail's 64.
async function getFileIcon(fullPath: AbsolutePath) {
  try {
    return await app.getFileIcon(fullPath, { size: "normal" });
  } catch {
    return;
  }
}

/**
 * Whether a thumbnail of this file says more at drag size than its type icon
 * does.
 *
 * A picture shrinks to a smaller picture and is still the thing the user
 * grabbed. A document does not: a page of text at 64pt is a gray smudge that
 * names neither the file nor its kind, where the type icon at least says
 * "spreadsheet" or "PDF" and carries the badge Finder trained everyone to read.
 * So the thumbnail is for what stays recognizable, and everything else takes
 * the icon.
 */
function hasLegibleThumbnail(fullPath: AbsolutePath) {
  return THUMBNAILED_EXTENSIONS.has(path.extname(fullPath).toLowerCase());
}

async function loadFallbackIcon() {
  try {
    const iconModule = await import("../../../resources/icon.png?asset");
    const image = nativeImage.createFromPath(iconModule.default);
    if (!image.isEmpty()) {
      fallbackIcon = image.resize({
        height: FALLBACK_ICON_PT,
        width: FALLBACK_ICON_PT,
      });
    }
  } catch (error) {
    captureServerException(
      new Error("Failed to load the drag fallback icon", { cause: error }),
    );
  }
}

function remember<K, V>(cache: Map<K, V>, key: K, value: V) {
  // Re-inserted rather than overwritten so insertion order stays use order, and
  // the entry dropped below is the one least recently prepared.
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) {
      cache.delete(oldest.value);
    }
  }
}
