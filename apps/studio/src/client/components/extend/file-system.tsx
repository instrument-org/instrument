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
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/client/components/ui/command";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { LOADER_DELAY_MS } from "@/client/components/ui/delayed";
import { Input } from "@/client/components/ui/input";
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
import { cn, isMacOS } from "@/client/lib/utils";
import {
  createFileTreeIconResolver,
  getBuiltInSpriteSheet,
} from "@pierre/trees";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import {
  ArrowRight,
  ArrowUpDown,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Columns3,
  FileArchiveIcon,
  Filter,
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
  RENAME_IDLE,
  type RenameEvent,
  type RenameState,
  renameStep,
  renamingPathOf,
} from "./file-system-rename";
import {
  keepShown,
  normalizeSelection,
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
   * Total page count when it exceeds `previewImageUrls.length`; the pager
   * loads the remaining pages on demand via `loadPreviewImageUrl`.
   */
  previewPageCount?: number;
  /**
   * When this file was put in front of the user, for a list that is a log of
   * what they were shown rather than a folder. Sortable, and nothing else: a
   * file's own dates say when it was made and changed, which is a different
   * question and often a different answer.
   */
  shownAt?: string;
  size?: number;
  /** The Kind column's text, where the system names it: "Application". */
  typeName?: string;
  updatedAt?: string;
  /** Optional if already public/presigned. Otherwise resolved via `getFileUrl`. */
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
   * The item a context menu is open on, by path. It is outlined rather than
   * selected, the way the Finder marks what its menu acts on.
   */
  contextMenuPath?: null | string;
  /** Folder prefix to open initially, e.g. `"invoices/"`. */
  defaultPath?: string;
  /** The item selected on opening, by path, e.g. `"invoices/march.pdf"`. */
  defaultSelectedPath?: string;
  /** The order the browser opens in, when name ascending is the wrong one. */
  defaultSort?: FileSystemSortState;
  defaultView?: FileSystemView;
  /** Resolve a URL (e.g. presigned) for a file without one. */
  getFileUrl?: (file: FileSystemFileItem) => Promise<string> | string;
  /**
   * Where an item lives on this computer, for dragging it out of the window
   * and into another app the way a row in the Finder drags. Left out, nothing
   * drags; an item it names nothing for does not either.
   */
  getHostPath?: (item: FileSystemItem) => string | undefined;
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
   * Lazily render a page thumbnail beyond the eagerly provided
   * `previewImageUrls` (the pager calls this as pages come into view).
   */
  loadPreviewImageUrl?: (
    file: FileSystemFileItem,
    pageIndex: number,
  ) => Promise<null | string>;
  /**
   * Whether the selection takes the keyboard with it as it moves. False while
   * something outside holds focus and walks the selection from there, so the
   * rows never pull focus out of it.
   */
  moveFocusWithSelection?: boolean;
  onColumnWidthChange?: (columnWidth: number) => void;
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
  /**
   * The selection moved. `item` is the one of it the keyboard is on, the last
   * picked; `items` is all of it, several after a ⌘- or Shift-click.
   */
  onSelectionChange?: (
    item: FileSystemItem | null,
    items: FileSystemItem[],
  ) => void;
  onShowHiddenFilesChange?: (showHiddenFiles: boolean) => void;
  onSortChange?: (sort: FileSystemSortState) => void;
  /**
   * What is selected, to the Trash, by the platform's key for it: ⌘⌫ on the
   * Mac, Delete elsewhere. Left out, the key is nobody's here.
   */
  onTrash?: (items: FileSystemItem[]) => void;
  onViewChange?: (view: FileSystemView) => void;
  /** Controls drawn under a selected file's name in the columns view's preview pane. */
  renderFileActions?: (file: FileSystemFileItem) => React.ReactNode;
  /** Custom preview node for files without `previewImageUrl`. */
  renderFilePreview?: (file: FileSystemFileItem) => React.ReactNode;
  /** What the columns view shows in its preview pane for a selected file, when something other than its icon. */
  renderFileStage?: (file: FileSystemFileItem) => React.ReactNode;
  /** Controls drawn at the head of the toolbar, before the folder's name: back and forward. */
  renderHeaderLead?: () => React.ReactNode;
  /** The host's primary action, drawn after the folder's name and before the view switcher. */
  renderHeaderPrimary?: () => React.ReactNode;
  /** Controls drawn among the toolbar's own, between the filters and the search. */
  renderHeaderActions?: () => React.ReactNode;
  /**
   * What the columns view shows past the last column while no file is
   * selected, given the folder that column lists.
   */
  renderTrailing?: (folderPath: string) => React.ReactNode;
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
   * browser keeps its own, opening in `defaultSort`.
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
  if (isMacOS() ? event.metaKey : event.ctrlKey) return "toggle";
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
function Calendar03Glyph(props: InlineRegistryIconProps) {
  return <Calendar {...props} />;
}
function File01Glyph(props: InlineRegistryIconProps) {
  return <FileArchiveIcon {...props} />;
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
function fileKindLabel(file: FileEntry) {
  if (file.typeName) return file.typeName;
  const byExtension = FILE_KIND_LABELS[fileExtension(file.name)];
  if (byExtension) return byExtension;
  if (file.contentType?.startsWith("image/")) return "Image";
  return file.contentType ?? "Document";
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
const FALLBACK_MIME_TYPE = "application/octet-stream";
const MIME_TYPE_LABELS: Record<string, string> = {
  "application/json": "JSON",
  "application/msword": "Word document (legacy)",
  "application/pdf": "PDF",
  "application/sql": "SQL",
  "application/vnd.ms-excel": "Excel workbook (legacy)",
  "application/vnd.ms-powerpoint": "PowerPoint (legacy)",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "PowerPoint",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    "Excel workbook",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "Word document",
  "application/x-sh": "Shell script",
  "application/zip": "ZIP archive",
  [FALLBACK_MIME_TYPE]: "Binary",
  "image/gif": "GIF image",
  "image/jpeg": "JPEG image",
  "image/png": "PNG image",
  "image/svg+xml": "SVG image",
  "image/webp": "WebP image",
  "text/css": "CSS",
  "text/csv": "CSV",
  "text/javascript": "JavaScript",
  "text/jsx": "JSX",
  "text/markdown": "Markdown",
  "text/mdx": "MDX",
  "text/plain": "Plain text",
  "text/tab-separated-values": "TSV",
  "text/x-go": "Go",
  "text/x-python": "Python",
  "text/x-rust": "Rust",
  "text/x-typescript": "TypeScript",
  "text/yaml": "YAML",
};
export type FileSystemViewerKind = "docx" | "image" | "pdf" | "pptx" | "xlsx";
function fileTypeFilterGroup(mime: string): FileTypeFilterGroup {
  if (
    mime === "application/pdf" ||
    mime === "application/msword" ||
    mime === "application/vnd.ms-powerpoint" ||
    mime ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "Documents";
  }
  if (
    mime === "application/vnd.ms-excel" ||
    mime ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mime === "text/csv" ||
    mime === "text/tab-separated-values"
  ) {
    return "Spreadsheets";
  }
  if (mime.startsWith("image/")) return "Images";
  if (
    mime === "application/json" ||
    mime === "application/sql" ||
    mime === "application/x-sh" ||
    mime === "text/css" ||
    mime === "text/javascript" ||
    mime === "text/jsx" ||
    mime === "text/x-go" ||
    mime === "text/x-python" ||
    mime === "text/x-rust" ||
    mime === "text/x-typescript" ||
    mime === "text/yaml"
  ) {
    return "Code";
  }
  if (
    mime === "text/markdown" ||
    mime === "text/mdx" ||
    mime === "text/plain"
  ) {
    return "Text";
  }
  return "Archives & binary";
}
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
  // Not in SORT_OPTIONS, so it never appears in the toolbar: only a list whose
  // items carry `shownAt` can be in this order, and it opens in it.
  | "shownAt"
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
function formatByteSize(size: number | undefined) {
  if (size === undefined) return null;
  if (size < 1000) return `${size} bytes`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = size;
  for (const unit of units) {
    value /= 1000;
    if (value < 1000 || unit === "TB") {
      return `${value >= 100 ? Math.round(value) : value.toFixed(value >= 10 ? 1 : 2).replace(/\.?0+$/, "")} ${unit}`;
    }
  }
  return null;
}
// Made once: `toLocaleDateString` with options builds a formatter per call,
// which a list of dates redrawn on every arrow press cannot afford.
const DAY_FORMAT = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const TIME_FORMAT = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});
function formatTimestamp(value: string | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${DAY_FORMAT.format(date)} at ${TIME_FORMAT.format(date)}`;
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
const DEFAULT_SORT: FileSystemSortState = { direction: "asc", key: "name" };
type FileSystemDateFilterType = Exclude<FileSystemFilterType, "fileType">;
type FileSystemFilter = {
  id: string;
  operator: FileSystemFilterOperator;
  type: FileSystemFilterType;
  value: string[];
};
type FileSystemFilterOperator =
  | "after"
  | "before"
  | "in-range"
  | "is"
  | "is-any-of"
  | "is-not"
  | "not-in-range";
type FileSystemFilterType = "dateCreated" | "dateModified" | "fileType";
type FileTypeFilterGroup =
  | "Archives & binary"
  | "Code"
  | "Documents"
  | "Images"
  | "Spreadsheets"
  | "Text";
type FileTypeFilterOption = {
  group: FileTypeFilterGroup;
  /** Sample file name so the option icon reuses the file-type sprite. */
  iconFileName: string;
  label: string;
  mime: string;
};
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
    SORT_OPTIONS.find((option) => option.key === key)?.defaultDirection ?? "asc"
  );
}
function entrySortTimestamp(
  entry: FileSystemEntry,
  key: "createdAt" | "shownAt" | "updatedAt",
) {
  // A folder is never shown to anyone, so it has no `shownAt` to read.
  const value =
    key === "shownAt"
      ? entry.kind === "file"
        ? entry.shownAt
        : undefined
      : entry[key];
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(time) ? 0 : time;
}
const FILE_TYPE_FILTER_GROUPS: FileTypeFilterGroup[] = [
  "Documents",
  "Spreadsheets",
  "Images",
  "Code",
  "Text",
  "Archives & binary",
];
const FILTER_TYPE_LABELS: Record<FileSystemFilterType, string> = {
  dateCreated: "Date created",
  dateModified: "Date modified",
  fileType: "File type",
};
const FILTER_OPERATOR_LABELS: Record<FileSystemFilterOperator, string> = {
  after: "after",
  before: "before",
  "in-range": "in range",
  is: "is",
  "is-any-of": "is any of",
  "is-not": "is not",
  "not-in-range": "not in range",
};
// Relative cutoffs for the date filters, mirroring Extend's table filters.
const DATE_FILTER_PRESETS = [
  "1 day ago",
  "3 days ago",
  "1 week ago",
  "1 month ago",
  "3 months ago",
  "6 months ago",
  "1 year ago",
];
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
function dateFilterPresetCutoff(preset: string) {
  const date = new Date();
  switch (preset) {
    case "1 day ago": {
      date.setDate(date.getDate() - 1);
      break;
    }
    case "1 month ago": {
      date.setMonth(date.getMonth() - 1);
      break;
    }
    case "1 week ago": {
      date.setDate(date.getDate() - 7);
      break;
    }
    case "1 year ago": {
      date.setFullYear(date.getFullYear() - 1);
      break;
    }
    case "3 days ago": {
      date.setDate(date.getDate() - 3);
      break;
    }
    case "3 months ago": {
      date.setMonth(date.getMonth() - 3);
      break;
    }
    case "6 months ago": {
      date.setMonth(date.getMonth() - 6);
      break;
    }
    default: {
      const parsed = Date.parse(preset);
      if (!Number.isNaN(parsed)) return new Date(parsed);
    }
  }
  return date;
}
function fileMatchesFilter(file: FileEntry, filter: FileSystemFilter) {
  if (filter.value.length === 0) return true;
  if (filter.type === "fileType") {
    const matches = filter.value.includes(mimeTypeForFile(file));
    return filter.operator === "is-not" ? !matches : matches;
  }
  const timestamp =
    filter.type === "dateCreated" ? file.createdAt : file.updatedAt;
  const time = timestamp ? Date.parse(timestamp) : Number.NaN;
  if (Number.isNaN(time)) return false;
  if (filter.operator === "in-range" || filter.operator === "not-in-range") {
    const from = Date.parse(filter.value[0] ?? "");
    const to = Date.parse(filter.value[1] ?? filter.value[0] ?? "");
    const isInRange = time >= from && time <= to;
    return filter.operator === "not-in-range" ? !isInRange : isInRange;
  }
  const cutoff = dateFilterPresetCutoff(filter.value[0] ?? "").getTime();
  return filter.operator === "before" ? time <= cutoff : time >= cutoff;
}
function filterOperatorChoices(
  filter: FileSystemFilter,
): FileSystemFilterOperator[] {
  if (filter.type === "fileType") {
    return filter.value.length > 1 ? ["is-any-of", "is-not"] : ["is", "is-not"];
  }
  if (isCustomDateRangeValue(filter.value)) return ["in-range", "not-in-range"];
  return ["before", "after"];
}
function folderHasChildren(index: FileSystemIndex, folder: FolderEntry) {
  return (
    (index.children.get(folder.path)?.length ?? 0) > 0 ||
    folder.hasChildren === true
  );
}
// Custom ranges store two ISO timestamps instead of a relative preset.
function isCustomDateRangeValue(value: string[]) {
  return (
    value.length === 2 &&
    value.every(
      (entry) =>
        !DATE_FILTER_PRESETS.includes(entry) &&
        !Number.isNaN(Date.parse(entry)),
    )
  );
}
// The folder glyph as one SVG source, drawn from a data URL wherever a folder
// is.
const FOLDER_GLYPH_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 50" width="64" height="50"><defs><linearGradient id="fs-folder-back" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#3dabf5"/><stop offset="1" stop-color="#1d84dd"/></linearGradient><linearGradient id="fs-folder-front" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#7accfb"/><stop offset="1" stop-color="#37a0ef"/></linearGradient></defs><path d="M5 10c0-3.31 2.69-6 6-6h10.9c1.6 0 3.13.7 4.18 1.9l1.5 1.73a3.5 3.5 0 0 0 2.64 1.22H54c2.76 0 5 2.24 5 5V40c0 3.87-3.13 7-7 7H12c-3.87 0-7-3.13-7-7V10Z" fill="url(#fs-folder-back)"/><path d="M5 15.5h54V40c0 3.87-3.13 7-7 7H12c-3.87 0-7-3.13-7-7V15.5Z" fill="url(#fs-folder-front)"/></svg>`;
const FOLDER_GLYPH_DATA_URL = `data:image/svg+xml,${encodeURIComponent(FOLDER_GLYPH_SVG)}`;
export function FileSystemFolderGlyph({
  className,
  src = FOLDER_GLYPH_DATA_URL,
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
      src={src}
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
  loadPreviewImageUrl,
  pageable = false,
  pageUrlCache,
  previewAspectRatio,
  previewClassName,
  renderFilePreview,
  style,
}: {
  className?: string;
  file: FileEntry;
  loadPreviewImageUrl?: (
    file: FileSystemFileItem,
    pageIndex: number,
  ) => Promise<null | string>;
  /** Show a hover pager over multi-page thumbnails. */
  pageable?: boolean;
  /**
   * Shared `"path#pageIndex"` → URL cache so pages fetched by one pager
   * (gallery stage, columns preview) are reused by every other instance.
   */
  pageUrlCache?: Map<string, string>;
  /**
   * The shape to draw the preview in, width over height, when neither the
   * file nor the loaded image says. A file's own `previewAspectRatio` wins;
   * failing that, an image that has loaded is drawn in its own shape.
   */
  previewAspectRatio?: number;
  previewClassName?: string;
  renderFilePreview?: (file: FileSystemFileItem) => React.ReactNode;
  style?: React.CSSProperties;
}) {
  const previewUrls = filePreviewUrls(file);
  const canLoadLazily = pageable && Boolean(loadPreviewImageUrl);
  const totalPages = Math.max(
    previewUrls.length,
    canLoadLazily ? (file.previewPageCount ?? 0) : 0,
  );
  const [pageIndex, setPageIndex] = React.useState(0);
  const [lazyPageUrls, setLazyPageUrls] = React.useState<
    Record<number, string>
  >({});
  const clampedPageIndex = Math.min(pageIndex, Math.max(totalPages - 1, 0));
  const previewUrl =
    previewUrls[clampedPageIndex] ??
    lazyPageUrls[clampedPageIndex] ??
    pageUrlCache?.get(`${file.path}#${clampedPageIndex}`) ??
    null;
  const naturalAspectRatio = useNaturalAspectRatio(previewUrl);
  const resolvedAspectRatio =
    file.previewAspectRatio ?? naturalAspectRatio ?? previewAspectRatio;
  const isLazyPagePending =
    canLoadLazily && !previewUrl && clampedPageIndex < totalPages;
  const fileRef = React.useRef(file);
  React.useEffect(() => {
    fileRef.current = file;
  });
  const [previousFilePath, setPreviousFilePath] = React.useState(file.path);
  if (!Object.is(previousFilePath, file.path)) {
    setPreviousFilePath(file.path);
    setPageIndex(0);
    setLazyPageUrls({});
  }
  // Keyed by path (not object identity) so manifest churn doesn't re-request
  // the page already being loaded.
  React.useEffect(() => {
    if (!isLazyPagePending || !loadPreviewImageUrl) return;
    let isCurrent = true;
    void loadPreviewImageUrl(fileRef.current, clampedPageIndex)
      .then((url) => {
        // Cache even when stale (page flipped away mid-load): the fetch is
        // done, so let the next visit use it.
        if (url) pageUrlCache?.set(`${file.path}#${clampedPageIndex}`, url);
        if (isCurrent && url) {
          setLazyPageUrls((previous) => ({
            ...previous,
            [clampedPageIndex]: url,
          }));
        }
      })
      .catch(() => {});
    return () => {
      isCurrent = false;
    };
  }, [
    clampedPageIndex,
    file.path,
    isLazyPagePending,
    loadPreviewImageUrl,
    pageUrlCache,
  ]);
  const customPreview =
    !previewUrl && !isLazyPagePending ? renderFilePreview?.(file) : null;
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
      isLoading={isLazyPagePending}
      previewAspectRatio={resolvedAspectRatio}
      // Previews are drawn on white, as a page is. The white is the image's
      // own backing so it arrives with the image; on the box it would sit
      // under the loading placeholder and show through as the image fades in.
      previewClassName={cn(!isIcon && "[&>img]:bg-white", previewClassName)}
      previewContent={
        previewUrl || isLazyPagePending
          ? undefined
          : (customPreview ?? <FileGenericPreview file={file} />)
      }
      previewImageUrl={previewUrl ?? undefined}
      previewUnavailableContent={
        customPreview ?? <FileGenericPreview file={file} />
      }
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
  renderFilePreview,
}: {
  /** The room the thumbnail has, in rem. */
  box: { height: number; width: number };
  className?: string;
  file: FileEntry;
  /** The width of a thumbnail drawn as a page. */
  pageClassName: string;
  renderFilePreview?: (file: FileSystemFileItem) => React.ReactNode;
}) {
  const aspectRatio = useFileAspectRatio(file);
  return (
    <FileVisual
      className={cn(className, aspectRatio === undefined && pageClassName)}
      file={file}
      previewAspectRatio={0.78}
      renderFilePreview={renderFilePreview}
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
  className,
  columnWidth: columnWidthProp,
  contextMenuPath = null,
  defaultPath = "",
  defaultSelectedPath,
  defaultSort,
  defaultView = "icons",
  getFileUrl,
  getHostPath,
  items,
  pendingFolders,
  listColumns: listColumnsProp,
  listColumnWidths: listColumnWidthsProp,
  loadChildren,
  loadPreviewImageUrl,
  moveFocusWithSelection = true,
  onColumnWidthChange,
  onFileOpen,
  onItemContextMenu,
  onListColumnsChange,
  onListColumnWidthsChange,
  onOpenSeveral,
  onPathChange,
  onRenameCommit,
  onSelectionChange,
  onShowHiddenFilesChange,
  onSortChange,
  onTrash,
  onViewChange,
  prefetchChildren,
  ref,
  renderFileActions,
  renderFilePreview,
  renderFileStage,
  renderHeaderActions,
  renderHeaderPrimary,
  renderHeaderLead,
  renderTrailing,
  renderUnreadable,
  selectedPath: selectedPathProp,
  showHiddenFiles: showHiddenFilesProp,
  sort: sortProp,
  title = "Files",
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
  const [searchInput, setSearchInput] = React.useState("");
  const searchInputRef = React.useRef<HTMLInputElement | null>(null);
  const [isSearchExpanded, setIsSearchExpanded] = React.useState(false);
  const searchQuery = normalizeSearchQuery(searchInput);
  const isSearching = searchQuery.length > 0;
  const [internalSort, setInternalSort] = React.useState(
    defaultSort ?? DEFAULT_SORT,
  );
  const sort = sortProp ?? internalSort;
  const setSort = (next: FileSystemSortState) => {
    setInternalSort(next);
    onSortChange?.(next);
  };
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
  const [filters, setFilters] = React.useState<FileSystemFilter[]>([]);
  const hasActiveFilters = filters.length > 0;
  // Files must pass every active filter; folders stay visible through
  // matching descendants, so the predicate only ever sees files.
  const fileFilter = React.useMemo(() => {
    if (filters.length === 0) return null;
    return (file: FileEntry) =>
      filters.every((filter) => fileMatchesFilter(file, filter));
  }, [filters]);
  // Paths that stay visible while searching or filtering: every file whose
  // currentPath-relative path contains the query — the list view tree's
  // hide-non-matches semantics — and that passes the filters, plus the
  // ancestor folders leading to it. Folder names participate in search
  // matches only when no filters are active; with filters, a folder is only
  // as visible as the files inside it.
  const visiblePaths = React.useMemo(() => {
    if (!isSearching && !fileFilter) return null;
    const visible = new Set<string>();
    const markVisible = (path: string) => {
      while (path && path !== currentPath && !visible.has(path)) {
        visible.add(path);
        path = pathParent(path);
      }
    };
    const matchesQuery = (path: string) =>
      !isSearching ||
      path.slice(currentPath.length).toLowerCase().includes(searchQuery);
    for (const [path, file] of index.files) {
      if (path === currentPath) continue;
      if (currentPath && !path.startsWith(currentPath)) continue;
      if (!matchesQuery(path)) continue;
      if (fileFilter && !fileFilter(file)) continue;
      markVisible(path);
    }
    if (!fileFilter) {
      for (const path of index.folders.keys()) {
        if (path === currentPath) continue;
        if (currentPath && !path.startsWith(currentPath)) continue;
        if (matchesQuery(path)) markVisible(path);
      }
    }
    return visible;
  }, [currentPath, fileFilter, index, isSearching, searchQuery]);
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
  // Children re-sorted per the active sort; the default (name ascending)
  // reuses the index's pre-sorted arrays untouched.
  const sortedIndex = React.useMemo(() => {
    if (
      sort.key === DEFAULT_SORT.key &&
      sort.direction === DEFAULT_SORT.direction
    ) {
      return visibleIndex;
    }
    const children = new Map<string, FileSystemEntry[]>();
    for (const [parentPath, parentChildren] of visibleIndex.children) {
      children.set(
        parentPath,
        [...parentChildren].sort((left, right) =>
          compareEntriesBySort(left, right, sort),
        ),
      );
    }
    return { ...visibleIndex, children };
  }, [sort, visibleIndex]);
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
  // Distinct MIME types across the loaded manifest, labeled for the filter
  // menu; the first file seen per type lends its name to the option icon.
  const fileTypeOptions = React.useMemo(() => {
    const byMime = new Map<string, FileTypeFilterOption>();
    for (const file of index.files.values()) {
      const mime = mimeTypeForFile(file);
      if (!byMime.has(mime)) {
        // The leading-dot check keeps dotfiles (.gitignore) whole.
        const dotIndex = file.name.lastIndexOf(".");
        const extension =
          dotIndex > 0 ? file.name.slice(dotIndex + 1).toLowerCase() : "";
        byMime.set(mime, {
          group: fileTypeFilterGroup(mime),
          // A synthesized generic name, so files with branded icons
          // (biome.json, next.config.ts, CLAUDE.md, …) don't lend them to
          // the whole type; extensionless names keep their own icon
          // (Dockerfile, Makefile).
          iconFileName: extension ? `file.${extension}` : file.name,
          label: MIME_TYPE_LABELS[mime] ?? mime,
          mime,
        });
      }
    }
    return [...byMime.values()].sort((left, right) =>
      left.label.localeCompare(right.label),
    );
  }, [index]);
  const filterIdRef = React.useRef(0);
  const [dateRangeDialog, setDateRangeDialog] = React.useState<null | {
    initialRange?: {
      from: Date;
      to: Date;
    };
    type: FileSystemDateFilterType;
  }>(null);
  const toggleFileTypeFilterValue = React.useCallback(
    (mime: string, checked: boolean) => {
      const id = `filter-${++filterIdRef.current}`;
      setFilters((previous) => {
        const existing = previous.find((filter) => filter.type === "fileType");
        if (!existing) {
          if (!checked) return previous;
          return [
            ...previous,
            {
              id,
              operator: "is" as const,
              type: "fileType" as const,
              value: [mime],
            },
          ];
        }
        const value = checked
          ? [...new Set([mime, ...existing.value])]
          : existing.value.filter((entry) => entry !== mime);
        if (value.length === 0) {
          return previous.filter((filter) => filter !== existing);
        }
        // "is" and "is any of" track the value count; "is not" is unaffected.
        const operator =
          existing.operator === "is" || existing.operator === "is-any-of"
            ? value.length > 1
              ? ("is-any-of" as const)
              : ("is" as const)
            : existing.operator;
        return previous.map((filter) =>
          filter === existing ? { ...filter, operator, value } : filter,
        );
      });
    },
    [],
  );
  const setDatePresetFilter = React.useCallback(
    (type: FileSystemDateFilterType, preset: string) => {
      const id = `filter-${++filterIdRef.current}`;
      setFilters((previous) => [
        ...previous.filter((filter) => filter.type !== type),
        { id, operator: "after", type, value: [preset] },
      ]);
    },
    [],
  );
  // Editing an existing custom range seeds the dialog with its bounds.
  const openDateRangeDialog = React.useCallback(
    (type: FileSystemDateFilterType) => {
      const existing = filters.find((filter) => filter.type === type);
      setDateRangeDialog({
        initialRange:
          existing && isCustomDateRangeValue(existing.value)
            ? {
                from: new Date(existing.value[0] ?? ""),
                to: new Date(existing.value[1] ?? ""),
              }
            : undefined,
        type,
      });
    },
    [filters],
  );
  const applyCustomDateRange = React.useCallback(
    (type: FileSystemDateFilterType, from: Date, to: Date) => {
      const id = `filter-${++filterIdRef.current}`;
      setFilters((previous) => {
        const existing = previous.find((filter) => filter.type === type);
        return [
          ...previous.filter((filter) => filter.type !== type),
          {
            id,
            operator:
              existing?.operator === "not-in-range"
                ? ("not-in-range" as const)
                : ("in-range" as const),
            type,
            value: [from.toISOString(), to.toISOString()],
          },
        ];
      });
    },
    [],
  );
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
      setSearchInput("");
      setIsSearchExpanded(false);
      selectEntry(null);
      ensureChildren(path);
    },
    [ensureChildren, selectEntry],
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
  // Component-lifetime caches shared by every view and the open dialog:
  // resolved (e.g. presigned) URLs keyed by path, and lazily loaded page
  // thumbnails keyed by `"path#pageIndex"`. Each resolution happens once no
  // matter how often the user revisits a file or switches views; stable
  // URLs also keep the browser's HTTP cache valid for fetched content.
  // Lazy state (never set) rather than refs: the Maps are passed down
  // during render, which the rules of React disallow for ref reads.
  const [resolvedUrlCache] = React.useState(() => new Map<string, string>());
  const [pageUrlCache] = React.useState(() => new Map<string, string>());
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
      void (async () => {
        let url = file.url ?? resolvedUrlCache.get(file.path) ?? null;
        if (!url && getFileUrl) {
          try {
            url = await getFileUrl(file);
            if (url) resolvedUrlCache.set(file.path, url);
          } catch {
            url = null;
          }
        }
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
      })();
    },
    [getFileUrl, onFileOpen, poolStagePath, resolvedUrlCache],
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
  React.useImperativeHandle(ref, () => ({ startRename }), [startRename]);
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
    switch (command.type) {
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
      case "open":
        if (!lead) return false;
        openEntry(lead);
        return true;
      case "return":
        if (!lead) return false;
        // Several selected are renamed one at a time or not at all.
        if (selectedPathsOf(selectionRef.current).length > 1) return true;
        if (canRename && nav.renames) {
          startRename(lead.path);
        } else {
          openEntry(lead);
        }
        return true;
      case "select-all":
        selectEntries(nav.rows);
        return true;
      case "space":
        return true;
      case "trash": {
        const picked = selectedPathsOf(selectionRef.current).flatMap((path) => {
          const each = entryOf(path);
          return each ? [each] : [];
        });
        if (!onTrash || picked.length === 0) return false;
        onTrash(picked);
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
    columnWidth: columnWidthProp,
    currentPath,
    draggable: dragArea.draggable,
    enabledListColumns: listColumns,
    entries: currentEntries,
    fileFilter,
    getFileUrl,
    index: sortedIndex,
    listColumnWidths,
    loadingFolders,
    loadPreviewImageUrl,
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
    onSortColumnClick: toggleSortColumn,
    pageUrlCache,
    poolStagePath,
    registerStageHost,
    renamingPath,
    renderFileActions,
    renderFilePreview,
    renderFileStage,
    renderNameField,
    renderTrailing,
    renderUnreadable,
    rowGestures,
    searchQuery,
    selectedEntry,
    selectedPath,
    selection,
    sort,
    treeExpansionRef,
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
        const command = listingCommandOf(event, isMacOS());
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
        <div className="flex @md/finder-header:hidden">
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
        </div>
        <Tabs
          // Arrows on a focused view only move between the views, and Return
          // or Space picks one: switching on every arrow fought the listing
          // for the same keys.
          activationMode="manual"
          className="hidden gap-0 @md/finder-header:flex"
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
        <div className="flex min-w-0 items-center justify-end gap-1.5">
          <FileSystemSortSelect onKeyChange={applySortKey} sort={sort} />
          <FileSystemFilterMenu
            fileTypeOptions={fileTypeOptions}
            filters={filters}
            onOpenCustomRange={openDateRangeDialog}
            onSelectDatePreset={setDatePresetFilter}
            onShowHiddenFilesChange={setShowHiddenFiles}
            onToggleFileType={toggleFileTypeFilterValue}
            showHiddenFiles={showHiddenFiles}
          />
          {renderHeaderActions ? renderHeaderActions() : null}
          <FileSystemSearchField
            inputRef={searchInputRef}
            isExpanded={isSearchExpanded}
            layout={headerLayout}
            onExpandedChange={setIsSearchExpanded}
            onValueChange={setSearchInput}
            value={searchInput}
          />
        </div>
      </div>
      {hasActiveFilters ? (
        <div
          className="flex shrink-0 flex-wrap items-center gap-1 border-b bg-muted/20 px-2 py-1.5 text-xs text-muted-foreground"
          onContextMenu={(event) => {
            event.preventDefault();
          }}
        >
          {filters.map((filter) => {
            const dateFilterType =
              filter.type === "fileType" ? null : filter.type;
            return (
              <FileSystemFilterPill
                fileTypeOptions={fileTypeOptions}
                filter={filter}
                key={filter.id}
                onOpenCustomRange={
                  dateFilterType
                    ? () => openDateRangeDialog(dateFilterType)
                    : undefined
                }
                onOperatorChange={(operator) =>
                  setFilters((previous) =>
                    previous.map((entry) =>
                      entry.id === filter.id ? { ...entry, operator } : entry,
                    ),
                  )
                }
                onRemove={() =>
                  setFilters((previous) =>
                    previous.filter((entry) => entry.id !== filter.id),
                  )
                }
                onSelectDatePreset={(preset) =>
                  setFilters((previous) =>
                    previous.map((entry) =>
                      entry.id === filter.id
                        ? {
                            ...entry,
                            operator:
                              entry.operator === "before" ||
                              entry.operator === "after"
                                ? entry.operator
                                : "after",
                            value: [preset],
                          }
                        : entry,
                    ),
                  )
                }
                onToggleFileType={toggleFileTypeFilterValue}
              />
            );
          })}
          <button
            className="rounded-md px-1.5 py-0.5 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setFilters([])}
            type="button"
          >
            Clear
          </button>
        </div>
      ) : null}
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
        ) : currentEntries.length === 0 &&
          (view !== "columns" || isSearching || hasActiveFilters) ? (
          <FileSystemEmptyState
            label={
              isSearching
                ? `No results for “${searchInput.trim()}”`
                : hasActiveFilters
                  ? "No items match the active filters"
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
              getFileUrl={getFileUrl}
              loadPreviewImageUrl={loadPreviewImageUrl}
              pageUrlCache={pageUrlCache}
              renderFilePreview={renderFilePreview}
              toolbarActions={
                isOpenedInDialog ? viewerCloseToolbarAction : undefined
              }
              urlCache={resolvedUrlCache}
              variant={isOpenedInDialog ? "dialog" : "stage"}
            />,
            container,
            path,
          );
        })}
      </Dialog>
      {dateRangeDialog ? (
        <FileSystemDateRangeDialog
          initialRange={dateRangeDialog.initialRange}
          onApply={(from, to) => {
            applyCustomDateRange(dateRangeDialog.type, from, to);
            setDateRangeDialog(null);
          }}
          onClose={() => setDateRangeDialog(null)}
        />
      ) : null}
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
  "min-h-8 w-auto min-w-0 shrink-0 gap-1 bg-none px-2 dark:border-0 [&>svg:last-child]:size-2.5",
);
// The square, icon-only member of that family.
export const TOOLBAR_ICON_BUTTON_CLASSNAME = cn(
  TOOLBAR_CONTROL_CLASSNAME,
  "flex size-8 shrink-0 items-center justify-center text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
);
// Searchable file-type list (cmdk) rendered inside a menu popup, so the
// long MIME list can be filtered by typing. Selection toggles stay open for
// multi-select; ArrowUp/Down and Enter come from cmdk's combobox semantics.
function FileSystemFileTypeCommand({
  checkedMimes,
  onToggle,
  options,
}: {
  checkedMimes: string[];
  onToggle: (mime: string, checked: boolean) => void;
  options: FileTypeFilterOption[];
}) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  // The menu focuses its popup when it opens; pull focus into the search
  // field so typing filters immediately.
  React.useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <Command
      // -m-1 spans the menu viewport's built-in padding so the search
      // field's bottom border runs edge to edge.
      className="-m-1 w-[calc(100%+--spacing(2))] bg-transparent"
      // cmdk owns the keyboard while focus is in the list; only Escape
      // (close the menu) and Tab continue outward.
      onKeyDown={(event) => {
        if (event.key !== "Escape" && event.key !== "Tab") {
          event.stopPropagation();
        }
      }}
    >
      <CommandInput
        className="h-9"
        placeholder="Search file types…"
        ref={inputRef}
      />
      <CommandList className="max-h-none">
        <CommandEmpty>No file types found.</CommandEmpty>
        <InlineScrollArea2 className="h-auto max-h-64" orientation="vertical">
          {FILE_TYPE_FILTER_GROUPS.map((group) => {
            const groupOptions = options.filter(
              (option) => option.group === group,
            );
            if (groupOptions.length === 0) return null;
            return (
              <CommandGroup heading={group} key={group}>
                {groupOptions.map((option) => {
                  const isChecked = checkedMimes.includes(option.mime);
                  return (
                    <CommandItem
                      key={option.mime}
                      keywords={[option.mime]}
                      onSelect={() => onToggle(option.mime, !isChecked)}
                      value={option.label}
                    >
                      <Check
                        className={cn(
                          "size-4 text-foreground",
                          !isChecked && "opacity-0",
                        )}
                      />
                      <FileTypeIcon
                        className="size-4"
                        fileName={option.iconFileName}
                      />
                      {option.label}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            );
          })}
        </InlineScrollArea2>
      </CommandList>
    </Command>
  );
}
// Toolbar filter menu: file types as a searchable checklist, dates as
// single-select presets plus a custom range, mirroring Extend's table
// filters.
function FileSystemFilterMenu({
  fileTypeOptions,
  filters,
  onOpenCustomRange,
  onSelectDatePreset,
  onShowHiddenFilesChange,
  onToggleFileType,
  showHiddenFiles,
}: {
  fileTypeOptions: FileTypeFilterOption[];
  filters: FileSystemFilter[];
  onOpenCustomRange: (type: FileSystemDateFilterType) => void;
  onSelectDatePreset: (type: FileSystemDateFilterType, preset: string) => void;
  onShowHiddenFilesChange: (showHiddenFiles: boolean) => void;
  onToggleFileType: (mime: string, checked: boolean) => void;
  showHiddenFiles: boolean;
}) {
  const fileTypeFilter = filters.find((filter) => filter.type === "fileType");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="Filter"
          className={cn(TOOLBAR_ICON_BUTTON_CLASSNAME, "relative sm:size-8")}
          size="icon-sm"
          title="Filter"
          type="button"
          variant="outline"
        >
          <Filter className="size-4" />
          {filters.length > 0 ? (
            <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <FileArchiveIcon className="size-4 text-muted-foreground" />
            File type
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-60">
            <FileSystemFileTypeCommand
              checkedMimes={fileTypeFilter?.value ?? []}
              onToggle={onToggleFileType}
              options={fileTypeOptions}
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {(["dateModified", "dateCreated"] as const).map((type) => (
          <DropdownMenuSub key={type}>
            <DropdownMenuSubTrigger>
              <Calendar className="size-4 text-muted-foreground" />
              {FILTER_TYPE_LABELS[type]}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <InlineScrollArea2
                className="h-auto max-h-72"
                orientation="vertical"
              >
                {DATE_FILTER_PRESETS.map((preset) => (
                  <DropdownMenuItem
                    key={preset}
                    onClick={() => onSelectDatePreset(type, preset)}
                  >
                    {preset}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem onClick={() => onOpenCustomRange(type)}>
                  Custom date range…
                </DropdownMenuItem>
              </InlineScrollArea2>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
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
        <button
          aria-label="Search"
          className={cn(TOOLBAR_ICON_BUTTON_CLASSNAME, "relative")}
          title="Search"
          type="button"
        >
          <Search className="size-4" />
          {value ? (
            <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1" sideOffset={6}>
        {input}
      </PopoverContent>
    </Popover>
  );
}
// Toolbar "sort by" select, as the sort glyph alone: the order in force is
// one press away in the menu, and the folder itself shows it.
function FileSystemSortSelect({
  onKeyChange,
  sort,
}: {
  onKeyChange: (key: FileSystemSortKey) => void;
  sort: FileSystemSortState;
}) {
  return (
    <Select
      onValueChange={(value) => onKeyChange(value as FileSystemSortKey)}
      value={sort.key}
    >
      <SelectTrigger
        aria-label="Sort by"
        className={TOOLBAR_SELECT_TRIGGER_CLASSNAME}
        size="sm"
        title="Sort by"
      >
        <SelectValue>
          <ArrowUpDown className="size-4" />
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="end" position="popper">
        {SORT_OPTIONS.map((option) => (
          <SelectItem key={option.key} value={option.key}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
const FILTER_PILL_SEGMENT_CLASSNAME =
  "flex h-5 items-center gap-1 border border-l-0 bg-background px-1.5 whitespace-nowrap text-foreground";
const FILTER_PILL_BUTTON_CLASSNAME = cn(
  FILTER_PILL_SEGMENT_CLASSNAME,
  "outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
);
// One applied filter, rendered as a segmented pill in the status bar:
// type · operator · value · remove, each segment interactive like Extend's
// table filter pills.
function FileSystemFilterPill({
  fileTypeOptions,
  filter,
  onOpenCustomRange,
  onOperatorChange,
  onRemove,
  onSelectDatePreset,
  onToggleFileType,
}: {
  fileTypeOptions: FileTypeFilterOption[];
  filter: FileSystemFilter;
  onOpenCustomRange?: () => void;
  onOperatorChange: (operator: FileSystemFilterOperator) => void;
  onRemove: () => void;
  onSelectDatePreset: (preset: string) => void;
  onToggleFileType: (mime: string, checked: boolean) => void;
}) {
  const isCustomRange =
    filter.type !== "fileType" && isCustomDateRangeValue(filter.value);
  const selectedTypeLabels =
    filter.type === "fileType"
      ? filter.value.map(
          (mime) =>
            fileTypeOptions.find((option) => option.mime === mime)?.label ??
            mime,
        )
      : [];
  return (
    <div className="flex items-center text-xs">
      <span
        className={cn(
          FILTER_PILL_SEGMENT_CLASSNAME,
          "rounded-l-md border-l text-primary",
        )}
      >
        {filter.type === "fileType" ? (
          <File01Glyph className="size-3" />
        ) : (
          <Calendar03Glyph className="size-3" />
        )}
        {FILTER_TYPE_LABELS[filter.type]}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(FILTER_PILL_BUTTON_CLASSNAME, "text-primary")}
            type="button"
          >
            {FILTER_OPERATOR_LABELS[filter.operator]}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-28">
          {filterOperatorChoices(filter).map((operator) => (
            <DropdownMenuItem
              key={operator}
              onClick={() => onOperatorChange(operator)}
            >
              {FILTER_OPERATOR_LABELS[operator]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {filter.type === "fileType" ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={FILTER_PILL_BUTTON_CLASSNAME}
              title={selectedTypeLabels.join(", ")}
              type="button"
            >
              {filter.value.length === 1
                ? selectedTypeLabels[0]
                : `${filter.value.length} selected`}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60">
            <FileSystemFileTypeCommand
              checkedMimes={filter.value}
              onToggle={onToggleFileType}
              options={fileTypeOptions}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      ) : isCustomRange ? (
        <button
          className={FILTER_PILL_BUTTON_CLASSNAME}
          onClick={onOpenCustomRange}
          type="button"
        >
          {filter.value
            .map((value) => new Date(value).toLocaleDateString("en-US"))
            .join(" – ")}
        </button>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className={FILTER_PILL_BUTTON_CLASSNAME} type="button">
              {filter.value[0]}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <InlineScrollArea2
              className="h-auto max-h-72"
              orientation="vertical"
            >
              {DATE_FILTER_PRESETS.map((preset) => (
                <DropdownMenuItem
                  key={preset}
                  onClick={() => onSelectDatePreset(preset)}
                >
                  {preset}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem onClick={onOpenCustomRange}>
                Custom date range…
              </DropdownMenuItem>
            </InlineScrollArea2>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <button
        aria-label={`Remove ${FILTER_TYPE_LABELS[filter.type]} filter`}
        className={cn(
          FILTER_PILL_BUTTON_CLASSNAME,
          "rounded-r-md px-1 text-muted-foreground hover:text-foreground",
        )}
        onClick={onRemove}
        type="button"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
function formatDateInputValue(date: Date | undefined) {
  if (!date) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function parseDateInputValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return;
  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (isoMatch) {
    const date = new Date(
      Number(isoMatch[1]),
      Number(isoMatch[2]) - 1,
      Number(isoMatch[3]),
    );
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? undefined : new Date(parsed);
}
const DATE_RANGE_DIALOG_PRESETS = [
  "Last 7 days",
  "This month",
  "Last 1 month",
  "Last 3 months",
  "This year",
  "Last 12 months",
];
function dateRangePresetRange(preset: string) {
  const from = new Date();
  const to = new Date();
  from.setHours(0, 0, 0, 0);
  to.setHours(23, 59, 59, 999);
  switch (preset) {
    case "Last 1 month": {
      from.setMonth(from.getMonth() - 1);
      break;
    }
    case "Last 3 months": {
      from.setMonth(from.getMonth() - 3);
      break;
    }
    case "Last 7 days": {
      from.setDate(from.getDate() - 6);
      break;
    }
    case "Last 12 months": {
      from.setFullYear(from.getFullYear() - 1);
      break;
    }
    case "This month": {
      from.setDate(1);
      break;
    }
    case "This year": {
      from.setMonth(0, 1);
      break;
    }
  }
  return { from, to };
}
const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
type FileSystemViewProps = {
  /** Pooled paths currently attached to the DOM (reveal instantly). */
  attachedStagePaths: string[];
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
  fileFilter: ((file: FileEntry) => boolean) | null;
  getFileUrl?: (file: FileSystemFileItem) => Promise<string> | string;
  index: FileSystemIndex;
  listColumnWidths: Partial<Record<FileSystemListColumn, number>>;
  loadingFolders: Set<string>;
  loadPreviewImageUrl?: (
    file: FileSystemFileItem,
    pageIndex: number,
  ) => Promise<null | string>;
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
  onSortColumnClick: (key: FileSystemSortKey) => void;
  /** `"path#pageIndex"` → thumbnail URL, shared by every pager. */
  pageUrlCache: Map<string, string>;
  /** Admits a file into the root-owned keep-alive preview pool. */
  poolStagePath: (path: string) => void;
  /** Mounts/unmounts the gallery host element for a pooled path. */
  registerStageHost: (path: string, element: HTMLElement | null) => void;
  /** The row whose name is being typed over, which draws `renderNameField` in place of its name. */
  renamingPath: null | string;
  renderFileActions?: (file: FileSystemFileItem) => React.ReactNode;
  renderFilePreview?: (file: FileSystemFileItem) => React.ReactNode;
  renderFileStage?: (file: FileSystemFileItem) => React.ReactNode;
  /** The name field for the row being renamed, with the view's own spacing. */
  renderNameField: RenderNameField;
  renderTrailing?: (folderPath: string) => React.ReactNode;
  renderUnreadable?: FileSystemProps["renderUnreadable"];
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
// Custom date range dialog mirroring Extend's table filters: From/To inputs,
// a two-month range calendar, and quick presets. Applied ranges span from
// the start of the first day to the end of the last.
function FileSystemDateRangeDialog({
  initialRange,
  onApply,
  onClose,
}: {
  initialRange?: {
    from: Date;
    to: Date;
  };
  onApply: (from: Date, to: Date) => void;
  onClose: () => void;
}) {
  const [range, setRange] = React.useState<{
    from?: Date;
    to?: Date;
  }>(() => initialRange ?? {});
  const [fromInput, setFromInput] = React.useState(() =>
    formatDateInputValue(initialRange?.from),
  );
  const [toInput, setToInput] = React.useState(() =>
    formatDateInputValue(initialRange?.to),
  );
  const selectRange = (next: { from?: Date; to?: Date }) => {
    setRange(next);
    if (next.from) setFromInput(formatDateInputValue(next.from));
    if (next.to) setToInput(formatDateInputValue(next.to));
  };
  const dateField = (
    label: string,
    value: string,
    onChange: (value: string) => void,
  ) => (
    <div className="flex flex-1 flex-col gap-1.5">
      <span className="text-xs font-medium">{label}</span>
      <div className="relative flex items-center">
        <Calendar className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground" />
        <Input
          aria-label={`${label} date`}
          className="h-8 pl-8 sm:h-8"
          onChange={(event) => onChange(event.target.value)}
          placeholder="YYYY-MM-DD"
          type="text"
          value={value}
        />
      </div>
    </div>
  );
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open
    >
      <DialogContent className="w-[30rem] max-w-[calc(100vw-2rem)]">
        <DialogHeader>
          <DialogTitle>Custom date range</DialogTitle>
        </DialogHeader>
        <InlineDialogPanel className="flex flex-col gap-4">
          <div className="flex gap-3">
            {dateField("From", fromInput, (value) => {
              setFromInput(value);
              const parsed = parseDateInputValue(value);
              if (parsed)
                setRange((previous) => ({ ...previous, from: parsed }));
            })}
            {dateField("To", toInput, (value) => {
              setToInput(value);
              const parsed = parseDateInputValue(value);
              if (parsed) setRange((previous) => ({ ...previous, to: parsed }));
            })}
          </div>
          <FileSystemRangeCalendar onSelect={selectRange} range={range} />
          <div className="grid grid-cols-3 gap-2">
            {DATE_RANGE_DIALOG_PRESETS.map((preset) => (
              <Button
                key={preset}
                onClick={() => selectRange(dateRangePresetRange(preset))}
                size="sm"
                type="button"
                variant="outline"
              >
                {preset}
              </Button>
            ))}
          </div>
        </InlineDialogPanel>
        <DialogFooter>
          <Button onClick={onClose} type="button" variant="outline">
            Cancel
          </Button>
          <Button
            disabled={!range.from || !range.to}
            onClick={() => {
              if (!range.from || !range.to) return;
              const from = new Date(range.from);
              const to = new Date(range.to);
              from.setHours(0, 0, 0, 0);
              to.setHours(23, 59, 59, 999);
              onApply(from, to);
            }}
            type="button"
          >
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
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
function FileSystemEmptyState({ label }: { label: string }) {
  return (
    <div className="flex size-full items-center justify-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}
// Two-month range calendar for the custom date range dialog (one month at
// phone widths). Clicking sets the start, then the end; clicking before the
// start swaps the ends, and a third click restarts the range.
function FileSystemRangeCalendar({
  onSelect,
  range,
}: {
  onSelect: (range: { from?: Date; to?: Date }) => void;
  range: {
    from?: Date;
    to?: Date;
  };
}) {
  const [viewMonth, setViewMonth] = React.useState(() => {
    const base = range.from ?? new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const months = [
    viewMonth,
    new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1),
  ];
  const fromKey = range.from ? calendarDayKey(range.from) : null;
  const toKey = range.to ? calendarDayKey(range.to) : null;
  const todayKey = calendarDayKey(new Date());
  const handleDayClick = (day: Date) => {
    if (!range.from || range.to) {
      onSelect({ from: day });
    } else if (calendarDayKey(day) < calendarDayKey(range.from)) {
      onSelect({ from: day, to: range.from });
    } else {
      onSelect({ from: range.from, to: day });
    }
  };
  return (
    <div className="relative">
      <button
        aria-label="Previous month"
        className="absolute top-0 left-0 flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() =>
          setViewMonth(
            (previous) =>
              new Date(previous.getFullYear(), previous.getMonth() - 1, 1),
          )
        }
        type="button"
      >
        <ChevronLeft className="size-4" />
      </button>
      <button
        aria-label="Next month"
        className="absolute top-0 right-0 flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() =>
          setViewMonth(
            (previous) =>
              new Date(previous.getFullYear(), previous.getMonth() + 1, 1),
          )
        }
        type="button"
      >
        <ArrowRight className="size-4" />
      </button>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {months.map((month, monthIndex) => {
          const firstWeekday = month.getDay();
          const dayCount = new Date(
            month.getFullYear(),
            month.getMonth() + 1,
            0,
          ).getDate();
          const cells = [
            ...Array.from({ length: firstWeekday }, () => null),
            ...Array.from(
              { length: dayCount },
              (_, index) =>
                new Date(month.getFullYear(), month.getMonth(), index + 1),
            ),
          ];
          return (
            <div
              className={cn(monthIndex === 1 && "max-sm:hidden")}
              key={`${month.getFullYear()}-${month.getMonth()}`}
            >
              <div className="text-center text-sm leading-6 font-medium">
                {month.toLocaleDateString("en-US", {
                  month: "long",
                  year: "numeric",
                })}
              </div>
              <div className="mt-1 grid grid-cols-7 text-center text-xs text-muted-foreground">
                {WEEKDAY_LABELS.map((weekday) => (
                  <span className="h-6 leading-6" key={weekday}>
                    {weekday}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-y-px">
                {cells.map((day, cellIndex) => {
                  if (!day) return <span key={cellIndex} />;
                  const dayKey = calendarDayKey(day);
                  const isFrom = dayKey === fromKey;
                  const isTo = dayKey === toKey;
                  const isWithinRange =
                    fromKey !== null &&
                    toKey !== null &&
                    dayKey > fromKey &&
                    dayKey < toKey;
                  return (
                    <button
                      className={cn(
                        "flex h-7 items-center justify-center rounded-md text-xs tabular-nums outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                        isWithinRange && "rounded-none bg-accent",
                        (isFrom || isTo) &&
                          "bg-primary text-primary-foreground hover:bg-primary",
                        isFrom &&
                          toKey !== null &&
                          fromKey !== toKey &&
                          "rounded-r-none",
                        isTo && fromKey !== toKey && "rounded-l-none",
                        dayKey === todayKey &&
                          !isFrom &&
                          !isTo &&
                          "font-semibold text-primary",
                      )}
                      key={cellIndex}
                      onClick={() => handleDayClick(day)}
                      type="button"
                    >
                      {day.getDate()}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
// Resolves a display URL for a file: its own `url`, else via `getFileUrl`.
// Keyed by path/url (not object identity) so manifest churn — e.g. thumbnails
// streaming in — doesn't re-trigger presign calls for the same file. An
// optional `cache` shared across mounts serves revisited files synchronously:
// no repeat presign round-trip (and no loading flash), and the stable URL
// keeps the browser's HTTP cache valid for already-fetched content.
function useResolvedFileUrl(
  file: FileEntry | null,
  getFileUrl?: (file: FileSystemFileItem) => Promise<string> | string,
  cache?: Map<string, string>,
) {
  const [state, setState] = React.useState<{
    isResolving: boolean;
    url: null | string;
  }>(() => ({
    isResolving: false,
    url: file ? (file.url ?? cache?.get(file.path) ?? null) : null,
  }));
  const fileRef = React.useRef(file);
  React.useEffect(() => {
    fileRef.current = file;
  });
  const filePath = file?.path ?? null;
  const fileUrl = file?.url ?? null;
  React.useEffect(() => {
    const currentFile = fileRef.current;
    const knownUrl =
      fileUrl ?? (filePath ? (cache?.get(filePath) ?? null) : null);
    if (!currentFile || knownUrl || !getFileUrl) {
      setState({ isResolving: false, url: knownUrl });
      return;
    }
    let isCurrent = true;
    setState({ isResolving: true, url: null });
    void Promise.resolve(getFileUrl(currentFile))
      .then((url) => {
        if (url) cache?.set(currentFile.path, url);
        if (isCurrent) setState({ isResolving: false, url });
      })
      .catch(() => {
        if (isCurrent) setState({ isResolving: false, url: null });
      });
    return () => {
      isCurrent = false;
    };
  }, [cache, filePath, fileUrl, getFileUrl]);
  return state;
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
const ICON_ROW_GAP = 12; // gap-y-3
const ICON_ROW_STRIDE = ICON_TILE_HEIGHT + ICON_ROW_GAP;
function FileSystemIconsView({
  draggable,
  entries,
  listingNavRef,
  menuTargetPath,
  moveFocusWithSelection,
  onItemContextMenu,
  onOpen,
  onSelect,
  renamingPath,
  renderFilePreview,
  renderNameField,
  rowGestures,
  selectedEntry,
  selectedPath,
  selection,
}: FileSystemViewProps) {
  const itemRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
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
  const { end, start } = useVirtualWindow({
    count: rowCount,
    itemStride: ICON_ROW_STRIDE,
    leadingPx: ICON_GRID_PADDING,
    overscan: 4,
    viewportRef,
  });
  const visibleEntries = entries.slice(
    start * resolvedColumnCount,
    end * resolvedColumnCount,
  );
  // Selection can land outside the window (view switches, shrinking results);
  // bring its row back into the viewport so the tile mounts and is focusable.
  React.useLayoutEffect(() => {
    if (!selectedPath) return;
    const entryIndex = entries.findIndex(
      (entry) => entry.path === selectedPath,
    );
    if (entryIndex === -1) return;
    scrollIndexIntoView({
      index: Math.floor(entryIndex / resolvedColumnCount),
      itemSize: ICON_TILE_HEIGHT,
      itemStride: ICON_ROW_STRIDE,
      leadingPx: ICON_GRID_PADDING,
      viewport: viewportRef.current,
    });
  }, [entries, resolvedColumnCount, selectedPath]);
  // Roving tabindex: the grid is a single tab stop (the selected tile when
  // rendered, else the first rendered one), so Shift+Tab returns to the
  // toolbar like in the list view.
  const tabStopPath = visibleEntries.some(
    (entry) => entry.path === selectedPath,
  )
    ? selectedPath
    : (visibleEntries[0]?.path ?? null);
  return (
    <InlineScrollArea2
      orientation="vertical"
      viewportClassName="p-3"
      viewportProps={{
        // A click past the tiles lets go of the selection, as in the Finder;
        // one with ⌘ or Shift held keeps it.
        onClick: (event) => {
          if (
            selectionModeOf(event) === null &&
            event.target instanceof HTMLElement &&
            !event.target.closest("[data-file-system-item], input")
          ) {
            onSelect(null);
          }
        },
      }}
      viewportRef={viewportRef}
    >
      <div
        className="relative"
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
          {visibleEntries.map((entry) => {
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
                    renderFilePreview={renderFilePreview}
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
          })}
        </div>
      </div>
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
  key: FileSystemListColumn;
  label: string;
  /** In px, as the Name column's floor is. */
  width: number;
}> = [
  { align: "start", key: "updatedAt", label: "Date Modified", width: 176 },
  { align: "start", key: "createdAt", label: "Date Created", width: 176 },
  { align: "end", key: "size", label: "Size", width: 88 },
  { align: "start", key: "kind", label: "Kind", width: 136 },
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
function listCellText(entry: FileSystemEntry, column: FileSystemListColumn) {
  switch (column) {
    case "createdAt": {
      return formatListDate(entry.createdAt);
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
      return formatListDate(entry.updatedAt);
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
  onColumnsChange,
  onColumnWidthsChange,
  onSortColumnClick,
  sort,
}: {
  columns: typeof LIST_COLUMNS;
  enabledColumns: readonly FileSystemListColumn[];
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
            label="Name"
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
                  label={column.label}
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
  currentPath,
  draggable,
  enabledListColumns,
  fileFilter,
  index,
  listColumnWidths,
  loadingFolders,
  menuTargetPath,
  moveFocusWithSelection,
  onExpandFolder,
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
}: FileSystemViewProps) {
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const rowRefs = React.useRef(new Map<string, HTMLDivElement>());
  const focusRow = useFocusWhenDrawn(rowRefs, {
    enabled: moveFocusWithSelection,
    preventScroll: true,
  });
  // The folders left open here, kept by the browser per folder so walking
  // away and back, or to another layout and back, finds them open again.
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(
    () => new Set(treeExpansionRef.current.get(currentPath) ?? []),
  );
  const setExpandedFolders = (next: ReadonlySet<string>) => {
    setExpanded(next);
    treeExpansionRef.current.set(currentPath, [...next]);
  };
  // A search or a filter shows every match wherever it is, so every folder
  // with one in it stands open while they are on.
  const isRevealing = searchQuery !== "" || fileFilter !== null;
  // The rows on screen, in order. A folder opened whose contents are still
  // being read shows nothing under it at first, as the Finder's does, so a
  // quick read (or an empty folder) moves no row; only a read slow enough to
  // be seen waiting holds a placeholder row for them.
  const slowFolders = useSlowLoads(loadingFolders);
  const rows = React.useMemo(() => {
    const visibleRows: Array<
      | { depth: number; entry: FileSystemEntry }
      | { depth: number; entry: null; loadingPath: string }
      | { depth: number; entry: null; note: React.ReactNode; notePath: string }
    > = [];
    const walk = (folderPath: string, depth: number) => {
      for (const entry of index.children.get(folderPath) ?? []) {
        visibleRows.push({ depth, entry });
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
    index,
    isRevealing,
    renderUnreadable,
    slowFolders,
  ]);
  // The rows that are items, which is what the keyboard walks.
  const entryRows = rows.filter(
    (row): row is { depth: number; entry: FileSystemEntry } =>
      row.entry !== null,
  );
  const rowEntries = entryRows.map((row) => row.entry);
  const toggleFolder = (folder: FolderEntry, open: boolean) => {
    if (open === expanded.has(folder.path)) return;
    const next = new Set(expanded);
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
  const columns = (() => {
    const shown = LIST_COLUMNS.filter((column) =>
      enabledListColumns.includes(column.key),
    ).map((column) => ({
      ...column,
      width: listColumnWidths[column.key] ?? column.width,
    }));
    if (width === null) return shown;
    let room = width - LIST_EDGE_PADDING - LIST_NAME_MIN_WIDTH;
    return shown.filter((column) => {
      room -= column.width;
      return room >= 0;
    });
  })();
  const { end, start } = useVirtualWindow({
    count: rows.length,
    itemStride: LIST_ROW_HEIGHT,
    overscan: 12,
    viewportRef,
  });
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
    <div className="flex size-full flex-col" ref={rootRef}>
      <FileSystemListHeader
        columns={columns}
        enabledColumns={enabledListColumns}
        onColumnsChange={onListColumnsChange}
        onColumnWidthsChange={(widths) => {
          onListColumnWidthsChange({ ...listColumnWidths, ...widths });
        }}
        onSortColumnClick={onSortColumnClick}
        sort={sort}
      />
      {rows.length === 0 ? (
        <FileSystemEmptyState
          label={
            fileFilter
              ? "No items match the active filters"
              : "This folder is empty"
          }
        />
      ) : (
        <InlineScrollArea2
          className="min-h-0 flex-1"
          orientation="vertical"
          viewportProps={{
            "aria-label": "Files",
            // A press past the last row lets go of the selection, as in the
            // Finder; one with ⌘ or Shift held keeps it.
            onPointerDown: (event) => {
              if (
                event.button === 0 &&
                selectionModeOf(event) === null &&
                event.target instanceof HTMLElement &&
                !event.target.closest('[role="option"]')
              ) {
                onSelect(null);
              }
            },
            role: "listbox",
          }}
          viewportRef={viewportRef}
        >
          <div
            className="relative min-h-full"
            style={{ ...LIST_STRIPES, height: rows.length * LIST_ROW_HEIGHT }}
          >
            <div
              className="absolute inset-x-0 flex flex-col"
              data-file-system-listing=""
              style={{ top: start * LIST_ROW_HEIGHT }}
            >
              {rows.slice(start, end).map((row) => {
                const { depth, entry } = row;
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
                      if (entry.kind === "folder") onFolderHover?.(entry.path);
                    }}
                    onPointerDown={(event) => {
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
                          if (entry.kind === "folder") event.stopPropagation();
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
                      <span className="ml-1.5 flex size-4 shrink-0 items-center justify-center">
                        <FileSystemRowGlyph entry={entry} />
                      </span>
                      {isRenaming ? (
                        renderNameField(entry, "-mr-0.5 ml-1 h-5")
                      ) : (
                        <span
                          className="ml-1.5 min-w-0 flex-1 truncate"
                          data-file-system-name=""
                        >
                          {shownName(entry)}
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
                        {listCellText(entry, column.key)}
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
    columnWidth: columnWidthProp,
    currentPath,
    draggable,
    index,
    loadingFolders,
    loadPreviewImageUrl,
    menuTargetPath,
    moveFocusWithSelection,
    onColumnWidthChange,
    onFolderHover,
    onItemContextMenu,
    listingNavRef,
    onOpen,
    onSelect,
    pageUrlCache,
    renamingPath,
    renderFileActions,
    renderFilePreview,
    renderFileStage,
    renderNameField,
    renderTrailing,
    renderUnreadable,
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
  return (
    <InlineScrollArea2
      orientation="horizontal"
      // The viewport's own content wrapper is `display: table` inline, and a
      // percentage height inside a table box is a minimum rather than a
      // bound: each column grew to its rows and the outer viewport, which
      // only scrolls sideways, clipped them, so nothing answered the wheel.
      // A block wrapper holds the columns to the viewport's height, and the
      // trail still overflows it sideways for the horizontal scroll.
      viewportClassName="overscroll-x-contain [&>div]:block!"
      viewportRef={scrollContainerRef}
    >
      {/* The Content part's ResizeObserver tells the scroll area when the
            trail shrinks (deselect, shallower selection) so the horizontal
            scrollbar hides; the viewport alone only observes its own box. Its
            built-in inline min-width (fit-content) would beat a min-w-full
            class, so the full-width floor is inline too. */}
      <InlineScrollAreaContent
        className="flex h-full w-max"
        data-file-system-listing=""
        style={{ minWidth: "100%" }}
      >
        {listedColumnPaths.map((columnPath, columnIndex) => (
          <FileSystemColumn
            draggable={draggable}
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
              columnIndex === 0 ? null : (index.folders.get(columnPath) ?? null)
            }
            // Scalar per-column props so the memoized column only
            // re-renders when its own rows change — a selection deeper in
            // the trail leaves ancestor columns untouched.
            renamingChildPath={
              renamingPath && pathParent(renamingPath) === columnPath
                ? renamingPath
                : null
            }
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
        ))}
        {unreadableColumnPath !== undefined ? (
          <div className="min-w-72 flex-1 contain-inline-size">
            {renderUnreadable?.(unreadableColumnPath, "pane")}
          </div>
        ) : selectedFile ? (
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
                    loadPreviewImageUrl={loadPreviewImageUrl}
                    pageable
                    pageUrlCache={pageUrlCache}
                    previewAspectRatio={0.78}
                    renderFilePreview={renderFilePreview}
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
              {renderFileActions ? (
                <div className="flex justify-center">
                  {renderFileActions(selectedFile)}
                </div>
              ) : null}
              <FileSystemInformation entry={selectedFile} index={index} />
            </div>
          </InlineScrollArea2>
        ) : deferredIsSeveral ? (
          <FileSystemSelectionStack
            entries={[...selection].flatMap((path) => {
              const entry = index.files.get(path) ?? index.folders.get(path);
              return entry ? [entry] : [];
            })}
            renderFilePreview={renderFilePreview}
            renderFileStage={renderFileStage}
          />
        ) : renderTrailing ? (
          <div className="min-w-52 flex-1 contain-inline-size">
            {renderTrailing(columnPaths.at(-1) ?? "")}
          </div>
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
  index,
  isLoading,
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
  index: FileSystemIndex;
  isLoading: boolean;
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
  const { end, start } = useVirtualWindow({
    count: entries.length,
    itemStride: COLUMN_ROW_STRIDE,
    leadingPx: COLUMN_PADDING,
    overscan: 10,
    viewportRef,
  });
  // Keyboard navigation can select a row this column hasn't mounted; scroll
  // it into the viewport so it mounts and the pending-focus effect can land.
  React.useLayoutEffect(() => {
    if (!selectedChildPath) return;
    scrollIndexIntoView({
      index: entries.findIndex((entry) => entry.path === selectedChildPath),
      itemSize: COLUMN_ROW_HEIGHT,
      itemStride: COLUMN_ROW_STRIDE,
      leadingPx: COLUMN_PADDING,
      viewport: viewportRef.current,
    });
  }, [entries, selectedChildPath]);
  return (
    <div className="relative shrink-0 border-r" style={{ width }}>
      <InlineScrollArea2
        className="h-full w-full"
        orientation="vertical"
        viewportClassName="p-1.5"
        viewportProps={{
          "aria-label": "Files",
          // A press past the rows goes back to the folder the column lists,
          // as in the Finder, and in the first column to nothing; one with
          // ⌘ or Shift held keeps the selection.
          onPointerDown: (event) => {
            if (
              event.button === 0 &&
              selectionModeOf(event) === null &&
              event.target instanceof HTMLElement &&
              !event.target.closest("[data-file-system-item], input")
            ) {
              onSelect(ownFolder);
            }
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
            style={{
              height:
                entries.length > 0
                  ? entries.length * COLUMN_ROW_STRIDE - COLUMN_ROW_GAP
                  : undefined,
            }}
          >
            <div
              className="absolute inset-x-0 flex flex-col gap-px"
              style={{ top: start * COLUMN_ROW_STRIDE }}
            >
              {entries.slice(start, end).map((entry) => {
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
  renderFilePreview,
  renderFileStage,
}: {
  entries: FileSystemEntry[];
  renderFilePreview?: (file: FileSystemFileItem) => React.ReactNode;
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
                        renderFilePreview={renderFilePreview}
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
  getFileUrl,
  loadPreviewImageUrl,
  pageUrlCache,
  renderFilePreview,
  urlCache,
}: {
  file: FileEntry;
  getFileUrl?: (file: FileSystemFileItem) => Promise<string> | string;
  loadPreviewImageUrl?: (
    file: FileSystemFileItem,
    pageIndex: number,
  ) => Promise<null | string>;
  pageUrlCache?: Map<string, string>;
  renderFilePreview?: (file: FileSystemFileItem) => React.ReactNode;
  /** Rendered in the viewer toolbar in the `"dialog"` variant. */
  toolbarActions?: React.ReactNode;
  urlCache: Map<string, string>;
  /** `"stage"` is toolbar-less in a bordered tile; `"dialog"` shows the full viewer chrome. */
  variant?: "dialog" | "stage";
}) {
  const viewerKind = viewerKindForFile(file);
  // Only viewer-backed stages need a URL; thumbnail stages render from the
  // manifest's preview images, so selecting them never triggers a presign.
  const { isResolving, url } = useResolvedFileUrl(
    viewerKind ? file : null,
    getFileUrl,
    urlCache,
  );
  if (viewerKind && isResolving) {
    return <InlineSpinner className="size-6 text-muted-foreground" />;
  }
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
      loadPreviewImageUrl={loadPreviewImageUrl}
      pageable
      pageUrlCache={pageUrlCache}
      previewAspectRatio={0.78}
      renderFilePreview={renderFilePreview}
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
    renderFilePreview,
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
                      renderFilePreview={renderFilePreview}
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
                  renderFilePreview={renderFilePreview}
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
function InlineDialogPanel({
  children,
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <InlineScrollArea className="min-h-0">
      <div
        className={cn("min-h-0", className)}
        data-slot="dialog-panel"
        {...props}
      >
        {children}
      </div>
    </InlineScrollArea>
  );
}
function InlineScrollArea2({
  children,
  className,
  orientation = "both",
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
function InlineScrollAreaContent(props: React.ComponentProps<"div">) {
  return <div {...props} />;
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
