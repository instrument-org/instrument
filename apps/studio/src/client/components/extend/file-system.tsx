import { displayLocale } from "@/client/lib/display-locale";
import {
  FileThumbnail,
  useNaturalAspectRatio,
} from "@/client/components/extend/file-thumbnail";
import {
  FILE_NAME_ALIASES,
  FILE_TYPE_ALIASES,
  FILE_TYPE_GLYPHS,
} from "@/client/components/extend/file-type-glyphs";
import { ResizeHandle } from "@/client/components/resize-handle";
import { Button } from "@/client/components/ui/button";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/client/components/ui/context-menu";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/client/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { LOADER_DELAY_MS } from "@/client/components/ui/delayed";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import {
  ScrollArea as InlineScrollArea,
  ScrollBar,
} from "@/client/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { Spinner } from "@/client/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/client/components/ui/tabs";
import { useFileDragArea } from "@/client/hooks/use-file-drag";
import { useFindTarget } from "@/client/hooks/use-find-target";
import { folderGlyphUrl } from "@/client/components/icons/folder-glyph";
import {
  cn,
  commandKeyHeld,
  currentOs,
  isMacOS,
  isWindows,
} from "@/client/lib/utils";
import {
  createFileTreeIconResolver,
  getBuiltInSpriteSheet,
} from "@pierre/trees";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import {
  ArrowRight,
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Columns3,
  Grid2x2,
  LoaderCircle,
  Rows3,
  Search,
  X,
} from "lucide-react";
import * as React from "react";
import { createPortal } from "react-dom";

import {
  GESTURE_IDLE,
  type GestureEvent,
  type GestureState,
  step as gestureStep,
  waitFor,
} from "./file-system-gestures";
import {
  type ListingCommand,
  type ListingDirection,
  listingCommandOf,
  NO_TYPE_AHEAD,
  typeAhead,
} from "./file-system-keys";
import {
  type Box,
  boxBetween,
  edgeScrollSpeed,
  gridTileSpan,
  overlaps,
  type Point,
  runHits,
} from "./file-system-marquee";
import {
  RENAME_IDLE,
  type RenameEvent,
  type RenameState,
  renameStep,
  renamingPathOf,
} from "./file-system-rename";
import {
  keepShown,
  marqueeSelection,
  normalizeSelection,
  NOTHING_SELECTED,
  rowAfterRemoving,
  sameSelection,
  type Selection,
  selectedPathsOf,
  selectExactly,
  type SelectionMode,
  selectOnly,
  selectWithMode,
} from "./file-system-selection";

export type FileSystemFileItem = {
  contentType?: string;
  createdAt?: string;
  /**
   * The name shown, where it differs from the one in the path: an app without
   * its `.app`. Renaming still starts from the whole name.
   */
  displayName?: string;
  etag?: string;
  /** Original object key (S3/R2). Defaults to `path`. */
  key?: string;
  kind: "file";
  metadata?: Record<string, string>;
  name?: string;
  parentPath?: string;
  /** Display/canonical path, e.g. `"invoices/2026/jan.pdf"`. */
  path: string;
  /**
   * Thumbnail aspect ratio (width / height). Left out, a preview image is
   * drawn in its own shape once it has loaded, and a portrait page until then
   * or when there is no image.
   */
  previewAspectRatio?: number;
  /** Externally generated thumbnail. The component never renders documents itself. */
  previewImageUrl?: null | string;
  /**
   * Whether the preview is an icon (an app's) rather than a picture of the
   * file's contents: drawn bare, as the system draws it, not on a page.
   */
  previewIsIcon?: boolean;
  /**
   * Externally generated page thumbnails (first entry is the cover). When a
   * file has more than one page, large thumbnails show a hover pager.
   */
  previewImageUrls?: null | string[];
  /**
   * When the person last opened this file, for a list that is a log of what
   * they opened rather than a folder. Sortable, and nothing else: a file's own
   * dates say when it was made and changed, which is a different question and
   * often a different answer.
   */
  openedAt?: string;
  size?: number;
  /** The Kind column's text, where the system names it: "Application". */
  typeName?: string;
  updatedAt?: string;
  url?: string;
};
export type FileSystemItem = FileSystemFileItem | FileSystemFolderItem;
/** The list view's columns beside Name, each optional. */
export type FileSystemListColumn = "createdAt" | "kind" | "size" | "updatedAt";
export type FileSystemProps = {
  className?: string;
  /**
   * How wide the columns view's columns are, in px, when the caller holds
   * it. Left out, the browser keeps its own, which lasts as long as this
   * instance of it does.
   */
  columnWidth?: number;
  /**
   * The item a context menu is open on, or a drop is aimed at, by path. It
   * is outlined rather than selected, the way the Finder marks what its menu
   * acts on.
   */
  contextMenuPath?: null | string;
  /** Folder prefix to open initially, e.g. `"invoices/"`. */
  defaultPath?: string;
  /**
   * The folders the list shows opened in place, by path, when the caller
   * holds the answer. Left out, the browser keeps its own for each folder it
   * stands in, for as long as it is mounted.
   */
  openFolders?: ReadonlySet<string>;
  /** What the toolbar search opens with typed in it. */
  defaultSearch?: string;
  /** The item selected on opening, by path, e.g. `"invoices/march.pdf"`. */
  defaultSelectedPath?: string;
  defaultView?: FileSystemView;
  /**
   * What the browser says when there is nothing to list and nothing is
   * searched or filtered, in every view: a list with nothing in it yet,
   * which a plain "This folder is empty" would misdescribe. Left out, an
   * empty folder says that.
   */
  emptyState?: { description: string; title: string };
  /**
   * Where an item lives on this computer, for dragging it out of the window
   * and into another app the way a row in the Finder drags. Left out, nothing
   * drags; an item it names nothing for does not either.
   */
  getHostPath?: (item: FileSystemItem) => string | undefined;
  /**
   * What the rows are grouped by, when the caller holds it; null for none.
   * Left out, the browser keeps its own, ungrouped at first.
   */
  group?: FileSystemGroupKey | null;
  /** Flat manifest. Folders are optional; missing prefixes are inferred from file paths. */
  items: FileSystemItem[];
  /**
   * The list view's columns beside Name, when the caller holds them. Left out,
   * the browser keeps its own: Date Modified, Size and Kind.
   */
  listColumns?: FileSystemListColumn[];
  /**
   * The widths of the list view's columns beside Name, in px, as dragged at
   * their headers, when the caller holds them. A column left out is at its
   * own default.
   */
  listColumnWidths?: Partial<Record<FileSystemListColumn, number>>;
  /**
   * Folders whose entries the caller is still reading into `items`, by path.
   * Each reads as loading rather than empty until it leaves the set.
   */
  pendingFolders?: ReadonlySet<string>;
  /** Lazily fetch children for folders with `hasChildren` and no loaded entries. */
  loadChildren?: (
    args: FileSystemLoadChildrenArgs,
  ) => Promise<FileSystemLoadChildrenResult>;
  /**
   * A folder the pointer is resting on, whose contents may be wanted next:
   * read ahead so opening it in place finds them already here.
   */
  prefetchChildren?: (folderPath: string) => void;
  /**
   * Whether the selection takes the keyboard with it as it moves. False while
   * something outside holds focus and walks the selection from there, so the
   * rows never pull focus out of it.
   */
  moveFocusWithSelection?: boolean;
  onColumnWidthChange?: (columnWidth: number) => void;
  /**
   * The paths of what is selected, to the clipboard, by the system's key for
   * it: ⌥⌘C on the Mac, Ctrl+Shift+C on Windows. Left out, the key is
   * nobody's here.
   */
  onCopyPath?: (items: FileSystemItem[]) => void;
  /**
   * What is selected, to the clipboard as the files themselves, by ⌘C (Ctrl+C
   * off the Mac). Left out, the key is nobody's here.
   */
  onCopy?: (items: FileSystemItem[]) => void;
  /**
   * A copy of what is selected beside it, by ⌘D on the Mac. Left out, the
   * key is nobody's here.
   */
  onDuplicate?: (items: FileSystemItem[]) => void;
  /**
   * Called on file open (double-click), replacing the built-in behavior. By
   * default PDF, DOCX, PPTX, XLSX, and image files open in a viewer dialog and
   * other files open their resolved URL in a new tab.
   */
  onFileOpen?: (file: FileSystemFileItem, url: null | string) => void;
  /**
   * Right-click, for a menu of what can be done to what it landed on. `null`
   * is the folder's own empty space, which every view reports the same way so
   * one menu can serve them all.
   */
  onItemContextMenu?: (
    item: FileSystemItem | null,
    event: React.MouseEvent,
  ) => void;
  onListColumnsChange?: (columns: FileSystemListColumn[]) => void;
  onListColumnWidthsChange?: (
    widths: Partial<Record<FileSystemListColumn, number>>,
  ) => void;
  /**
   * The folder above the browser's root asked for, by ⌘↑ or Alt+↑ at the top
   * of the tree: the page re-roots there. Left out, the top is as far up as
   * the keys go.
   */
  onLeaveRoot?: () => void;
  /**
   * A new folder asked for by ⇧⌘N or Ctrl+Shift+N, made by the page in the
   * folder on screen. Left out, the key is nobody's here.
   */
  onNewFolder?: () => void;
  /**
   * Several selected opened at once, by a double-click or ⌘O on one of them.
   * Left out, each file among them opens as `onFileOpen` would, and the
   * folders are left where they are.
   */
  onOpenSeveral?: (items: FileSystemItem[]) => void;
  /** Called with the folder prefix on screen whenever it changes. */
  onPathChange?: (path: string) => void;
  /**
   * A new name typed over an item where it sits, to be written. Return on the
   * item, a second slow click on its name, or `startRename` opens the field;
   * left out, nothing renames. A rejected promise opens the field again with
   * what was typed, so a name that could not be used is not lost.
   */
  onRenameCommit?: (item: FileSystemItem, name: string) => Promise<void> | void;
  /** A folder opened or closed in place in the list, by its path. */
  onOpenFolderChange?: (path: string, open: boolean) => void;
  /** The search field's text changed, typed or cleared, or emptied by walking to a folder. */
  onSearchChange?: (search: string) => void;
  /**
   * The selection moved. `item` is the one of it the keyboard is on, the last
   * picked; `items` is all of it, several after a ⌘- or Shift-click.
   */
  onSelectionChange?: (
    item: FileSystemItem | null,
    items: FileSystemItem[],
  ) => void;
  onShowHiddenFilesChange?: (showHiddenFiles: boolean) => void;
  onGroupChange?: (group: FileSystemGroupKey | null) => void;
  onSortChange?: (sort: FileSystemSortState) => void;
  /**
   * What is selected, to the Trash, by the platform's key for it: ⌘⌫ on the
   * Mac, Delete elsewhere. Left out, the key is nobody's here.
   */
  onTrash?: (items: FileSystemItem[]) => void;
  onViewChange?: (view: FileSystemView) => void;
  /** What the columns view shows in its preview pane for a selected file, when something other than its icon. */
  renderFileStage?: (file: FileSystemFileItem) => React.ReactNode;
  /** Controls drawn at the head of the toolbar, before the folder's name: back and forward. */
  renderHeaderLead?: () => React.ReactNode;
  /** The host's primary action, drawn after the folder's name and before the view switcher. */
  renderHeaderPrimary?: () => React.ReactNode;
  /** Controls drawn among the toolbar's own, between the filters and the search. */
  renderHeaderActions?: () => React.ReactNode;
  /**
   * Narrowed to this width beside a file open from it, in CSS px: the
   * columns give up their preview of the selected file, which is open beside
   * them, and the list keeps its columns past the names, as wide as this,
   * for a sideways scroll to reach rather than dropping them.
   */
  besideWidth?: number;
  /** Whether `besideWidth` is being dragged, when the folder follows it with no slide. */
  besideResizing?: boolean;
  /**
   * Where the toolbar's controls go instead of a header of their own: `lead`
   * takes the views, sort and filter, and `tail` the host's primary action,
   * its actions and the search. With no `tail` the views fold into a menu,
   * the search ends `lead`, and the host's own controls are left out, for a
   * folder narrowed beside an open file.
   */
  toolbarInto?: { lead: HTMLElement | null; tail?: HTMLElement | null };
  /**
   * What stands where a folder's contents would, for a folder the caller
   * cannot list (the system refused the read), given the folder; null for one
   * it can. A `pane` is the whole of the browser below the toolbar for the
   * folder on screen, in every view, and a column's place for a folder opened
   * beside it in the columns. `inline` is one line of text under a folder
   * opened in place in the list.
   */
  renderUnreadable?: (
    folderPath: string,
    place: "inline" | "pane",
  ) => React.ReactNode;
  /**
   * The selected item's path, when the caller holds it. Left out, the browser
   * keeps its own; given, the caller can put the selection on something it
   * just made or renamed, the way the Finder leaves the new thing selected.
   */
  selectedPath?: null | string;
  /**
   * Whether dotfiles are listed, when the caller holds the answer. Left out,
   * the browser keeps its own, which lasts as long as this instance of it does.
   */
  showHiddenFiles?: boolean;
  /**
   * The order the rows are in, when the caller holds it. Left out, the
   * browser keeps its own, opening by name ascending.
   */
  sort?: FileSystemSortState;
  /** What a caller can ask of the browser itself. */
  ref?: React.Ref<FileSystemHandle>;
  /** Label for the root folder. */
  title?: string;
  view?: FileSystemView;
};
export type FileSystemHandle = {
  /**
   * Type over this item's name where it sits, by path. An item not listed yet
   * (a folder just made, before the re-read that lists it) opens its field
   * once it is, unless the person does something else first.
   */
  startRename: (path: string) => void;
  /** Exactly these selected, by path, the first the one the keyboard is on. */
  select: (paths: readonly string[]) => void;
  /**
   * The row on screen the Finder selects once these go: the first after the
   * last of them, or null when they were the last.
   */
  rowAfter: (paths: readonly string[]) => null | string;
};
export type FileSystemView = "columns" | "gallery" | "icons" | "list";
type FileEntry = FileSystemFileItem & {
  key: string;
  name: string;
  parentPath: string;
};
type FileSystemEntry = FileEntry | FolderEntry;
type FileSystemFolderItem = {
  createdAt?: string;
  /** A picture drawn in place of the folder glyph, for a folder with its own icon. */
  glyphSrc?: string;
  /** Set when children exist but are not in `items` yet; enables `loadChildren`. */
  hasChildren?: boolean;
  kind: "folder";
  metadata?: Record<string, string>;
  name?: string;
  parentPath?: string;
  /** Folder prefix, e.g. `"invoices/2026/"`. A trailing slash is added when missing. */
  path: string;
  updatedAt?: string;
};
type FileSystemIndex = {
  children: Map<string, FileSystemEntry[]>;
  files: Map<string, FileEntry>;
  folders: Map<string, FolderEntry>;
};
type FileSystemLoadChildrenArgs = {
  cursor: null | string;
  path: string;
};
type FileSystemLoadChildrenResult = {
  items: FileSystemItem[];
  nextCursor?: null | string;
};
type FolderEntry = FileSystemFolderItem & {
  name: string;
  parentPath: string;
};
/**
 * A selection of several, the way the Finder holds one: every path in it in
 * the order picked, the one a Shift-click or Shift-arrow reaches from, and the
 * reach the last of those took, which the next one replaces.
 */
/** A press or key that adds to the selection, and the order the view draws its rows in. */
type SelectionGesture = {
  mode: SelectionMode;
  order: readonly FileSystemEntry[];
};
/** What a view's dragged box tells the browser, which owns the selection. */
type MarqueeControl = {
  /**
   * A box began, with the modifier its press carried. It adds to or flips
   * the selection standing now, unless that is in rows the box cannot reach
   * (`order`, as another of the columns), when it starts from nothing.
   */
  begin: (mode: null | SelectionMode, order: null | readonly string[]) => void;
  /** What the box touches now, in the order the view draws it. */
  touch: (paths: readonly string[]) => void;
};
/**
 * The modifier a click or an arrow carries that adds to the selection rather
 * than replacing it: Shift reaches, and ⌘ (Ctrl off the Mac) picks one more.
 */
function selectionModeOf(event: {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): null | SelectionMode {
  if (event.shiftKey) return "extend";
  if (commandKeyHeld(event)) return "toggle";
  return null;
}
/** A Control-click, which on a Mac is the right click and selects nothing. */
function isMacContextClick(event: { ctrlKey: boolean }) {
  return event.ctrlKey && isMacOS();
}
function ArrowDown01Glyph(props: InlineRegistryIconProps) {
  return <ChevronDown {...props} />;
}
function ArrowUp01Glyph(props: InlineRegistryIconProps) {
  return <ChevronUp {...props} />;
}
function fileExtension(name: string) {
  const dotIndex = name.lastIndexOf(".");
  return dotIndex === -1 ? "" : name.slice(dotIndex + 1).toLowerCase();
}
function GridViewGlyph(props: InlineRegistryIconProps) {
  return <Grid2x2 {...props} />;
}
// Whether a path is one the Finder would keep out of sight: any segment of it
// starting with a dot.
//
// Every segment, not just the last, because the index synthesizes the folders
// its items imply -- drop `.git/config` on its name alone and `.git` comes back
// as an empty folder built from the path of a file that is no longer there.
//
// The segments checked are the ones below the folder the browser was opened at.
// Opening one at `.config` is asking to be inside it, and a rule that read the
// root's own name would answer that by showing nothing at all.
function isHiddenPath(path: string, rootPrefix: string) {
  return path
    .slice(path.startsWith(rootPrefix) ? rootPrefix.length : 0)
    .split("/")
    .some((segment) => segment.startsWith("."));
}
function LayoutThreeColumnGlyph(props: InlineRegistryIconProps) {
  return <Columns3 {...props} />;
}
function ListRowsGlyph(props: InlineRegistryIconProps) {
  return <Rows3 {...props} />;
}
function normalizeFolderPath(path: string) {
  if (!path || path === "/") return "";
  return path.endsWith("/") ? path : `${path}/`;
}
function pathName(path: string) {
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
  const separatorIndex = trimmed.lastIndexOf("/");
  return separatorIndex === -1 ? trimmed : trimmed.slice(separatorIndex + 1);
}
function pathParent(path: string) {
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
  const separatorIndex = trimmed.lastIndexOf("/");
  return separatorIndex === -1 ? "" : trimmed.slice(0, separatorIndex + 1);
}
const FILE_KIND_LABELS: Record<string, string> = {
  css: "CSS Stylesheet",
  csv: "CSV Document",
  doc: "Word Document",
  docx: "Word Document",
  gif: "GIF Image",
  go: "Go Source",
  htm: "HTML Document",
  html: "HTML Document",
  jpeg: "JPEG Image",
  jpg: "JPEG Image",
  js: "JavaScript Source",
  json: "JSON Document",
  jsx: "JavaScript Source",
  md: "Markdown Document",
  mdx: "MDX Document",
  pdf: "PDF Document",
  png: "PNG Image",
  ppt: "PowerPoint Presentation",
  pptx: "PowerPoint Presentation",
  py: "Python Script",
  rs: "Rust Source",
  sh: "Shell Script",
  sql: "SQL Script",
  svg: "SVG Image",
  ts: "TypeScript Source",
  tsv: "TSV Document",
  tsx: "TypeScript Source",
  txt: "Plain Text",
  webp: "WebP Image",
  xls: "Excel Workbook",
  xlsx: "Excel Workbook",
  yaml: "YAML Document",
  yml: "YAML Document",
  zip: "ZIP Archive",
};
// Folders sort under the "Folder" kind alphabetically among the file kinds,
// like Finder's Kind sort.
function entryKindLabel(entry: FileSystemEntry) {
  return entry.kind === "folder" ? "Folder" : fileKindLabel(entry);
}
/** The name an entry is shown by: the system's, where it leaves the extension off. */
function shownName(entry: FileSystemEntry) {
  return entry.kind === "file" ? (entry.displayName ?? entry.name) : entry.name;
}
// A file's kind in words, never its MIME type: by the system's name for it,
// then its extension, then its type, which names a file with no extension
// (`2024`, read as text) the way a file of that type with one is named.
function fileKindLabel(file: FileEntry) {
  if (file.typeName) return file.typeName;
  const byExtension = FILE_KIND_LABELS[fileExtension(file.name)];
  if (byExtension) return byExtension;
  const type = file.contentType ?? "";
  const byType = KIND_LABELS_BY_MIME_TYPE.get(type);
  if (byType) return byType;
  if (type.startsWith("image/")) return "Image";
  if (type.startsWith("audio/")) return "Audio";
  if (type.startsWith("video/")) return "Video";
  if (type.startsWith("text/")) return "Text Document";
  return "Document";
}
// MIME types inferred from the extension when a file carries no
// `contentType`, so the file-type filter can classify every manifest entry.
const EXTENSION_MIME_TYPES: Record<string, string> = {
  css: "text/css",
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  gif: "image/gif",
  go: "text/x-go",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  js: "text/javascript",
  json: "application/json",
  jsx: "text/jsx",
  md: "text/markdown",
  mdx: "text/mdx",
  pdf: "application/pdf",
  png: "image/png",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  py: "text/x-python",
  rs: "text/x-rust",
  sh: "application/x-sh",
  sql: "application/sql",
  svg: "image/svg+xml",
  ts: "text/x-typescript",
  tsv: "text/tab-separated-values",
  tsx: "text/x-typescript",
  txt: "text/plain",
  webp: "image/webp",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  yaml: "text/yaml",
  yml: "text/yaml",
  zip: "application/zip",
};
const KIND_LABELS_BY_MIME_TYPE = new Map(
  Object.entries(EXTENSION_MIME_TYPES).flatMap(
    ([extension, mime]): [string, string][] => {
      const label = FILE_KIND_LABELS[extension];
      return label ? [[mime, label]] : [];
    },
  ),
);
const FALLBACK_MIME_TYPE = "application/octet-stream";
export type FileSystemViewerKind = "docx" | "image" | "pdf" | "pptx" | "xlsx";
function mimeTypeForFile(file: { contentType?: string; name: string }) {
  return (
    file.contentType ??
    EXTENSION_MIME_TYPES[fileExtension(file.name)] ??
    FALLBACK_MIME_TYPE
  );
}
function viewerKindForFile(
  file: FileSystemFileItem,
): FileSystemViewerKind | null {
  if (file.contentType?.startsWith("image/")) return "image";
  if (file.contentType === "application/pdf") return "pdf";
  if (
    file.contentType ===
    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    return "pptx";
  }
  const name = (file.name ?? file.path).toLowerCase();
  if (name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".docx")) return "docx";
  if (name.endsWith(".pptx")) return "pptx";
  if (name.endsWith(".xlsx")) return "xlsx";
  if (/\.(avif|gif|jpe?g|png|svg|webp)$/.test(name)) return "image";
  return null;
}
// PDF and Word pages want height; presentations and spreadsheets want width;
// images get a roomy but contained frame.
const VIEWER_DIALOG_CLASSNAMES: Record<FileSystemViewerKind, string> = {
  docx: "h-[88vh] w-[min(96vw,68rem)] max-w-none",
  image: "max-h-[88vh] w-fit max-w-[min(96vw,64rem)]",
  pdf: "h-[88vh] w-[min(96vw,68rem)] max-w-none",
  pptx: "h-[88vh] w-[min(96vw,84rem)] max-w-none",
  xlsx: "h-[85vh] w-[min(96vw,100rem)] max-w-none",
};
export type FileSystemSortKey =
  | "createdAt"
  | "kind"
  | "name"
  // Offered only by a list whose items carry `openedAt` (OPENED_SORT_OPTION),
  // which opens in it.
  | "openedAt"
  | "size"
  | "updatedAt";
