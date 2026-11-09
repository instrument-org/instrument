import { computerHiddenFilesAtom } from "@/client/atoms/window";
import { WINDOW_ID } from "@instrument-org/workspace/client";
import {
  FileSystemFolderGlyph,
  FileTypeIcon,
  formatByteSize,
  formatDateSpan,
  formatTimestamp,
  itemKindLabel,
} from "@/client/components/extend/file-system";
import { FolderTrail } from "@/client/components/folder-trail";
import { OpenTargetIcon } from "@/client/components/open-target-icon";
import { useIsActiveTab } from "@/client/hooks/use-active-tab";
import { useFileOpenControl } from "@/client/hooks/use-file-open-control";
import { useTheme } from "@/client/components/theme-provider";
import { useWatchedFileUrl } from "@/client/hooks/use-watched-file-url";
import { getComputerThumbnailUrl } from "@/client/lib/computer-file-url";
import { getFileType } from "@/client/lib/get-file-type";
import { isTypingTarget } from "@/client/lib/is-typing-target";
import { cn, currentOs } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { macosAsksBeforeReading } from "@/shared/macos-guarded-folders";
import { folderNameFromPath } from "@instrument-org/shared";
import { CircleNotchIcon } from "@phosphor-icons/react/CircleNotch";
import { StackIcon } from "@phosphor-icons/react/Stack";
import { XIcon } from "@phosphor-icons/react/X";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { type ReactNode, useEffect, useState } from "react";

import { parentFolderOf } from "./host-path";

/** One file or folder the card can say something about, as its row has it. */
export type FileInfoItem = {
  contentType?: string;
  createdAt?: string;
  glyphSrc?: string;
  hostPath: string;
  /** A folder the system shows as one file: an app, a Pages document. */
  isPackage?: boolean;
  kind: "file" | "folder";
  kindLabel: string;
  modifiedAt?: string;
  name: string;
  previewImageUrl?: string;
  size?: number;
};

/** The files that give themselves a title: pages and Markdown. */
export const TITLED_NAME = /\.(?:x?html?|markdown|mdx?)$/i;

const requests = new Set<() => void>();

/** The window's Info command, which the screen in the tab up answers. */
export function requestFileInfo() {
  for (const request of requests) {
    request();
  }
}

/**
 * The Info key on a selected file or folder, showing what is known about it in
 * a small card at the screen's corner. Nothing behind it is dimmed and the
 * keyboard stays where it was, so the arrows go on walking the folder and the
 * card follows what they land on, with the file still in view.
 *
 * `file` is the file open on screen, which the card is about when nothing is
 * selected or the file's own menu asked; `belowRow` says the screen's row is
 * inside what the card floats over.
 */
export function useFileInfo({
  belowRow,
  file,
}: {
  belowRow: boolean;
  file?: string | undefined;
}): {
  /** Rendered inside the screen, which it floats over. */
  card: ReactNode;
  /** Whether Esc put the card away, for a handler that would otherwise use it. */
  closeOnEscape: (event: EscapePress) => boolean;
  /** Puts the card up over the open file, from that file's own menu. */
  openOnFile: () => void;
  /** Spread onto the folder browser. */
  props: {
    onInfoSelection: (items: FileInfoItem[]) => void;
    onInfoShow: (items: FileInfoItem[]) => void;
  };
} {
  const isActiveTab = useIsActiveTab();
  const [isOpen, setOpen] = useState(false);
  const [selection, setSelection] = useState<FileInfoItem[]>([]);
  // The path the card was put up on by a person, which macOS may be asked
  // about. One the selection merely passed over is not (`FolderInfo`).
  const [askedFor, setAskedFor] = useState<string>();
  const [isOnFile, setOnFile] = useState(false);
  // The selection moving hands the card back to it.
  const [seenSelection, setSeenSelection] = useState(selection);
  if (seenSelection !== selection) {
    setSeenSelection(selection);
    setOnFile(false);
  }
  const showsFile = file !== undefined && (isOnFile || selection.length === 0);
  const fileItem = useFileItem(isOpen && showsFile ? file : undefined);
  const items = showsFile ? [fileItem ?? bareItem(file)] : selection;
  const isShown = isOpen && items.length > 0;

  // Subscribed afresh each render, so a press reads what is selected now.
  useEffect(() => {
    if (!isActiveTab) {
      return;
    }
    const toggle = () => {
      // A key a field left alone is still that field's to ignore.
      if (isTypingTarget(document.activeElement)) {
        return;
      }
      setAskedFor(items[0]?.hostPath);
      setOpen(!isOpen && items.length > 0);
    };
    requests.add(toggle);
    return () => {
      requests.delete(toggle);
    };
  });

  const closeOnEscape = (event: EscapePress) => {
    if (
      !isShown ||
      event.key !== "Escape" ||
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      isTypingTarget(event.target)
    ) {
      return false;
    }
    event.preventDefault();
    setOpen(false);
    return true;
  };
  // Esc from wherever the keyboard is, once anything nearer has had its say.
  useEffect(() => {
    if (!isShown || !isActiveTab) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      closeOnEscape(event);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  });

  return {
    card: isShown ? (
      <FileInfoCard
        askedFor={askedFor}
        className={belowRow ? "top-12" : "top-3"}
        items={items}
        onClose={() => {
          setOpen(false);
        }}
      />
    ) : null,
    closeOnEscape,
    openOnFile: () => {
      setOnFile(true);
      setAskedFor(file);
      setOpen(true);
    },
    props: {
      onInfoSelection: setSelection,
      onInfoShow: (shown) => {
        setSelection(shown);
        setAskedFor(shown[0]?.hostPath);
        setOpen(shown.length > 0);
      },
    },
  };
}

