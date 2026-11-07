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
import { BorderSweep } from "../shimmer-sweep";
import { useTheme } from "../theme-provider";
import { type TranscriptSurface, TranscriptSurfaceContext } from "./surface";

/** The earlier pictures a row of reads keeps beside its newest. */
const EARLIER_SHOWN = 3;

const baseName = (path: string) => path.split(/[/\\]/).pop() ?? path;

function hostOf(url: string | undefined): string | undefined {
  if (url === undefined) {
    return undefined;
  }
  try {
    const { hostname, pathname } = new URL(url);
    // A file's address has no host, so it goes by its file's name.
    return hostname === ""
      ? baseName(decodeURIComponent(pathname)) || undefined
      : hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

type ShowsOf<K extends StepShows["kind"]> = Extract<StepShows, { kind: K }>;

/** Where a path a call named is on this computer, once that is known. */
type PlaceOf = (path: string) => string | undefined;

/** The paths a card names, as the calls spelled them. */
function pathsOf({ changedFile, steps }: SlotCard): string[] {
  return [
    ...(changedFile === undefined ? [] : [changedFile]),
    ...steps.flatMap(({ shows }) => {
      switch (shows?.kind) {
        case "file": {
          return [shows.path];
        }
        case "generated":
        case "image": {
          return shows.path === undefined ? [] : [shows.path];
        }
        case "opened": {
          return /^[a-z]+:\/\//.test(shows.target) ? [] : [shows.target];
        }
        default: {
          return [];
        }
      }
    }),
  ];
}

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
 * The live card: what the activity going on is showing, so a person can watch
 * it without the transcript moving. It loses its glow if the turn ends with it
 * still up.
 */
export function SlotCardView({
  card,
  isCurrent,
  sessionId,
}: {
  card: SlotCard;
  /** The turn it belongs to is still working. */
  isCurrent: boolean;
  sessionId: StoreId.Session;
}) {
  const surface = use(TranscriptSurfaceContext);
  const places = surface?.useHostPaths(pathsOf(card));
  const drivenPage = surface?.useDrivenPage(
    card.kind === "page" ? sessionId : undefined,
  );
  const body = cardBody(
    card,
    surface,
    sessionId,
    (path) => places?.[path] ?? undefined,
    drivenPage,
  );
  return (
    <div className="relative w-full max-w-115 rounded-2xl">
      <button
        className="block w-full overflow-hidden rounded-2xl border border-border bg-card text-left"
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
      {isCurrent && <BorderSweep />}
    </div>
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
  placeOf: PlaceOf,
  drivenPage: { title?: string; url?: string } | undefined,
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
      const place = drivenPage?.url ?? address ?? target;
      const PagePicture = surface?.PagePicture;
      return {
        mark: <GlobeIcon className="size-3.5" />,
        ...(place && {
          open: () => {
            if (/^[a-z]+:\/\//.test(place)) {
              surface?.onOpenUrl(place);
            } else {
              surface?.onOpenFile(placeOf(place) ?? place);
            }
          },
        }),
        title:
          drivenPage?.title ??
          hostOf(drivenPage?.url ?? address) ??
          (target ? baseName(target) : "A page"),
        view: PagePicture ? <PagePicture sessionId={sessionId} /> : null,
      };
    }
    case "images": {
      const images = shownBy(steps, "image");
      const newest = images.at(-1);
      const place = newest?.path && placeOf(newest.path);
      return {
        mark: <ImageIcon className="size-3.5" />,
        meta: images.length > 1 ? `${images.length.toString()} images` : "Read",
        ...(place && {
          open: () => {
            surface?.onOpenFile(place);
          },
        }),
        title: newest?.path ? baseName(newest.path) : "An image",
        view: <PictureRow images={images} placeOf={placeOf} />,
      };
    }
    case "generated": {
      const generated = shownBy(steps, "generated");
      const newest = generated.at(-1);
      const place = newest?.path && placeOf(newest.path);
      return {
        mark: <ImageIcon className="size-3.5" />,
        ...(place && {
          open: () => {
            surface?.onOpenFile(place);
          },
        }),
        title: newest?.path ? baseName(newest.path) : "An image",
        // The tool writes each partial frame over the file, so the picture
        // fills in as it is made.
        view: place ? (
          <FilePicture
            path={place}
            {...(newest?.modifiedAt !== undefined && {
              version: newest.modifiedAt,
            })}
          />
        ) : (
          <Waiting>Generating the image</Waiting>
        ),
      };
    }
    case "web": {
      return webCard(steps, surface);
    }
    case "files": {
      return filesCard(card, surface, placeOf);
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
  { changedFile, steps }: SlotCard,
  surface: TranscriptSurface | undefined,
  placeOf: PlaceOf,
): CardBody {
  const written = shownBy(steps, "file").at(-1);
  const path = changedFile ?? written?.path;
  const place = path && placeOf(path);
  const isWriting = written?.status === "writing";
  return {
    mark: <FileTextIcon className="size-3.5" />,
    meta: isWriting
      ? "Writing"
      : written?.after !== undefined
        ? "Edited"
        : "Written",
    ...(place && {
      open: () => {
        surface?.onOpenFile(place);
      },
    }),
    title: path ? baseName(path) : "A file",
    view:
      written?.after !== undefined ? (
        <div className="absolute inset-0 overflow-hidden bg-card p-3 text-xs">
          {written.before && (
            <p className="mb-1.5 rounded-sm bg-destructive/10 px-1 whitespace-pre-wrap text-foreground/70">
              {written.before}
            </p>
          )}
          <p className="rounded-sm bg-brand-500/10 px-1 whitespace-pre-wrap text-foreground/80">
            {written.after}
          </p>
        </div>
      ) : written?.words !== undefined ? (
        <TypedWords isWriting={isWriting} words={written.words} />
      ) : place ? (
        <FilePicture path={place} />
      ) : null,
  };
}

/** A file's words as they arrive, kept at the end while they do. */
function TypedWords({
  isWriting,
  words,
}: {
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
      className="absolute inset-0 overflow-hidden bg-card px-3 py-2.5 text-xs whitespace-pre-wrap text-foreground/80"
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
function PictureRow({
  images,
  placeOf,
}: {
  images: readonly ShowsOf<"image">[];
  placeOf: PlaceOf;
}) {
  const newest = images.at(-1);
  const place = newest?.path && placeOf(newest.path);
  if (!place) {
    return <Waiting>Reading the image</Waiting>;
  }
  const earlier = images
    .slice(0, -1)
    .slice(-EARLIER_SHOWN)
    .toReversed()
    .flatMap((image) => {
      const earlierPlace = image.path && placeOf(image.path);
      return earlierPlace ? [earlierPlace] : [];
    });
  return (
    <div className="flex h-full gap-0.5">
      <div className="min-w-0 flex-1">
        <FilePicture fit="contain" path={place} version={newest?.modifiedAt} />
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
  const { resolvedTheme } = useTheme();
  const src = getComputerThumbnailUrl({
    hostPath: path,
    size: 1024,
    theme: resolvedTheme,
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