export type FileSystemSortState = {
  direction: "asc" | "desc";
  key: FileSystemSortKey;
};
function compareEntryNames(
  left: {
    name: string;
  },
  right: {
    name: string;
  },
) {
  return left.name.localeCompare(right.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}
/**
 * A size the way the system's file manager writes it: File Explorer counts a
 * kilobyte as 1024 bytes, and the Finder and GNOME's Files as 1000, so a disk
 * reads the same here as there.
 */
export function formatByteSize(size: number | undefined) {
  if (size === undefined) return null;
  const step = isWindows() ? 1024 : 1000;
  if (size < step) return `${size} bytes`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = size;
  for (const unit of units) {
    value /= step;
    if (value < 1000 || unit === "TB") {
      return `${value >= 100 ? Math.round(value) : value.toFixed(value >= 10 ? 1 : 2).replace(/\.?0+$/, "")} ${unit}`;
    }
  }
  return null;
}
// Made once: `toLocaleDateString` with options builds a formatter per call,
// which a list of dates redrawn on every arrow press cannot afford.
const DAY_FORMAT = new Intl.DateTimeFormat(displayLocale, {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const TIME_FORMAT = new Intl.DateTimeFormat(displayLocale, {
  hour: "numeric",
  minute: "2-digit",
});
function formatTimestamp(value: string | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${DAY_FORMAT.format(date)} at ${TIME_FORMAT.format(date)}`;
}
/**
 * What a folder's rows can be grouped by, as the Finder groups them. The
 * Finder's other choices need what the browser is not told: each file's
 * application, its tags, when it was added. Its Name groups nothing.
 */
export type FileSystemGroupKey = "createdAt" | "kind" | "size" | "updatedAt";
const GROUP_OPTIONS: Array<{ key: FileSystemGroupKey; label: string }> = [
  { key: "kind", label: "Kind" },
  { key: "updatedAt", label: "Date modified" },
  { key: "createdAt", label: "Date created" },
  { key: "size", label: "Size" },
];
/** One group: its heading, and where it stands among the folder's groups. */
type EntryGroup = { label: string; rank: number };
type Grouping = (entry: FileSystemEntry) => EntryGroup;
// The Finder's kinds, in the order it lists them, which is no alphabet's.
const KIND_GROUPS = [
  "Folders",
  "Applications",
  "Documents",
  "Images",
  "PDF Documents",
  "Music",
  "Movies",
  "Fonts",
  "Presentations",
  "Spreadsheets",
  "Developer",
  "Other",
] as const;
type KindGroup = (typeof KIND_GROUPS)[number];
// Where the type alone does not say which kind the Finder puts a file in:
// source is Developer, styles and plain words are Documents, JSON is Other.
const KIND_GROUP_EXTENSIONS = new Map<string, KindGroup>([
  ...[
    "c",
    "cc",
    "cjs",
    "cpp",
    "cs",
    "cts",
    "cxx",
    "go",
    "h",
    "hh",
    "hpp",
    "htm",
    "html",
    "java",
    "js",
    "jsx",
    "kt",
    "kts",
    "lua",
    "m",
    "mjs",
    "mm",
    "mts",
    "php",
    "pl",
    "pm",
    "py",
    "pyw",
    "r",
    "rb",
    "rs",
    "scala",
    "sh",
    "bash",
    "fish",
    "svelte",
    "swift",
    "ts",
    "tsx",
    "vue",
    "xhtml",
    "zsh",
  ].map((extension): [string, KindGroup] => [extension, "Developer"]),
  ...[
    "css",
    "csv",
    "doc",
    "docx",
    "epub",
    "ics",
    "log",
    "markdown",
    "md",
    "odt",
    "pages",
    "rtf",
    "rtfd",
    "tex",
    "tsv",
    "txt",
  ].map((extension): [string, KindGroup] => [extension, "Documents"]),
  ...["key", "odp", "ppt", "pptx"].map((extension): [string, KindGroup] => [
    extension,
    "Presentations",
  ]),
  ...["numbers", "ods", "xls", "xlsx"].map((extension): [string, KindGroup] => [
    extension,
    "Spreadsheets",
  ]),
  ...["otf", "ttc", "ttf", "woff", "woff2"].map(
    (extension): [string, KindGroup] => [extension, "Fonts"],
  ),
]);
function kindGroupOf(entry: FileSystemEntry): KindGroup {
  if (
    entry.name.endsWith(".app") ||
    (entry.kind === "file" && entry.typeName === "Application")
  ) {
    return "Applications";
  }
  if (entry.kind === "folder") return "Folders";
  const mime = mimeTypeForFile(entry);
  if (mime === "application/pdf") return "PDF Documents";
  const byExtension = KIND_GROUP_EXTENSIONS.get(fileExtension(entry.name));
  if (byExtension) return byExtension;
  if (mime.startsWith("image/")) return "Images";
  if (mime.startsWith("audio/")) return "Music";
  if (mime.startsWith("video/")) return "Movies";
  if (mime.startsWith("font/")) return "Fonts";
  if (mime.startsWith("text/")) return "Documents";
  return "Other";
}
const MONTH_FORMAT = new Intl.DateTimeFormat(displayLocale, { month: "long" });
const DAY_MS = 24 * 60 * 60 * 1000;
// The Finder's ladder for a date, by calendar day: today, yesterday, the
// seven days and the thirty before those, each month left of this year, and
// then whole years, with no date (or one still to come) last.
function dateGroupOf(value: string | undefined, now: Date): EntryGroup {
  const time = value ? Date.parse(value) : Number.NaN;
  const noDate = { label: "No Date", rank: Number.POSITIVE_INFINITY };
  if (Number.isNaN(time)) return noDate;
  const date = new Date(time);
  const dayOf = (day: Date) =>
    new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const daysAgo = Math.round((dayOf(now) - dayOf(date)) / DAY_MS);
  if (daysAgo < 0) return noDate;
  if (daysAgo === 0) return { label: "Today", rank: 0 };
  if (daysAgo === 1) return { label: "Yesterday", rank: 1 };
  if (daysAgo <= 8) return { label: "Previous 7 Days", rank: 2 };
  if (daysAgo <= 38) return { label: "Previous 30 Days", rank: 3 };
  if (date.getFullYear() === now.getFullYear()) {
    return { label: MONTH_FORMAT.format(date), rank: 15 - date.getMonth() };
  }
  return {
    label: `${date.getFullYear()}`,
    rank: 100 + now.getFullYear() - date.getFullYear(),
  };
}
const SIZE_UNITS = ["bytes", "KB", "MB", "GB", "TB", "PB"];
// The Finder's sizes, a power of ten apart and largest first, folders last.
function sizeGroupOf(entry: FileSystemEntry): EntryGroup {
  if (entry.kind === "folder") {
    return { label: "--", rank: Number.POSITIVE_INFINITY };
  }
  const bytes = entry.size ?? 0;
  if (bytes < 100) return { label: "Under 100 bytes", rank: 100 };
  let power = 2;
  while (bytes >= 10 ** (power + 1)) power += 1;
  const step = (at: number) =>
    `${10 ** (at % 3)} ${SIZE_UNITS[Math.floor(at / 3)] ?? "PB"}`;
  return { label: `From ${step(power)} to ${step(power + 1)}`, rank: -power };
}
function groupingFor(group: FileSystemGroupKey): Grouping {
  const now = new Date();
  switch (group) {
    case "createdAt": {
      return (entry) => dateGroupOf(entry.createdAt, now);
    }
    case "kind": {
      return (entry) => {
        const label = kindGroupOf(entry);
        return { label, rank: KIND_GROUPS.indexOf(label) };
      };
    }
    case "size": {
      return sizeGroupOf;
    }
    case "updatedAt": {
      return (entry) => dateGroupOf(entry.updatedAt, now);
    }
  }
}
const SORT_OPTIONS: Array<{
  defaultDirection: "asc" | "desc";
  key: FileSystemSortKey;
  label: string;
}> = [
  { defaultDirection: "asc", key: "name", label: "Name" },
  { defaultDirection: "asc", key: "kind", label: "Kind" },
  { defaultDirection: "desc", key: "createdAt", label: "Date created" },
  { defaultDirection: "desc", key: "updatedAt", label: "Date modified" },
  { defaultDirection: "desc", key: "size", label: "Size" },
];
// The order a list of files someone opened (the recents) opens in, and so
// one its menu has to offer to get back to.
const OPENED_SORT_OPTION = {
  defaultDirection: "desc",
  key: "openedAt",
  label: "Date last opened",
} as const;
const DEFAULT_SORT: FileSystemSortState = { direction: "asc", key: "name" };
// Primary key per the active sort; ties (and missing metadata) fall back to
// the name order so results stay stable. The name tiebreak ignores the
// direction, like Finder.
function compareEntriesBySort(
  left: FileSystemEntry,
  right: FileSystemEntry,
  sort: FileSystemSortState,
) {
  let result = 0;
  switch (sort.key) {
    case "kind": {
      result = entryKindLabel(left).localeCompare(
        entryKindLabel(right),
        undefined,
        {
          sensitivity: "base",
        },
      );

      break;
    }
    case "name": {
      result = compareEntryNames(left, right);

      break;
    }
    case "size": {
      // Folders have no byte size; group them at the small end.
      const leftSize = left.kind === "file" ? (left.size ?? 0) : -1;
      const rightSize = right.kind === "file" ? (right.size ?? 0) : -1;
      result = leftSize - rightSize;

      break;
    }
    default: {
      result =
        entrySortTimestamp(left, sort.key) -
        entrySortTimestamp(right, sort.key);
    }
  }
  if (result === 0) return compareEntryNames(left, right);
  return sort.direction === "asc" ? (result < 0 ? -1 : 1) : result < 0 ? 1 : -1;
}
function defaultSortDirection(key: FileSystemSortKey) {
  return (
    [OPENED_SORT_OPTION, ...SORT_OPTIONS].find((option) => option.key === key)
      ?.defaultDirection ?? "asc"
  );
}
function entrySortTimestamp(
  entry: FileSystemEntry,
  key: "createdAt" | "openedAt" | "updatedAt",
) {
  // The recents list only files, so a folder has no `openedAt` to read.
  const value =
    key === "openedAt"
      ? entry.kind === "file"
        ? entry.openedAt
        : undefined
      : entry[key];
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(time) ? 0 : time;
}
function buildFileSystemIndex(items: FileSystemItem[]): FileSystemIndex {
  const folders = new Map<string, FolderEntry>();
  const files = new Map<string, FileEntry>();
  const ensureFolderChain = (folderPath: string) => {
    let path = normalizeFolderPath(folderPath);
    while (path && !folders.has(path)) {
      folders.set(path, {
        kind: "folder",
        name: pathName(path),
        parentPath: pathParent(path),
        path,
      });
      path = pathParent(path);
    }
  };
  for (const item of items) {
    if (item.kind === "folder") {
      const path = normalizeFolderPath(item.path);
      if (!path) continue;
      folders.set(path, {
        ...item,
        name: item.name ?? pathName(path),
        parentPath: normalizeFolderPath(item.parentPath ?? pathParent(path)),
        path,
      });
      ensureFolderChain(pathParent(path));
    } else {
      if (!item.path) continue;
      files.set(item.path, {
        ...item,
        key: item.key ?? item.path,
        name: item.name ?? pathName(item.path),
        parentPath: normalizeFolderPath(
          item.parentPath ?? pathParent(item.path),
        ),
      });
      ensureFolderChain(pathParent(item.path));
    }
  }
  const children = new Map<string, FileSystemEntry[]>();
  const pushChild = (entry: FileSystemEntry) => {
    const siblings = children.get(entry.parentPath);
    if (siblings) {
      siblings.push(entry);
    } else {
      children.set(entry.parentPath, [entry]);
    }
  };
  for (const folder of folders.values()) pushChild(folder);
  for (const file of files.values()) pushChild(file);
  for (const siblings of children.values()) {
    siblings.sort(compareEntryNames);
  }
  // Folders without an explicit modified date inherit their newest child's —
  // object stores carry no folder metadata, yet the list view shows the
  // column and the date sorts compare it. Deepest first (a descendant's path
  // is always longer than its ancestor's) so dates propagate up the chain.
  const foldersDeepestFirst = [...folders.values()].sort(
    (left, right) => right.path.length - left.path.length,
  );
  for (const folder of foldersDeepestFirst) {
    if (folder.updatedAt) continue;
    let newestTime = Number.NEGATIVE_INFINITY;
    let newestValue: string | undefined;
    for (const child of children.get(folder.path) ?? []) {
      const value = child.updatedAt ?? child.createdAt;
      const time = value ? Date.parse(value) : Number.NaN;
      if (!Number.isNaN(time) && time > newestTime) {
        newestTime = time;
        newestValue = value;
      }
    }
    if (newestValue) folder.updatedAt = newestValue;
  }
  return { children, files, folders };
}
function folderHasChildren(index: FileSystemIndex, folder: FolderEntry) {
  return (
    (index.children.get(folder.path)?.length ?? 0) > 0 ||
    folder.hasChildren === true
  );
}
// The folder glyph as one SVG source, drawn from a data URL wherever a folder
// is.
export function FileSystemFolderGlyph({
  className,
  src,
}: {
  className?: string;
  src?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- The folder glyph is an inline SVG data URL.
    <img
      alt=""
      aria-hidden="true"
      className={className}
      draggable={false}
      src={src ?? folderGlyphUrl()}
    />
  );
}
// Per-token light/dark colors for the file-type icons. Tokens without an
// entry (font, nextjs, stylelint) take the default token's gray, which the
// paper surface swaps along with the rest of the palette.
const FILE_ICON_COLORS: Record<string, [light: string, dark: string]> = {
  astro: ["#a631be", "#d568ea"],
  babel: ["#d5a910", "#ffd452"],
  bash: ["#199f43", "#5ecc71"],
  biome: ["#1a85d4", "#69b1ff"],
  bootstrap: ["#693acf", "#9d6afb"],
  browserslist: ["#d5a910", "#ffd452"],
  bun: ["#594c5b", "#79697b"],
  c: ["#1a85d4", "#69b1ff"],
  claude: ["#d47628", "#ffa359"],
  cpp: ["#1a85d4", "#69b1ff"],
  css: ["#693acf", "#9d6afb"],
  database: ["#a631be", "#d568ea"],
  default: ["#84848a", "#adadb1"],
  docker: ["#1a85d4", "#69b1ff"],
  eslint: ["#693acf", "#9d6afb"],
  git: ["#ff8c5b", "#d5512f"],
  go: ["#1ca1c7", "#68cdf2"],
  graphql: ["#d32a61", "#ff678d"],
  html: ["#d47628", "#ffa359"],
  image: ["#d32a61", "#ff678d"],
  javascript: ["#d5a910", "#ffd452"],
  json: ["#d47628", "#ffa359"],
  markdown: ["#199f43", "#5ecc71"],
  mcp: ["#17a5af", "#64d1db"],
  npm: ["#d52c36", "#ff6762"],
  oxc: ["#1ca1c7", "#68cdf2"],
  postcss: ["#d52c36", "#ff6762"],
  prettier: ["#17a5af", "#64d1db"],
  python: ["#1a85d4", "#69b1ff"],
  react: ["#1ca1c7", "#68cdf2"],
  ruby: ["#d52c36", "#ff6762"],
  rust: ["#d47628", "#ffa359"],
  sass: ["#d32a61", "#ff678d"],
  svelte: ["#d52c36", "#ff6762"],
  svg: ["#d47628", "#ffa359"],
  svgo: ["#199f43", "#5ecc71"],
  swift: ["#d47628", "#ffa359"],
  table: ["#17a5af", "#64d1db"],
  tailwind: ["#1ca1c7", "#68cdf2"],
  terraform: ["#693acf", "#9d6afb"],
  text: ["#84848a", "#adadb1"],
  typescript: ["#1a85d4", "#69b1ff"],
  vite: ["#a631be", "#d568ea"],
  vscode: ["#1a85d4", "#69b1ff"],
  vue: ["#199f43", "#5ecc71"],
  wasm: ["#693acf", "#9d6afb"],
  webpack: ["#1a85d4", "#69b1ff"],
  yml: ["#d52c36", "#ff6762"],
  zig: ["#d47628", "#ffa359"],
  zip: ["#d47628", "#ffa359"],
  ...Object.fromEntries(
    Object.entries(FILE_TYPE_GLYPHS).map(([token, glyph]) => [
      token,
      glyph.colors,
    ]),
  ),
};
// The set's gaps (file-type-glyphs.ts) ride in as extension remaps onto our
// own symbols. A remapped icon carries no data-icon-token, so each symbol
// colors itself from its --fs-file-icon-* variable, with a light-dark()
// fallback where that is unset.
const FILE_TYPE_ICON_TOKENS: [
  token: string,
  markup: string,
  extensions: string[],
][] = [
  ...Object.entries(FILE_TYPE_GLYPHS).map(
    ([token, glyph]): [string, string, string[]] => [
      token,
      glyph.markup,
      glyph.extensions,
    ],
  ),
  ...Object.entries(FILE_TYPE_ALIASES).map(
    ([token, extensions]): [string, string, string[]] => [
      token,
      `<use href="#file-tree-builtin-${token}"/>`,
      extensions,
    ],
  ),
];
const FILE_TYPE_ICON_SYMBOLS = FILE_TYPE_ICON_TOKENS.map(([token, markup]) => {
  const [light, dark] = FILE_ICON_COLORS[token] ?? ["#84848a", "#adadb1"];
  return `<symbol id="file-system-icon-${token}" viewBox="0 0 16 16"><g style="color: var(--fs-file-icon-${token}, light-dark(${light}, ${dark}))">${markup}</g></symbol>`;
}).join("");
const FILE_TYPE_ICONS_BY_EXTENSION = Object.fromEntries(
  FILE_TYPE_ICON_TOKENS.flatMap(([token, , extensions]) =>
    extensions.map((extension) => [
      extension,
      { name: `file-system-icon-${token}`, viewBox: "0 0 16 16" },
    ]),
  ),
);
const FILE_TYPE_ICONS_BY_FILE_NAME = Object.fromEntries(
  Object.entries(FILE_NAME_ALIASES).flatMap(([token, fileNames]) =>
    fileNames.map((fileName) => [
      fileName,
      { name: `file-system-icon-${token}`, viewBox: "0 0 16 16" },
    ]),
  ),
);
// The @pierre/trees "complete" set — the full, colored suite with brand and
// framework glyphs — ships as an SVG sprite, rendered once per browser so
// every view falls back to the same file-type icon when a file has no
// thumbnail.
const FILE_ICON_SPRITE_SHEET = `${getBuiltInSpriteSheet("complete")}<svg data-icon-sprite aria-hidden="true" width="0" height="0">${FILE_TYPE_ICON_SYMBOLS}</svg>`;
const { resolveIcon: resolveFileIcon } = createFileTreeIconResolver({
  byFileExtension: FILE_TYPE_ICONS_BY_EXTENSION,
  byFileName: FILE_TYPE_ICONS_BY_FILE_NAME,
  colored: true,
  set: "complete",
});
function fileIconColorVariables(mode: 0 | 1) {
  return Object.entries(FILE_ICON_COLORS)
    .map(([token, colors]) => `--fs-file-icon-${token}: ${colors[mode]};`)
    .join(" ");
}
// The variables live on :root rather than the component root because the
// filter menus and dialogs portal outside it; the --fs-file-icon-*
// namespace keeps them collision-free. Thumbnail tiles keep a light
// (paper) surface in dark mode, so icons inside them revert to the light
// palette ([data-file-system-on-light]).
const FILE_ICON_COLOR_CSS = `
:root { ${fileIconColorVariables(0)} }
.dark { ${fileIconColorVariables(1)} }
.dark [data-file-system-on-light] { ${fileIconColorVariables(0)} }
`;
function FileGenericPreview({ file }: { file: FileEntry }) {
  const extension = fileExtension(file.name);
  return (
    <div
      className="flex size-full flex-col items-center justify-center gap-1.5 bg-white"
      data-file-system-on-light=""
    >
      <FileTypeIcon className="size-1/3 min-h-4 min-w-4" fileName={file.name} />
      {extension ? (
        <span className="text-[min(0.625rem,18cqw)] font-semibold tracking-wide uppercase">
          {extension}
        </span>
      ) : null}
    </div>
  );
}
function filePreviewUrls(
  file: Pick<FileSystemFileItem, "previewImageUrl" | "previewImageUrls">,
) {
  if (file.previewImageUrls?.length) return file.previewImageUrls;
  return file.previewImageUrl ? [file.previewImageUrl] : [];
}
export function FileSystemIconSpriteSheet() {
  return (
    <>
      <span
        aria-hidden="true"
        className="hidden"
        dangerouslySetInnerHTML={{ __html: FILE_ICON_SPRITE_SHEET }}
      />
      <style>{FILE_ICON_COLOR_CSS}</style>
    </>
  );
}
/**
 * The sprite symbol drawing a file of this name. `fallbackExtension` covers a
 * file whose name carries no extension the set knows (a download named by its
 * URL, an attachment named by the user) but whose type is known from
 * elsewhere.
 */
export function resolveFileTypeIcon(
  fileName: string,
  fallbackExtension?: string,
) {
  const icon = resolveFileIcon("file-tree-icon-file", fileName);
  if (icon.token !== "default" || !fallbackExtension) return icon;
  return resolveFileIcon("file-tree-icon-file", `file.${fallbackExtension}`);
}
export function FileTypeIcon({
  className,
  fallbackExtension,
  fileName,
}: {
  className?: string;
  fallbackExtension?: string;
  fileName: string;
}) {
  return (
    <FileTypeGlyph
      className={className}
      icon={resolveFileTypeIcon(fileName, fallbackExtension)}
    />
  );
}
export function FileTypeGlyph({
  className,
  icon,
}: {
  className?: string;
  icon: ReturnType<typeof resolveFileTypeIcon>;
}) {
  return (
    <svg
      aria-hidden="true"
      className={cn("shrink-0 text-muted-foreground", className)}
      style={
        icon.token
          ? {
              color: `var(--fs-file-icon-${icon.token}, var(--fs-file-icon-default))`,
            }
          : undefined
      }
      viewBox={icon.viewBox ?? "0 0 16 16"}
    >
      <use href={`#${icon.name}`} />
    </svg>
  );
}
function FileVisual({
  className,
  file,
  pageable = false,
  previewAspectRatio,
  previewClassName,
  style,
}: {
  className?: string;
  file: FileEntry;
  /** Show a hover pager over multi-page thumbnails. */
  pageable?: boolean;
  /**
   * The shape to draw the preview in, width over height, when neither the
   * file nor the loaded image says. A file's own `previewAspectRatio` wins;
   * failing that, an image that has loaded is drawn in its own shape.
   */
  previewAspectRatio?: number;
  previewClassName?: string;
  style?: React.CSSProperties;
}) {
  const previewUrls = filePreviewUrls(file);
  const totalPages = previewUrls.length;
  const [pageIndex, setPageIndex] = React.useState(0);
  const clampedPageIndex = Math.min(pageIndex, Math.max(totalPages - 1, 0));
  const previewUrl = previewUrls[clampedPageIndex] ?? null;
  const naturalAspectRatio = useNaturalAspectRatio(previewUrl);
  const resolvedAspectRatio =
    file.previewAspectRatio ?? naturalAspectRatio ?? previewAspectRatio;
  const [previousFilePath, setPreviousFilePath] = React.useState(file.path);
  if (!Object.is(previousFilePath, file.path)) {
    setPreviousFilePath(file.path);
    setPageIndex(0);
  }
  const showPager = pageable && totalPages > 1;
  const isIcon = file.previewIsIcon === true;
  const thumbnail = (
    <FileThumbnail
      bare={isIcon}
      className={cn(
        "@container",
        !showPager && className,
        // An icon carries its own shape and shadow.
        isIcon && "rounded-none shadow-none",
      )}
      file={{ name: file.name, type: file.contentType ?? "" }}
      previewAspectRatio={resolvedAspectRatio}
      // Previews are drawn on white, as a page is. The white is the image's
      // own backing so it arrives with the image; on the box it would sit
      // under the loading placeholder and show through as the image fades in.
      previewClassName={cn(!isIcon && "[&>img]:bg-white", previewClassName)}
      previewContent={
        previewUrl ? undefined : <FileGenericPreview file={file} />
      }
      previewImageUrl={previewUrl ?? undefined}
      previewUnavailableContent={<FileGenericPreview file={file} />}
      style={showPager ? undefined : style}
    />
  );
  if (!showPager) return thumbnail;
  return (
    <div className={cn("group/pager relative", className)} style={style}>
      {thumbnail}
      <div className="absolute inset-x-0 bottom-1.5 flex items-center justify-center gap-1 opacity-0 transition-opacity group-focus-within/pager:opacity-100 group-hover/pager:opacity-100">
        <button
          aria-label="Previous page"
          className="flex size-6 items-center justify-center rounded-md bg-background/80 text-foreground shadow-xs backdrop-blur-sm outline-none hover:bg-background focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
          disabled={clampedPageIndex === 0}
          onClick={(event) => {
            event.stopPropagation();
            setPageIndex((previous) => Math.max(0, previous - 1));
          }}
          onDoubleClick={(event) => event.stopPropagation()}
          tabIndex={-1}
          type="button"
        >
          <ChevronLeft className="size-3.5" />
        </button>
        <span className="rounded-md bg-background/80 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground tabular-nums shadow-xs backdrop-blur-sm">
          {clampedPageIndex + 1}/{totalPages}
        </span>
        <button
          aria-label="Next page"
          className="flex size-6 items-center justify-center rounded-md bg-background/80 text-foreground shadow-xs backdrop-blur-sm outline-none hover:bg-background focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
          disabled={clampedPageIndex >= totalPages - 1}
          onClick={(event) => {
            event.stopPropagation();
            setPageIndex((previous) => Math.min(totalPages - 1, previous + 1));
          }}
          onDoubleClick={(event) => event.stopPropagation()}
          tabIndex={-1}
          type="button"
        >
          <ArrowRight className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
/**
 * The shape a file's thumbnail is known to have, width over height: what the
 * manifest says, or what its cover image turned out to be once it loaded.
 * Undefined for a file that has said nothing yet, which is drawn as a page.
 */
function useFileAspectRatio(file: FileEntry) {
  const naturalAspectRatio = useNaturalAspectRatio(filePreviewUrls(file)[0]);
  return file.previewAspectRatio ?? naturalAspectRatio;
}
/**
 * The width, in rem, of a thumbnail of a known shape drawn inside a box: as
 * wide as the box, unless it would run out of height first.
 */
function fittedWidth(
  aspectRatio: number,
  box: { height: number; width: number },
) {
  return `${Math.min(box.width, box.height * aspectRatio)}rem`;
}
/**
 * A thumbnail sized to the file's own shape inside a box: a photo keeps its
 * proportions rather than being cut down to a page. Until the shape is known,
 * or for a file with no picture at all, `pageClassName` gives it a page's
 * width, which the page's proportions turn into a height.
 */
function FittedFileVisual({
  box,
  className,
  file,
  pageClassName,
}: {
  /** The room the thumbnail has, in rem. */
  box: { height: number; width: number };
  className?: string;
  file: FileEntry;
  /** The width of a thumbnail drawn as a page. */
  pageClassName: string;
}) {
  const aspectRatio = useFileAspectRatio(file);
  return (
    <FileVisual
      className={cn(className, aspectRatio === undefined && pageClassName)}
      file={file}
      previewAspectRatio={0.78}
      style={
        aspectRatio === undefined
          ? undefined
          : { width: fittedWidth(aspectRatio, box) }
      }
    />
  );
}
// The toolbar search's query as every view matches it: trimmed, backslashes
// to slashes, lowercased, substring match on the path.
function normalizeSearchQuery(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.replaceAll("\\", "/").toLowerCase();
}
// Scrolls the item at `index` into the viewport when it sits outside it —
// virtualized views need this because off-window items have no DOM node to
// call scrollIntoView on.
function scrollIndexIntoView({
  horizontal = false,
  index,
  itemSize,
  itemStride,
  leadingPx = 0,
  viewport,
}: {
  horizontal?: boolean;
  index: number;
  itemSize: number;
  itemStride: number;
  leadingPx?: number;
  viewport: HTMLDivElement | null;
}) {
  if (!viewport || index < 0) return;
  const start = leadingPx + index * itemStride;
  const end = start + itemSize;
  const scrollStart = horizontal ? viewport.scrollLeft : viewport.scrollTop;
  const viewportSize = horizontal
    ? viewport.clientWidth
    : viewport.clientHeight;
  let nextScrollStart: null | number = null;
  if (start < scrollStart) {
    nextScrollStart = start;
  } else if (end > scrollStart + viewportSize) {
    nextScrollStart = end - viewportSize;
  }
  if (nextScrollStart === null) return;
  if (horizontal) {
    viewport.scrollLeft = nextScrollStart;
  } else {
    viewport.scrollTop = nextScrollStart;
  }
}
// Windowed rendering: with a fixed item stride only the items intersecting the viewport — plus
// `overscan` on each side — are mounted, so views stay flat-cost at
// thousands of entries. The window keeps a one-item margin before
// recomputing (scrolling doesn't re-render per item) and that margin also
// guarantees single-step keyboard moves land on a mounted neighbor.
function useVirtualWindow({
  count,
  horizontal = false,
  itemStride,
  leadingPx = 0,
  overscan = 8,
  viewportRef,
}: {
  count: number;
  horizontal?: boolean;
  itemStride: number;
  leadingPx?: number;
  overscan?: number;
  viewportRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [window_, setWindow] = React.useState(() => ({
    end: Math.min(count, overscan * 2),
    start: 0,
  }));
  React.useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || itemStride <= 0) return;
    const update = () => {
      const scrollStart =
        (horizontal ? viewport.scrollLeft : viewport.scrollTop) - leadingPx;
      const viewportSize = horizontal
        ? viewport.clientWidth
        : viewport.clientHeight;
      const firstVisible = Math.max(0, Math.floor(scrollStart / itemStride));
      const lastVisible = Math.min(
        count,
        Math.ceil((scrollStart + viewportSize) / itemStride),
      );
      setWindow((previous) => {
        if (
          previous.end <= count &&
          previous.start <= Math.max(0, firstVisible - 1) &&
          previous.end >= Math.min(count, lastVisible + 1)
        ) {
          return previous;
        }
        return {
          end: Math.min(count, lastVisible + overscan),
          start: Math.max(0, firstVisible - overscan),
        };
      });
    };
    update();
    viewport.addEventListener("scroll", update, { passive: true });
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(viewport);
    return () => {
      viewport.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [count, horizontal, itemStride, leadingPx, overscan, viewportRef]);
  return window_;
}
/** How far a press on empty space travels before it is a box being dragged rather than a click. */
const MARQUEE_SLOP_PX = 4;
/**
 * A press on empty space dragged across the rows, which selects what it
 * reaches as it goes, the way the Finder's does: a box drawn over the icons
 * (`shape: "box"`), a run of rows in the list and the columns, with nothing
 * drawn (`shape: "run"`). The view says what is reached (`hitTest`, given the
 * box and both its ends in the coordinates of `containerRef`, the element its
 * rows are laid out in) and draws `overlay` over its scroll area; the press
 * itself keeps whatever the view did with it.
 */
function useMarquee({
  containerRef,
  hitTest,
  marquee,
  shape,
  viewportRef,
}: {
  containerRef: React.RefObject<HTMLElement | null>;
  hitTest: (box: Box, ends: { from: Point; to: Point }) => readonly string[];
  marquee: MarqueeControl;
  shape: "box" | "run";
  viewportRef: React.RefObject<HTMLElement | null>;
}) {
  const [drawn, setDrawn] = React.useState<Box | null>(null);
  // The click a released box ends in is the box's, not a press on empty space.
  const claimedClickRef = React.useRef(false);
  const hitTestRef = React.useRef(hitTest);
  React.useEffect(() => {
    hitTestRef.current = hitTest;
  });
  const stopRef = React.useRef<(() => void) | null>(null);
  React.useEffect(() => () => stopRef.current?.(), []);
  const start = (
    event: React.PointerEvent,
    {
      onBegin,
      order,
    }: {
      /** The box began, before it touches anything. */
      onBegin?: () => void;
      /** The rows the box can reach, in the order the view draws them. */
      order?: () => readonly string[];
    } = {},
  ) => {
    const container = containerRef.current;
    const viewport = viewportRef.current;
    if (
      event.button !== 0 ||
      event.pointerType === "touch" ||
      !container ||
      !viewport
    ) {
      return;
    }
    stopRef.current?.();
    const mode = selectionModeOf(event);
    // Pointer coordinates are the window's; lengths inside are the zoomed
    // layout's, so a point is divided by how much larger the view is drawn.
    const scaleOf = () =>
      viewport.offsetHeight > 0
        ? viewport.getBoundingClientRect().height / viewport.offsetHeight
        : 1;
    const toContent = (client: Point): Point => {
      const scale = scaleOf();
      const box = container.getBoundingClientRect();
      return {
        x: (client.x - box.left) / scale,
        y: (client.y - box.top) / scale,
      };
    };
    const origin = toContent({ x: event.clientX, y: event.clientY });
    const pressed = { x: event.clientX, y: event.clientY };
    let pointer = pressed;
    let isDragging = false;
    let frame = 0;
    const draw = () => {
      const bounds = viewport.getBoundingClientRect();
      // The box stops at the edges of what is on screen, as the Finder's
      // does, while the view scrolls on under a pointer held past them.
      const held = {
        x: Math.min(Math.max(pointer.x, bounds.left), bounds.right),
        y: Math.min(Math.max(pointer.y, bounds.top), bounds.bottom),
      };
      const to = toContent(held);
      const box = boxBetween(origin, to);
      marquee.touch(hitTestRef.current(box, { from: origin, to }));
      if (shape === "run") return;
      const scale = scaleOf();
      const containerBox = container.getBoundingClientRect();
      setDrawn({
        ...box,
        x: box.x + (containerBox.left - bounds.left) / scale,
        y: box.y + (containerBox.top - bounds.top) / scale,
      });
    };
    const scroll = () => {
      if (!isDragging) return;
      const bounds = viewport.getBoundingClientRect();
      const speed = edgeScrollSpeed({
        bottom: bounds.bottom,
        pointer: pointer.y,
        top: bounds.top,
      });
      if (speed !== 0) {
        viewport.scrollTop += speed / scaleOf();
      }
      frame = requestAnimationFrame(scroll);
    };
    const onMove = (move: PointerEvent) => {
      if (move.pointerId !== event.pointerId) return;
      pointer = { x: move.clientX, y: move.clientY };
      if (!isDragging) {
        if (
          Math.hypot(pointer.x - pressed.x, pointer.y - pressed.y) <
          MARQUEE_SLOP_PX
        ) {
          return;
        }
        isDragging = true;
        onBegin?.();
        marquee.begin(mode, order?.() ?? null);
        frame = requestAnimationFrame(scroll);
      }
      draw();
    };
    const onScroll = () => {
      if (isDragging) draw();
    };
    const stop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      viewport.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
      stopRef.current = null;
      setDrawn(null);
    };
    const onUp = (up: PointerEvent) => {
      if (up.pointerId !== event.pointerId) return;
      const dragged = isDragging;
      stop();
      if (dragged) {
        claimedClickRef.current = true;
        // The click follows the release at once, when it comes at all.
        setTimeout(() => {
          claimedClickRef.current = false;
        });
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    viewport.addEventListener("scroll", onScroll, { passive: true });
    stopRef.current = stop;
  };
  return {
    /** Whether the click now arriving ends a box, which the view leaves alone. */
    claimClick: () => claimedClickRef.current,
    overlay:
      drawn === null ? null : (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
        >
          <div
            className="absolute rounded-[2px] border border-foreground/25 bg-foreground/10"
            data-file-system-marquee=""
            style={{
              height: drawn.height,
              left: drawn.x,
              top: drawn.y,
              width: drawn.width,
            }}
          />
        </div>
      ),
    start,
  };
}
const VIEW_OPTIONS: Array<{
  icon: React.ComponentType<InlineRegistryIconProps>;
  label: string;
  value: FileSystemView;
}> = [
  { icon: GridViewGlyph, label: "Grid", value: "icons" },
  { icon: ListRowsGlyph, label: "List", value: "list" },
  { icon: LayoutThreeColumnGlyph, label: "Columns", value: "columns" },
];
export function FileSystem({
  besideResizing = false,
  besideWidth,
  className,
  columnWidth: columnWidthProp,
  contextMenuPath = null,
  defaultPath = "",
  defaultSearch = "",
  defaultSelectedPath,
  defaultView = "icons",
  emptyState,
  getHostPath,
  group: groupProp,
  items,
  pendingFolders,
  listColumns: listColumnsProp,
  listColumnWidths: listColumnWidthsProp,
  loadChildren,
  moveFocusWithSelection = true,
  onColumnWidthChange,
  onCopy,
  onCopyPath,
  onDuplicate,
  onFileOpen,
  onItemContextMenu,
  onListColumnsChange,
  onListColumnWidthsChange,
  onLeaveRoot,
  onNewFolder,
  onOpenSeveral,
  onPathChange,
  onOpenFolderChange,
  onRenameCommit,
  onSearchChange,
  onGroupChange,
  onSelectionChange,
  onShowHiddenFilesChange,
  onSortChange,
  onTrash,
  onViewChange,
  openFolders,
  prefetchChildren,
  ref,
  renderFileStage,
  renderHeaderActions,
  renderHeaderPrimary,
  renderHeaderLead,
  renderUnreadable,
  selectedPath: selectedPathProp,
  showHiddenFiles: showHiddenFilesProp,
  sort: sortProp,
  title = "Files",
  toolbarInto,
  view: viewProp,
}: FileSystemProps) {
  const [internalView, setInternalView] = React.useState(defaultView);
  const view = viewProp ?? internalView;
  const [loadedItems, setLoadedItems] = React.useState<FileSystemItem[]>([]);
  const allItems = React.useMemo(
    () => (loadedItems.length > 0 ? [...items, ...loadedItems] : items),
    [items, loadedItems],
  );
  const [internalShowHiddenFiles, setInternalShowHiddenFiles] =
    React.useState(false);
  const showHiddenFiles = showHiddenFilesProp ?? internalShowHiddenFiles;
  const setShowHiddenFiles = React.useCallback(
    (next: boolean) => {
      setInternalShowHiddenFiles(next);
      onShowHiddenFilesChange?.(next);
    },
    [onShowHiddenFilesChange],
  );
  // Hidden files leave before the index rather than at the point of drawing a
  // row, so one answer covers all four views, search, the selection and the
  // arrow keys. A file the browser is not showing is one it does not know.
  const rootPrefix = normalizeFolderPath(defaultPath);
  const shownItems = React.useMemo(
    () =>
      showHiddenFiles
        ? allItems
        : allItems.filter((item) => !isHiddenPath(item.path, rootPrefix)),
    [allItems, rootPrefix, showHiddenFiles],
  );
  const index = React.useMemo(
    () => buildFileSystemIndex(shownItems),
    [shownItems],
  );
  const [history, setHistory] = React.useState(() => ({
    index: 0,
    stack: [normalizeFolderPath(defaultPath)],
  }));
  const currentPath = history.stack[history.index] ?? "";
  // Told before paint, so a caller that lays each folder out its own way
  // draws the new folder in its layout from the first frame.
  React.useLayoutEffect(() => {
    onPathChange?.(currentPath);
  }, [currentPath, onPathChange]);
  // The selection, as one value: the one the keyboard is on and, after a ⌘-
  // or Shift-click, the several held beside it. A caller holding `selectedPath`
  // holds the first half; the several stand only while they include it, so a
  // caller moving the selection onto a thing just made or renamed moves it to
  // that one thing.
  const [ownSelection, setOwnSelection] = React.useState(() =>
    selectOnly(defaultSelectedPath ?? null),
  );
  const selectionState = React.useMemo(
    () =>
      normalizeSelection(
        selectedPathProp === undefined
          ? ownSelection
          : { lead: selectedPathProp, several: ownSelection.several },
      ),
    [ownSelection, selectedPathProp],
  );
  const selectedPath = selectionState.lead;
  const selectedEntry = React.useMemo(() => {
    if (selectedPath === null) return null;
    return (
      index.files.get(selectedPath) ?? index.folders.get(selectedPath) ?? null
    );
  }, [index, selectedPath]);
  const [searchInput, setSearchInput] = React.useState(defaultSearch);
  const changeSearch = React.useCallback(
    (next: string) => {
      setSearchInput(next);
      onSearchChange?.(next);
    },
    [onSearchChange],
  );
  const searchInputRef = React.useRef<HTMLInputElement | null>(null);
  const [isSearchExpanded, setIsSearchExpanded] = React.useState(false);
  const searchQuery = normalizeSearchQuery(searchInput);
  const isSearching = searchQuery.length > 0;
  const [internalSort, setInternalSort] = React.useState(DEFAULT_SORT);
  const sort = sortProp ?? internalSort;
  const setSort = (next: FileSystemSortState) => {
    setInternalSort(next);
    onSortChange?.(next);
  };
  const [internalGroup, setInternalGroup] =
    React.useState<FileSystemGroupKey | null>(null);
  const group = groupProp === undefined ? internalGroup : groupProp;
  const setGroup = (next: FileSystemGroupKey | null) => {
    setInternalGroup(next);
    onGroupChange?.(next);
  };
  // Dates are grouped against the day the grouping is chosen on.
  const grouping = React.useMemo(
    () => (group === null ? null : groupingFor(group)),
    [group],
  );
  const [internalListColumns, setInternalListColumns] =
    React.useState(DEFAULT_LIST_COLUMNS);
  const listColumns = listColumnsProp ?? internalListColumns;
  const setListColumns = (next: FileSystemListColumn[]) => {
    setInternalListColumns(next);
    onListColumnsChange?.(next);
  };
  const [internalListColumnWidths, setInternalListColumnWidths] =
    React.useState<Partial<Record<FileSystemListColumn, number>>>({});
  const listColumnWidths = listColumnWidthsProp ?? internalListColumnWidths;
  const setListColumnWidths = (
    next: Partial<Record<FileSystemListColumn, number>>,
  ) => {
    setInternalListColumnWidths(next);
    onListColumnWidthsChange?.(next);
  };
  // Paths that stay visible while searching: every entry whose
  // currentPath-relative path contains the query (the list view tree's
  // hide-non-matches semantics), plus the ancestor folders leading to it.
  const visiblePaths = React.useMemo(() => {
    if (!isSearching) return null;
    const visible = new Set<string>();
    const markVisible = (path: string) => {
      while (path && path !== currentPath && !visible.has(path)) {
        visible.add(path);
        path = pathParent(path);
      }
    };
    const matchesQuery = (path: string) =>
      path.slice(currentPath.length).toLowerCase().includes(searchQuery);
    for (const path of [...index.files.keys(), ...index.folders.keys()]) {
      if (path === currentPath) continue;
      if (currentPath && !path.startsWith(currentPath)) continue;
      if (matchesQuery(path)) markVisible(path);
    }
    return visible;
  }, [currentPath, index, isSearching, searchQuery]);
  const visibleIndex = React.useMemo(() => {
    if (!visiblePaths) return index;
    const children = new Map<string, FileSystemEntry[]>();
    for (const [parentPath, parentChildren] of index.children) {
      const visibleChildren = parentChildren.filter((entry) =>
        visiblePaths.has(entry.path),
      );
      if (visibleChildren.length > 0) children.set(parentPath, visibleChildren);
    }
    return { ...index, children };
  }, [index, visiblePaths]);
  // Children re-sorted per the active sort, within their groups where the
  // rows are grouped, the groups in their own fixed order whatever the
  // sort's direction; the default (name ascending, ungrouped) reuses the
  // index's pre-sorted arrays untouched.
  const sortedIndex = React.useMemo(() => {
    if (
      grouping === null &&
      sort.key === DEFAULT_SORT.key &&
      sort.direction === DEFAULT_SORT.direction
    ) {
      return visibleIndex;
    }
    const children = new Map<string, FileSystemEntry[]>();
    for (const [parentPath, parentChildren] of visibleIndex.children) {
      const ranks = new Map(
        grouping
          ? parentChildren.map((entry) => [entry.path, grouping(entry).rank])
          : [],
      );
      children.set(
        parentPath,
        [...parentChildren].sort(
          (left, right) =>
            (ranks.get(left.path) ?? 0) - (ranks.get(right.path) ?? 0) ||
            compareEntriesBySort(left, right, sort),
        ),
      );
    }
    return { ...visibleIndex, children };
  }, [grouping, sort, visibleIndex]);
  // Which right-click a row has already answered for. The component's own
  // handler runs after it, and reports the empty space only for a press no
  // row claimed.
  const claimedContextMenu = React.useRef<Event | null>(null);
  const claimContextMenu = React.useCallback(
    (item: FileSystemItem, event: React.MouseEvent) => {
      claimedContextMenu.current = event.nativeEvent;
      onItemContextMenu?.(item, event);
    },
    [onItemContextMenu],
  );
  // The row a press or a hover landed on, whichever view drew it: every row
  // names itself by its whole path.
  const entryFromEventPath = (event: React.SyntheticEvent) => {
    for (const target of event.nativeEvent.composedPath()) {
      if (!(target instanceof HTMLElement)) continue;
      const path = target.dataset.fileSystemItem;
      if (path !== undefined) {
        return index.files.get(path) ?? index.folders.get(path) ?? null;
      }
    }
    return null;
  };
  const entryOf = React.useCallback(
    (path: null | string) =>
      path === null
        ? null
        : (index.files.get(path) ?? index.folders.get(path) ?? null),
    [index],
  );
  // What callbacks read the selection from, so the memoized columns are not
  // drawn again for every change to it. It is moved at once by a change made
  // here, and follows one the caller makes once that has drawn.
  const selectionRef = React.useRef(selectionState);
  React.useEffect(() => {
    selectionRef.current = selectionState;
  }, [selectionState]);
  // What is selected and still shown: a search, a filter or a re-read can
  // take some of it out from under the views.
  const selectedPaths = React.useMemo(
    () =>
      selectedPathsOf(selectionState).filter(
        (path) =>
          path === selectedPath ||
          ((index.files.has(path) || index.folders.has(path)) &&
            (!visiblePaths || visiblePaths.has(path))),
      ),
    [index, selectedPath, selectionState, visiblePaths],
  );
  const selection = React.useMemo(
    () => new Set(selectedPaths),
    [selectedPaths],
  );
  const commitSelection = React.useCallback(
    (next: Selection) => {
      const normal = normalizeSelection(next);
      if (sameSelection(selectionRef.current, normal)) return;
      selectionRef.current = normal;
      setOwnSelection(normal);
      onSelectionChange?.(
        entryOf(normal.lead),
        selectedPathsOf(normal).flatMap((path) => {
          const entry = entryOf(path);
          return entry ? [entry] : [];
        }),
      );
    },
    [entryOf, onSelectionChange],
  );
  const selectEntry = React.useCallback(
    (entry: FileSystemEntry | null) => {
      commitSelection(selectOnly(entry?.path ?? null));
    },
    [commitSelection],
  );
  // Exactly these, the way ⌘A takes a folder: the one the keyboard is on
  // stays on it when it is among them.
  const selectEntries = React.useCallback(
    (entries: readonly FileSystemEntry[]) => {
      commitSelection(
        selectExactly(
          selectionRef.current,
          entries.map((entry) => entry.path),
        ),
      );
    },
    [commitSelection],
  );
  // A ⌘-click picks one more or lets one go; a Shift-click reaches from the
  // last thing clicked to this one in the order the view draws them. Both
  // add to a selection among the rows they reach along: one made elsewhere
  // (another of the columns) is started over from this one, the way the
  // Finder's columns pick several in one column.
  const selectWithGesture = React.useCallback(
    (entry: FileSystemEntry, { mode, order }: SelectionGesture) => {
      const current = selectionRef.current;
      const paths = order.map((candidate) => candidate.path);
      commitSelection(
        current.lead !== null && !paths.includes(current.lead)
          ? selectOnly(entry.path)
          : selectWithMode(current, entry.path, mode, paths),
      );
    },
    [commitSelection],
  );
  // How many items the list draws, which is what it counts, as the Finder's
  // list counts what is open in place under a folder.
  const [listedCount, setListedCount] = React.useState<null | number>(null);
  // What a box dragged across the rows starts from, and how it adds to it.
  const marqueeStartRef = React.useRef<{
    base: Selection;
    mode: null | SelectionMode;
  } | null>(null);
  const marquee = React.useMemo<MarqueeControl>(
    () => ({
      begin: (mode, order) => {
        const current = selectionRef.current;
        marqueeStartRef.current = {
          base:
            mode !== null &&
            order !== null &&
            current.lead !== null &&
            !order.includes(current.lead)
              ? NOTHING_SELECTED
              : current,
          mode,
        };
      },
      touch: (paths) => {
        const started = marqueeStartRef.current;
        if (!started) return;
        commitSelection(marqueeSelection(started.base, paths, started.mode));
      },
    }),
    [commitSelection],
  );
  // A query or filter change can hide some of the selection out from under
  // the views. What is left is what is shown, so an action on the selection
  // never reaches a row the search has taken off the screen.
  React.useEffect(() => {
    if (!visiblePaths || selectionState.lead === null) return;
    const kept = keepShown(
      selectionState,
      (path) =>
        (index.files.has(path) || index.folders.has(path)) &&
        visiblePaths.has(path),
    );
    if (kept !== selectionState) commitSelection(kept);
  }, [commitSelection, index, selectionState, visiblePaths]);
  // Dragging a row out of the window, to the desktop or another app. One
  // gesture for every view, on the browser itself; the rows say they drag.
  // A row of several selected carries the rest of them with it.
  const dragArea = useFileDragArea(
    getHostPath
      ? (event) => {
          const entry = entryFromEventPath(event);
          const hostPath = entry ? getHostPath(entry) : undefined;
          if (!entry || !hostPath) return undefined;
          if (selection.size < 2 || !selection.has(entry.path)) {
            return { hostPath };
          }
          return {
            hostPath,
            others: selectedPaths.flatMap((path) => {
              const other =
                path === entry.path
                  ? undefined
                  : (index.files.get(path) ?? index.folders.get(path));
              const otherHostPath = other ? getHostPath(other) : undefined;
              return otherHostPath ? [otherHostPath] : [];
            }),
          };
        }
      : undefined,
  );
  const applySortKey = (key: FileSystemSortKey) => {
    if (sort.key !== key) {
      setSort({ direction: defaultSortDirection(key), key });
    }
  };
  // Column headers toggle the direction when the column is already active,
  // like Finder.
  const toggleSortColumn = (key: FileSystemSortKey) => {
    setSort(
      sort.key === key
        ? { direction: sort.direction === "asc" ? "desc" : "asc", key }
        : { direction: defaultSortDirection(key), key },
    );
  };
  // Below 560px the search input collapses into a popover, and below 360px the
  // folder name is dropped too. The view switcher answers to the toolbar's
  // container instead.
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const [headerLayout, setHeaderLayout] = React.useState<
    "compact" | "full" | "minimal"
  >("full");
  React.useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const applyWidth = (width: number | undefined) => {
      if (width === undefined) return;
      setHeaderLayout(
        width < 360 ? "minimal" : width < 560 ? "compact" : "full",
      );
    };
    const observer = new ResizeObserver((observerEntries) =>
      applyWidth(observerEntries[0]?.contentRect.width),
    );
    // Measure synchronously so the first painted layout is already correct;
    // the observer then tracks resizes.
    applyWidth(root.clientWidth);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);
  const requestedFoldersRef = React.useRef(new Set<string>());
  const [fetchingFolders, setFetchingFolders] = React.useState<Set<string>>(
    () => new Set(),
  );
  const loadingFolders = React.useMemo(
    () =>
      pendingFolders?.size
        ? new Set([...fetchingFolders, ...pendingFolders])
        : fetchingFolders,
    [fetchingFolders, pendingFolders],
  );
  const ensureChildren = React.useCallback(
    (folderPath: string) => {
      if (!loadChildren) return;
      const folder = index.folders.get(folderPath);
      if (!folder?.hasChildren) return;
      if (index.children.get(folderPath)?.length) return;
      if (requestedFoldersRef.current.has(folderPath)) return;
      requestedFoldersRef.current.add(folderPath);
      setFetchingFolders((previous) => new Set(previous).add(folderPath));
      void (async () => {
        try {
          let cursor: null | string = null;
          do {
            const result = await loadChildren({ cursor, path: folderPath });
            if (result.items.length > 0) {
              setLoadedItems((previous) => [...previous, ...result.items]);
            }
            cursor = result.nextCursor ?? null;
          } while (cursor);
        } catch {
          requestedFoldersRef.current.delete(folderPath);
        } finally {
          setFetchingFolders((previous) => {
            const next = new Set(previous);
            next.delete(folderPath);
            return next;
          });
        }
      })();
    },
    [index, loadChildren],
  );
  const navigateTo = React.useCallback(
    (folderPath: string) => {
      const path = normalizeFolderPath(folderPath);
      setHistory((previous) => {
        if (previous.stack[previous.index] === path) return previous;
        const stack = [...previous.stack.slice(0, previous.index + 1), path];
        return { index: stack.length - 1, stack };
      });
      // Navigation exits search, like Finder.
      changeSearch("");
      setIsSearchExpanded(false);
      selectEntry(null);
      ensureChildren(path);
    },
    [changeSearch, ensureChildren, selectEntry],
  );
  React.useEffect(() => {
    ensureChildren(currentPath);
  }, [currentPath, ensureChildren]);
  // Navigation unmounts the focused row, dropping focus to <body> and killing
  // the ⌘ shortcuts; reclaim focus onto the component root when that happens.
  const previousPathRef = React.useRef(currentPath);
  React.useEffect(() => {
    if (previousPathRef.current === currentPath) {
      return;
    }
    previousPathRef.current = currentPath;
    const root = rootRef.current;
    if (root && document.activeElement === document.body) {
      root.focus({ preventScroll: true });
    }
  }, [currentPath]);
  const [openedFile, setOpenedFile] = React.useState<null | {
    file: FileEntry;
    kind: FileSystemViewerKind;
    url: string;
  }>(null);
  // The keep-alive preview pool. Recently shown documents stay mounted so
  // returning to one — in the gallery stage or the viewer dialog — skips
  // the download and parse work instead of repeating it behind a spinner.
  // Each pooled path renders through a portal into a stable detached <div>
  // created once per path and never swapped (React remounts a portal's
  // children when its container changes); a layout effect reparents that
  // div into whichever host currently shows the file: the gallery's stage
  // wrapper or the open dialog. Imperative appendChild keeps the mounted
  // viewer (and its parsed document) alive across every move. Pooled paths
  // without a current host stay mounted but DETACHED from the DOM — a
  // detached subtree costs no layout, paint, or style-recalc work, so idle
  // pool members never slow down interactions in the visible viewer.
  const [stagePool, setStagePool] = React.useState<string[]>([]);
  const [stageRecency] = React.useState(() => new Map<string, number>());
  const stageClockRef = React.useRef(0);
  const [stageContainers] = React.useState(
    () => new Map<string, HTMLDivElement>(),
  );
  const [stageHosts] = React.useState(() => new Map<string, HTMLElement>());
  const [, bumpStageHosts] = React.useState(0);
  // Bumped on every admission so the attach set recomputes when recency
  // changes without a pool membership change.
  const [stageVersion, setStageVersion] = React.useState(0);
  const [dialogStageHost, setDialogStageHost] =
    React.useState<HTMLElement | null>(null);
  const registerStageHost = React.useCallback(
    (path: string, element: HTMLElement | null) => {
      if (element) {
        if (stageHosts.get(path) === element) return;
        stageHosts.set(path, element);
      } else {
        if (!stageHosts.has(path)) return;
        stageHosts.delete(path);
      }
      bumpStageHosts((version) => version + 1);
    },
    [stageHosts],
  );
  const dialogStageHostRef = React.useCallback(
    (element: HTMLDivElement | null) => setDialogStageHost(element),
    [],
  );
  // Admits a file into the pool (idempotent), evicting the least recently
  // admitted path beyond the cap. The pool array keeps insertion order —
  // reordering would churn the host registrations — so recency lives in a
  // separate map; the version bump re-renders so the attach set below
  // tracks recency even when pool membership is unchanged.
  const poolStagePath = React.useCallback(
    (path: string) => {
      if (!index.files.has(path)) return;
      if (!stageContainers.has(path)) {
        const container = document.createElement("div");
        // Layout/paint containment keeps work inside one preview from
        // invalidating the rest of the page (and vice versa).
        container.className =
          "flex size-full min-h-0 min-w-0 items-center justify-center contain-layout contain-paint";
        stageContainers.set(path, container);
      }
      stageRecency.set(path, ++stageClockRef.current);
      setStageVersion((version) => version + 1);
      setStagePool((previous) => {
        if (previous.includes(path)) return previous;
        const next = [...previous, path];
        if (next.length <= GALLERY_STAGE_POOL_SIZE) return next;
        let evicted = next[0];
        for (const candidate of next) {
          if (candidate === path) continue;
          if (
            (stageRecency.get(candidate) ?? 0) <
            (evicted === undefined ? 0 : (stageRecency.get(evicted) ?? 0))
          ) {
            evicted = candidate;
          }
        }
        return next.filter((candidate) => candidate !== evicted);
      });
    },
    [index, stageContainers, stageRecency],
  );
  const dialogStagePath =
    openedFile !== null && openedFile.kind !== "image"
      ? openedFile.file.path
      : null;
  // Only the most recently shown stages stay attached to the DOM, so
  // rotating among a few files stays instant while older pool members wait
  // detached at zero rendering cost. Memoized so host ref callbacks
  // downstream stay referentially stable — recomputing every render would
  // re-register hosts in a loop.
  const attachedStagePaths = React.useMemo(() => {
    void stageVersion;
    const attached = [...stagePool]
      .sort((a, b) => (stageRecency.get(b) ?? 0) - (stageRecency.get(a) ?? 0))
      .slice(0, GALLERY_STAGE_ATTACHED_COUNT);
    if (
      dialogStagePath &&
      stagePool.includes(dialogStagePath) &&
      !attached.includes(dialogStagePath)
    ) {
      attached.push(dialogStagePath);
    }
    return attached;
  }, [dialogStagePath, stagePool, stageRecency, stageVersion]);
  // Reparent each pooled container to its current host. No dependency
  // array: host registration mutates maps in place, so the cheap loop
  // (pool ≤ GALLERY_STAGE_POOL_SIZE) runs every commit instead of chasing
  // every mutation source.
  React.useLayoutEffect(() => {
    for (const [path, container] of stageContainers) {
      if (!stagePool.includes(path)) {
        // Evicted — React already unmounted the portal's children.
        container.remove();
        stageContainers.delete(path);
        continue;
      }
      if (dialogStagePath === path) {
        // Leave the container in place until the dialog host mounts.
        if (dialogStageHost && container.parentElement !== dialogStageHost) {
          dialogStageHost.append(container);
        }
        continue;
      }
      const target = attachedStagePaths.includes(path)
        ? (stageHosts.get(path) ?? null)
        : null;
      if (!target) {
        if (container.parentElement) container.remove();
      } else if (container.parentElement !== target) {
        target.append(container);
      }
    }
  });
  /** The keyboard back on the listing's row, once the view it switched to has drawn it. */
  const focusListing = () => {
    requestAnimationFrame(() => {
      const root = rootRef.current;
      (
        root?.querySelector<HTMLElement>('[role="option"][tabindex="0"]') ??
        root
      )?.focus({ preventScroll: true });
    });
  };
  // Leaving the columns leaves the window in the folder the last column
  // shows, the way the Finder does: the selected folder, or the folder the
  // selected file is in, which stays selected there.
  //
  // Coming back to the columns from a folder below the one the browser opened
  // on starts them a folder up, with that folder selected, so the columns
  // show where it sits rather than starting inside it: columns, list,
  // columns again is the columns as they were, and a folder walked into in
  // the list is never a place the columns strand the reader in. A step the
  // leaving took is stepped back over rather than added to.
  const setView = (nextView: FileSystemView) => {
    setInternalView(nextView);
    onViewChange?.(nextView);
    if (nextView === "columns" && view !== "columns") {
      const folder = index.folders.get(currentPath);
      if (currentPath === "" || !folder) {
        return;
      }
      const parent = pathParent(currentPath);
      setHistory((previous) =>
        previous.stack[previous.index - 1] === parent
          ? { ...previous, index: previous.index - 1 }
          : {
              ...previous,
              stack: previous.stack.map((entry, at) =>
                at === previous.index ? parent : entry,
              ),
            },
      );
      // What was selected inside the folder stays selected; with nothing
      // selected there, the folder itself is.
      if (!selectedPath?.startsWith(currentPath)) {
        selectEntry(folder);
      }
      return;
    }
    if (view !== "columns" || nextView === "columns" || !selectedEntry) {
      return;
    }
    // Several selected stay selected in the folder that lists them.
    if (selectedEntry.kind === "folder" && selectedPaths.length === 1) {
      navigateTo(selectedEntry.path);
      return;
    }
    const folder = selectedEntry.parentPath;
    if (folder !== currentPath) {
      setHistory((previous) => {
        const stack = [...previous.stack.slice(0, previous.index + 1), folder];
        return { index: stack.length - 1, stack };
      });
    }
  };
  const openFile = React.useCallback(
    (file: FileEntry) => {
      const url = file.url ?? null;
      if (onFileOpen) {
        onFileOpen(file, url);
        return;
      }
      const kind = viewerKindForFile(file);
      if (kind && url) {
        // Pool the file so the dialog reuses an already-mounted preview
        // (and the gallery inherits the live viewer after it closes).
        poolStagePath(file.path);
        setOpenedFile({ file, kind, url });
      }
    },
    [onFileOpen, poolStagePath],
  );
  // A double-click or ⌘O on one of several selected opens all of them, the
  // way the Finder does.
  const openEntry = React.useCallback(
    (entry: FileSystemEntry) => {
      const entries = selectedPathsOf(selectionRef.current).flatMap((path) => {
        const each = entryOf(path);
        return each ? [each] : [];
      });
      if (
        entries.length > 1 &&
        entries.some((each) => each.path === entry.path)
      ) {
        if (onOpenSeveral) {
          onOpenSeveral(entries);
        } else {
          for (const each of entries) {
            if (each.kind === "file") openFile(each);
          }
        }
        return;
      }
      if (entry.kind === "folder") {
        navigateTo(entry.path);
      } else {
        openFile(entry);
      }
    },
    [entryOf, navigateTo, onOpenSeveral, openFile],
  );
  // Selecting a lazy folder (columns view, keyboard nav) prefetches children.
  const selectAndPrefetchEntry = React.useCallback(
    (entry: FileSystemEntry | null, gesture?: SelectionGesture) => {
      if (entry && gesture) {
        selectWithGesture(entry, gesture);
        return;
      }
      selectEntry(entry);
      if (entry?.kind === "folder") ensureChildren(entry.path);
    },
    [ensureChildren, selectEntry, selectWithGesture],
  );
  // Renaming in place: one rename at a time, run by `renameStep`. The field
  // is drawn by whichever view shows the row; everything else about the
  // rename (when it opens, what ends it, the save, the keyboard after it)
  // is here, the same for every view.
  const canRename = onRenameCommit !== undefined;
  // What a row is called, while it is listed and on screen; a rename waits
  // for that, and ends when it stops being so.
  const listedNameOf = React.useCallback(
    (path: string) => {
      const entry = entryOf(path);
      return entry && (!visiblePaths || visiblePaths.has(path))
        ? entry.name
        : null;
    },
    [entryOf, visiblePaths],
  );
  const [renameState, setRenameState] =
    React.useState<RenameState>(RENAME_IDLE);
  const renameRef = React.useRef(renameState);
  const nameInputRef = React.useRef<HTMLInputElement | null>(null);
  const refocusAfterRenameRef = React.useRef(false);
  // The latest of what the machines' effects call, so the senders below stay
  // one function for the component's life and the memoized columns that are
  // handed them are not drawn again.
  const effectsRef = React.useRef({
    entryOf,
    onRenameCommit,
    selectAndPrefetchEntry,
  });
  React.useLayoutEffect(() => {
    effectsRef.current = { entryOf, onRenameCommit, selectAndPrefetchEntry };
  });
  const sendRename = React.useCallback((event: RenameEvent) => {
    const { effects, state } = renameStep(renameRef.current, event);
    if (state === renameRef.current) return;
    renameRef.current = state;
    setRenameState(state);
    for (const effect of effects) {
      if (effect.type === "ended") {
        refocusAfterRenameRef.current = true;
        continue;
      }
      const { entryOf: lookUp, onRenameCommit: save } = effectsRef.current;
      const entry = lookUp(effect.path);
      // The caller hears about the name and writes it; a write it reports as
      // failed opens the field again with what was typed.
      void (async () => {
        if (!entry || !save) throw new Error("Nothing to rename");
        await save(entry, effect.name);
      })().then(
        () => sendRename({ type: "saved" }),
        () => sendRename({ type: "save-failed" }),
      );
    }
  }, []);
  const startRename = React.useCallback(
    (path: string) => {
      if (!canRename) return;
      sendRename({ name: listedNameOf(path), path, type: "start" });
    },
    [canRename, listedNameOf, sendRename],
  );
  React.useImperativeHandle(
    ref,
    () => ({
      rowAfter: (paths) =>
        rowAfterRemoving(
          listingNavRef.current?.rows.map((entry) => entry.path) ?? [],
          paths,
        ),
      select: (paths) => {
        commitSelection(selectExactly(selectOnly(null), paths));
      },
      startRename,
    }),
    [commitSelection, startRename],
  );
  React.useEffect(() => {
    sendRename({ nameOf: listedNameOf, type: "listed" });
  }, [listedNameOf, sendRename]);
  // A rename asked for before its row is listed is called off by anything
  // the person does first; one being typed is accepted by a press anywhere
  // but the field, the way the Finder takes a click away as Return.
  const renamePhase = renameState.phase;
  React.useEffect(() => {
    if (renamePhase !== "waiting" && renamePhase !== "editing") return;
    const onPointerDown = (event: PointerEvent) => {
      if (renamePhase === "waiting") {
        sendRename({ type: "interrupt" });
        return;
      }
      const input = nameInputRef.current;
      if (
        input &&
        event.target instanceof Node &&
        input.contains(event.target)
      ) {
        return;
      }
      sendRename({ text: input?.value ?? "", type: "accept" });
    };
    const onKeyDown = () => {
      if (renamePhase === "waiting") sendRename({ type: "interrupt" });
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [renamePhase, sendRename]);
  // Going to another folder leaves the field behind: what was typed is kept,
  // and a rename still waiting for its row is called off.
  const renamedFromPathRef = React.useRef(currentPath);
  React.useEffect(() => {
    if (renamedFromPathRef.current === currentPath) return;
    renamedFromPathRef.current = currentPath;
    sendRename({ type: "interrupt" });
    sendRename({ text: nameInputRef.current?.value ?? "", type: "accept" });
  }, [currentPath, sendRename]);
  // A field put away leaves the keyboard on nothing, since the row it was in
  // is being rebuilt under its new name. The browser itself takes it, which
  // is where an arrow walks the folder from and Return renames again; a press
  // that put the field away has already given it to what was pressed.
  React.useLayoutEffect(() => {
    if (!refocusAfterRenameRef.current || renamingPathOf(renameState)) return;
    refocusAfterRenameRef.current = false;
    const active = document.activeElement;
    if (!active || active === document.body) {
      rootRef.current?.focus({ preventScroll: true });
    }
  }, [renameState]);
  const renamingPath = renamingPathOf(renameState);
  const renderNameField = React.useCallback(
    (entry: FileSystemEntry, fieldClassName?: string) => {
      if (
        (renameState.phase !== "editing" && renameState.phase !== "saving") ||
        renameState.path !== entry.path
      ) {
        return null;
      }
      return (
        <FileSystemNameField
          className={fieldClassName}
          draft={renameState.draft}
          inputRef={nameInputRef}
          key={renameState.attempt}
          onAccept={(text) => {
            sendRename({ text, type: "accept" });
          }}
          onCancel={() => {
            sendRename({ type: "cancel" });
          }}
          readOnly={renameState.phase === "saving"}
        />
      );
    },
    [renameState, sendRename],
  );
  // Rows pressed and clicked, run by `gestureStep`: one machine for every
  // view and every column, so a press in one column lands a narrowing a
  // click in another left waiting.
  const startRenameRef = React.useRef(startRename);
  React.useLayoutEffect(() => {
    startRenameRef.current = startRename;
  });
  const canRenameRef = React.useRef(canRename);
  React.useLayoutEffect(() => {
    canRenameRef.current = canRename;
  });
  const gestureRef = React.useRef<GestureState>(GESTURE_IDLE);
  const gestureTimerRef = React.useRef<number | undefined>(undefined);
  const gestureInterruptRef = React.useRef<(() => void) | null>(null);
  const sendGesture = React.useCallback(
    (event: GestureEvent, order?: () => readonly FileSystemEntry[]) => {
      const previous = gestureRef.current;
      const { effects, state } = gestureStep(previous, event);
      gestureRef.current = state;
      if (state !== previous) {
        window.clearTimeout(gestureTimerRef.current);
        const ms = waitFor(state);
        if (ms !== null) {
          gestureTimerRef.current = window.setTimeout(() => {
            const current = selectionRef.current;
            sendGesture({
              lead: current.lead,
              selectionSize: selectedPathsOf(current).length,
              type: "timeout",
            });
          }, ms);
        }
        // A key or a scroll calls off a rename the pointer is waiting on,
        // wherever in the window it lands.
        const listens = state.phase !== "idle" && state.after === "rename";
        const interrupt = gestureInterruptRef.current;
        if (!listens && interrupt) {
          window.removeEventListener("keydown", interrupt, true);
          window.removeEventListener("wheel", interrupt, true);
          gestureInterruptRef.current = null;
        } else if (listens && !interrupt) {
          const next = () => sendGesture({ type: "interrupt" });
          window.addEventListener("keydown", next, true);
          window.addEventListener("wheel", next, true);
          gestureInterruptRef.current = next;
        }
      }
      const { entryOf: lookUp, selectAndPrefetchEntry: select } =
        effectsRef.current;
      for (const effect of effects) {
        const entry = lookUp(effect.path);
        if (!entry) continue;
        if (effect.type === "rename") {
          startRenameRef.current(effect.path);
        } else if (effect.type === "select" && effect.mode) {
          select(entry, { mode: effect.mode, order: order?.() ?? [] });
        } else {
          select(entry);
        }
      }
    },
    [],
  );
  React.useEffect(
    () => () => {
      window.clearTimeout(gestureTimerRef.current);
      const interrupt = gestureInterruptRef.current;
      if (interrupt) {
        window.removeEventListener("keydown", interrupt, true);
        window.removeEventListener("wheel", interrupt, true);
      }
    },
    [],
  );
  React.useEffect(() => {
    sendGesture({ lead: selectionState.lead, type: "selection" });
  }, [selectionState, sendGesture]);
  const rowGestures = React.useMemo<RowGestures>(
    () => ({
      click: (entry, event, order) => {
        sendGesture(
          {
            detail: event.detail,
            isContextClick: isMacContextClick(event),
            mode: selectionModeOf(event),
            path: entry.path,
            type: "click",
          },
          order,
        );
      },
      doubleClick: () => {
        sendGesture({ type: "double-click" });
      },
      press: (entry, event, order) => {
        const held = selectedPathsOf(selectionRef.current);
        sendGesture(
          {
            button: event.button,
            isContextClick: isMacContextClick(event),
            isOnName:
              event.target instanceof Element &&
              event.target.closest("[data-file-system-name]") !== null,
            mode: selectionModeOf(event),
            path: entry.path,
            pointerType: event.pointerType,
            renames: canRenameRef.current,
            selection: { has: held.includes(entry.path), size: held.length },
            type: "press",
          },
          order,
        );
      },
    }),
    [sendGesture],
  );
  // The keys, read once for every view (`listingCommandOf`) and answered by
  // the view on screen, which says how its rows are walked.
  const listingNavRef = React.useRef<ListingNav | null>(null);
  const typeAheadRef = React.useRef(NO_TYPE_AHEAD);
  const runListingCommand = (command: ListingCommand) => {
    const nav = listingNavRef.current;
    if (!nav) return false;
    const lead = entryOf(selectionRef.current.lead);
    const picked = () =>
      selectedPathsOf(selectionRef.current).flatMap((path) => {
        const each = entryOf(path);
        return each ? [each] : [];
      });
    switch (command.type) {
      case "copy":
      case "copy-path":
      case "duplicate": {
        const handler =
          command.type === "duplicate"
            ? onDuplicate
            : command.type === "copy"
              ? onCopy
              : onCopyPath;
        const chosen = picked();
        if (!handler || chosen.length === 0) return false;
        handler(chosen);
        return true;
      }
      case "move": {
        const moved = nav.move(command.direction);
        if (typeof moved === "boolean") return moved;
        selectAndPrefetchEntry(
          moved.entry,
          command.extend && moved.order
            ? { mode: "extend", order: moved.order }
            : undefined,
        );
        nav.reveal(moved.entry);
        return true;
      }
      case "new-folder":
        if (!onNewFolder) return false;
        onNewFolder();
        return true;
      case "open":
        if (!lead) return false;
        openEntry(lead);
        return true;
      case "parent": {
        if (currentPath === "") {
          if (!onLeaveRoot) return false;
          onLeaveRoot();
          return true;
        }
        // The folder left behind is what is selected above it, the way the
        // Finder and File Explorer both go up.
        const left = index.folders.get(currentPath) ?? null;
        navigateTo(pathParent(currentPath));
        selectEntry(left);
        return true;
      }
      case "rename":
      case "return":
        if (!lead) return false;
        // Several selected are renamed one at a time or not at all.
        if (selectedPathsOf(selectionRef.current).length > 1) return true;
        if (canRename && nav.renames) {
          startRename(lead.path);
        } else if (command.type === "return") {
          openEntry(lead);
        }
        return true;
      case "select-all":
        selectEntries(nav.rows);
        return true;
      case "space":
        return true;
      case "trash": {
        const chosen = picked();
        if (!onTrash || chosen.length === 0) return false;
        onTrash(chosen);
        return true;
      }
      case "type-ahead": {
        const current = nav.current;
        const { match, state } = typeAhead({
          char: command.char,
          currentIndex: current
            ? nav.rows.findIndex((entry) => entry.path === current.path)
            : -1,
          entries: nav.rows,
          now: performance.now(),
          state: typeAheadRef.current,
        });
        typeAheadRef.current = state;
        if (match) {
          selectAndPrefetchEntry(match);
          nav.reveal(match);
        }
        return true;
      }
    }
  };
  const currentEntries = sortedIndex.children.get(currentPath) ?? [];
  const currentFolderName =
    currentPath === "" ? title : pathName(currentPath) || title;
  const isLoadingCurrentFolder = loadingFolders.has(currentPath);
  const currentUnreadable = renderUnreadable?.(currentPath, "pane") ?? null;
  // The list view keeps its open folders here, per folder on screen, so
  // returning to the list view — or to a previously visited folder — finds
  // them open again.
  const treeExpansionRef = React.useRef(new Map<string, readonly string[]>());
  const viewProps: FileSystemViewProps = {
    attachedStagePaths,
    besideResizing,
    besideWidth,
    columnWidth: columnWidthProp,
    currentPath,
    draggable: dragArea.draggable,
    enabledListColumns: listColumns,
    entries: currentEntries,
    grouping,
    index: sortedIndex,
    listColumnWidths,
    loadingFolders,
    menuTargetPath: contextMenuPath,
    moveFocusWithSelection,
    onColumnWidthChange,
    onExpandFolder: ensureChildren,
    onFolderHover: prefetchChildren,
    onItemContextMenu: onItemContextMenu ? claimContextMenu : undefined,
    onListColumnsChange: setListColumns,
    onListColumnWidthsChange: setListColumnWidths,
    listingNavRef,
    onOpen: openEntry,
    onSelect: selectAndPrefetchEntry,
    onSelectEntries: selectEntries,
    marquee,
    onListedCount: setListedCount,
    onSortColumnClick: toggleSortColumn,
    poolStagePath,
    registerStageHost,
    renamingPath,
    renderFileStage,
    renderNameField,
    renderUnreadable,
    rootTitle: title,
    rowGestures,
    searchQuery,
    selectedEntry,
    selectedPath,
    selection,
    sort,
    treeExpansionRef,
    ...(openFolders === undefined ? {} : { openFolders, onOpenFolderChange }),
  };
  // ⌘F focuses the toolbar search. Below 560px the field is in a popover,
  // outside the component, so a press with the caret already in it is ours too.
  useFindTarget({
    anchor: rootRef,
    holdsKeyboard: () => document.activeElement === searchInputRef.current,
    openFind: () => {
      setIsSearchExpanded(true);
      searchInputRef.current?.focus();
    },
  });
  const openedFileName = openedFile
    ? (openedFile.file.name ?? openedFile.file.path)
    : "";
  const activeViewOption = VIEW_OPTIONS.find((option) => option.value === view);
  const viewerCloseToolbarAction = (
    <DialogClose asChild>
      <Button
        aria-label="Close preview"
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <X className="size-4" />
      </Button>
    </DialogClose>
  );
  // The toolbar's controls, drawn in its own header or, for a host that
  // holds them in a row of its own, portalled there.
  const viewSelect = (
    <Select
      onValueChange={(value) => setView(value as FileSystemView)}
      value={view}
    >
      <SelectTrigger
        aria-label="View"
        className={TOOLBAR_SELECT_TRIGGER_CLASSNAME}
        size="sm"
      >
        <SelectValue>
          {activeViewOption ? (
            <activeViewOption.icon
              className={cn("size-4", VIEW_GLYPH_DIM_CLASSNAME)}
            />
          ) : null}
        </SelectValue>
      </SelectTrigger>
      <SelectContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          focusListing();
        }}
        position="popper"
      >
        {VIEW_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            <span className="flex items-center gap-2">
              <option.icon className="size-4" />
              {option.label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  const viewTabs = (tabsClassName: string) => (
    <Tabs
      // Arrows on a focused view only move between the views, and Return
      // or Space picks one: switching on every arrow fought the listing
      // for the same keys.
      activationMode="manual"
      className={tabsClassName}
      onValueChange={(value) => setView(value as FileSystemView)}
      value={view}
    >
      {/* A track a shade darker than the muted one, so it reads as a
          well the choices sit in against the toolbar's own tint. */}
      <TabsList className="h-8 bg-foreground/8 p-0.5">
        {VIEW_OPTIONS.map((option) => (
          <TabsTrigger
            aria-label={`${option.label} view`}
            className={VIEW_TAB_CLASSNAME}
            key={option.value}
            // Picked, a view hands the keyboard back to the listing,
            // the way the Finder's toolbar never keeps it: the next arrow
            // walks the folder rather than the views.
            onClick={focusListing}
            title={option.label}
            value={option.value}
          >
            <option.icon className="size-4" />
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
  const sortMenu = (
    <FileSystemSortMenu
      // `some`, not every, so a recent that has gone since is no reason to
      // take the order away.
      options={
        items.some(
          (item) => item.kind === "file" && item.openedAt !== undefined,
        )
          ? [OPENED_SORT_OPTION, ...SORT_OPTIONS]
          : SORT_OPTIONS
      }
      group={group}
      onClosed={focusListing}
      onGroupChange={setGroup}
      onKeyChange={applySortKey}
      onShowHiddenFilesChange={setShowHiddenFiles}
      showHiddenFiles={showHiddenFiles}
      sort={sort}
    />
  );
  const searchField = (layout: "compact" | "full" | "minimal") => (
    <FileSystemSearchField
      inputRef={searchInputRef}
      isExpanded={isSearchExpanded}
      layout={layout}
      onExpandedChange={setIsSearchExpanded}
      onValueChange={changeSearch}
      value={searchInput}
    />
  );
  // Whether one of the views is drawn, rather than what stands for the
  // folder when it has nothing to show.
  const isViewShown =
    currentUnreadable === null &&
    !(isLoadingCurrentFolder && currentEntries.length === 0) &&
    !(currentEntries.length === 0 && emptyState && !isSearching) &&
    !(currentEntries.length === 0 && (view !== "columns" || isSearching));
  return (
    <div
      className={cn(
        // Pressed and double-clicked all over, which as text would select
        // whatever words a quick second click landed on. Fields still take a
        // selection of their own.
        "flex h-[480px] min-h-0 flex-col overflow-hidden rounded-xl border bg-background text-foreground outline-none select-none",
        className,
      )}
      data-find-surface
      data-slot="file-system"
      onClickCapture={dragArea.onClickCapture}
      onContextMenu={(event) => {
        // A row answered it, or a part of the browser with a menu of its own
        // (the list's header) or none (the toolbar).
        if (
          claimedContextMenu.current === event.nativeEvent ||
          event.defaultPrevented
        ) {
          return;
        }
        onItemContextMenu?.(null, event);
      }}
      onDragStart={dragArea.onDragStart}
      onKeyDown={(event) => {
        // The rows' keys, read here for every view. A press already answered
        // (a menu's own arrows), one from something portalled out of the
        // browser (its menus and dialogs), and one typed into a field are
        // someone else's; so are the view switcher's arrows.
        const target = event.target;
        if (
          event.defaultPrevented ||
          !(target instanceof HTMLElement) ||
          !rootRef.current?.contains(target) ||
          isEditableTarget(target) ||
          target.closest('[role="tablist"], [role="combobox"]')
        ) {
          return;
        }
        const command = listingCommandOf(event, currentOs());
        if (!command) return;
        // On the rows, or on the browser itself (empty space clicked, a name
        // field just put away), every key is the listing's. On the toolbar
        // only the arrows and ⌘A walk the folder, as the Finder's do: Return
        // and Space there press the button, and letters are nobody's.
        const isOnListing =
          target === event.currentTarget ||
          target.closest("[data-file-system-listing]") !== null;
        if (
          !isOnListing &&
          command.type !== "move" &&
          command.type !== "select-all"
        ) {
          return;
        }
        if (runListingCommand(command)) event.preventDefault();
      }}
      onPointerDown={dragArea.onPointerDown}
      onPointerOver={dragArea.onPointerOver}
      ref={rootRef}
      tabIndex={-1}
    >
      <FileSystemIconSpriteSheet />
      {toolbarInto ? (
        <>
          {toolbarInto.lead &&
            createPortal(
              <div
                className={cn(
                  "flex min-w-0 items-center gap-1",
                  toolbarInto.tail === undefined && "flex-1",
                )}
                onContextMenu={(event) => {
                  event.preventDefault();
                }}
              >
                {toolbarInto.tail === undefined
                  ? viewSelect
                  : viewTabs("flex gap-0")}
                {sortMenu}
                {/* With the folder alone, its menu and search follow sort,
                    beside the rows they act on and where search stands
                    beside a file; beside a file, search alone, at the
                    section's end. */}
                {toolbarInto.tail === undefined ? (
                  <>
                    <span className="flex-1" />
                    {searchField("compact")}
                  </>
                ) : (
                  <>
                    {renderHeaderActions ? renderHeaderActions() : null}
                    {searchField("compact")}
                  </>
                )}
              </div>,
              toolbarInto.lead,
            )}
          {toolbarInto.tail &&
            createPortal(
              <div
                className="flex items-center gap-1"
                onContextMenu={(event) => {
                  event.preventDefault();
                }}
              >
                {renderHeaderPrimary ? renderHeaderPrimary() : null}
              </div>,
              toolbarInto.tail,
            )}
        </>
      ) : (
        <div
          className="@container/finder-header relative flex h-12 shrink-0 items-center gap-1.5 border-b bg-muted/40 px-2"
          // The toolbar is not the folder, and nothing is made or acted on here.
          onContextMenu={(event) => {
            event.preventDefault();
          }}
        >
          <div className="flex min-w-0 flex-1 items-center gap-0.5">
            {renderHeaderLead ? renderHeaderLead() : null}
            {headerLayout === "minimal" ? null : (
              <span className="ml-1.5 truncate text-sm font-semibold">
                {currentFolderName}
              </span>
            )}
          </div>
          {renderHeaderPrimary ? renderHeaderPrimary() : null}
          {/* The switcher folds into a select only once the toolbar's own width
            cannot hold the segmented control beside the rest; the folder name
            truncates first. Both are mounted and the container decides. */}
          <div className="flex @md/finder-header:hidden">{viewSelect}</div>
          {viewTabs("hidden gap-0 @md/finder-header:flex")}
          <div className="flex min-w-0 items-center justify-end gap-1.5">
            {sortMenu}
            {renderHeaderActions ? renderHeaderActions() : null}
            {searchField(headerLayout)}
          </div>
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        {currentUnreadable !== null ? (
          currentUnreadable
        ) : isLoadingCurrentFolder && currentEntries.length === 0 ? (
          // Blank while the folder is read, and a ring only once that is slow.
          <div
            className="flex size-full items-center justify-center"
            role="status"
          >
            <Spinner className="size-5 text-muted-foreground" delay={1000} />
          </div>
        ) : currentEntries.length === 0 && emptyState && !isSearching ? (
          <div className="flex size-full flex-col items-center justify-center gap-1 px-6 text-center">
            <p className="text-sm font-medium text-foreground">
              {emptyState.title}
            </p>
            <p className="max-w-72 text-sm text-muted-foreground">
              {emptyState.description}
            </p>
          </div>
        ) : currentEntries.length === 0 &&
          (view !== "columns" || isSearching) ? (
          <FileSystemEmptyState
            action={
              isSearching
                ? {
                    label: "Clear search",
                    onPress: () => {
                      changeSearch("");
                      setIsSearchExpanded(false);
                    },
                  }
                : undefined
            }
            label={
              isSearching
                ? `Nothing here matches “${searchInput.trim()}”.`
                : "This folder is empty"
            }
          />
        ) : view === "icons" ? (
          <FileSystemIconsView {...viewProps} />
        ) : view === "list" ? (
          // Keyed by folder: the folders left open are the folder's own.
          <FileSystemListView key={currentPath} {...viewProps} />
        ) : view === "columns" ? (
          <FileSystemColumnsView {...viewProps} />
        ) : (
          <FileSystemGalleryView {...viewProps} />
        )}
      </div>
      {currentUnreadable === null &&
      !(isLoadingCurrentFolder && currentEntries.length === 0) ? (
        <FileSystemStatusBar
          count={
            view === "list" && isViewShown && listedCount !== null
              ? listedCount
              : (
                  sortedIndex.children.get(
                    view === "columns" && selectedPath !== null
                      ? pathParent(selectedPath)
                      : currentPath,
                  ) ?? []
                ).length
          }
          selected={selectedPaths.length}
        />
      ) : null}
      <Dialog
        onOpenChange={(open) => {
          if (!open) setOpenedFile(null);
        }}
        open={openedFile !== null}
      >
        {openedFile ? (
          <DialogContent
            className={cn(
              "overflow-hidden p-0",
              VIEWER_DIALOG_CLASSNAMES[openedFile.kind],
            )}
            showCloseButton={openedFile.kind === "image"}
          >
            <DialogTitle className="sr-only">{openedFileName}</DialogTitle>
            {openedFile.kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element -- File previews render caller-provided URLs that may be object or presigned URLs.
              <img
                alt={openedFileName}
                className="max-h-[88vh] w-auto max-w-full rounded-2xl object-contain"
                src={openedFile.url}
              />
            ) : (
              // The pooled preview reparents into this host (see the layout
              // effect above), so a viewer the gallery already loaded
              // carries over live instead of remounting behind a loading
              // state.
              <div
                className="flex h-full min-h-0 flex-1 flex-col"
                ref={dialogStageHostRef}
              />
            )}
          </DialogContent>
        ) : null}
        {/* The pooled previews. Rendered inside <Dialog> so the dialog
            variant's close toolbar button keeps its context; each portal's
            container never changes, the container's parent does. */}
        {stagePool.map((path) => {
          const file = index.files.get(path);
          const container = stageContainers.get(path);
          if (!file || !container) return null;
          const isOpenedInDialog =
            openedFile !== null &&
            openedFile.kind !== "image" &&
            openedFile.file.path === path;
          return createPortal(
            <FileSystemGalleryStage
              file={file}
              toolbarActions={
                isOpenedInDialog ? viewerCloseToolbarAction : undefined
              }
              variant={isOpenedInDialog ? "dialog" : "stage"}
            />,
            container,
            path,
          );
        })}
      </Dialog>
    </div>
  );
}
// Dark mode's muted foreground is a translucent white, and each of a view
// glyph's frame and dividers composites on its own, so the crossings paint
// twice and read brighter than the strokes. An opaque white faded as one layer
// paints every pixel once at the same strength.
const VIEW_GLYPH_DIM_CLASSNAME = "dark:text-foreground dark:opacity-60";
// The selected layout in the view switcher stands on the track as the same
// surface as the toolbar's buttons: card fill, the shadow's hairline as its only
// edge, so a choice made here and a button beside it read as one family. The
// tab trigger's own dark border is cleared for that reason; its dark fill is
// already the buttons' `input/30`. The unselected glyphs dim as one layer, as
// above.
const VIEW_TAB_CLASSNAME =
  "h-7 grow-0 px-2.5 text-muted-foreground data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-xs sm:h-7 dark:data-[state=active]:border-transparent dark:not-data-[state=active]:[&_svg]:text-foreground dark:not-data-[state=active]:[&_svg]:opacity-60";
// The surface every framed control on the toolbar stands on: 32px tall, the
// track's height, 8px corners, and the shadow's own hairline as the edge, so
// the sort, the filter, the search, the overflow menu and whatever the host
// adds after them are one family. The hover is restated with `not-disabled:` so
// it replaces the one each primitive (button, select trigger) brings.
export const TOOLBAR_CONTROL_CLASSNAME =
  "h-8 rounded-lg border-0 bg-card shadow-xs not-disabled:hover:bg-accent dark:bg-input/30 dark:not-disabled:hover:bg-input/50";
// An icon-only select in that family: sheds the base min-width to hug icon and
// caret at the toolbar's 32px height, and draws the caret at a hint's size so
// the icon reads as the control and the caret as the note that it opens.
const TOOLBAR_SELECT_TRIGGER_CLASSNAME = cn(
  TOOLBAR_CONTROL_CLASSNAME,
  "min-h-8 w-auto min-w-0 shrink-0 gap-1 bg-none px-1.5 has-[>svg]:px-1.5 dark:border-0 [&>svg:last-child]:size-2.5",
);
// The square, icon-only member of that family.
export const TOOLBAR_ICON_BUTTON_CLASSNAME = cn(
  TOOLBAR_CONTROL_CLASSNAME,
  "flex size-8 shrink-0 items-center justify-center text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
);
// macOS Finder-style toolbar search. At the full layout it sits inline in
// the header's right column; at compact widths it collapses into a ghost
// icon button that opens the input in a popover (a dot marks the button
// while a query keeps filtering the views).
function FileSystemSearchField({
  inputRef,
  isExpanded,
  layout,
  onExpandedChange,
  onValueChange,
  value,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  isExpanded: boolean;
  layout: "compact" | "full" | "minimal";
  onExpandedChange: (isExpanded: boolean) => void;
  onValueChange: (value: string) => void;
  value: string;
}) {
  const isInline = layout === "full";
  React.useEffect(() => {
    if (isExpanded) inputRef.current?.focus();
  }, [inputRef, isExpanded]);
  const input = (
    <div
      className={cn(
        TOOLBAR_CONTROL_CLASSNAME,
        "relative flex min-w-0 flex-1 items-center text-sm text-foreground transition-shadow outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1 focus-within:ring-offset-background",
        isInline && "max-w-56",
      )}
    >
      <Search className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground" />
      <input
        aria-label="Search files"
        className="h-full w-full min-w-0 rounded-[inherit] bg-transparent pr-6 pl-7 outline-none placeholder:text-muted-foreground"
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          if (value) {
            onValueChange("");
          } else {
            onExpandedChange(false);
            event.currentTarget.blur();
          }
        }}
        placeholder="Search"
        ref={inputRef}
        role="searchbox"
        type="text"
        value={value}
      />
      {value ? (
        <button
          aria-label="Clear search"
          className="absolute right-1 flex size-5 items-center justify-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => {
            onValueChange("");
            inputRef.current?.focus();
          }}
          type="button"
        >
          <X className="size-3" />
        </button>
      ) : null}
    </div>
  );
  if (isInline) {
    // A magnifying glass until asked for, the way the Finder's toolbar keeps
    // its search: the field opens in its place, and closes again when the
    // keyboard leaves it with nothing typed.
    if (!isExpanded && !value) {
      return (
        <button
          aria-label="Search"
          className={TOOLBAR_ICON_BUTTON_CLASSNAME}
          onClick={() => onExpandedChange(true)}
          title="Search"
          type="button"
        >
          <Search className="size-4" />
        </button>
      );
    }
    // A fixed basis (not flex-1) keeps the whole toolbar cluster packed
    // against the header's right edge; the input shrinks first when the
    // header tightens.
    return (
      <div
        className="flex w-56 min-w-32 items-center"
        onBlur={(event) => {
          if (
            !value &&
            !(
              event.relatedTarget instanceof Node &&
              event.currentTarget.contains(event.relatedTarget)
            )
          ) {
            onExpandedChange(false);
          }
        }}
      >
        {input}
      </div>
    );
  }
  return (
    <Popover onOpenChange={onExpandedChange} open={isExpanded}>
      <PopoverTrigger asChild>
        {/* Searched, the button says for what, so a folder showing less than
            it has says why at a glance. */}
        {value ? (
          <button
            aria-label={`Search: ${value}`}
            className={cn(
              TOOLBAR_CONTROL_CLASSNAME,
              "flex max-w-32 min-w-0 shrink items-center gap-1.5 bg-primary/10 px-2 text-sm text-primary outline-none not-disabled:hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring dark:bg-primary/15 dark:not-disabled:hover:bg-primary/20",
            )}
            title={`Search: ${value}`}
            type="button"
          >
            <Search className="size-3.5 shrink-0" />
            <span className="truncate">{value}</span>
          </button>
        ) : (
          <button
            aria-label="Search"
            className={TOOLBAR_ICON_BUTTON_CLASSNAME}
            title="Search"
            type="button"
          >
            <Search className="size-4" />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1" sideOffset={6}>
        {input}
      </PopoverContent>
    </Popover>
  );
}
// The toolbar's sort menu, as the sort glyph alone: the order in force is one
// press away, and the folder itself shows it. It also holds what changes
// which rows the folder lists, as the Finder's view options do.
function FileSystemSortMenu({
  group,
  onClosed,
  onGroupChange,
  onKeyChange,
  onShowHiddenFilesChange,
  options,
  showHiddenFiles,
  sort,
}: {
  group: FileSystemGroupKey | null;
  /** Put away, for the keyboard to go back to the listing rather than stay on the button. */
  onClosed: () => void;
  onGroupChange: (group: FileSystemGroupKey | null) => void;
  onKeyChange: (key: FileSystemSortKey) => void;
  onShowHiddenFilesChange: (showHiddenFiles: boolean) => void;
  /** The orders it offers. */
  options: readonly { key: FileSystemSortKey; label: string }[];
  showHiddenFiles: boolean;
  sort: FileSystemSortState;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={group === null ? "Sort by" : "Group by"}
          className={TOOLBAR_SELECT_TRIGGER_CLASSNAME}
          size="sm"
          title={group === null ? "Sort by" : "Group by"}
          type="button"
          variant="outline"
        >
          <ArrowUpDown className="size-4" />
          <ChevronDown className="opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-44"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onClosed();
        }}
      >
        {/* Grouped, the groups are the order, so Sort by goes the way the
            Finder's does; List's column headers still order the rows within
            each group. */}
        {group === null ? (
          <>
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              Sort by
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              onValueChange={(value) => {
                const option = options.find((each) => each.key === value);
                if (option) onKeyChange(option.key);
              }}
              value={sort.key}
            >
              {options.map((option) => (
                <DropdownMenuRadioItem key={option.key} value={option.key}>
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Group by
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          onValueChange={(value) => {
            onGroupChange(
              GROUP_OPTIONS.find((each) => each.key === value)?.key ?? null,
            );
          }}
          value={group ?? "none"}
        >
          <DropdownMenuRadioItem value="none">None</DropdownMenuRadioItem>
          {GROUP_OPTIONS.map((option) => (
            <DropdownMenuRadioItem key={option.key} value={option.key}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        {/* The menu stays open on a toggle: watching the dotfiles arrive or
            leave is the whole point of the item, and a menu that closes to
            show it makes the second thought a second trip. */}
        <DropdownMenuCheckboxItem
          checked={showHiddenFiles}
          onCheckedChange={onShowHiddenFilesChange}
          onSelect={(event) => event.preventDefault()}
        >
          Show hidden files
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
type FileSystemViewProps = {
  /** Pooled paths currently attached to the DOM (reveal instantly). */
  attachedStagePaths: string[];
  besideResizing: boolean;
  besideWidth: number | undefined;
  columnWidth?: number;
  currentPath: string;
  /**
   * Whether a row drags out of the window. The gesture is on the browser
   * itself; a row only has to say it is a thing that drags, and name itself
   * by its path so the gesture can find what was picked up.
   */
  draggable: boolean;
  enabledListColumns: FileSystemListColumn[];
  entries: FileSystemEntry[];
  /** Each row's group, where the rows are grouped: headings go between groups. */
  grouping: Grouping | null;
  index: FileSystemIndex;
  listColumnWidths: Partial<Record<FileSystemListColumn, number>>;
  loadingFolders: Set<string>;
  /** The row a context menu is open on, outlined rather than selected. */
  menuTargetPath: null | string;
  moveFocusWithSelection: boolean;
  onColumnWidthChange?: (columnWidth: number) => void;
  /** A folder opened in place in the list, whose contents are needed now. */
  onExpandFolder: (folderPath: string) => void;
  /** A folder the pointer rests on, whose contents may be wanted next. */
  onFolderHover?: (folderPath: string) => void;
  onItemContextMenu?: (item: FileSystemItem, event: React.MouseEvent) => void;
  onListColumnsChange: (columns: FileSystemListColumn[]) => void;
  onListColumnWidthsChange: (
    widths: Partial<Record<FileSystemListColumn, number>>,
  ) => void;
  /** Where the view says how its rows are walked, for the keys the browser reads. */
  listingNavRef: React.RefObject<ListingNav | null>;
  onOpen: (entry: FileSystemEntry) => void;
  /** Selects the entry alone, or adds to the selection with a gesture. */
  onSelect: (entry: FileSystemEntry | null, gesture?: SelectionGesture) => void;
  /** Selects exactly these, keeping the keyboard on the one it is on when it is among them. */
  onSelectEntries: (entries: readonly FileSystemEntry[]) => void;
  /** Where a box dragged across the rows says what it touches. */
  marquee: MarqueeControl;
  /** How many items the list draws, those in folders opened in place included. */
  onListedCount: (count: number) => void;
  onSortColumnClick: (key: FileSystemSortKey) => void;
  /** Admits a file into the root-owned keep-alive preview pool. */
  poolStagePath: (path: string) => void;
  /** Mounts/unmounts the gallery host element for a pooled path. */
  registerStageHost: (path: string, element: HTMLElement | null) => void;
  /** The row whose name is being typed over, which draws `renderNameField` in place of its name. */
  renamingPath: null | string;
  renderFileStage?: (file: FileSystemFileItem) => React.ReactNode;
  /** The name field for the row being renamed, with the view's own spacing. */
  renderNameField: RenderNameField;
  renderUnreadable?: FileSystemProps["renderUnreadable"];
  /** The label of the folder the browser opened at. */
  rootTitle: string;
  /** What every row's press, click and double-click go through. */
  rowGestures: RowGestures;
  searchQuery: string;
  /** The one of the selection the keyboard is on, the last picked. */
  selectedEntry: FileSystemEntry | null;
  selectedPath: null | string;
  /** Everything selected, the keyboard's one among it. */
  selection: ReadonlySet<string>;
  sort: FileSystemSortState;
  /** The list's open folders per folder on screen, surviving view switches. */
  treeExpansionRef: React.RefObject<Map<string, readonly string[]>>;
  /** The caller's open folders, which take the place of `treeExpansionRef`'s. */
  openFolders?: ReadonlySet<string>;
  onOpenFolderChange?: (path: string, open: boolean) => void;
};
/** How a view's rows are walked by the keys the browser reads (`listingCommandOf`). */
type ListingNav = {
  /** The row the keyboard is on, which type-ahead searches on from. */
  current: FileSystemEntry | null;
  /**
   * Where an arrow goes: a row, with the order a Shift-arrow reaches along
   * (null where it does not reach, as across columns); true for a step the
   * view took itself (a folder opened or closed in place); false for none.
   */
  move: (
    direction: ListingDirection,
  ) =>
    | boolean
    | { entry: FileSystemEntry; order: null | readonly FileSystemEntry[] };
  /** Whether Return renames here; where it does not, it opens. */
  renames: boolean;
  /** The keyboard onto the row the selection landed on, once it is drawn. */
  reveal: (entry: FileSystemEntry) => void;
  /** The rows the keys walk, in order: ⌘A takes them, letters search them. */
  rows: readonly FileSystemEntry[];
};
/** The view on screen walks the rows; the last one drawn holds the keys. */
function useListingNav(
  navRef: React.RefObject<ListingNav | null>,
  nav: ListingNav,
) {
  const ownRef = React.useRef<ListingNav | null>(null);
  React.useLayoutEffect(() => {
    navRef.current = nav;
    ownRef.current = nav;
  });
  // A layout cleanup, so a view leaving lets go before the one replacing it
  // takes the keys, and never after.
  React.useLayoutEffect(
    () => () => {
      if (navRef.current === ownRef.current) navRef.current = null;
    },
    [navRef],
  );
}
type RenderNameField = (
  entry: FileSystemEntry,
  className?: string,
) => React.ReactNode;
/** A row's pointer, handed to the browser's one gesture machine with the order the view draws its rows in. */
type RowGestures = {
  click: (
    entry: FileSystemEntry,
    event: React.MouseEvent,
    order: () => readonly FileSystemEntry[],
  ) => void;
  doubleClick: () => void;
  press: (
    entry: FileSystemEntry,
    event: React.PointerEvent,
    order: () => readonly FileSystemEntry[],
  ) => void;
};
/**
 * The keyboard onto a row by its path: at once when it is drawn, or once it
 * is, as a row scrolled into a virtual window or a column not mounted yet.
 */
function useFocusWhenDrawn<T extends HTMLElement>(
  refs: React.RefObject<Map<string, T>>,
  {
    enabled,
    preventScroll,
  }: {
    /** False while something outside holds the keyboard and walks the rows from there. */
    enabled: boolean;
    /** Whether the view scrolls the row in itself, rather than leaving it to the focus. */
    preventScroll: boolean;
  },
) {
  const pendingRef = React.useRef<null | string>(null);
  React.useEffect(() => {
    const path = pendingRef.current;
    if (!path) return;
    const element = refs.current.get(path);
    if (element) {
      pendingRef.current = null;
      element.focus({ preventScroll });
    }
  });
  return (path: string) => {
    if (!enabled) {
      pendingRef.current = null;
      return;
    }
    const element = refs.current.get(path);
    if (element) {
      pendingRef.current = null;
      element.focus({ preventScroll });
    } else {
      pendingRef.current = path;
    }
  };
}
function calendarDayKey(date: Date) {
  return date.getFullYear() * 10_000 + date.getMonth() * 100 + date.getDate();
}
/**
 * The folders among `loading` that have been loading for a moment: a read
 * that ends sooner never shows as one.
 */
function useSlowLoads(loading: ReadonlySet<string>, ms = LOADER_DELAY_MS) {
  const [slow, setSlow] = React.useState<ReadonlySet<string>>(new Set());
  React.useEffect(() => {
    if (loading.size === 0) return;
    const timeout = window.setTimeout(() => {
      setSlow(new Set(loading));
    }, ms);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [loading, ms]);
  return React.useMemo(
    () => new Set([...slow].filter((path) => loading.has(path))),
    [loading, slow],
  );
}
/**
 * How many things the folder on screen lists, and how many of them are
 * selected, along the bottom as the Finder's status bar says it. In the
 * columns the folder is the column the selection is in; in the list it is
 * every item drawn, those open in place under a folder included.
 */
function FileSystemStatusBar({
  count,
  selected,
}: {
  count: number;
  selected: number;
}) {
  return (
    <div
      className="flex h-6 shrink-0 items-center justify-center border-t px-3 text-xs text-muted-foreground tabular-nums"
      data-file-system-status=""
    >
      <span className="truncate">
        {selected > 0
          ? `${selected} of ${count} selected`
          : `${count} ${count === 1 ? "item" : "items"}`}
      </span>
    </div>
  );
}
function FileSystemEmptyState({
  action,
  label,
}: {
  action?: { label: string; onPress: () => void };
  label: string;
}) {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
      <p className="max-w-80 break-words">{label}</p>
      {action ? (
        <Button onClick={action.onPress} size="sm" variant="outline">
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}
// Returns `value` once it has stopped changing for `delay` ms. Gallery
// navigation scrubs past files quickly; heavy previews (document viewers,
// presigned URL resolution) only kick in for the file the user lands on.
function useSettledValue<T>(value: T, delay: number): T {
  const [settled, setSettled] = React.useState(value);
  React.useEffect(() => {
    if (Object.is(settled, value)) return;
    const timeout = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timeout);
  }, [delay, settled, value]);
  return settled;
}
// Somewhere a keypress belongs to whoever is typing there.
function isEditableTarget(target: HTMLElement) {
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}
/**
 * A name typed over where it sits, the way the Finder edits one: the field
 * opens with the base name selected so typing keeps the extension, Return
 * accepts it, Escape abandons it, and the field losing the keyboard accepts
 * it. What an accept means (an unchanged name is none) is the rename
 * machine's; the field only reports. Every press stays in the field, so the
 * letters and arrows a name is typed with are never read as walking the
 * folder.
 */
function FileSystemNameField({
  className,
  draft,
  inputRef,
  onAccept,
  onCancel,
  readOnly,
}: {
  className?: string;
  /** What the field opens holding. */
  draft: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onAccept: (text: string) => void;
  onCancel: () => void;
  /** While the name is being written, so it can be neither changed nor accepted twice. */
  readOnly: boolean;
}) {
  React.useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const dot = input.value.lastIndexOf(".");
    input.focus();
    input.setSelectionRange(0, dot > 0 ? dot : input.value.length);
  }, [inputRef]);
  return (
    <input
      aria-label="Name"
      // Typed over where the name stood, the way the Finder does it: the
      // row's own font, an opaque box of the Finder's ground over the
      // selection, as wide as the name, and an outline that takes no room,
      // the box bleeding a hair past the name (each caller's margin gives
      // the hair back) so not a letter moves.
      className={cn(
        "field-sizing-content max-w-full min-w-4 shrink rounded-[3px] bg-background px-0.5 py-0 text-foreground ring-1 ring-ring outline-none [font:inherit]",
        className,
      )}
      defaultValue={draft}
      onBlur={(event) => {
        // The window going to another app takes the keyboard from the field
        // and gives it back on return, as the Finder's does; only the
        // keyboard going elsewhere in the window ends the naming.
        if (!document.hasFocus()) return;
        onAccept(event.currentTarget.value);
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          onAccept(event.currentTarget.value);
        } else if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      readOnly={readOnly}
      ref={inputRef}
      type="text"
    />
  );
}
/**
 * The tile an arrow reaches in a grid drawn by the browser's own auto-fill:
 * the next or previous in order across, and up or down by where the tiles
 * actually stand, so the walk follows the rendered grid.
 */
function gridNeighbor({
  current,
  direction,
  entries,
  itemRefs,
}: {
  current: null | string;
  direction: ListingDirection;
  entries: readonly FileSystemEntry[];
  itemRefs: Map<string, HTMLElement>;
}) {
  const currentIndex = entries.findIndex((entry) => entry.path === current);
  if (currentIndex === -1) return entries[0] ?? null;
  if (direction === "left" || direction === "right") {
    return entries[currentIndex + (direction === "left" ? -1 : 1)] ?? null;
  }
  const currentRect = itemRefs
    .get(entries[currentIndex]?.path ?? "")
    ?.getBoundingClientRect();
  if (!currentRect) return null;
  let best: FileSystemEntry | null = null;
  let bestScore = Infinity;
  for (const entry of entries) {
    if (entry.path === current) continue;
    const rect = itemRefs.get(entry.path)?.getBoundingClientRect();
    if (!rect) continue;
    const rowDelta =
      direction === "down"
        ? rect.top - currentRect.top
        : currentRect.top - rect.top;
    if (rowDelta <= 1) continue;
    const score = rowDelta * 1000 + Math.abs(rect.left - currentRect.left);
    if (score < bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  return best;
}
// Icon grid geometry (px at the default 16px root font size). Tiles have a
// fixed height — a 4rem glyph box plus a reserved two-line label — so rows
// share one stride and the grid can window cleanly.
const ICON_GRID_PADDING = 12; // p-3
const ICON_MIN_TILE_WIDTH = 104; // 6.5rem
const ICON_TILE_GAP_X = 4; // gap-x-1
const ICON_TILE_HEIGHT = 102; // h-16 glyph box + gap-1.5 + two text-xs lines
const ICON_TILE_WIDTH = 80; // the glyph box, w-20
const ICON_ROW_GAP = 12; // gap-y-3
const ICON_ROW_STRIDE = ICON_TILE_HEIGHT + ICON_ROW_GAP;
// Grouped, the grid steps in thirds of a row: a heading takes one, a row of
// tiles three.
const ICON_ROW_UNITS = 3;
const ICON_UNIT = ICON_ROW_STRIDE / ICON_ROW_UNITS;
function FileSystemIconsView({
  draggable,
  entries,
  grouping,
  listingNavRef,
  marquee,
  menuTargetPath,
  moveFocusWithSelection,
  onItemContextMenu,
  onOpen,
  onSelect,
  renamingPath,
  renderNameField,
  rowGestures,
  selectedEntry,
  selectedPath,
  selection,
}: FileSystemViewProps) {
  const itemRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const gridRef = React.useRef<HTMLDivElement | null>(null);
  // A tile the keyboard lands on may be outside the virtual window; the
  // selection effect scrolls it in, and the keyboard follows once it mounts.
  const focusTile = useFocusWhenDrawn(itemRefs, {
    enabled: moveFocusWithSelection,
    preventScroll: false,
  });
  useListingNav(listingNavRef, {
    current: selectedEntry,
    move: (direction) => {
      const entry = gridNeighbor({
        current: selectedPath,
        direction,
        entries,
        itemRefs: itemRefs.current,
      });
      return entry ? { entry, order: entries } : false;
    },
    renames: true,
    reveal: (entry) => {
      focusTile(entry.path);
    },
    rows: entries,
  });
  // The column count mirrors what `repeat(auto-fill, minmax(6.5rem, 1fr))`
  // produces (the CSS owns the actual layout) so item indices map to grid
  // rows — the windowing below depends on that mapping. It stays null until
  // the first client measure; server markup must not guess.
  const [columnCount, setColumnCount] = React.useState<null | number>(null);
  React.useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const available = viewport.clientWidth - ICON_GRID_PADDING * 2;
      setColumnCount(
        Math.max(
          1,
          Math.floor(
            (available + ICON_TILE_GAP_X) /
              (ICON_MIN_TILE_WIDTH + ICON_TILE_GAP_X),
          ),
        ),
      );
    };
    const observer = new ResizeObserver(update);
    update();
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);
  const resolvedColumnCount = columnCount ?? 1;
  const rowCount = Math.ceil(entries.length / resolvedColumnCount);
  // Grouped, each group stands under a heading with a rule over it, its
  // tiles wrapping onto as many rows as they take, where the Finder's sit in
  // one row that scrolls sideways until Show All. The grid is laid out in
  // thirds of a row of tiles, a heading taking one and a row three, so the
  // windowing still steps evenly. A folder of one group has no heading.
  const groupedLines = (() => {
    if (!grouping) return null;
    const sections: Array<{ entries: FileSystemEntry[]; label: string }> = [];
    for (const entry of entries) {
      const label = grouping(entry).label;
      const section = sections.at(-1);
      if (section?.label === label) {
        section.entries.push(entry);
      } else {
        sections.push({ entries: [entry], label });
      }
    }
    if (sections.length < 2) return null;
    const lines: Array<
      | { heading: string; isFirst: boolean; unit: number }
      | { row: FileSystemEntry[]; unit: number }
    > = [];
    let unit = 0;
    for (const [sectionIndex, section] of sections.entries()) {
      lines.push({ heading: section.label, isFirst: sectionIndex === 0, unit });
      unit += 1;
      for (let at = 0; at < section.entries.length; at += resolvedColumnCount) {
        lines.push({
          row: section.entries.slice(at, at + resolvedColumnCount),
          unit,
        });
        unit += ICON_ROW_UNITS;
      }
    }
    return { lines, unitCount: unit };
  })();
  const { end, start } = useVirtualWindow({
    count: groupedLines ? groupedLines.unitCount : rowCount,
    itemStride: groupedLines ? ICON_UNIT : ICON_ROW_STRIDE,
    leadingPx: ICON_GRID_PADDING,
    overscan: groupedLines ? ICON_ROW_UNITS * 4 : 4,
    viewportRef,
  });
  const visibleLines = groupedLines?.lines.filter(
    (line) =>
      line.unit + ("row" in line ? ICON_ROW_UNITS : 1) > start &&
      line.unit < end,
  );
  const visibleEntries = visibleLines
    ? visibleLines.flatMap((line) => ("row" in line ? line.row : []))
    : entries.slice(start * resolvedColumnCount, end * resolvedColumnCount);
  // A box dragged across the grid takes every tile whose glyph or name it
  // reaches, by where the tiles stand rather than which are drawn.
  const marqueeDrag = useMarquee({
    containerRef: gridRef,
    hitTest: (box) => {
      const width = gridRef.current?.offsetWidth ?? 0;
      const rows = groupedLines
        ? groupedLines.lines.flatMap((line) =>
            "row" in line
              ? [{ entries: line.row, top: line.unit * ICON_UNIT }]
              : [],
          )
        : Array.from({ length: rowCount }, (_, row) => ({
            entries: entries.slice(
              row * resolvedColumnCount,
              (row + 1) * resolvedColumnCount,
            ),
            top: row * ICON_ROW_STRIDE,
          }));
      return rows.flatMap(({ entries: rowEntries, top }) =>
        top <= box.y + box.height && box.y <= top + ICON_TILE_HEIGHT
          ? rowEntries.flatMap((entry, column) => {
              const span = gridTileSpan({
                column,
                columnCount: resolvedColumnCount,
                gap: ICON_TILE_GAP_X,
                tileWidth: ICON_TILE_WIDTH,
                width,
              });
              return overlaps(box, {
                ...span,
                height: ICON_TILE_HEIGHT,
                y: top,
              })
                ? [entry.path]
                : [];
            })
          : [],
      );
    },
    marquee,
    shape: "box",
    viewportRef,
  });
  // Selection can land outside the window (view switches, shrinking results);
  // bring its row back into the viewport so the tile mounts and is focusable.
  React.useLayoutEffect(() => {
    if (!selectedPath) return;
    const entryIndex = entries.findIndex(
      (entry) => entry.path === selectedPath,
    );
    if (entryIndex === -1) return;
    const groupedRow = groupedLines?.lines.find(
      (line) =>
        "row" in line && line.row.some((entry) => entry.path === selectedPath),
    );
    scrollIndexIntoView({
      index: groupedRow
        ? groupedRow.unit
        : Math.floor(entryIndex / resolvedColumnCount),
      itemSize: ICON_TILE_HEIGHT,
      itemStride: groupedRow ? ICON_UNIT : ICON_ROW_STRIDE,
      leadingPx: ICON_GRID_PADDING,
      viewport: viewportRef.current,
    });
  }, [entries, groupedLines, resolvedColumnCount, selectedPath]);
  // Roving tabindex: the grid is a single tab stop (the selected tile when
  // rendered, else the first rendered one), so Shift+Tab returns to the
  // toolbar like in the list view.
  const tabStopPath = visibleEntries.some(
    (entry) => entry.path === selectedPath,
  )
    ? selectedPath
    : (visibleEntries[0]?.path ?? null);
  const renderTile = (entry: FileSystemEntry) => {
    const isSelected = selection.has(entry.path);
    const tileClassName =
      "group flex h-[6.375rem] flex-col items-center gap-1.5 outline-none";
    const glyph = (
      <span
        className={cn(
          "flex h-16 w-20 shrink-0 items-center justify-center rounded-lg p-1 group-focus-visible:ring-2 group-focus-visible:ring-ring",
          isSelected && "bg-accent",
          entry.path === menuTargetPath && "ring-2 ring-brand-500",
        )}
      >
        {entry.kind === "folder" ? (
          <FileSystemFolderGlyph
            className="h-13 w-auto drop-shadow-sm"
            src={entry.glyphSrc}
          />
        ) : (
          <FittedFileVisual
            // The glyph box: as tall as it is, and as wide as a
            // landscape thumbnail is let fill it.
            box={{ height: 4, width: 4.75 }}
            className="rounded-sm shadow-xs"
            file={entry}
            pageClassName="w-12"
          />
        )}
      </span>
    );
    if (entry.path === renamingPath) {
      // The tile keeps its place in the grid while its name is typed
      // over, so nothing around it moves.
      return (
        <div className={tileClassName} key={entry.path}>
          {glyph}
          {/* In the selected name's own pill, so the field sits where
                      the name did. */}
          <span
            className={cn(
              "flex max-w-full justify-center rounded-sm px-1.5 py-px text-xs leading-tight",
              SELECTED_ROW_CLASSNAME,
            )}
          >
            {renderNameField(entry, "-mx-0.5 text-center")}
          </span>
        </div>
      );
    }
    return (
      <button
        aria-selected={isSelected}
        className={tileClassName}
        data-file-system-item={entry.path}
        draggable={draggable}
        key={entry.path}
        onClick={(event) => {
          rowGestures.click(entry, event, () => entries);
        }}
        // Right-clicking marks what the menu acts on without moving
        // the selection, the way the Finder does.
        onContextMenu={(event) => {
          onItemContextMenu?.(entry, event);
        }}
        onDoubleClick={() => {
          rowGestures.doubleClick();
          onOpen(entry);
        }}
        onPointerDown={(event) => {
          rowGestures.press(entry, event, () => entries);
        }}
        ref={(element) => {
          if (element) {
            itemRefs.current.set(entry.path, element);
          } else {
            itemRefs.current.delete(entry.path);
          }
        }}
        role="option"
        tabIndex={entry.path === tabStopPath ? 0 : -1}
        type="button"
      >
        {glyph}
        <span
          className={cn(
            "max-w-full rounded-sm px-1.5 py-px text-center text-xs leading-tight break-words",
            isSelected ? SELECTED_ROW_CLASSNAME : "text-foreground",
          )}
          data-file-system-name=""
        >
          <span className="line-clamp-2">{shownName(entry)}</span>
        </span>
      </button>
    );
  };
  return (
    <InlineScrollArea2
      orientation="vertical"
      overlay={marqueeDrag.overlay}
      viewportClassName="p-3"
      viewportProps={{
        // A click past the tiles lets go of the selection, as in the Finder;
        // one with ⌘ or Shift held keeps it. One ending a dragged box is the
        // box's.
        onClick: (event) => {
          if (
            !marqueeDrag.claimClick() &&
            selectionModeOf(event) === null &&
            event.target instanceof HTMLElement &&
            !event.target.closest("[data-file-system-item], input")
          ) {
            onSelect(null);
          }
        },
        // A press past the tiles that drags draws a box, which starts from
        // nothing unless ⌘ or Shift is held.
        onPointerDown: (event) => {
          if (
            event.target instanceof HTMLElement &&
            !event.target.closest("[data-file-system-item], input")
          ) {
            marqueeDrag.start(event, {
              onBegin: () => {
                if (selectionModeOf(event) === null) onSelect(null);
              },
            });
          }
        },
      }}
      viewportRef={viewportRef}
    >
      {groupedLines && visibleLines ? (
        <div
          className="relative"
          ref={gridRef}
          style={{
            height: groupedLines.unitCount * ICON_UNIT - ICON_ROW_GAP,
          }}
        >
          <div
            aria-label="Files"
            className="absolute inset-0"
            data-file-system-listing=""
            role="listbox"
          >
            {visibleLines.map((line) =>
              "heading" in line ? (
                <div
                  aria-hidden
                  className={cn(
                    "absolute inset-x-0 flex items-end px-1 pb-2 text-sm font-semibold text-muted-foreground",
                    !line.isFirst && "border-t border-border/60",
                  )}
                  key={`heading:${line.heading}`}
                  style={{ height: ICON_UNIT, top: line.unit * ICON_UNIT }}
                >
                  <span className="truncate">{line.heading}</span>
                </div>
              ) : (
                <div
                  className="absolute inset-x-0 grid gap-x-1"
                  key={`row:${line.row[0]?.path ?? line.unit}`}
                  style={{
                    gridTemplateColumns:
                      "repeat(auto-fill, minmax(6.5rem, 1fr))",
                    top: line.unit * ICON_UNIT,
                  }}
                >
                  {line.row.map(renderTile)}
                </div>
              ),
            )}
          </div>
        </div>
      ) : (
        <div
          className="relative"
          ref={gridRef}
          // The scroll-height spacer needs the measured column count; until
          // then the absolutely positioned grid alone defines the scrollable
          // overflow, so the server-rendered frame doesn't flash an
          // oversized scroll range.
          style={{
            height:
              columnCount !== null && rowCount
                ? rowCount * ICON_ROW_STRIDE - ICON_ROW_GAP
                : undefined,
          }}
        >
          <div
            aria-label="Files"
            className="absolute inset-x-0 grid gap-x-1 gap-y-3"
            data-file-system-listing=""
            role="listbox"
            // The auto-fill expression produces the same column count the
            // ResizeObserver measures (the measurement exists only for the
            // windowing math), so the server-rendered first paint is already
            // a grid instead of flashing a single stacked column until the
            // first client measure.
            style={{
              gridTemplateColumns: "repeat(auto-fill, minmax(6.5rem, 1fr))",
              top: start * ICON_ROW_STRIDE,
            }}
          >
            {visibleEntries.map(renderTile)}
          </div>
        </div>
      )}
    </InlineScrollArea2>
  );
}
// List geometry (px at the default 16px root font size).
const LIST_ROW_HEIGHT = 24; // h-6
// How far a folder's contents sit in from the folder, per level.
const LIST_INDENT = 16;
// The Name column's floor: past it the other columns leave, last first,
// rather than squeezing the names out.
const LIST_NAME_MIN_WIDTH = 200;
// Room kept clear on the right for the overlaid scrollbar.
const LIST_EDGE_PADDING = 24;
// How narrow and how wide a column beside Name can be dragged.
const LIST_COLUMN_WIDTH_MIN = 64;
const LIST_COLUMN_WIDTH_MAX = 480;
// The selection: the app's accent, solid, with the row's text in white over
// it, the way the Finder fills one with the system's.
export const SELECTED_ROW_CLASSNAME = "bg-brand-500 text-white";
// What reads as secondary on a row (dates, sizes, the chevron), over the
// selection or off it.
const SELECTED_ROW_SECONDARY_CLASSNAME = "text-white/80";
// What a context menu is open on: outlined, not selected.
export const MENU_TARGET_CLASSNAME = "ring-2 ring-brand-500 ring-inset";
const LIST_COLUMNS: Array<{
  align: "end" | "start";
  /** Cut to fit beside a file: its short label and short dates, as wide as `shortWidth`, with no edge to drag. */
  compact?: boolean;
  key: FileSystemListColumn;
  label: string;
  shortLabel: string;
  shortWidth: number;
  /** In px, as the Name column's floor is. */
  width: number;
}> = [
  {
    align: "start",
    key: "updatedAt",
    label: "Date Modified",
    shortLabel: "Modified",
    shortWidth: 88,
    width: 176,
  },
  {
    align: "start",
    key: "createdAt",
    label: "Date Created",
    shortLabel: "Created",
    shortWidth: 88,
    width: 176,
  },
  {
    align: "end",
    key: "size",
    label: "Size",
    shortLabel: "Size",
    shortWidth: 72,
    width: 88,
  },
  {
    align: "start",
    key: "kind",
    label: "Kind",
    shortLabel: "Kind",
    shortWidth: 96,
    width: 136,
  },
];
const DEFAULT_LIST_COLUMNS: FileSystemListColumn[] = [
  "updatedAt",
  "size",
  "kind",
];
// Alternate rows tinted, the way the Finder's list is, drawn as the
// background of the rows' whole height so the stripes run on past the last
// row and never move while the rows above them are swapped in and out.
const LIST_STRIPES: React.CSSProperties = {
  backgroundImage: `linear-gradient(to bottom, transparent ${LIST_ROW_HEIGHT}px, color-mix(in oklab, var(--color-foreground) 3.5%, transparent) ${LIST_ROW_HEIGHT}px)`,
  backgroundSize: `100% ${LIST_ROW_HEIGHT * 2}px`,
};
// A date the way the Finder's list writes one: today and yesterday by name.
function formatListDate(value: string | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const day =
    calendarDayKey(date) === calendarDayKey(today)
      ? "Today"
      : calendarDayKey(date) === calendarDayKey(yesterday)
        ? "Yesterday"
        : null;
  if (!day) return formatTimestamp(value) ?? "--";
  return `${day} at ${TIME_FORMAT.format(date)}`;
}
// A date short enough for the narrow column beside a file, the way the
// Finder shortens one as its column narrows: today by its time, yesterday by
// name, this year by its month and day, and earlier years in figures.
const SHORT_DAY_FORMAT = new Intl.DateTimeFormat(displayLocale, {
  day: "numeric",
  month: "short",
});
const FIGURES_DAY_FORMAT = new Intl.DateTimeFormat(displayLocale, {
  day: "numeric",
  month: "numeric",
  year: "2-digit",
});
function formatShortListDate(value: string | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (calendarDayKey(date) === calendarDayKey(today)) {
    return TIME_FORMAT.format(date);
  }
  if (calendarDayKey(date) === calendarDayKey(yesterday)) {
    return "Yesterday";
  }
  return date.getFullYear() === today.getFullYear()
    ? SHORT_DAY_FORMAT.format(date)
    : FIGURES_DAY_FORMAT.format(date);
}
function listCellText(
  entry: FileSystemEntry,
  column: FileSystemListColumn,
  { short = false } = {},
) {
  const formatDate = short ? formatShortListDate : formatListDate;
  switch (column) {
    case "createdAt": {
      return formatDate(entry.createdAt);
    }
    case "kind": {
      return entryKindLabel(entry);
    }
    case "size": {
      // A folder's size is not known without walking it, so the Finder
      // leaves the cell empty-handed rather than guessing.
      return entry.kind === "file"
        ? (formatByteSize(entry.size) ?? "--")
        : "--";
    }
    case "updatedAt": {
      return formatDate(entry.updatedAt);
    }
  }
}
// One sortable column header for the list view; the active column shows the
// direction chevron on its right.
function FileSystemListColumnHeader({
  align = "start",
  className,
  label,
  onClick,
  sort,
  sortKey,
  width,
}: {
  align?: "end" | "start";
  className?: string;
  label: string;
  onClick: (key: FileSystemSortKey) => void;
  sort: FileSystemSortState;
  sortKey: FileSystemSortKey;
  width?: number;
}) {
  const isActive = sort.key === sortKey;
  return (
    <button
      className={cn(
        "flex h-full min-w-0 items-center gap-0.5 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        align === "end" && "flex-row-reverse",
        isActive && "text-foreground",
        className,
      )}
      onClick={() => onClick(sortKey)}
      style={width === undefined ? undefined : { width }}
      type="button"
    >
      <span className="truncate">{label}</span>
      {isActive ? (
        sort.direction === "asc" ? (
          <ArrowUp01Glyph className="size-3 shrink-0" />
        ) : (
          <ArrowDown01Glyph className="size-3 shrink-0" />
        )
      ) : null}
    </button>
  );
}
/**
 * The list's header: a label per column that sorts by it, and on a right
 * click the columns to show, the way the Finder's header offers them.
 */
function FileSystemListHeader({
  columns,
  enabledColumns,
  nameLabel = "Name",
  onColumnsChange,
  onColumnWidthsChange,
  onSortColumnClick,
  sort,
}: {
  columns: typeof LIST_COLUMNS;
  enabledColumns: readonly FileSystemListColumn[];
  /** What the Name column's header says: the group scrolled to, as the Finder's does, where the rows are grouped. */
  nameLabel?: string;
  onColumnsChange: (columns: FileSystemListColumn[]) => void;
  onColumnWidthsChange: (
    widths: Partial<Record<FileSystemListColumn, number>>,
  ) => void;
  onSortColumnClick: (key: FileSystemSortKey) => void;
  sort: FileSystemSortState;
}) {
  const clampColumnWidth = (width: number) =>
    Math.round(
      Math.min(LIST_COLUMN_WIDTH_MAX, Math.max(LIST_COLUMN_WIDTH_MIN, width)),
    );
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="flex h-7 shrink-0 items-stretch border-b px-3 text-xs font-medium text-muted-foreground select-none">
          <FileSystemListColumnHeader
            className="flex-1 pl-5.5"
            label={nameLabel}
            onClick={onSortColumnClick}
            sort={sort}
            sortKey="name"
          />
          {columns.map((column, columnIndex) => {
            const previous = columns[columnIndex - 1];
            return (
              <div
                className="relative shrink-0 border-l border-border/60"
                key={column.key}
                style={{ width: column.width }}
              >
                <FileSystemListColumnHeader
                  align={column.align}
                  className="w-full px-2"
                  label={column.compact ? column.shortLabel : column.label}
                  onClick={onSortColumnClick}
                  sort={sort}
                  sortKey={column.key}
                />
                {/* The divider at the column's left edge. The columns are
                    laid out from the right, Name taking what is left, so
                    the divider trades width between the two columns it
                    separates and the rest stay put: dragged left, the
                    column before it narrows and truncates, the way the
                    Finder's does. Next to Name, only this column moves. */}
                {column.compact ? null : (
                  <ResizeHandle
                    className="left-0 -translate-x-1/2"
                    getWidth={() => column.width}
                    grows="left"
                    // Back to their defaults, which an unset width reads as.
                    onReset={() => {
                      onColumnWidthsChange({
                        [column.key]: undefined,
                        ...(previous && { [previous.key]: undefined }),
                      });
                    }}
                    onResize={(width) => {
                      if (!previous) {
                        onColumnWidthsChange({
                          [column.key]: clampColumnWidth(width),
                        });
                        return;
                      }
                      // Both held within the bounds, so the pair's total
                      // never changes and the divider stops where either
                      // one would.
                      const total = column.width + previous.width;
                      const own = Math.min(
                        total - LIST_COLUMN_WIDTH_MIN,
                        Math.max(
                          total - LIST_COLUMN_WIDTH_MAX,
                          clampColumnWidth(width),
                        ),
                      );
                      onColumnWidthsChange({
                        [column.key]: own,
                        [previous.key]: total - own,
                      });
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-44">
        {LIST_COLUMNS.map((column) => (
          <ContextMenuCheckboxItem
            checked={enabledColumns.includes(column.key)}
            key={column.key}
            onCheckedChange={(checked) => {
              onColumnsChange(
                LIST_COLUMNS.map(({ key }) => key).filter((key) =>
                  key === column.key ? checked : enabledColumns.includes(key),
                ),
              );
            }}
          >
            {column.label}
          </ContextMenuCheckboxItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}
/**
 * The Finder's list: a row per item, folders opening in place under a
 * disclosure chevron in the margin, so every icon at one depth lines up
 * whether or not it is a folder. The chevron only opens and closes; the row
 * is what selects, and a double-click is what goes into a folder. Rows are
 * in the active sort with folders among the files, the way the Finder keeps
 * them, and only those in view are drawn.
 */
function FileSystemListView({
  besideResizing,
  besideWidth,
  currentPath,
  draggable,
  enabledListColumns,
  grouping,
  index,
  listColumnWidths,
  loadingFolders,
  marquee,
  menuTargetPath,
  moveFocusWithSelection,
  onExpandFolder,
  onListedCount,
  onFolderHover,
  onItemContextMenu,
  onListColumnsChange,
  listingNavRef,
  onListColumnWidthsChange,
  onOpen,
  onSelect,
  onSelectEntries,
  onSortColumnClick,
  renamingPath,
  renderNameField,
  renderUnreadable,
  rowGestures,
  searchQuery,
  selectedPath,
  selection,
  sort,
  treeExpansionRef,
  openFolders,
  onOpenFolderChange,
}: FileSystemViewProps) {
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const rowRefs = React.useRef(new Map<string, HTMLDivElement>());
  const focusRow = useFocusWhenDrawn(rowRefs, {
    enabled: moveFocusWithSelection,
    preventScroll: true,
  });
  // The folders left open here, kept by the browser per folder so walking
  // away and back, or to another layout and back, finds them open again.
  const [ownExpanded, setExpanded] = React.useState<ReadonlySet<string>>(
    () => new Set(treeExpansionRef.current.get(currentPath) ?? []),
  );
  const expanded = openFolders ?? ownExpanded;
  const setExpandedFolders = (next: ReadonlySet<string>) => {
    setExpanded(next);
    treeExpansionRef.current.set(currentPath, [...next]);
  };
  // A search shows every match wherever it is, so every folder with one in
  // it stands open while it is on.
  const isRevealing = searchQuery !== "";
  // The rows on screen, in order. A folder opened whose contents are still
  // being read shows nothing under it at first, as the Finder's does, so a
  // quick read (or an empty folder) moves no row; only a read slow enough to
  // be seen waiting holds a placeholder row for them.
  const slowFolders = useSlowLoads(loadingFolders);
  // Grouped, the folder's own rows stand under a heading for each group
  // after the first, two rows tall with the name in the lower one, the way
  // the Finder spaces them; the first group's name is in the header. A
  // folder of one group has no headings at all. What a folder opened in
  // place holds goes with the folder, in its group.
  const topGroups = grouping
    ? new Set(
        (index.children.get(currentPath) ?? []).map(
          (entry) => grouping(entry).label,
        ),
      )
    : null;
  const isGrouped = topGroups !== null && topGroups.size > 1;
  const rows = React.useMemo(() => {
    const visibleRows: Array<
      | { depth: number; entry: FileSystemEntry; group?: string }
      | { depth: number; entry: null; group: string; heading: "gap" | "name" }
      | { depth: number; entry: null; loadingPath: string }
      | { depth: number; entry: null; note: React.ReactNode; notePath: string }
    > = [];
    let lastGroup: null | string = null;
    const walk = (folderPath: string, depth: number) => {
      for (const entry of index.children.get(folderPath) ?? []) {
        const group =
          depth === 0 && grouping ? grouping(entry).label : undefined;
        if (group !== undefined) {
          if (isGrouped && lastGroup !== null && group !== lastGroup) {
            visibleRows.push({ depth, entry: null, group, heading: "gap" });
            visibleRows.push({ depth, entry: null, group, heading: "name" });
          }
          lastGroup = group;
        }
        visibleRows.push({ depth, entry, ...(group ? { group } : {}) });
        if (
          entry.kind === "folder" &&
          (isRevealing || expanded.has(entry.path))
        ) {
          // A folder that cannot be listed says so in a line of its own,
          // where its contents would be.
          const note = index.children.get(entry.path)?.length
            ? null
            : (renderUnreadable?.(entry.path, "inline") ?? null);
          if (note !== null) {
            visibleRows.push({
              depth: depth + 1,
              entry: null,
              note,
              notePath: entry.path,
            });
          } else if (
            slowFolders.has(entry.path) &&
            !index.children.get(entry.path)?.length
          ) {
            visibleRows.push({
              depth: depth + 1,
              entry: null,
              loadingPath: entry.path,
            });
          } else {
            walk(entry.path, depth + 1);
          }
        }
      }
    };
    walk(currentPath, 0);
    return visibleRows;
  }, [
    currentPath,
    expanded,
    grouping,
    index,
    isGrouped,
    isRevealing,
    renderUnreadable,
    slowFolders,
  ]);
  // The row at the top of the list, whose group the Name column's header
  // names while the rows are grouped.
  const [topRow, setTopRow] = React.useState(0);
  const groupAtTop = (() => {
    if (!grouping) return undefined;
    for (let at = Math.min(topRow, rows.length - 1); at >= 0; at -= 1) {
      const row = rows[at];
      if (row && "group" in row && row.group !== undefined) return row.group;
    }
    return undefined;
  })();
  // The rows that are items, which is what the keyboard walks.
  const entryRows = rows.filter(
    (row): row is { depth: number; entry: FileSystemEntry } =>
      row.entry !== null,
  );
  const rowEntries = entryRows.map((row) => row.entry);
  React.useEffect(() => {
    onListedCount(rowEntries.length);
  }, [onListedCount, rowEntries.length]);
  // A folder drawn open that was opened somewhere else (another window,
  // another folder walked through) has its contents read as it is drawn.
  const unreadOpen = rowEntries
    .filter(
      (entry) =>
        entry.kind === "folder" &&
        expanded.has(entry.path) &&
        !index.children.get(entry.path)?.length,
    )
    .map((entry) => entry.path)
    .join("\n");
  React.useEffect(() => {
    for (const path of unreadOpen.split("\n").filter(Boolean)) {
      onExpandFolder(path);
    }
  }, [onExpandFolder, unreadOpen]);
  const toggleFolder = (folder: FolderEntry, open: boolean) => {
    if (open === expanded.has(folder.path)) return;
    const next = new Set(expanded);
    onOpenFolderChange?.(folder.path, open);
    if (open) {
      next.add(folder.path);
      onExpandFolder(folder.path);
    } else {
      next.delete(folder.path);
      // A selection closed out of sight is let go of rather than kept where
      // nothing shows it.
      const isInside = (path: string) =>
        path.startsWith(folder.path) && path !== folder.path;
      if ([...selection].some(isInside)) {
        onSelectEntries(
          rowEntries.filter(
            (entry) => selection.has(entry.path) && !isInside(entry.path),
          ),
        );
      }
    }
    setExpandedFolders(next);
  };
  // Measured so the columns that do not fit leave rather than crowding the
  // names out.
  const [width, setWidth] = React.useState<null | number>(null);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  React.useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) =>
      setWidth(entries[0]?.contentRect.width ?? null),
    );
    setWidth(root.clientWidth);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);
  // Beside a file the list never scrolls sideways: of the columns turned on,
  // it keeps the name and the one it is sorted by first (Date Modified for
  // the name), cut short to fit, and more of the others as the folder is
  // dragged wider. While the folder slides in or out it keeps the layout of
  // its full width, drawn at that width and cut off at the folder's edge, so
  // the columns go under the file and come back out from under it, and the
  // cut layout takes over once the folder stands at its width beside the
  // file. A drag of that width is never a slide, even on a frame where the
  // measured width trails it.
  const [wideWidth, setWideWidth] = React.useState<null | number>(null);
  if (besideWidth === undefined && width !== null && width !== wideWidth) {
    setWideWidth(width);
  }
  const isBesideNarrow =
    besideWidth !== undefined &&
    width !== null &&
    (besideResizing || width <= besideWidth + 2);
  const heldWidth =
    besideWidth !== undefined &&
    !isBesideNarrow &&
    width !== null &&
    wideWidth !== null &&
    wideWidth > width
      ? wideWidth
      : null;
  const layoutWidth = heldWidth ?? width;
  const columns = (() => {
    const shown = LIST_COLUMNS.filter((column) =>
      enabledListColumns.includes(column.key),
    ).map((column) => ({
      ...column,
      width: listColumnWidths[column.key] ?? column.width,
    }));
    if (layoutWidth === null) return shown;
    const keptKey =
      sort.key === "name" || sort.key === "openedAt" ? "updatedAt" : sort.key;
    const kept = isBesideNarrow
      ? shown.find((column) => column.key === keptKey)
      : undefined;
    const ordered = kept
      ? [kept, ...shown.filter((column) => column !== kept)]
      : shown;
    let room = layoutWidth - LIST_EDGE_PADDING - LIST_NAME_MIN_WIDTH;
    const fitted = ordered.filter((column) => {
      room -= column.width;
      return room >= 0;
    });
    const first = ordered[0];
    return isBesideNarrow && first && fitted.length === 0
      ? [{ ...first, compact: true, width: first.shortWidth }]
      : fitted;
  })();
  const { end, start } = useVirtualWindow({
    count: rows.length,
    itemStride: LIST_ROW_HEIGHT,
    overscan: 12,
    viewportRef,
  });
  // A drag up or down the list takes the run of rows it passes, those in
  // folders opened in place included.
  const rowsRef = React.useRef<HTMLDivElement | null>(null);
  const marqueeDrag = useMarquee({
    containerRef: rowsRef,
    hitTest: (_, { from, to }) =>
      runHits({
        count: rows.length,
        from: from.y,
        stride: LIST_ROW_HEIGHT,
        to: to.y,
      }).flatMap((at) => {
        const entry = rows[at]?.entry;
        return entry ? [entry.path] : [];
      }),
    marquee,
    shape: "run",
    viewportRef,
  });
  // A press that began a run on a row's own blank space, which is the run's
  // and not a drag of the row out of the window.
  const runFromRowRef = React.useRef(false);
  const selectedRowIndex = rows.findIndex(
    (row) => row.entry?.path === selectedPath,
  );
  const selectedEntryIndex = entryRows.findIndex(
    (row) => row.entry.path === selectedPath,
  );
  // Keyboard moves can land on a row outside the drawn window; bring it into
  // view so it mounts and can take the keyboard. Only when the selection
  // moves: a folder opened or closed above a selection scrolled out of view
  // shifts its row, and following it would pull the list out from under the
  // pointer that opened the folder.
  const scrolledToRef = React.useRef<null | string>(null);
  React.useLayoutEffect(() => {
    if (scrolledToRef.current === selectedPath) return;
    // A selection whose row is not listed yet, as one the browser opened on
    // before its folder was read, is scrolled to once the row arrives.
    if (selectedRowIndex === -1) return;
    scrolledToRef.current = selectedPath;
    scrollIndexIntoView({
      index: selectedRowIndex,
      itemSize: LIST_ROW_HEIGHT,
      itemStride: LIST_ROW_HEIGHT,
      viewport: viewportRef.current,
    });
  }, [selectedPath, selectedRowIndex]);
  // Up and down walk the rows as drawn; right opens a folder in place and
  // left closes it, or goes to the folder holding the row.
  useListingNav(listingNavRef, {
    current: entryRows[selectedEntryIndex]?.entry ?? null,
    move: (direction) => {
      const selectedRow = entryRows[selectedEntryIndex];
      const first = entryRows[0]?.entry;
      if (!selectedRow) {
        return first ? { entry: first, order: null } : true;
      }
      if (direction === "up" || direction === "down") {
        const next =
          entryRows[selectedEntryIndex + (direction === "up" ? -1 : 1)]?.entry;
        return next ? { entry: next, order: rowEntries } : true;
      }
      const { depth, entry } = selectedRow;
      if (direction === "right") {
        if (entry.kind === "folder") toggleFolder(entry, true);
        return true;
      }
      if (entry.kind === "folder" && expanded.has(entry.path) && !isRevealing) {
        toggleFolder(entry, false);
        return true;
      }
      const parent = depth > 0 ? index.folders.get(entry.parentPath) : null;
      return parent ? { entry: parent, order: null } : true;
    },
    renames: true,
    reveal: (entry) => {
      focusRow(entry.path);
    },
    rows: rowEntries,
  });
  // The rows' single tab stop: the selected row when it is drawn, else the
  // first drawn one.
  const tabStopPath =
    selectedRowIndex >= start && selectedRowIndex < end
      ? selectedPath
      : (rows.slice(start, end).find((row) => row.entry)?.entry?.path ?? null);
  return (
    <div
      className={cn("size-full", heldWidth !== null && "overflow-hidden")}
      ref={rootRef}
    >
      <div
        className="flex h-full flex-col"
        style={heldWidth === null ? {} : { width: heldWidth }}
      >
        <FileSystemListHeader
          columns={columns}
          enabledColumns={enabledListColumns}
          onColumnsChange={onListColumnsChange}
          onColumnWidthsChange={(widths) => {
            onListColumnWidthsChange({ ...listColumnWidths, ...widths });
          }}
          {...(groupAtTop === undefined ? {} : { nameLabel: groupAtTop })}
          onSortColumnClick={onSortColumnClick}
          sort={sort}
        />
        {rows.length === 0 ? (
          <FileSystemEmptyState label="This folder is empty" />
        ) : (
          <InlineScrollArea2
            className="min-h-0 flex-1"
            orientation="vertical"
            overlay={marqueeDrag.overlay}
            viewportProps={{
              "aria-label": "Files",
              // A press past the last row lets go of the selection, as in the
              // Finder; one with ⌘ or Shift held keeps it. Dragged up, it
              // selects the run of rows from the last to the pointer.
              onPointerDown: (event) => {
                if (
                  event.button !== 0 ||
                  !(event.target instanceof HTMLElement) ||
                  event.target.closest('[role="option"]')
                ) {
                  return;
                }
                const isPlain = selectionModeOf(event) === null;
                if (isPlain) onSelect(null);
                marqueeDrag.start(event);
              },
              onScroll: (event) => {
                setTopRow(
                  Math.floor(event.currentTarget.scrollTop / LIST_ROW_HEIGHT),
                );
              },
              role: "listbox",
            }}
            viewportRef={viewportRef}
          >
            <div
              className="relative min-h-full"
              ref={rowsRef}
              style={{ ...LIST_STRIPES, height: rows.length * LIST_ROW_HEIGHT }}
            >
              <div
                className="absolute inset-x-0 flex flex-col"
                data-file-system-listing=""
                style={{ top: start * LIST_ROW_HEIGHT }}
              >
                {rows.slice(start, end).map((row) => {
                  const { depth, entry } = row;
                  if (entry === null && "heading" in row) {
                    // Over the stripes, and the name in line with the rows'
                    // names rather than their icons.
                    return (
                      <div
                        aria-hidden
                        className="flex h-6 shrink-0 items-end bg-background pr-3 pb-0.5 pl-14 text-xs font-semibold text-muted-foreground"
                        key={`heading:${row.heading}:${row.group}`}
                      >
                        {row.heading === "name" ? (
                          <span className="truncate">{row.group}</span>
                        ) : null}
                      </div>
                    );
                  }
                  if (entry === null && "note" in row) {
                    return (
                      <div
                        className="mx-1.5 flex h-6 shrink-0 items-center px-1.5 text-xs text-muted-foreground"
                        key={`note:${row.notePath}`}
                        style={{ paddingLeft: depth * LIST_INDENT + 6 }}
                      >
                        <span className="ml-5.5 truncate">{row.note}</span>
                      </div>
                    );
                  }
                  if (entry === null) {
                    return (
                      <div
                        aria-hidden
                        className="mx-1.5 flex h-6 shrink-0 items-center px-1.5"
                        key={`loading:${"loadingPath" in row ? row.loadingPath : ""}`}
                        style={{ paddingLeft: depth * LIST_INDENT + 6 }}
                      >
                        <span className="ml-5.5 h-2.5 w-32 animate-pulse rounded-full bg-foreground/10 motion-reduce:animate-none" />
                      </div>
                    );
                  }
                  const isSelected = selection.has(entry.path);
                  const isExpanded =
                    entry.kind === "folder" &&
                    (isRevealing || expanded.has(entry.path));
                  const isRenaming = entry.path === renamingPath;
                  return (
                    <div
                      aria-expanded={
                        entry.kind === "folder" ? isExpanded : undefined
                      }
                      aria-selected={isSelected}
                      className={cn(
                        "mx-1.5 flex h-6 shrink-0 items-center rounded-md px-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                        isSelected && SELECTED_ROW_CLASSNAME,
                        entry.path === menuTargetPath && MENU_TARGET_CLASSNAME,
                      )}
                      data-file-system-item={entry.path}
                      draggable={draggable && !isRenaming}
                      key={entry.path}
                      onClick={(event) => {
                        if (marqueeDrag.claimClick()) return;
                        rowGestures.click(entry, event, () => rowEntries);
                      }}
                      onContextMenu={(event) => {
                        onItemContextMenu?.(entry, event);
                      }}
                      onDoubleClick={() => {
                        rowGestures.doubleClick();
                        onOpen(entry);
                      }}
                      onPointerEnter={() => {
                        if (entry.kind === "folder")
                          onFolderHover?.(entry.path);
                      }}
                      // Pulled by its blank space (past its name, in its
                      // other columns), the row starts a run up or down the
                      // list, as the Finder's does; by its icon or its name,
                      // it drags out of the window.
                      onDragStart={(event) => {
                        if (runFromRowRef.current) {
                          event.preventDefault();
                          event.stopPropagation();
                        }
                      }}
                      onPointerDown={(event) => {
                        runFromRowRef.current =
                          !isRenaming &&
                          event.button === 0 &&
                          event.pointerType === "mouse" &&
                          !isMacContextClick(event) &&
                          event.target instanceof Element &&
                          !event.target.closest(
                            "[data-file-system-name-text], [data-file-system-glyph], input",
                          );
                        if (runFromRowRef.current) {
                          marqueeDrag.start(event, {
                            onBegin: () => {
                              if (selectionModeOf(event) === null) {
                                onSelect(null);
                              }
                            },
                          });
                          return;
                        }
                        rowGestures.press(entry, event, () => rowEntries);
                      }}
                      ref={(element) => {
                        if (element) {
                          rowRefs.current.set(entry.path, element);
                        } else {
                          rowRefs.current.delete(entry.path);
                        }
                      }}
                      role="option"
                      tabIndex={entry.path === tabStopPath ? 0 : -1}
                    >
                      <div
                        className="flex min-w-0 flex-1 items-center"
                        style={{ paddingLeft: depth * LIST_INDENT }}
                      >
                        <span
                          aria-hidden
                          className="flex h-6 w-4 shrink-0 items-center justify-center"
                          // The chevron opens and closes the folder and does
                          // nothing else: the press never reaches the row, so
                          // the selection stays where it was.
                          onClick={(event) => {
                            if (entry.kind !== "folder") return;
                            event.stopPropagation();
                            toggleFolder(entry, !isExpanded);
                          }}
                          onDoubleClick={(event) => {
                            if (entry.kind === "folder")
                              event.stopPropagation();
                          }}
                          onPointerDown={(event) => {
                            if (entry.kind !== "folder") return;
                            event.stopPropagation();
                            event.preventDefault();
                          }}
                        >
                          {entry.kind === "folder" ? (
                            <ChevronRight
                              className={cn(
                                "size-3.5 transition-transform duration-100 motion-reduce:transition-none",
                                isExpanded && "rotate-90",
                                isSelected
                                  ? SELECTED_ROW_SECONDARY_CLASSNAME
                                  : "text-muted-foreground",
                              )}
                              strokeWidth={2.5}
                            />
                          ) : null}
                        </span>
                        <span
                          className="ml-1.5 flex size-4 shrink-0 items-center justify-center"
                          data-file-system-glyph=""
                        >
                          <FileSystemRowGlyph entry={entry} />
                        </span>
                        {isRenaming ? (
                          renderNameField(entry, "-mr-0.5 ml-1 h-5")
                        ) : (
                          <span
                            className="ml-1.5 min-w-0 flex-1 truncate"
                            data-file-system-name=""
                          >
                            <span data-file-system-name-text="">
                              {shownName(entry)}
                            </span>
                          </span>
                        )}
                      </div>
                      {columns.map((column) => (
                        <span
                          className={cn(
                            "shrink-0 truncate px-2 text-xs tabular-nums",
                            column.align === "end" && "text-right",
                            isSelected
                              ? SELECTED_ROW_SECONDARY_CLASSNAME
                              : "text-muted-foreground",
                          )}
                          key={column.key}
                          style={{ width: column.width }}
                        >
                          {listCellText(entry, column.key, {
                            short: column.compact,
                          })}
                        </span>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          </InlineScrollArea2>
        )}
      </div>
    </div>
  );
}
// Row thumbnails that did not load, so a row drawn again goes straight to the
// file's type icon rather than trying the picture once per mount.
const failedRowThumbnails = new Set<string>();
/**
 * The small picture a row leads with: the folder glyph, a picture's own
 * thumbnail in its own shape with a hairline around it, an app's icon, or
 * the file's type. Pictures and design artwork are drawn as themselves at
 * this size; a text document's thumbnail would be a smudge, and its type
 * says more.
 */
export function FileSystemRowGlyph({
  entry,
}: {
  entry:
    | { glyphSrc?: string; kind: "folder" }
    | (Pick<
        FileSystemFileItem,
        "contentType" | "previewImageUrl" | "previewImageUrls" | "previewIsIcon"
      > & { kind: "file"; name: string });
}) {
  const [, setFailed] = React.useState(false);
  if (entry.kind === "folder") {
    return (
      <FileSystemFolderGlyph
        className="h-3.5 w-auto shrink-0"
        src={entry.glyphSrc}
      />
    );
  }
  const coverUrl =
    entry.previewIsIcon ||
    mimeTypeForFile(entry).startsWith("image/") ||
    /\.(?:ai|psd)$/i.test(entry.name)
      ? filePreviewUrls(entry)[0]
      : undefined;
  if (!coverUrl || failedRowThumbnails.has(coverUrl)) {
    return <FileTypeIcon className="size-4" fileName={entry.name} />;
  }
  if (entry.previewIsIcon) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- Cover thumbnails come from caller-provided file preview URLs.
      <img
        alt=""
        className="size-4 shrink-0 object-contain"
        draggable={false}
        onError={() => {
          failedRowThumbnails.add(coverUrl);
          setFailed(true);
        }}
        src={coverUrl}
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- Cover thumbnails come from caller-provided file preview URLs.
    <img
      alt=""
      className="max-h-4 max-w-4 rounded-[1.5px] bg-white object-contain shadow-[0_0_0_0.5px_color-mix(in_oklab,var(--color-foreground)_35%,transparent)]"
      draggable={false}
      onError={() => {
        failedRowThumbnails.add(coverUrl);
        setFailed(true);
      }}
      src={coverUrl}
    />
  );
}
function FileSystemColumnsView(props: FileSystemViewProps) {
  const {
    besideWidth,
    columnWidth: columnWidthProp,
    currentPath,
    draggable,
    grouping,
    index,
    loadingFolders,
    menuTargetPath,
    moveFocusWithSelection,
    onColumnWidthChange,
    onFolderHover,
    onItemContextMenu,
    listingNavRef,
    marquee,
    onOpen,
    onSelect,
    renamingPath,
    renderFileStage,
    renderNameField,
    renderUnreadable,
    rootTitle,
    rowGestures,
    selectedEntry,
    selectedPath,
    selection,
  } = props;
  const isSeveral = selection.size > 1;
  const scrollContainerRef = React.useRef<HTMLDivElement | null>(null);
  const rowRefs = React.useRef(new Map<string, HTMLButtonElement>());
  // The selection highlight tracks every keypress; mounting the trailing
  // child column and the preview pane is deferred so holding an arrow key
  // doesn't pay that DOM churn per step.
  const deferredSelectedEntry = React.useDeferredValue(selectedEntry);
  const deferredSelectedPath = React.useDeferredValue(selectedPath);
  // The keyboard follows the selection, except while something outside holds
  // it and walks the folder from there. A row in a column that has not
  // mounted yet takes it once it exists.
  const focusRow = useFocusWhenDrawn(rowRefs, {
    enabled: moveFocusWithSelection,
    preventScroll: false,
  });
  // Up and down walk the column the selection is in; left goes back to the
  // folder that column lists, right into the first of a selected folder.
  // Letters and ⌘A stay within that column, like the Finder's.
  const isInColumns =
    selectedEntry !== null && selectedPath?.startsWith(currentPath) === true;
  const activeColumn = isInColumns
    ? (index.children.get(selectedEntry.parentPath) ?? [])
    : (index.children.get(currentPath) ?? []);
  useListingNav(listingNavRef, {
    current: isInColumns ? selectedEntry : null,
    move: (direction) => {
      if (!isInColumns) {
        const first = index.children.get(currentPath)?.[0];
        return first ? { entry: first, order: null } : false;
      }
      if (direction === "up" || direction === "down") {
        const at = activeColumn.findIndex(
          (sibling) => sibling.path === selectedEntry.path,
        );
        const next = activeColumn[at + (direction === "up" ? -1 : 1)];
        return next ? { entry: next, order: activeColumn } : false;
      }
      const next =
        direction === "left"
          ? selectedEntry.parentPath === currentPath
            ? undefined
            : index.folders.get(selectedEntry.parentPath)
          : selectedEntry.kind === "folder"
            ? index.children.get(selectedEntry.path)?.[0]
            : undefined;
      return next ? { entry: next, order: null } : false;
    },
    renames: true,
    reveal: (entry) => {
      focusRow(entry.path);
    },
    rows: activeColumn,
  });
  // Several selected open nothing past the column they are in.
  const deferredIsSeveral = React.useDeferredValue(isSeveral);
  const columnPaths = React.useMemo(() => {
    const paths = [currentPath];
    if (!deferredSelectedPath?.startsWith(currentPath)) return paths;
    const targetFolder =
      deferredSelectedEntry?.kind === "folder" && !deferredIsSeveral
        ? deferredSelectedEntry.path
        : (deferredSelectedEntry?.parentPath ?? currentPath);
    const relativePath = targetFolder.slice(currentPath.length);
    let walkedPath = currentPath;
    for (const segment of relativePath.split("/")) {
      if (!segment) continue;
      walkedPath = `${walkedPath}${segment}/`;
      paths.push(walkedPath);
    }
    return paths;
  }, [
    currentPath,
    deferredIsSeveral,
    deferredSelectedEntry,
    deferredSelectedPath,
  ]);
  // Roving tabindex: all columns together form a single tab stop (the
  // selected row when its column is mounted, else the first row), so
  // Shift+Tab returns to the toolbar like in the list view.
  const tabStopPath = React.useMemo(() => {
    if (selectedPath) {
      for (const columnPath of columnPaths) {
        if (
          index.children
            .get(columnPath)
            ?.some((entry) => entry.path === selectedPath)
        ) {
          return selectedPath;
        }
      }
    }
    return index.children.get(columnPaths[0] ?? "")?.[0]?.path ?? null;
  }, [columnPaths, index, selectedPath]);
  // The first folder in the trail that cannot be listed stands in its
  // column's place, and nothing past it can be open. The first column is the
  // folder on screen, which the browser stands in for as a whole.
  const unreadableAt = columnPaths.findIndex(
    (columnPath, columnIndex) =>
      columnIndex > 0 &&
      (renderUnreadable?.(columnPath, "pane") ?? null) !== null,
  );
  const unreadableColumnPath =
    unreadableAt === -1 ? undefined : columnPaths[unreadableAt];
  const listedColumnPaths =
    unreadableAt === -1 ? columnPaths : columnPaths.slice(0, unreadableAt);
  const selectedFile =
    deferredSelectedEntry?.kind === "file" && !deferredIsSeveral
      ? (deferredSelectedEntry as FileEntry)
      : null;
  const selectedFileSize = selectedFile
    ? formatByteSize(selectedFile.size)
    : null;
  const selectedFileStage =
    selectedFile && renderFileStage ? renderFileStage(selectedFile) : null;
  // A picture drawn in its own shape: the stage's width follows it, so a
  // landscape photo takes the pane's width where a page takes a page's.
  const selectedFileAspectRatio =
    useNaturalAspectRatio(
      selectedFile ? filePreviewUrls(selectedFile)[0] : undefined,
    ) ?? 0.78;
  // One width for every column, dragged at any column's right edge, the way
  // the Finder's option-drag sets them all.
  const [internalColumnWidth, setInternalColumnWidth] =
    React.useState(COLUMN_WIDTH_DEFAULT);
  const columnWidth = columnWidthProp ?? internalColumnWidth;
  const setColumnWidth = (next: number) => {
    setInternalColumnWidth(next);
    onColumnWidthChange?.(next);
  };
  React.useEffect(() => {
    const container = scrollContainerRef.current;
    if (container) container.scrollLeft = container.scrollWidth;
  }, [columnPaths.length, deferredSelectedPath]);
  // Beside a file only the last column stands, filling the folder's width:
  // the file is open beside it, so there is no preview to make room for,
  // and the columns before it are a step back (left, or the folder's menu).
  const isBeside = besideWidth !== undefined;
  return (
    <InlineScrollArea2
      orientation="horizontal"
      viewportClassName="overscroll-x-contain"
      viewportProps={{ disableImplicitContentElement: true }}
      viewportRef={scrollContainerRef}
    >
      {/* The Content part's ResizeObserver tells the scroll area when the
            trail shrinks (deselect, shallower selection) so the horizontal
            scrollbar hides; the viewport alone only observes its own box.
            Content's built-in inline style is `display: table`, and a
            percentage height inside a table box is a minimum rather than a
            bound: each column would grow to its rows and the viewport, which
            only scrolls sideways, would clip them so nothing answered the
            wheel. The inline flex display holds the columns to the viewport's
            height; the inline min-width keeps the full-width floor. */}
      <InlineScrollAreaContent
        className={cn("flex h-full", isBeside ? "w-full" : "w-max")}
        data-file-system-listing=""
        style={{ display: "flex", minWidth: "100%" }}
      >
        {listedColumnPaths.map((columnPath, columnIndex) => {
          if (
            isBeside &&
            (unreadableColumnPath !== undefined ||
              columnIndex < listedColumnPaths.length - 1)
          ) {
            return null;
          }
          const column = (
            <FileSystemColumn
              draggable={draggable}
              fills={isBeside}
              grouping={grouping}
              entries={index.children.get(columnPath) ?? []}
              index={index}
              isLoading={loadingFolders.has(columnPath)}
              key={columnPath || "(root)"}
              menuTargetChildPath={
                menuTargetPath && pathParent(menuTargetPath) === columnPath
                  ? menuTargetPath
                  : null
              }
              onFolderHover={onFolderHover}
              onItemContextMenu={onItemContextMenu}
              onOpen={onOpen}
              onResize={setColumnWidth}
              onSelect={onSelect}
              ownFolder={
                columnIndex === 0
                  ? null
                  : (index.folders.get(columnPath) ?? null)
              }
              // Scalar per-column props so the memoized column only
              // re-renders when its own rows change — a selection deeper in
              // the trail leaves ancestor columns untouched.
              renamingChildPath={
                renamingPath && pathParent(renamingPath) === columnPath
                  ? renamingPath
                  : null
              }
              marquee={marquee}
              renderNameField={renderNameField}
              rowGestures={rowGestures}
              rowRefs={rowRefs}
              selectedChildPath={
                selectedPath && pathParent(selectedPath) === columnPath
                  ? selectedPath
                  : null
              }
              selection={
                selectedPath && pathParent(selectedPath) === columnPath
                  ? selection
                  : null
              }
              tabStopChildPath={
                tabStopPath && pathParent(tabStopPath) === columnPath
                  ? tabStopPath
                  : null
              }
              trailChildPath={columnPaths[columnIndex + 1] ?? null}
              width={columnWidth}
            />
          );
          if (!isBeside || columnIndex === 0) {
            return column;
          }
          // The way back to the column before, named for where it goes, as
          // a phone names its back button: the folder's own name is in its
          // section of the row.
          const backPath = listedColumnPaths[columnIndex - 1] ?? currentPath;
          const backFolder =
            columnIndex === 1 ? null : (index.folders.get(backPath) ?? null);
          return (
            <div
              className="flex min-w-0 flex-1 flex-col"
              key={columnPath || "(root)"}
            >
              <button
                className="flex h-8 shrink-0 items-center gap-1 border-b px-2 text-left text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                onClick={() => {
                  onSelect(backFolder);
                }}
                type="button"
              >
                <ChevronLeft className="size-4 shrink-0" />
                <span className="truncate">
                  {backFolder?.name ??
                    index.folders.get(backPath)?.name ??
                    rootTitle}
                </span>
              </button>
              {column}
            </div>
          );
        })}
        {unreadableColumnPath !== undefined ? (
          <div className="min-w-72 flex-1 contain-inline-size">
            {renderUnreadable?.(unreadableColumnPath, "pane")}
          </div>
        ) : isBeside ? null : selectedFile ? (
          <InlineScrollArea2
            className="min-w-60 flex-1 contain-inline-size"
            orientation="vertical"
            viewportClassName="flex justify-center p-4"
          >
            <div className="mx-auto flex w-full max-w-xl flex-col items-stretch gap-3">
              {/* Width derives from the aspect ratio so the thumbnail grows
                with the pane up to a 24rem height cap; past that the whole
                column stands centered, top-aligned, as the Finder's does.
                Double-clicking it opens the file, as double-clicking its row
                does. */}
              <div
                className="mx-auto w-full shrink-0"
                onDoubleClick={() => onOpen(selectedFile)}
                style={{
                  maxWidth: `min(100%, ${(selectedFile.previewAspectRatio ?? selectedFileAspectRatio) * 24}rem)`,
                }}
              >
                {selectedFileStage ?? (
                  <FileVisual
                    className="w-full"
                    file={selectedFile}
                    pageable
                    previewAspectRatio={0.78}
                  />
                )}
              </div>
              <div className="text-center">
                <div className="text-sm font-semibold break-words">
                  {shownName(selectedFile)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {fileKindLabel(selectedFile)}
                  {selectedFileSize ? ` - ${selectedFileSize}` : null}
                </div>
              </div>
              <FileSystemInformation entry={selectedFile} index={index} />
            </div>
          </InlineScrollArea2>
        ) : deferredIsSeveral ? (
          <FileSystemSelectionStack
            entries={[...selection].flatMap((path) => {
              const entry = index.files.get(path) ?? index.folders.get(path);
              return entry ? [entry] : [];
            })}
            renderFileStage={renderFileStage}
          />
        ) : null}
      </InlineScrollAreaContent>
    </InlineScrollArea2>
  );
}
// Column row geometry (px at the default 16px root font size).
const COLUMN_PADDING = 6; // p-1.5
const COLUMN_ROW_HEIGHT = 28; // h-7
const COLUMN_ROW_GAP = 1; // gap-px
const COLUMN_ROW_STRIDE = COLUMN_ROW_HEIGHT + COLUMN_ROW_GAP;
// Memoized with scalar selection props: pressing into a deep trail only
// re-renders the columns whose rows actually change.
const COLUMN_WIDTH_DEFAULT = 240;
const COLUMN_WIDTH_MIN = 160;
const COLUMN_WIDTH_MAX = 640;
const FileSystemColumn = React.memo(function FileSystemColumn({
  draggable,
  entries,
  fills,
  grouping,
  index,
  isLoading,
  marquee,
  menuTargetChildPath,
  onFolderHover,
  onItemContextMenu,
  onOpen,
  onResize,
  onSelect,
  ownFolder,
  renamingChildPath,
  renderNameField,
  rowGestures,
  rowRefs,
  selectedChildPath,
  selection,
  tabStopChildPath,
  trailChildPath,
  width,
}: {
  draggable: boolean;
  entries: FileSystemEntry[];
  /** The only column, beside a file: as wide as the folder, with no edge to drag. */
  fills: boolean;
  grouping: Grouping | null;
  index: FileSystemIndex;
  isLoading: boolean;
  marquee: MarqueeControl;
  menuTargetChildPath: null | string;
  onFolderHover?: (folderPath: string) => void;
  onItemContextMenu?: (item: FileSystemItem, event: React.MouseEvent) => void;
  onOpen: (entry: FileSystemEntry) => void;
  onResize: (width: number) => void;
  onSelect: FileSystemViewProps["onSelect"];
  /** The folder this column lists, selected by a press past its rows; null for the first column. */
  ownFolder: FolderEntry | null;
  renamingChildPath: null | string;
  renderNameField: RenderNameField;
  rowGestures: RowGestures;
  rowRefs: React.RefObject<Map<string, HTMLButtonElement>>;
  /** The row the keyboard is on, when it is in this column. */
  selectedChildPath: null | string;
  /** Everything selected, when it is in this column. */
  selection: null | ReadonlySet<string>;
  tabStopChildPath: null | string;
  trailChildPath: null | string;
  width: number;
}) {
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  // Grouped, each group stands under its heading, the first at the top of
  // the column, as the Finder's columns do; a column of one group has none.
  const lines = React.useMemo(() => {
    if (!grouping) return entries;
    const labels = entries.map((entry) => grouping(entry).label);
    if (new Set(labels).size < 2) return entries;
    return entries.flatMap(
      (entry, at): Array<FileSystemEntry | { heading: string }> =>
        at === 0 || labels[at] !== labels[at - 1]
          ? [{ heading: labels[at] ?? "" }, entry]
          : [entry],
    );
  }, [entries, grouping]);
  const { end, start } = useVirtualWindow({
    count: lines.length,
    itemStride: COLUMN_ROW_STRIDE,
    leadingPx: COLUMN_PADDING,
    overscan: 10,
    viewportRef,
  });
  // A drag up or down the column takes the run of rows it passes here, and
  // only here, the way the Finder's columns pick several in one column.
  const rowsRef = React.useRef<HTMLDivElement | null>(null);
  const marqueeDrag = useMarquee({
    containerRef: rowsRef,
    hitTest: (_, { from, to }) =>
      runHits({
        count: lines.length,
        from: from.y,
        stride: COLUMN_ROW_STRIDE,
        to: to.y,
      }).flatMap((at) => {
        const line = lines[at];
        return line && !("heading" in line) ? [line.path] : [];
      }),
    marquee,
    shape: "run",
    viewportRef,
  });
  // Keyboard navigation can select a row this column hasn't mounted; scroll
  // it into the viewport so it mounts and the pending-focus effect can land.
  React.useLayoutEffect(() => {
    if (!selectedChildPath) return;
    scrollIndexIntoView({
      index: lines.findIndex(
        (line) => !("heading" in line) && line.path === selectedChildPath,
      ),
      itemSize: COLUMN_ROW_HEIGHT,
      itemStride: COLUMN_ROW_STRIDE,
      leadingPx: COLUMN_PADDING,
      viewport: viewportRef.current,
    });
  }, [lines, selectedChildPath]);
  return (
    <div
      className={cn(
        "relative",
        fills ? "min-h-0 min-w-0 flex-1" : "shrink-0 border-r",
      )}
      // The folder the column lists, for a drop on its empty space; the first
      // column's is the browser's own.
      data-file-system-folder={ownFolder?.path ?? ""}
      style={fills ? {} : { width }}
    >
      <InlineScrollArea2
        className="h-full w-full"
        orientation="vertical"
        overlay={marqueeDrag.overlay}
        viewportClassName="p-1.5"
        viewportProps={{
          "aria-label": "Files",
          // A press past the rows goes back to the folder the column lists,
          // as in the Finder, and in the first column to nothing; one with
          // ⌘ or Shift held keeps the selection. Dragged up, it selects the
          // run of rows from the last to the pointer, in this column.
          onPointerDown: (event) => {
            if (
              event.button !== 0 ||
              !(event.target instanceof HTMLElement) ||
              event.target.closest("[data-file-system-item], input")
            ) {
              return;
            }
            const isPlain = selectionModeOf(event) === null;
            if (isPlain) onSelect(ownFolder);
            marqueeDrag.start(event, {
              order: () => entries.map((entry) => entry.path),
            });
          },
          role: "listbox",
        }}
        viewportRef={viewportRef}
      >
        {isLoading && entries.length === 0 ? (
          // A column still being read is left blank, as the Finder leaves
          // one, and only a slow read turns a ring in it.
          <div className="flex justify-center py-3" role="status">
            <Spinner className="size-4 text-muted-foreground" delay={1000} />
          </div>
        ) : (
          <div
            className="relative"
            ref={rowsRef}
            style={{
              height:
                lines.length > 0
                  ? lines.length * COLUMN_ROW_STRIDE - COLUMN_ROW_GAP
                  : undefined,
            }}
          >
            <div
              className="absolute inset-x-0 flex flex-col gap-px"
              style={{ top: start * COLUMN_ROW_STRIDE }}
            >
              {lines.slice(start, end).map((line) => {
                if ("heading" in line) {
                  // In line with the rows' names rather than their icons.
                  return (
                    <div
                      aria-hidden
                      className="flex h-7 shrink-0 items-end pr-2 pb-1 pl-8 text-xs font-semibold text-muted-foreground"
                      key={`heading:${line.heading}`}
                    >
                      <span className="truncate">{line.heading}</span>
                    </div>
                  );
                }
                const entry = line;
                const isSelected = selection?.has(entry.path) ?? false;
                const isOnTrail =
                  entry.kind === "folder" && entry.path === trailChildPath;
                const glyph = (
                  <span className="flex size-4 shrink-0 items-center justify-center">
                    <FileSystemRowGlyph entry={entry} />
                  </span>
                );
                const rowClassName =
                  "flex h-7 shrink-0 items-center gap-2 rounded-md px-2 py-1 text-left text-sm outline-none";
                if (entry.path === renamingChildPath) {
                  // The row keeps its place while its name is typed over, so
                  // nothing above or below it moves.
                  return (
                    <div
                      className={cn(rowClassName, SELECTED_ROW_CLASSNAME)}
                      key={entry.path}
                    >
                      {glyph}
                      {renderNameField(entry, "-mx-0.5")}
                    </div>
                  );
                }
                return (
                  <button
                    aria-selected={isSelected}
                    className={cn(
                      rowClassName,
                      "focus-visible:ring-2 focus-visible:ring-ring",
                      isSelected
                        ? SELECTED_ROW_CLASSNAME
                        : isOnTrail
                          ? "bg-accent"
                          : "hover:bg-accent/50",
                      entry.path === menuTargetChildPath &&
                        MENU_TARGET_CLASSNAME,
                    )}
                    data-file-system-item={entry.path}
                    draggable={draggable}
                    key={entry.path}
                    onClick={(event) => {
                      rowGestures.click(entry, event, () => entries);
                    }}
                    // Right-clicking marks what the menu acts on without
                    // moving the selection, the way the Finder does.
                    onContextMenu={(event) => {
                      onItemContextMenu?.(entry, event);
                    }}
                    onDoubleClick={() => {
                      rowGestures.doubleClick();
                      onOpen(entry);
                    }}
                    onPointerEnter={() => {
                      if (entry.kind === "folder") onFolderHover?.(entry.path);
                    }}
                    // Selecting on press (mouse only) starts mounting the
                    // child column a beat before mouseup. Touch keeps
                    // selection on the click so scroll gestures don't select.
                    onPointerDown={(event) => {
                      rowGestures.press(entry, event, () => entries);
                    }}
                    ref={(element) => {
                      if (element) {
                        rowRefs.current.set(entry.path, element);
                      } else {
                        rowRefs.current.delete(entry.path);
                      }
                    }}
                    role="option"
                    tabIndex={entry.path === tabStopChildPath ? 0 : -1}
                    type="button"
                  >
                    {glyph}
                    <span
                      className="min-w-0 flex-1 truncate"
                      data-file-system-name=""
                    >
                      {shownName(entry)}
                    </span>
                    {entry.kind === "folder" &&
                    folderHasChildren(index, entry) ? (
                      <ChevronRight
                        className={cn(
                          "size-3.5 shrink-0",
                          isSelected
                            ? SELECTED_ROW_SECONDARY_CLASSNAME
                            : "text-muted-foreground/60",
                        )}
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </InlineScrollArea2>
      {/* The edge that drags: every column follows, since the width is one. */}
      {fills ? null : (
        <ResizeHandle
          className="right-0 translate-x-1/2"
          getWidth={() => width}
          grows="right"
          onReset={() => {
            onResize(COLUMN_WIDTH_DEFAULT);
          }}
          onResize={(next) => {
            onResize(
              Math.round(
                Math.min(COLUMN_WIDTH_MAX, Math.max(COLUMN_WIDTH_MIN, next)),
              ),
            );
          }}
        />
      )}
    </div>
  );
});
/**
 * How the last few picked lie in the pile, back to front: the one on top
 * almost square, each under it turned a little the other way and nudged
 * aside, the way the Finder's preview piles a selection.
 */
const STACK_POSES = [
  { rotate: 9, x: 1.5, y: -0.75 },
  { rotate: -8, x: -1.25, y: -0.25 },
  { rotate: -1, x: 0, y: 0.25 },
];
/**
 * Several selected, where one file's preview stands and laid out as it is,
 * so nothing moves between picking one and picking more: the last few picked
 * as a loose pile in the picture's place, the newest on top and each drawn as
 * the pane draws it alone; how many, of what, and how large under it; and the
 * span of their dates where one file's dates go.
 */
function FileSystemSelectionStack({
  entries,
  renderFileStage,
}: {
  entries: FileSystemEntry[];
  renderFileStage?: (file: FileSystemFileItem) => React.ReactNode;
}) {
  const shown = entries.slice(-STACK_POSES.length);
  const poses = STACK_POSES.slice(-shown.length);
  const files = entries.filter((entry) => entry.kind === "file");
  const folderCount = entries.length - files.length;
  const kinds = [
    folderCount > 0 &&
      `${folderCount} ${folderCount === 1 ? "folder" : "folders"}`,
    files.length > 0 &&
      `${files.length} ${files.length === 1 ? "document" : "documents"}`,
  ].filter(Boolean);
  const sizes = files.flatMap((file) =>
    file.size === undefined ? [] : [file.size],
  );
  const totalSize =
    sizes.length > 0
      ? formatByteSize(sizes.reduce((sum, size) => sum + size, 0))
      : null;
  const rows: Array<[string, string]> = [];
  const created = formatDateSpan(entries.map((entry) => entry.createdAt));
  const updated = formatDateSpan(entries.map((entry) => entry.updatedAt));
  if (created) rows.push(["Created", created]);
  if (updated) rows.push(["Modified", updated]);
  return (
    <InlineScrollArea2
      className="min-w-60 flex-1 contain-inline-size"
      orientation="vertical"
      viewportClassName="flex justify-center p-4"
    >
      <div className="mx-auto flex w-full max-w-xl flex-col items-stretch gap-3">
        {/* The picture's own room: as tall as one file's is let grow. */}
        <div className="relative mx-auto h-96 w-full max-w-sm shrink-0">
          {shown.map((entry, at) => {
            const pose = poses[at];
            return (
              <div
                className="absolute inset-0 flex items-center justify-center drop-shadow-md"
                key={entry.path}
                style={
                  pose
                    ? {
                        transform: `translate(${pose.x}rem, ${pose.y}rem) rotate(${pose.rotate}deg)`,
                      }
                    : undefined
                }
              >
                {entry.kind === "folder" ? (
                  <FileSystemFolderGlyph
                    className="h-48 w-auto"
                    src={entry.glyphSrc}
                  />
                ) : (
                  <div className="flex w-60 justify-center">
                    {renderFileStage?.(entry) ?? (
                      <FittedFileVisual
                        box={{ height: 20, width: 15 }}
                        file={entry}
                        pageClassName="w-60"
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="text-center">
          <div className="text-sm font-semibold">{entries.length} items</div>
          <div className="text-xs text-muted-foreground">
            {kinds.join(", ")}
            {totalSize ? ` - ${totalSize}` : null}
          </div>
        </div>
        <FileSystemInformationRows rows={rows} />
      </div>
    </InlineScrollArea2>
  );
}
/**
 * The days a set of timestamps falls on, as one span: `Sep 10 – 22, 2026`,
 * or the one day when they share it. Null when none of them says.
 */
function formatDateSpan(values: Array<string | undefined>) {
  const times = values.flatMap((value) => {
    const time = value ? new Date(value).getTime() : Number.NaN;
    return Number.isNaN(time) ? [] : [time];
  });
  if (times.length === 0) return null;
  return DAY_FORMAT.formatRange(Math.min(...times), Math.max(...times));
}
function FileSystemInformation({
  entry,
  index,
}: {
  entry: FileSystemEntry;
  index: FileSystemIndex;
}) {
  const rows: Array<[string, string]> = [];
  const created = formatTimestamp(entry.createdAt);
  const updated = formatTimestamp(entry.updatedAt);
  if (created) rows.push(["Created", created]);
  if (updated) rows.push(["Modified", updated]);
  // A file's size is already beside its kind, under its name.
  if (entry.kind === "folder") {
    const childCount = index.children.get(entry.path)?.length;
    if (childCount !== undefined) {
      rows.push(["Items", `${childCount}`]);
    }
  }
  return <FileSystemInformationRows rows={rows} />;
}
/** The Information table under a preview: a label and its value per row. */
function FileSystemInformationRows({
  rows,
}: {
  rows: Array<[string, string]>;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="border-t pt-3">
      <div className="mb-1.5 text-xs font-semibold">Information</div>
      <dl className="space-y-1">
        {rows.map(([label, value]) => (
          <div
            className="flex items-baseline justify-between gap-3 text-xs"
            key={label}
          >
            <dt className="shrink-0 text-muted-foreground">{label}</dt>
            <dd className="text-right" suppressHydrationWarning>
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
// Filmstrip geometry (px at the default 16px root font size).
const GALLERY_STRIP_PADDING = 8; // p-2
const GALLERY_TILE_SIZE = 56; // size-14
const GALLERY_TILE_GAP = 6; // gap-1.5
const GALLERY_TILE_STRIDE = GALLERY_TILE_SIZE + GALLERY_TILE_GAP;
// How many visited stages stay mounted so stepping back to a recent file
// restores its already-loaded preview without refetching or re-parsing;
// also bounds the memory the keep-alive pool can hold onto.
const GALLERY_STAGE_POOL_SIZE = 4;
// Of those, how many stay attached to the DOM (the active stage plus the
// two before it, keeping the usual two-or-three-file rotation instant).
// The rest wait detached, costing no layout or style-recalc work until
// they return — their page canvases remount on the way back, so returning
// to a detached stage briefly rebuilds the page content.
const GALLERY_STAGE_ATTACHED_COUNT = 3;
type InlineRegistryIconProps = Omit<
  React.ComponentProps<"svg">,
  "children" | "strokeWidth"
> & { strokeWidth?: number };
type InlineScrollAreaProps = React.ComponentProps<
  typeof ScrollAreaPrimitive.Root
> & {
  orientation?: "both" | "horizontal" | "vertical";
  /** Drawn over the viewport, outside what scrolls, as a dragged box is. */
  overlay?: React.ReactNode;
  scrollbarGutter?: boolean;
  scrollbarOverflowOnly?: boolean;
  scrollFade?: boolean;
  viewportClassName?: string;
  viewportProps?: React.ComponentProps<typeof ScrollAreaPrimitive.Viewport>;
  viewportRef?: React.Ref<HTMLDivElement>;
};
// The preview for one pooled file. Each stage owns its URL resolution and
// viewer state, so a mounted stage is self-contained: the root keeps
// recently shown stages alive (reparented between hosts rather than
// remounted, because the document viewers load in effects and would
// refetch and re-parse on remount) and revisiting one — in the gallery or
// the dialog — skips the presign, download, and parse work instead of
// re-running it behind a spinner. The two variants share one element
// structure, differing only in props and classes, so flipping a mounted
// stage between them keeps the viewer instance.
function FileSystemGalleryStage({
  file,
}: {
  file: FileEntry;
  /** Rendered in the viewer toolbar in the `"dialog"` variant. */
  toolbarActions?: React.ReactNode;
  /** `"stage"` is toolbar-less in a bordered tile; `"dialog"` shows the full viewer chrome. */
  variant?: "dialog" | "stage";
}) {
  const viewerKind = viewerKindForFile(file);
  // Only viewer-backed stages need a URL; thumbnail stages render from the
  // manifest's preview images.
  const url = viewerKind ? (file.url ?? null) : null;
  if (viewerKind === "image" && url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- Image file previews render caller-provided URLs that may be object or presigned URLs.
      <img
        alt={file.name}
        className="max-h-full max-w-full rounded-lg object-contain"
        src={url}
      />
    );
  }
  return (
    <FileVisual
      className="w-56 max-w-full"
      file={file}
      pageable
      previewAspectRatio={0.78}
    />
  );
}
function FileSystemGalleryView(props: FileSystemViewProps) {
  const {
    attachedStagePaths,
    draggable,
    entries,
    index,
    listingNavRef,
    moveFocusWithSelection,
    onItemContextMenu,
    onOpen,
    onSelect,
    poolStagePath,
    registerStageHost,
    renderFileStage,
    rowGestures,
    selectedEntry,
    selectedPath,
    selection,
  } = props;
  const stripRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const stripViewportRef = React.useRef<HTMLDivElement | null>(null);
  const activeEntry =
    selectedEntry && entries.some((entry) => entry.path === selectedEntry.path)
      ? selectedEntry
      : (entries[0] ?? null);
  // A tile the keyboard lands on may be outside the strip's virtual window;
  // the active-tile effect scrolls it in, and the keyboard follows once it
  // has mounted.
  const focusTile = useFocusWhenDrawn(stripRefs, {
    enabled: moveFocusWithSelection,
    preventScroll: false,
  });
  // The strip runs one way: left and right walk it, from the tile on show.
  // Return opens, since the strip has no name to type over.
  useListingNav(listingNavRef, {
    current: activeEntry,
    move: (direction) => {
      if (direction === "up" || direction === "down") return false;
      const at = activeEntry
        ? entries.findIndex((entry) => entry.path === activeEntry.path)
        : -1;
      const next =
        entries[at === -1 ? 0 : at + (direction === "left" ? -1 : 1)];
      return next ? { entry: next, order: at === -1 ? null : entries } : false;
    },
    renames: false,
    reveal: (entry) => {
      focusTile(entry.path);
    },
    rows: entries,
  });
  const activeFile = activeEntry?.kind === "file" ? activeEntry : null;
  // While arrow keys are scrubbing the strip, the center pane shows a
  // spinner; a file is only admitted to the preview pool (mounting its
  // viewer and resolving its URL) once the selection settles so each
  // keystroke stays cheap.
  const settledPath = useSettledValue(activeEntry?.path ?? null, 200);
  React.useEffect(() => {
    if (settledPath) poolStagePath(settledPath);
  }, [poolStagePath, settledPath]);
  // Hosts for the root-owned preview pool: one positioned wrapper per
  // pooled path; the root reparents each live preview into its wrapper.
  // Stable callbacks per path keep React from re-running the host refs on
  // unrelated renders.
  const stageHostRefs = React.useMemo(
    () =>
      new Map(
        attachedStagePaths.map(
          (path) =>
            [
              path,
              (element: HTMLElement | null) => registerStageHost(path, element),
            ] as const,
        ),
      ),
    [attachedStagePaths, registerStageHost],
  );
  const activeFileSize = activeFile ? formatByteSize(activeFile.size) : null;
  const fileStage =
    activeFile && renderFileStage ? renderFileStage(activeFile) : null;
  const { end: stripEnd, start: stripStart } = useVirtualWindow({
    count: entries.length,
    horizontal: true,
    itemStride: GALLERY_TILE_STRIDE,
    leadingPx: GALLERY_STRIP_PADDING,
    overscan: 8,
    viewportRef: stripViewportRef,
  });
  // Keep the active tile mounted and visible while scrubbing or when the
  // selection arrives from another view.
  const activePath = activeEntry?.path ?? null;
  React.useLayoutEffect(() => {
    if (!activePath) return;
    scrollIndexIntoView({
      horizontal: true,
      index: entries.findIndex((entry) => entry.path === activePath),
      itemSize: GALLERY_TILE_SIZE,
      itemStride: GALLERY_TILE_STRIDE,
      leadingPx: GALLERY_STRIP_PADDING,
      viewport: stripViewportRef.current,
    });
  }, [activePath, entries]);
  return (
    <div className="flex size-full flex-col" data-file-system-listing="">
      {/* The strip comes first in DOM order (rendered below via order-last)
            so the filmstrip is the view's single tab stop: Shift+Tab exits to
            the toolbar instead of landing inside the embedded viewers. */}
      <InlineScrollArea2
        className="order-last h-auto w-full shrink-0 border-t"
        orientation="horizontal"
        viewportClassName="p-2"
        viewportRef={stripViewportRef}
      >
        <div
          className="relative h-14 min-w-full"
          style={{
            width:
              entries.length > 0
                ? entries.length * GALLERY_TILE_STRIDE - GALLERY_TILE_GAP
                : undefined,
          }}
        >
          <div
            aria-label="Files"
            className="absolute inset-y-0 flex items-center gap-1.5"
            role="listbox"
            style={{ left: stripStart * GALLERY_TILE_STRIDE }}
          >
            {entries.slice(stripStart, stripEnd).map((entry) => {
              const isActive =
                entry.path === (activeEntry?.path ?? selectedPath);
              const isSelected = isActive || selection.has(entry.path);
              return (
                <button
                  aria-selected={isSelected}
                  className={cn(
                    "flex size-14 shrink-0 items-center justify-center rounded-md border border-transparent p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isSelected && "border-ring/40 bg-accent",
                  )}
                  data-file-system-item={entry.path}
                  draggable={draggable}
                  key={entry.path}
                  onClick={(event) => {
                    rowGestures.click(entry, event, () => entries);
                  }}
                  onContextMenu={(event) => {
                    if (!selection.has(entry.path)) onSelect(entry);
                    onItemContextMenu?.(entry, event);
                  }}
                  onDoubleClick={() => {
                    rowGestures.doubleClick();
                    onOpen(entry);
                  }}
                  onPointerDown={(event) => {
                    rowGestures.press(entry, event, () => entries);
                  }}
                  ref={(element) => {
                    if (element) {
                      stripRefs.current.set(entry.path, element);
                    } else {
                      stripRefs.current.delete(entry.path);
                    }
                  }}
                  role="option"
                  tabIndex={isActive ? 0 : -1}
                  title={shownName(entry)}
                  type="button"
                >
                  {entry.kind === "folder" ? (
                    <FileSystemFolderGlyph
                      className="h-9 w-auto"
                      src={entry.glyphSrc}
                    />
                  ) : (
                    <FittedFileVisual
                      // The tile inside its border and padding.
                      box={{ height: 2.875, width: 2.875 }}
                      className="rounded-sm"
                      file={entry}
                      pageClassName="w-9"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </InlineScrollArea2>
      <div className="flex min-h-0 flex-1">
        <div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center p-3">
          {activeEntry?.kind === "folder" ? (
            <FileSystemFolderGlyph
              className="h-40 max-h-full w-auto drop-shadow-md"
              src={activeEntry.glyphSrc}
            />
          ) : activeFile && !attachedStagePaths.includes(activeFile.path) ? (
            (fileStage ?? (
              <InlineSpinner className="size-6 text-muted-foreground" />
            ))
          ) : null}
          {/* Inactive hosts hide via `visibility` + `opacity`, never
            `display`: the document viewers size pages off ResizeObserver
            measurements, and display:none would collapse them to zero
            width — every reveal would re-lay-out and re-rasterize behind
            a blank pane. Stacking absolutely keeps each hidden stage at
            its real size so revealing one is pure paint. `opacity-0`
            matters: descendants can override an inherited
            visibility:hidden with their own visibility:visible (the
            spreadsheet grid's cell-selection overlay does), but nothing
            can opt out of an ancestor's zero opacity. `inert` keeps the
            hidden viewer's focusables out of reach. */}
          {attachedStagePaths.map((path) => {
            const isActiveStage = path === activeFile?.path;
            return (
              <div
                className={cn(
                  "absolute inset-0 flex items-center justify-center p-3",
                  !isActiveStage && "invisible opacity-0",
                )}
                inert={!isActiveStage || undefined}
                key={path}
                ref={stageHostRefs.get(path)}
              />
            );
          })}
        </div>
        {activeEntry ? (
          <InlineScrollArea2
            className="hidden w-64 shrink-0 border-l sm:block"
            orientation="vertical"
            viewportClassName="flex flex-col gap-3 p-4"
          >
            <div className="flex items-center gap-3">
              {activeFile ? (
                <FittedFileVisual
                  // A page's height beside the name, and a landscape
                  // picture's width.
                  box={{ height: 2.875, width: 4 }}
                  className="shrink-0 rounded-sm"
                  file={activeFile}
                  pageClassName="w-9"
                />
              ) : (
                <FileSystemFolderGlyph
                  className="h-8 w-auto shrink-0"
                  src={
                    activeEntry.kind === "folder"
                      ? activeEntry.glyphSrc
                      : undefined
                  }
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold break-words">
                  {shownName(activeEntry)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {activeFile ? fileKindLabel(activeFile) : "Folder"}
                  {activeFileSize ? ` - ${activeFileSize}` : null}
                </div>
              </div>
            </div>
            <FileSystemInformation entry={activeEntry} index={index} />
          </InlineScrollArea2>
        ) : null}
      </div>
    </div>
  );
}
function InlineComposeRefs<T>(...refs: Array<React.Ref<T> | undefined>) {
  return (node: null | T) => {
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === "function") ref(node);
      else ref.current = node;
    }
  };
}
function InlineScrollArea2({
  children,
  className,
  orientation = "both",
  overlay,
  scrollbarGutter = false,
  scrollbarOverflowOnly = false,
  scrollFade = false,
  viewportClassName,
  viewportProps,
  viewportRef,
  ...props
}: InlineScrollAreaProps) {
  const {
    className: viewportPropsClassName,
    ref: viewportPropsRef,
    ...resolvedViewportProps
  } = viewportProps ?? {};
  const composedViewportRef = React.useMemo(
    () => InlineComposeRefs(viewportPropsRef, viewportRef),
    [viewportPropsRef, viewportRef],
  );

  if (
    !viewportProps &&
    !viewportRef &&
    !viewportClassName &&
    !scrollFade &&
    !scrollbarGutter &&
    !scrollbarOverflowOnly
  ) {
    return (
      <InlineScrollArea
        {...props}
        className={cn(
          "size-full min-h-0",
          orientation === "horizontal" &&
            "[&>[data-orientation=vertical]]:hidden",
          className,
        )}
      >
        {children}
        {orientation === "vertical" ? null : (
          <ScrollBar orientation="horizontal" />
        )}
      </InlineScrollArea>
    );
  }

  return (
    <ScrollAreaPrimitive.Root
      className={cn(
        "size-full min-h-0",
        scrollbarOverflowOnly &&
          "[&:not(:has([data-slot=scroll-area-viewport][data-has-overflow-x]))_[data-orientation=horizontal]]:hidden [&:not(:has([data-slot=scroll-area-viewport][data-has-overflow-y]))_[data-orientation=vertical]]:hidden",
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        {...resolvedViewportProps}
        className={cn(
          "h-full rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-ring [&>div]:h-full",
          scrollFade &&
            "mask-t-from-[calc(100%-min(var(--fade-size),var(--scroll-area-overflow-y-start)))] mask-r-from-[calc(100%-min(var(--fade-size),var(--scroll-area-overflow-x-end)))] mask-b-from-[calc(100%-min(var(--fade-size),var(--scroll-area-overflow-y-end)))] mask-l-from-[calc(100%-min(var(--fade-size),var(--scroll-area-overflow-x-start)))] [--fade-size:1.5rem]",
          scrollbarGutter && orientation !== "vertical" && "pb-3.5",
          scrollbarGutter && orientation !== "horizontal" && "pe-3.5",
          viewportPropsClassName,
          viewportClassName,
        )}
        data-slot="scroll-area-viewport"
        ref={composedViewportRef}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      {overlay}
      {orientation === "horizontal" ? null : (
        <ScrollBar orientation="vertical" />
      )}
      {orientation === "vertical" ? null : (
        <ScrollBar orientation="horizontal" />
      )}
      {orientation === "both" ? <ScrollAreaPrimitive.Corner /> : null}
    </ScrollAreaPrimitive.Root>
  );
}
function InlineScrollAreaContent(
  props: React.ComponentProps<typeof ScrollAreaPrimitive.Content>,
) {
  return <ScrollAreaPrimitive.Content {...props} />;
}
function InlineSpinner({ className, ...props }: InlineRegistryIconProps) {
  return (
    <LoaderCircle
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      role="status"
      {...props}
    />
  );
}