type EscapePress = Pick<
  KeyboardEvent,
  | "altKey"
  | "ctrlKey"
  | "defaultPrevented"
  | "key"
  | "metaKey"
  | "preventDefault"
  | "shiftKey"
  | "target"
>;

/** The folder a file or folder is in, a drive's or a share's top as it is written. */
function whereIs(hostPath: string) {
  return parentFolderOf(hostPath) ?? hostPath;
}

function bareItem(hostPath: string): FileInfoItem {
  const name = folderNameFromPath(hostPath);
  return {
    hostPath,
    kind: "file",
    kindLabel: itemKindLabel({ name }),
    name,
  };
}

/** The open file, read from the listing of the folder it is in. */
function useFileItem(hostPath: string | undefined) {
  const listing = useQuery(
    rpcClient.workspace.computer.list.queryOptions({
      input: hostPath ? { id: WINDOW_ID, path: whereIs(hostPath) } : skipToken,
      retry: false,
    }),
  );
  const entry =
    listing.data?.kind === "listing"
      ? listing.data.entries.find(({ path }) => path === hostPath)
      : undefined;
  if (!hostPath || !entry) {
    return undefined;
  }
  return {
    ...bareItem(hostPath),
    ...(entry.mimeType ? { contentType: entry.mimeType } : {}),
    ...(entry.createdAt === undefined
      ? {}
      : { createdAt: new Date(entry.createdAt).toISOString() }),
    kindLabel: itemKindLabel({
      name: entry.name,
      ...(entry.mimeType ? { contentType: entry.mimeType } : {}),
    }),
    ...(entry.modifiedAt === undefined
      ? {}
      : { modifiedAt: new Date(entry.modifiedAt).toISOString() }),
    ...(entry.kind === "file" ? { size: entry.size } : {}),
  } satisfies FileInfoItem;
}

/**
 * What Info says about a file or folder named by its path, for a place that
 * shows one beside a list rather than over a folder (Activity's details):
 * a file's picture large, as the system draws it, then the card's own
 * header and rows, without the card. A path with nothing at it any more
 * says so under its name, and where it was.
 */
export function PathInfo({
  hostPath,
  kind,
}: {
  hostPath: string;
  kind: "file" | "folder";
}) {
  const listing = useQuery(
    rpcClient.workspace.computer.list.queryOptions({
      input: { id: WINDOW_ID, path: whereIs(hostPath) },
      retry: false,
    }),
  );
  const item = useFileItem(hostPath);
  const name = folderNameFromPath(hostPath);
  const picture =
    kind === "file" ? (
      <LargePicture
        hostPath={hostPath}
        name={name}
        version={item?.modifiedAt}
      />
    ) : null;
  if (item) {
    return (
      <>
        {picture}
        {kind === "folder" ? (
          <FolderInfo
            isAskedFor={false}
            item={{ ...item, kind: "folder", kindLabel: "Folder" }}
          />
        ) : (
          <FileInfo item={item} />
        )}
      </>
    );
  }
  return (
    <InfoFrame
      name={name}
      picture={
        kind === "folder" ? (
          <FileSystemFolderGlyph className="size-11" />
        ) : (
          <FileTypeIcon className="size-9" fileName={name} />
        )
      }
      sub={listing.isPending ? "" : "Can’t be found"}
    >
      <WhereRow hostPath={hostPath} />
    </InfoFrame>
  );
}

