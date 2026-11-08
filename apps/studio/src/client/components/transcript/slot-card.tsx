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

import { useSyntaxHighlighting } from "../../hooks/use-syntax-highlighting";
import { Favicon } from "../favicon";
import { Markdown } from "../markdown";
import { BorderSweep } from "../shimmer-sweep";
import { useTheme } from "../theme-provider";
import { type TranscriptSurface, TranscriptSurfaceContext } from "./surface";

/** The most pictures the strip under a card's newest shows, the newest among them. */
const STRIP_SHOWN = 6;

/** The files whose words a card shows as they read rather than as typed. */
const MARKDOWN_EXTENSIONS = new Set(["markdown", "md", "mdx"]);
/**
 * The files a card shows by their picture once written, since the app draws
 * them as they look: a page, a drawing, a table.
 */
const PICTURED_EXTENSIONS = new Set(["csv", "htm", "html", "svg", "tsv"]);

const isPictured = (path: string) =>
  PICTURED_EXTENSIONS.has(extensionOf(path) ?? "");

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
    ...(changedFile === undefined ? [] : [changedFile.path]),
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
        meta:
          images.length > 1 ? `${images.length.toString()} images` : "Opened",
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
  const path = changedFile?.path ?? written?.path;
  const place = path && placeOf(path);
  const isWriting = written !== undefined && written.status !== "done";
  const isNew =
    written?.after === undefined
      ? (changedFile?.isNew ?? written?.isNew)
      : false;
  const meta = isWriting
    ? "Writing"
    : isNew === undefined
      ? undefined
      : isNew
        ? "New file"
        : "Updated";
  return {
    mark: <FileTextIcon className="size-3.5" />,
    ...(meta && { meta }),
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
            <FileWords
              className="mb-1.5 rounded-sm bg-destructive/10 px-1 text-foreground/70"
              path={written.path}
              text={written.before}
            />
          )}
          <FileWords
            className="rounded-sm bg-brand-500/10 px-1 text-foreground/80"
            path={written.path}
            text={written.after}
          />
        </div>
      ) : written?.words !== undefined &&
        !(written.status === "done" && place && isPictured(written.path)) ? (
        <TypedWords
          isWriting={written.status === "writing"}
          path={written.path}
          words={written.words}
        />
      ) : place ? (
        <FilePicture path={place} version={written?.modifiedAt} />
      ) : null,
  };
}

/**
 * A file's words as they arrive, kept at the end while they do: Markdown as it
 * reads, code in its colors, anything else as typed.
 */
function TypedWords({
  isWriting,
  path,
  words,
}: {
  isWriting: boolean;
  path: string;
  words: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (isWriting && ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [isWriting, words]);
  const isMarkdown = MARKDOWN_EXTENSIONS.has(extensionOf(path) ?? "");
  return (
    <div
      className="absolute inset-0 overflow-hidden bg-card px-3 py-2.5 text-xs text-foreground/80"
      ref={ref}
    >
      {isMarkdown ? (
        // A picture of the file: the card is the one control, so nothing in
        // the words answers a press or takes focus.
        <div
          className="prose prose-custom font-sans text-xs/relaxed wrap-break-word dark:prose-invert prose-code:text-inherit prose-pre:text-xs prose-table:text-xs"
          inert
        >
          <Markdown hideImages isStreaming={isWriting} markdown={words} />
        </div>
      ) : (
        <FileWords path={path} text={words} />
      )}
    </div>
  );
}

const extensionOf = (path: string) =>
  /\.([^./\\]+)$/.exec(path)?.[1]?.toLowerCase();

/**
 * Some of a file's words as its source reads: code in monospace and its
 * grammar's colors, and anything else, Markdown included, as typed.
 */
function FileWords({
  className,
  path,
  text,
}: {
  className?: string;
  path: string;
  text: string;
}) {
  const extension = extensionOf(path);
  const language = MARKDOWN_EXTENSIONS.has(extension ?? "")
    ? undefined
    : extension;
  const { highlightedHtml, isLanguageSupported } = useSyntaxHighlighting({
    code: language === undefined ? undefined : text,
    language,
  });
  return highlightedHtml ? (
    <div
      className={cn(
        "font-mono [&_pre]:break-words [&_pre]:whitespace-pre-wrap",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: highlightedHtml.join("\n") }}
    />
  ) : (
    <div
      className={cn(
        "whitespace-pre-wrap",
        isLanguageSupported && "font-mono",
        className,
      )}
    >
      {text}
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

/**
 * The newest large and whole, and with more than one, each of the latest whole
 * along a strip under it, oldest first with the newest ringed. Nothing is
 * cropped, so every picture keeps its own shape.
 */
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
    return <Waiting>Opening the image</Waiting>;
  }
  const strip =
    images.length > 1
      ? images.slice(-STRIP_SHOWN).flatMap((image) => {
          const stripPlace = image.path && placeOf(image.path);
          return stripPlace ? [{ image, place: stripPlace }] : [];
        })
      : [];
  return (
    <div className="flex h-full flex-col items-center gap-2 p-2.5">
      <div className="flex min-h-0 w-full flex-1 items-center justify-center">
        <FilePicture
          className="max-h-full max-w-full rounded-md shadow-xs ring-1 ring-foreground/10"
          path={place}
          version={newest?.modifiedAt}
        />
      </div>
      {strip.length > 0 && (
        <div className="flex h-9 shrink-0 items-center gap-1.5">
          {strip.map(({ image, place: stripPlace }, index) => (
            <FilePicture
              className={cn(
                "h-full w-auto rounded-sm",
                index === strip.length - 1
                  ? "ring-2 ring-brand-500"
                  : "opacity-80 ring-1 ring-foreground/10",
              )}
              key={`${index.toString()}:${stripPlace}`}
              path={stripPlace}
              version={image.modifiedAt}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** A file drawn small by the system: a picture, a page, a document's first page. */
function FilePicture({
  className = "size-full object-cover object-top",
  path,
  version,
}: {
  className?: string;
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
  return <img alt="" className={className} draggable={false} src={src} />;
}
