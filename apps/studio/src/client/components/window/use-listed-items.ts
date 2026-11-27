import {
  type FileSystemFileItem,
  type FileSystemItem,
} from "@/client/components/extend/file-system";
import { instrumentFolderGlyphUrl } from "@/client/components/icons/folder-glyph";
import { useRecentFiles } from "@/client/hooks/use-recent-files";
import {
  getComputerFileUrl,
  getComputerThumbnailUrl,
} from "@/client/lib/computer-file-url";
import { rpcClient } from "@/client/rpc/client";
import { RENDERED_EXTENSIONS } from "@/shared/rendered-kinds";
import { type ComputerFolder } from "@instrument-org/workspace/client";
import { useQueries } from "@tanstack/react-query";

import { soundTypeIfNoPicture } from "./file-mark";

/**
 * Stable while nothing changed: what each query holds, and only that, so a
 * re-render that fetched nothing new hands the browser the same items. A
 * folder that could not be read travels with them, since the one asking is
 * the only one that can stop asking.
 */
export function combineListings(
  results: {
    data: ComputerFolder | undefined;
    isError: boolean;
    isPending: boolean;
  }[],
) {
  return results.map((result) => ({
    data: result.data?.kind === "listing" ? result.data : undefined,
    isError: result.isError,
    isPending: result.isPending,
    refusal: result.data?.kind === "refused" ? result.data : undefined,
  }));
}

/**
 * What the browser lists: the folders' entries as items, or the recents as a
 * folder's worth of files, named where they live and flat, since a list of
 * what was opened is not a tree. A hook of its own so the compiler keeps the
 * items the same object while nothing they come from changed, which spares
 * the browser re-indexing the folder on every selection change.
 */
export function useListedItems({
  instrumentPath,
  isRecents,
  listings,
  prefixes,
  recentEntries,
  resolvedTheme,
  showHiddenFiles,
  workspaceFolder,
}: {
  instrumentPath: string | undefined;
  isRecents: boolean;
  listings: ReturnType<typeof combineListings>;
  prefixes: readonly string[];
  recentEntries: ReturnType<typeof useRecentFiles>["files"];
  resolvedTheme: Parameters<typeof previewOf>[1];
  showHiddenFiles: boolean;
  workspaceFolder: string | undefined;
}) {
  // A WebM or a 3GP is a video or a sound, which its name cannot tell. Each
  // one listed is read (`files.probeMedia`, kept per version), and one with
  // no picture is typed and drawn as a sound, as the viewer opens it.
  const ambiguousPaths = [
    ...new Set(
      [
        ...listings.flatMap(({ data }) => data?.entries ?? []),
        ...recentEntries,
      ].flatMap((entry) =>
        entry.kind !== "folder" && soundTypeIfNoPicture(entry.name)
          ? [entry.path]
          : [],
      ),
    ),
  ];
  // Combined into a string, which stays equal from one render to the next
  // where a set would be new each time. Each answer names its own file, so
  // nothing past the hook reads the paths asked about, which would keep the
  // compiler from memoizing what is built from them.
  const soundOnlyPaths = useQueries({
    combine: picturelessPaths,
    queries: ambiguousPaths.map((ambiguousPath) =>
      rpcClient.files.probeMedia.queryOptions({
        input: { path: ambiguousPath },
        retry: false,
        select: (probe) => ({ path: ambiguousPath, picture: probe?.picture }),
      }),
    ),
  });
  // Everything below is built after the hook, where the compiler can keep it.
  const recentKeys = recentPaths(recentEntries);
  const soundOnly = new Set(soundOnlyPaths.split("\n"));
  const recentItems = recentEntries.map((entry, index): FileSystemItem => {
    return {
      contentType: contentTypeOf(entry, soundOnly),
      ...(entry.createdAt === undefined
        ? {}
        : { createdAt: new Date(entry.createdAt).toISOString() }),
      kind: "file",
      metadata: { hostPath: entry.path },
      name: entry.name,
      path: recentKeys[index] ?? entry.name,
      ...previewOf(entry, resolvedTheme),
      openedAt: new Date(entry.openedAt).toISOString(),
      size: entry.size,
      ...(entry.modifiedAt === undefined
        ? {}
        : { updatedAt: new Date(entry.modifiedAt).toISOString() }),
    };
  });
  const folderItems = listings.flatMap(({ data }, index) => {
    const prefix = prefixes[index] ?? "";
    if (!data) {
      return [];
    }
    return (
      data.entries
        // The browser hides a name that begins with a dot itself. Windows keeps
        // the answer as a file attribute instead, which only the listing can
        // read, so those are dropped here -- under the same switch, so one menu
        // item still governs everything the system would rather you did not see.
        .filter((entry) => showHiddenFiles || !entry.hidden)
        .map((entry): FileSystemItem => {
          const stamps = {
            ...(entry.createdAt === undefined
              ? {}
              : { createdAt: new Date(entry.createdAt).toISOString() }),
            ...(entry.modifiedAt === undefined
              ? {}
              : { updatedAt: new Date(entry.modifiedAt).toISOString() }),
          };
          if (entry.kind === "folder") {
            return {
              ...stamps,
              ...withGlyph(
                instrumentFolderGlyphUrl(entry.path, {
                  outputFolder: instrumentPath,
                  workspace: workspaceFolder,
                }),
              ),
              hasChildren: true,
              kind: "folder",
              metadata: { hostPath: entry.path },
              path: `${prefix}${entry.name}/`,
            };
          }
          // Read by where it is, as the listing was: whatever the column can
          // list, the viewer can show, whether or not the agent can reach it.
          return {
            ...stamps,
            contentType: contentTypeOf(entry, soundOnly),
            ...(entry.displayName === undefined
              ? {}
              : { displayName: entry.displayName }),
            kind: "file",
            metadata: { hostPath: entry.path },
            path: `${prefix}${entry.name}`,
            ...previewOf(entry, resolvedTheme),
            size: entry.size,
            ...(entry.typeName === undefined
              ? {}
              : { typeName: entry.typeName }),
          };
        })
    );
  });
  return { items: isRecents ? recentItems : folderItems, recentKeys };
}