/**
 * A file as the system draws it, large: a picture, a PDF's first page, a
 * page as a page. A file with no picture shows its kind's icon instead.
 */
function LargePicture({
  hostPath,
  name,
  version,
}: {
  hostPath: string;
  name: string;
  version: string | undefined;
}) {
  const { resolvedTheme } = useTheme();
  const url = getComputerThumbnailUrl({
    hostPath,
    size: 512,
    theme: resolvedTheme === "dark" ? "dark" : "light",
    ...(version === undefined ? {} : { version }),
  });
  const [failed, setFailed] = useState<string | undefined>();
  return (
    <div className="grid h-52 shrink-0 place-items-center border-b border-border bg-foreground/3 p-4">
      {url && failed !== url ? (
        <img
          alt=""
          className="max-h-full max-w-full rounded-sm object-contain shadow-sm ring-1 ring-black/10"
          draggable={false}
          onError={() => {
            setFailed(url);
          }}
          src={url}
        />
      ) : (
        <FileTypeIcon className="size-16" fileName={name} />
      )}
    </div>
  );
}

function FileInfoCard({
  askedFor,
  className,
  items,
  onClose,
}: {
  askedFor: string | undefined;
  className: string;
  items: FileInfoItem[];
  onClose: () => void;
}) {
  const [only] = items;
  return (
    <aside
      aria-label="Info"
      className={cn(
        "absolute right-3 z-30 flex max-h-[calc(100%-4rem)] w-74 flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground shadow-float-md ring-1 ring-black/8",
        className,
      )}
    >
      {items.length > 1 || !only ? (
        <SeveralInfo items={items} />
      ) : only.kind === "folder" ? (
        <FolderInfo
          isAskedFor={askedFor === only.hostPath}
          item={only}
          key={only.hostPath}
        />
      ) : (
        <FileInfo item={only} key={only.hostPath} />
      )}
      <button
        aria-label="Close"
        className="absolute top-2 right-2 grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        onClick={onClose}
        type="button"
      >
        <XIcon className="size-3.5" />
      </button>
    </aside>
  );
}

function FileInfo({ item }: { item: FileInfoItem }) {
  const type = getFileType({ filename: item.name });
  const probe = useQuery(
    rpcClient.files.probeMedia.queryOptions({
      input:
        type === "audio" || type === "video"
          ? { path: item.hostPath }
          : skipToken,
      retry: false,
    }),
  );
  // A vector's natural size is whatever the browser made up for it.
  const imageUrl = useWatchedFileUrl(
    type === "image" && !/\.svgz?$/i.test(item.name)
      ? item.hostPath
      : undefined,
  );
  const imageShape = useImageShape(imageUrl);
  const shape = type === "image" ? imageShape : probe.data;
  const packageSize = useQuery({
    ...rpcClient.files.folderSize.queryOptions({
      input: item.isPackage ? { path: item.hostPath } : skipToken,
      retry: false,
    }),
    refetchOnWindowFocus: false,
  });
  const opens = useFileOpenControl(
    { hostPath: item.hostPath },
    { loadCandidates: false },
  );
  const titles = useQuery(
    rpcClient.workspace.computer.titles.queryOptions({
      input: TITLED_NAME.test(item.name)
        ? { paths: [item.hostPath] }
        : skipToken,
      retry: false,
    }),
  );
  const title = titles.data?.[item.hostPath];
  return (
    <InfoFrame
      name={item.name}
      picture={
        item.previewImageUrl ? (
          <img
            alt=""
            className="max-h-14 max-w-11 rounded-sm object-contain shadow-xs ring-1 ring-black/10"
            src={item.previewImageUrl}
          />
        ) : (
          <FileTypeIcon
            className="size-9"
            {...(item.contentType ? { contentType: item.contentType } : {})}
            fileName={item.name}
          />
        )
      }
      sub={item.kindLabel}
    >
      {title ? <InfoRow label="Title">{title}</InfoRow> : null}
      {item.size !== undefined ? (
        <InfoRow label="Size">{sizeWords(item.size)}</InfoRow>
      ) : item.isPackage ? (
        <InfoRow label="Size">
          <WalkedSize size={packageSize} />
        </InfoRow>
      ) : null}
      {shape?.width && shape.height && type !== "audio" ? (
        <InfoRow label="Dimensions">
          {shape.width} × {shape.height}
        </InfoRow>
      ) : null}
      {probe.data?.durationSeconds ? (
        <InfoRow label="Duration">{clock(probe.data.durationSeconds)}</InfoRow>
      ) : null}
      <WhereRow hostPath={item.hostPath} />
      <DateRows item={item} />
      {opens.appName && !item.isPackage ? (
        <InfoRow label="Opens with">
          {/* The app named is a way to open it there, as a click on it says. */}
          <button
            className="-mx-1 flex max-w-full min-w-0 items-center gap-1.5 rounded px-1 hover:bg-accent"
            onClick={opens.open}
            title={opens.openLabel}
            type="button"
          >
            <OpenTargetIcon
              className="size-3.5 shrink-0"
              file={{ hostPath: item.hostPath }}
            />
            <span className="truncate">{opens.appName}</span>
          </button>
        </InfoRow>
      ) : null}
    </InfoFrame>
  );
}

