import { getComputerThumbnailUrl } from "@/client/lib/computer-file-url";
import { cn } from "@/client/lib/utils";
import {
  type SlotCard,
  type StepShows,
  type StoreId,
  type TurnStep,
  type WebResult,
} from "@instrument-org/workspace/client";
import { FileTextIcon } from "@phosphor-icons/react/FileText";
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { ImageIcon } from "@phosphor-icons/react/Image";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { use, useLayoutEffect, useRef, type ReactNode } from "react";

import { Favicon } from "../favicon";
import { type TranscriptSurface, TranscriptSurfaceContext } from "./surface";

/** The most files a set names beside its newest. */
const NAMES_SHOWN = 5;
/** The earlier pictures a row of reads keeps beside its newest. */
const EARLIER_SHOWN = 3;

const baseName = (path: string) => path.split(/[/\\]/).pop() ?? path;

function hostOf(url: string | undefined): string | undefined {
  if (url === undefined) {
    return undefined;
  }
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

type ShowsOf<K extends StepShows["kind"]> = Extract<StepShows, { kind: K }>;

/** Each step's `shows` of the given kinds, oldest first. */
function shownBy<K extends StepShows["kind"]>(
  steps: readonly TurnStep[],
  ...kinds: K[]
): (ShowsOf<K> & { status: TurnStep["status"] })[] {
  return steps.flatMap((step) => {
    const { shows } = step;
    return shows && (kinds as string[]).includes(shows.kind)
      ? [{ ...(shows as ShowsOf<K>), status: step.status }]
      : [];
  });
}

/**
 * The live card: what the work is showing, in one place, so a person can watch
 * it without the transcript moving. Its foot always names what it shows, since
 * it can stay up after the work has moved on, and it loses its glow when it has.
 */
export function SlotCardView({
  card,
  isCurrent,
  sessionId,
}: {
  card: SlotCard;
  /** The work is still on what this shows. */
  isCurrent: boolean;
  sessionId: StoreId.Session;
}) {
  const surface = use(TranscriptSurfaceContext);
  const body = cardBody(card, surface, sessionId);
  return (
    <button
      className={cn(
        "block w-full max-w-100 overflow-hidden rounded-2xl border bg-card text-left transition-shadow duration-300",
        isCurrent
          ? "border-primary/40 shadow-[0_0_0_3px] shadow-primary/15"
          : "border-border",
      )}
      data-slot-card={card.kind}
      onClick={body.open}
      type="button"
    >
      <div className="relative h-52 overflow-hidden bg-muted/50">
        {body.view}
      </div>
      <div className="flex h-8 items-center gap-1.5 border-t border-border px-2.5 text-xs">
        <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
          {body.mark}
        </span>
        <span className="min-w-0 truncate text-foreground/80">
          {body.title}
        </span>
        {body.meta && (
          <span className="ml-auto shrink-0 pl-2 text-muted-foreground tabular-nums">
            {body.meta}
          </span>
        )}
      </div>
    </button>
  );
}

interface CardBody {
  mark: ReactNode;
  meta?: string;
  open?: () => void;
  title: string;
  view: ReactNode;
}

function cardBody(
  card: SlotCard,
  surface: TranscriptSurface | undefined,
  sessionId: StoreId.Session,
): CardBody {
  const { kind, steps } = card;
  switch (kind) {
    case "page": {
      const pages = shownBy(steps, "page", "opened");
      const newest = pages.at(-1);
      const address = pages
        .flatMap((page) => (page.kind === "page" && page.url ? [page.url] : []))
        .at(-1);
      const target = newest?.kind === "opened" ? newest.target : undefined;
      const place = address ?? target;
      const PagePicture = surface?.PagePicture;
      return {
        mark: <GlobeIcon className="size-3.5" />,
        ...(place && {
          open: () => {
            if (/^[a-z]+:\/\//.test(place)) {
              surface?.onOpenUrl(place);
            } else {
              surface?.onOpenFile(place);
            }
          },
        }),
        title: hostOf(address) ?? (target ? baseName(target) : "A page"),
        view: PagePicture ? <PagePicture sessionId={sessionId} /> : null,
      };
    }
    case "images": {
      const images = shownBy(steps, "image");
      const newest = images.at(-1);
      return {
        mark: <ImageIcon className="size-3.5" />,
        meta: images.length > 1 ? `${images.length.toString()} images` : "Read",
        ...(newest?.path && {
          open: () => {
            surface?.onOpenFile(newest.path ?? "");
          },
        }),
        title: newest?.path ? baseName(newest.path) : "An image",
        view: <PictureRow images={images} />,
      };
    }
    case "generated": {
      const generated = shownBy(steps, "generated");
      const newest = generated.at(-1);
      const isDone = newest?.status === "done";
      return {
        mark: <ImageIcon className="size-3.5" />,
        ...(newest?.path && {
          open: () => {
            surface?.onOpenFile(newest.path ?? "");
          },
        }),
        title: newest?.path ? baseName(newest.path) : "An image",
        view:
          isDone && newest.path ? (
            <FilePicture path={newest.path} />
          ) : (
            <Waiting>Generating the image</Waiting>
          ),
      };
    }
    case "web": {
      return webCard(steps, surface);
    }
    case "files": {
      return filesCard(card, surface);
    }
  }
}

function webCard(
  steps: readonly TurnStep[],
  surface: TranscriptSurface | undefined,
): CardBody {
  const searches = shownBy(steps, "search");
  const reads = shownBy(steps, "fetch");
  const reading =
    steps.at(-1)?.shows?.kind === "fetch" ? reads.at(-1) : undefined;
  const search = searches.at(-1);
  const found = searches.reduce((sum, each) => sum + each.total, 0);
  const meta = [
    found > 0 && `${found.toString()} ${found === 1 ? "result" : "results"}`,
    reads.length > 0 &&
      `${reads.length.toString()} ${reads.length === 1 ? "page" : "pages"} read`,
  ]
    .filter(Boolean)
    .join(", ");
  const host = hostOf(reading?.url);
  return {
    mark: <MagnifyingGlassIcon className="size-3.5" />,
    ...(meta && { meta }),
    ...(reading?.url && {
      open: () => {
        surface?.onOpenUrl(reading.url ?? "");
      },
    }),
    title: reading
      ? (reading.title ?? host ?? "A page")
      : (search?.query ?? "Searching the web"),
    view:
      reading?.words !== undefined ? (
        <div className="absolute inset-0 overflow-hidden bg-card px-3 py-2.5 text-xs">
          <p className="truncate font-medium text-foreground">
            {reading.title ?? host}
          </p>
          <p className="truncate text-muted-foreground">{host}</p>
          <p className="mt-1.5 whitespace-pre-wrap text-foreground/80">
            {reading.words}
          </p>
        </div>
      ) : (
        <div className="absolute inset-0 flex flex-col gap-2 overflow-hidden bg-card px-3 py-2.5 text-xs">
          <p className="truncate font-medium text-foreground">
            {reading
              ? reading.status === "done"
                ? (reading.title ?? host)
                : `Reading ${host ?? "the page"}`
              : (search?.query ?? "Searching")}
          </p>
          {search && search.results.length > 0 ? (
            <ResultList results={search.results} />
          ) : (
            !reading && (
              <span className="text-muted-foreground">
                {search?.status === "done"
                  ? "Nothing came up for that search."
                  : "Searching…"}
              </span>
            )
          )}
        </div>
      ),
  };
}

function ResultList({ results }: { results: readonly WebResult[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {results.map((result) => (
        <li className="flex min-w-0 items-start gap-1.5" key={result.url}>
          <Favicon className="mt-px size-3.5 shrink-0" url={result.url} />
          <span className="min-w-0">
            <span className="block truncate text-foreground/80">
              {result.title ?? hostOf(result.url)}
            </span>
            {result.title && (
              <span className="block truncate text-muted-foreground">
                {hostOf(result.url)}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function filesCard(
  { changedFiles, steps }: SlotCard,
  surface: TranscriptSurface | undefined,
): CardBody {
  const written = shownBy(steps, "file");
  const names = [
    ...new Set([...written.map((file) => file.path), ...changedFiles]),
  ];
  const newestPath = changedFiles.at(-1) ?? written.at(-1)?.path;
  const newest = written.findLast((file) => file.path === newestPath);
  const isWriting = newest?.status === "writing";
  const list =
    names.length > 1 ? (
      <ul className="absolute inset-y-0 left-0 flex w-28 flex-col gap-1 overflow-hidden bg-muted/60 p-2 text-[11px]">
        {names.slice(-NAMES_SHOWN).map((name) => (
          <li className="truncate text-foreground/80" key={name}>
            {baseName(name)}
          </li>
        ))}
      </ul>
    ) : null;
  const offset = list ? "left-28" : "left-0";
  const body = !newestPath ? null : newest?.after !== undefined ? (
    <div
      className={cn(
        "absolute inset-y-0 right-0 overflow-hidden bg-card p-3 text-xs",
        offset,
      )}
    >
      {newest.before && (
        <p className="mb-1.5 rounded-sm bg-destructive/10 px-1 whitespace-pre-wrap text-foreground/70">
          {newest.before}
        </p>
      )}
      <p className="rounded-sm bg-emerald-500/10 px-1 whitespace-pre-wrap text-foreground/80">
        {newest.after}
      </p>
    </div>
  ) : newest?.words !== undefined ? (
    <TypedWords className={offset} isWriting={isWriting} words={newest.words} />
  ) : (
    <div className={cn("absolute inset-y-0 right-0", offset)}>
      <FilePicture path={newestPath} />
    </div>
  );
  return {
    mark: <FileTextIcon className="size-3.5" />,
    meta:
      names.length > 1
        ? `${names.length.toString()} files`
        : isWriting
          ? "Writing"
          : newest?.after !== undefined
            ? "Edited"
            : "Written",
    ...(newestPath && {
      open: () => {
        surface?.onOpenFile(newestPath);
      },
    }),
    title: newestPath ? baseName(newestPath) : "A file",
    view: (
      <>
        {list}
        {body}
      </>
    ),
  };
}

/** A file's words as they arrive, kept at the end while they do. */
function TypedWords({
  className,
  isWriting,
  words,
}: {
  className?: string;
  isWriting: boolean;
  words: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (isWriting && ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [isWriting, words]);
  return (
    <div
      className={cn(
        "absolute inset-y-0 right-0 overflow-hidden bg-card px-3 py-2.5 text-xs whitespace-pre-wrap text-foreground/80",
        className,
      )}
      ref={ref}
    >
      {words}
    </div>
  );
}

function Waiting({ children }: { children: string }) {
  return (
    <div className="flex h-full animate-pulse items-center justify-center text-xs text-muted-foreground">
      {children}
    </div>
  );
}

/** The newest large, with a few earlier ones beside it so each stays legible. */
function PictureRow({ images }: { images: readonly ShowsOf<"image">[] }) {
  const newest = images.at(-1);
  if (!newest?.path) {
    return <Waiting>Reading the image</Waiting>;
  }
  const earlier = images
    .slice(0, -1)
    .slice(-EARLIER_SHOWN)
    .toReversed()
    .flatMap((image) => (image.path ? [image.path] : []));
  return (
    <div className="flex h-full gap-0.5">
      <div className="min-w-0 flex-1">
        <FilePicture
          fit="contain"
          path={newest.path}
          version={newest.modifiedAt}
        />
      </div>
      {earlier.length > 0 && (
        <div className="flex w-20 shrink-0 flex-col gap-0.5">
          {earlier.map((path) => (
            <div className="min-h-0 flex-1" key={path}>
              <FilePicture path={path} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** A file drawn small by the system: a picture, a page, a document's first page. */
function FilePicture({
  fit = "cover",
  path,
  version,
}: {
  fit?: "contain" | "cover";
  path: string;
  version?: number;
}) {
  const src = getComputerThumbnailUrl({
    hostPath: path,
    size: 1024,
    theme: "light",
    ...(version !== undefined && { version }),
  });
  return (
    <img
      alt=""
      className={cn(
        "size-full object-top",
        fit === "cover" ? "object-cover" : "object-contain",
      )}
      draggable={false}
      src={src}
    />
  );
}