/** A file's type, as a sound where probing found it has no picture. */
function contentTypeOf(
  entry: { mimeType?: string; name: string; path: string },
  soundOnly: ReadonlySet<string>,
) {
  return (
    (soundOnly.has(entry.path)
      ? soundTypeIfNoPicture(entry.name)
      : undefined) ?? entry.mimeType
  );
}

/** The probed files found to have no picture, one to a line. */
function picturelessPaths(
  results: { data?: { path: string; picture?: boolean } }[],
) {
  return results
    .flatMap(({ data }) => (data?.picture === false ? [data.path] : []))
    .join("\n");
}

/** A folder's own glyph as an item's field, when it has one. */
function withGlyph(glyphSrc: string | undefined) {
  return glyphSrc === undefined ? {} : { glyphSrc };
}

/**
 * What the browser knows each recent file by. Its own name for almost every
 * one of them, which holds still as the list is read again; where two folders
 * hold the same name, the later of the two is told apart by where it sits.
 */
function recentPaths(entries: readonly { name: string }[]): string[] {
  const taken = new Set<string>();
  return entries.map((entry, index) => {
    const path = taken.has(entry.name)
      ? `${entry.name} (${index})`
      : entry.name;
    taken.add(path);
    return path;
  });
}

/**
 * What has a picture rather than an icon, the way the Finder's icons show
 * one: pictures, documents with pages and video, which the system draws, and
 * pages, Markdown and code, which the app draws itself. Anything else would
 * come back as a blank page, which says less than the file's own type icon.
 */
const THUMBNAIL_EXTENSIONS = new Set([
  ...RENDERED_EXTENSIONS,
  "ai",
  "bmp",
  "docx",
  "gif",
  "heic",
  "heif",
  "jpeg",
  "jpg",
  "key",
  "m4v",
  "mov",
  "mp4",
  "numbers",
  "pages",
  "pdf",
  "png",
  "pptx",
  "psd",
  "rtf",
  "tif",
  "tiff",
  "webp",
  "xlsx",
]);

/**
 * A listed file's own URL, and the system's picture of it where there is one,
 * named by when the file was written so a new write is a new picture. A
 * package's picture is the system's icon for it, square.
 */
function previewOf(
  entry: {
    mimeType?: string;
    modifiedAt?: number;
    name: string;
    package?: true;
    path: string;
  },
  theme: "dark" | "light",
): Pick<
  FileSystemFileItem,
  "previewAspectRatio" | "previewImageUrl" | "previewIsIcon" | "url"
> {
  const version = entry.modifiedAt;
  const url = getComputerFileUrl({ hostPath: entry.path, version });
  const extension = entry.name.split(".").at(-1)?.toLowerCase() ?? "";
  if (entry.package) {
    return {
      previewAspectRatio: 1,
      previewImageUrl: getComputerThumbnailUrl({
        hostPath: entry.path,
        size: 512,
        theme,
        version,
      }),
      previewIsIcon: true,
      url,
    };
  }
  if (
    !entry.mimeType?.startsWith("image/") &&
    !THUMBNAIL_EXTENSIONS.has(extension)
  ) {
    return { url };
  }
  return {
    previewImageUrl: getComputerThumbnailUrl({
      hostPath: entry.path,
      size: 512,
      theme,
      version,
    }),
    url,
  };
}