/**
 * A picture's shape as the browser decodes and shows it, turned the way its
 * own data says to, which a stream reader does not tell for a rotated photo or
 * a tiled HEIC. Nothing for a picture the browser cannot decode.
 */
function useImageShape(url: string | undefined) {
  const [shape, setShape] = useState<{ height: number; width: number }>();
  useEffect(() => {
    if (!url) {
      return;
    }
    const image = new Image();
    image.onload = () => {
      setShape({ height: image.naturalHeight, width: image.naturalWidth });
    };
    image.src = url;
    return () => {
      image.onload = null;
      // Stops a large or far-off picture nobody is looking at any more.
      image.src = "";
    };
  }, [url]);
  return shape;
}

const CANT_BE_READ = "Can’t be read";

function FolderInfo({
  isAskedFor,
  item,
}: {
  isAskedFor: boolean;
  item: FileInfoItem;
}) {
  // A selection walking past a folder macOS asks about is no reason to put its
  // prompt up, so one the card only followed onto waits to be asked for.
  const [isCalculating, setCalculating] = useState(false);
  const mayRead =
    isAskedFor ||
    isCalculating ||
    !macosAsksBeforeReading(item.hostPath, {
      home: window.api.homeDir,
      os: currentOs(),
    });
  const listing = useQuery(
    rpcClient.workspace.computer.list.queryOptions({
      input: mayRead ? { id: WINDOW_ID, path: item.hostPath } : skipToken,
      retry: false,
    }),
  );
  // Walks the folder for as long as the card is on it: moving on or closing
  // the card ends the query, and with it the walk.
  const size = useQuery({
    ...rpcClient.files.folderSize.queryOptions({
      input: mayRead ? { path: item.hostPath } : skipToken,
      retry: false,
    }),
    refetchOnWindowFocus: false,
  });
  const showHidden = useAtomValue(computerHiddenFilesAtom);
  const count =
    listing.data?.kind === "listing"
      ? listing.data.entries.filter((entry) => showHidden || !entry.hidden)
          .length
      : undefined;
  const isRefused = listing.data?.kind === "refused" || listing.isError;
  return (
    <InfoFrame
      name={item.name}
      picture={
        <FileSystemFolderGlyph
          className="size-11"
          {...(item.glyphSrc ? { src: item.glyphSrc } : {})}
        />
      }
      sub={item.kindLabel}
    >
      {mayRead ? (
        <InfoRow label="Items">
          {isRefused ? (
            <Quiet>{CANT_BE_READ}</Quiet>
          ) : count === undefined ? (
            <Calculating />
          ) : (
            `${count.toLocaleString()}${listing.data?.kind === "listing" && listing.data.truncated ? "+" : ""} ${count === 1 ? "item" : "items"}`
          )}
        </InfoRow>
      ) : null}
      <InfoRow label="Size">
        {!mayRead ? (
          <button
            className="text-brand-600 hover:underline dark:text-brand-400"
            onClick={() => {
              setCalculating(true);
            }}
            type="button"
          >
            Calculate
          </button>
        ) : isRefused ? (
          <Quiet>{CANT_BE_READ}</Quiet>
        ) : (
          <WalkedSize size={size} />
        )}
      </InfoRow>
      <WhereRow hostPath={item.hostPath} />
      <DateRows item={item} />
    </InfoFrame>
  );
}

/** A size that took a walk: what it found, or that it is still looking, never an older answer. */
function WalkedSize({
  size,
}: {
  size: {
    data?: { bytes: number; complete: boolean } | null;
    isFetching: boolean;
  };
}) {
  if (size.isFetching) {
    return <Calculating />;
  }
  if (!size.data) {
    return <Quiet>{CANT_BE_READ}</Quiet>;
  }
  return size.data.complete
    ? sizeWords(size.data.bytes)
    : `More than ${shortSize(size.data.bytes)}`;
}

function SeveralInfo({ items }: { items: FileInfoItem[] }) {
  // What takes a walk to size is said apart, rather than as nothing.
  const unsized = items.filter(({ size }) => size === undefined);
  const unsizedNoun = unsized.every(({ kind }) => kind === "folder")
    ? "folder"
    : "item";
  const bytes = items.reduce((sum, { size = 0 }) => sum + size, 0);
  const kinds = new Map<string, number>();
  for (const { kindLabel } of items) {
    kinds.set(kindLabel, (kinds.get(kindLabel) ?? 0) + 1);
  }
  const places = new Set(items.map(({ hostPath }) => whereIs(hostPath)));
  const [place] = places;
  const modified = formatDateSpan(items.map(({ modifiedAt }) => modifiedAt));
  return (
    <InfoFrame
      name={`${items.length} items`}
      picture={<StackIcon className="size-9 text-muted-foreground" />}
      sub={
        place && places.size === 1
          ? `In ${folderNameFromPath(place)}`
          : "Selected"
      }
    >
      {unsized.length === items.length ? null : (
        <InfoRow label="Size">
          {unsized.length === 0
            ? `${shortSize(bytes)} in all`
            : `${shortSize(bytes)}, plus ${unsized.length} ${unsizedNoun}${unsized.length === 1 ? "" : "s"}`}
        </InfoRow>
      )}
      <InfoRow label="Kinds">
        {[...kinds]
          .map(([kind, count]) =>
            count === 1 ? `1 ${kind}` : `${count} ${kind}s`,
          )
          .join(", ")}
      </InfoRow>
      {place && places.size === 1 ? (
        <InfoRow label="Where">
          <FolderTrail path={place} />
        </InfoRow>
      ) : null}
      {modified ? <InfoRow label="Modified">{modified}</InfoRow> : null}
    </InfoFrame>
  );
}

export function InfoFrame({
  children,
  name,
  picture,
  sub,
}: {
  children: ReactNode;
  name: string;
  picture: ReactNode;
  sub: string;
}) {
  return (
    <>
      <div className="flex shrink-0 items-center gap-3 border-b border-border p-3 pr-9">
        <span className="grid w-11 shrink-0 place-items-center">{picture}</span>
        <div className="min-w-0 select-text">
          <div className="text-sm font-medium [overflow-wrap:anywhere]">
            {name}
          </div>
          <div className="truncate text-xs text-muted-foreground">{sub}</div>
        </div>
      </div>
      <dl className="min-h-0 overflow-y-auto px-3 py-2">{children}</dl>
    </>
  );
}

export function InfoRow({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div className="grid grid-cols-[5.25rem_minmax(0,1fr)] gap-2 py-1 text-[13px] leading-[18px]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere] select-text">
        {children}
      </dd>
    </div>
  );
}

function WhereRow({ hostPath }: { hostPath: string }) {
  return (
    <InfoRow label="Where">
      <FolderTrail path={whereIs(hostPath)} />
    </InfoRow>
  );
}

function DateRows({ item }: { item: FileInfoItem }) {
  // A system that keeps no creation date answers with the epoch.
  const created =
    item.createdAt && new Date(item.createdAt).getTime() > 0
      ? formatTimestamp(item.createdAt)
      : null;
  const modified = formatTimestamp(item.modifiedAt);
  return (
    <>
      {created ? <InfoRow label="Created">{created}</InfoRow> : null}
      {modified ? <InfoRow label="Modified">{modified}</InfoRow> : null}
    </>
  );
}

function Quiet({ children }: { children: ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>;
}

function Calculating() {
  return (
    <span className="flex items-center gap-1.5 text-muted-foreground">
      <CircleNotchIcon className="size-3.5 animate-spin" />
      Calculating…
    </span>
  );
}

function shortSize(bytes: number) {
  return formatByteSize(bytes) ?? `${bytes} bytes`;
}

/** A size in the file manager's units, then its exact bytes where those differ. */
function sizeWords(bytes: number) {
  const short = shortSize(bytes);
  return short === `${bytes} bytes`
    ? short
    : `${short} (${bytes.toLocaleString()} bytes)`;
}

/** A length as a player shows it: `2:41`, or `1:02:41` past the hour. */
function clock(seconds: number) {
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  const secondsPart = String(whole % 60).padStart(2, "0");
  return minutes < 60
    ? `${minutes}:${secondsPart}`
    : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${secondsPart}`;
}
