import { getComputerThumbnailUrl } from "@/client/lib/computer-file-url";
import { cn } from "@/client/lib/utils";
import {
  type StoreId,
  type WorkCard,
  workCardFace,
  type WorkCardFaceOf,
  type WorkCardKind,
  workCardPaths,
  type WorkCardPicture,
  type WorkCardResult,
  type WorkCardView,
} from "@instrument-org/workspace/client";
import { FileTextIcon } from "@phosphor-icons/react/FileText";
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { ImageIcon } from "@phosphor-icons/react/Image";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { motion, useReducedMotion } from "motion/react";
import {
  use,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  codeBlockLines,
  highlightedLineSpans,
  plainLineSpan,
} from "@/shared/syntax-highlight";

import { useSyntaxHighlighting } from "../../hooks/use-syntax-highlighting";
import { Favicon, PageFavicon } from "../favicon";
import { Markdown } from "../markdown";
import { Prose } from "../prose";
import { BorderSweep } from "../shimmer-sweep";
import { useTheme } from "../theme-provider";
import { type ColoredLines, streamedCode } from "./streamed-code";
import { type TranscriptSurface, TranscriptSurfaceContext } from "./surface";
import { useDrivenPage, useTranscriptHostPaths } from "./transcript-data";

/** The files whose words a card shows as they read rather than as typed. */
const MARKDOWN_EXTENSIONS = new Set(["markdown", "md", "mdx"]);

const MARKS: Record<WorkCardKind, ReactNode> = {
  files: <FileTextIcon className="size-3.5" />,
  generated: <ImageIcon className="size-3.5" />,
  images: <ImageIcon className="size-3.5" />,
  page: <GlobeIcon className="size-3.5" />,
  web: <MagnifyingGlassIcon className="size-3.5" />,
};

/**
 * The live card: what the activity going on is showing, so a person can watch
 * it without the transcript moving. It loses its glow if the turn ends with it
 * still up.
 */
export function WorkCardView({
  card,
  isCurrent,
  sessionId,
}: {
  card: WorkCard;
  /** The turn it belongs to is still working. */
  isCurrent: boolean;
  sessionId: StoreId.Session;
}) {
  const surface = use(TranscriptSurfaceContext);
  const places = useTranscriptHostPaths(workCardPaths(card));
  const drivenPage = useDrivenPage(
    card.kind === "page" ? sessionId : undefined,
  );
  const face = workCardFace(card, {
    ...(drivenPage && { drivenPage }),
    places,
  });
  const target = face.open;
  const open =
    target &&
    (() => {
      if ("url" in target) {
        surface?.onOpenUrl(target.url);
      } else {
        surface?.onOpenFile(target.file);
      }
    });
  return (
    <div className="relative w-full max-w-115 rounded-2xl">
      <button
        className="block w-full overflow-hidden rounded-2xl border border-border bg-card text-left"
        data-work-card={card.kind}
        onClick={open}
        type="button"
      >
        <div className="relative h-52 overflow-hidden bg-muted/50">
          {viewOf(face, {
            PagePicture: surface?.PagePicture,
            sessionId,
          })}
        </div>
        <div className="flex h-8 items-center gap-1.5 border-t border-border px-2.5 text-xs">
          <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
            {card.kind === "page" ? (
              // The page's own icon, as its tab shows it.
              <PageFavicon
                className="size-3.5"
                favicon={drivenPage?.favicon}
                hasTooltip={false}
                url={target && "url" in target ? target.url : undefined}
              />
            ) : (
              MARKS[card.kind]
            )}
          </span>
          <span className="min-w-0 truncate text-foreground/80">
            {face.title}
          </span>
          {face.meta && (
            <span className="ml-auto shrink-0 pl-2 text-muted-foreground tabular-nums">
              {face.meta}
            </span>
          )}
        </div>
      </button>
      {isCurrent && <BorderSweep />}
    </div>
  );
}

/** What a view has besides its face. */
interface ViewContext {
  PagePicture: TranscriptSurface["PagePicture"] | undefined;
  sessionId: StoreId.Session;
}

/**
 * A view for each of a card's views, given its face. Each is called as a
 * function rather than mounted as a component, so a card moving from one view
 * to the next keeps what the two have in common, a web card's results as one
 * is opened among them above all.
 */
const VIEWS: {
  [V in WorkCardView]: (
    face: WorkCardFaceOf<V>,
    context: ViewContext,
  ) => ReactNode;
} = {
  "files/diff": (face) => (
    <div className="absolute inset-0 overflow-hidden bg-card p-3 text-xs">
      {face.before && (
        <FileWords
          className="mb-1.5 rounded-sm bg-destructive/10 px-1 text-foreground/70"
          path={face.path}
          text={face.before}
        />
      )}
      <FileWords
        className="rounded-sm bg-brand-500/10 px-1 text-foreground/80"
        path={face.path}
        text={face.after}
      />
    </div>
  ),
  "files/none": () => null,
  "files/picture": (face) => <FilePicture picture={face.picture} />,
  "files/words": (face) => (
    <TypedWords isWriting={false} path={face.path} words={face.words} />
  ),
  "files/writing": (face) => (
    <TypedWords isWriting path={face.path} words={face.words} />
  ),
  "generated/generating": () => <Waiting>Generating the image</Waiting>,
  "generated/picture": (face) => <FilePicture picture={face.picture} />,
  "images/opening": () => <Waiting>Opening the image</Waiting>,
  "images/pictures": (face) => (
    <PictureRow newest={face.newest} strip={face.strip} />
  ),
  "page/picture": (_face, { PagePicture, sessionId }) =>
    PagePicture ? <PagePicture sessionId={sessionId} /> : null,
  "web/nothing-found": (face) =>
    webList(
      face.heading,
      <span className="text-muted-foreground">
        Nothing came up for that search.
      </span>,
    ),
  "web/opening": (face) =>
    webList(
      face.heading,
      face.results && <ResultList dims results={face.results} />,
    ),
  "web/page": (face) =>
    face.words === undefined ? (
      webList(face.heading)
    ) : (
      <div className="absolute inset-0 animate-in overflow-hidden bg-card px-3 py-2.5 text-xs duration-200 fade-in">
        <p className="truncate font-medium text-foreground">{face.heading}</p>
        <p className="truncate text-muted-foreground">{face.host}</p>
        <p className="mt-1.5 whitespace-pre-wrap text-foreground/80">
          {face.words}
        </p>
      </div>
    ),
  "web/results": (face) =>
    webList(face.heading, <ResultList dims={false} results={face.results} />),
  "web/searching": (face) =>
    webList(
      face.heading,
      <span className="text-muted-foreground">Searching…</span>,
    ),
};

/** A face drawn by its view. */
function viewOf<V extends WorkCardView>(
  face: WorkCardFaceOf<V>,
  context: ViewContext,
): ReactNode {
  return VIEWS[face.view](face, context);
}

/** A web card's heading over what goes under it. */
function webList(heading: string | undefined, under?: ReactNode) {
  return (
    <div className="absolute inset-0 flex flex-col gap-2 overflow-hidden bg-card px-3 py-2.5 text-xs">
      <p className="truncate font-medium text-foreground">{heading}</p>
      {under}
    </div>
  );
}

/** How long after the one before it each result comes in. */
const RESULT_STAGGER_S = 0.04;

/**
 * A search's results, each coming in a moment after the one before, since a
 * search's results arrive together. With `dims`, the one being opened stands
 * out and the rest step back.
 */
function ResultList({
  dims,
  results,
}: {
  dims: boolean;
  results: readonly WorkCardResult[];
}) {
  const isReduced = useReducedMotion();
  return (
    <ul className="flex flex-col gap-1.5">
      {results.map((result, index) => (
        <motion.li
          animate={{ opacity: dims && !result.isOpening ? 0.5 : 1, y: 0 }}
          className={cn(
            "-mx-1 flex min-w-0 items-start gap-1.5 rounded-md px-1",
            result.isOpening && "bg-brand-500/10",
          )}
          initial={isReduced ? false : { opacity: 0, y: 2 }}
          key={result.url}
          transition={{ delay: index * RESULT_STAGGER_S, duration: 0.15 }}
        >
          <Favicon className="mt-px size-3.5 shrink-0" url={result.url} />
          <span className="min-w-0">
            <span className="block truncate text-foreground/80">
              {result.title ?? result.host}
            </span>
            {result.title && (
              <span className="block truncate text-muted-foreground">
                {result.host}
              </span>
            )}
          </span>
        </motion.li>
      ))}
    </ul>
  );
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
        <Prose headings="card" inert size="xs">
          <Markdown hideImages isStreaming={isWriting} markdown={words} />
        </Prose>
      ) : (
        <FileWords isWriting={isWriting} path={path} text={words} />
      )}
    </div>
  );
}

const extensionOf = (path: string) =>
  /\.([^./\\]+)$/.exec(path)?.[1]?.toLowerCase();

/**
 * Some of a file's words as its source reads: code in monospace and its
 * grammar's colors, and anything else, Markdown included, as typed. Words
 * still arriving keep the colors they were shown in (`streamedCode`).
 */
function FileWords({
  className,
  isWriting = false,
  path,
  text,
}: {
  className?: string;
  isWriting?: boolean;
  path: string;
  text: string;
}) {
  const extension = extensionOf(path);
  const language = MARKDOWN_EXTENSIONS.has(extension ?? "")
    ? undefined
    : extension;
  const { grammar, highlightedHtml, isLanguageSupported } =
    useSyntaxHighlighting({
      code: language === undefined || isWriting ? undefined : text,
      language,
    });
  const [colored, setColored] = useState<ColoredLines>();
  const streamed =
    isWriting && grammar
      ? streamedCode(colored, text, {
          highlight: (code) => highlightedLineSpans(code, grammar),
          plain: plainLineSpan,
        })
      : undefined;
  if (streamed && streamed.colored !== colored) {
    setColored(streamed.colored);
  }
  const html =
    streamed && grammar
      ? codeBlockLines(streamed.spans, grammar)
      : highlightedHtml;
  return html ? (
    <div
      className={cn(
        "font-mono [&_pre]:break-words [&_pre]:whitespace-pre-wrap",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: html.join("\n") }}
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
  newest,
  strip,
}: {
  newest: WorkCardPicture;
  strip: readonly WorkCardPicture[];
}) {
  return (
    <div className="flex h-full flex-col items-center gap-2 p-2.5">
      <div className="flex min-h-0 w-full flex-1 items-center justify-center">
        <FilePicture
          className="max-h-full max-w-full rounded-md shadow-xs ring-1 ring-foreground/10"
          picture={newest}
        />
      </div>
      {strip.length > 0 && (
        <div className="flex h-9 shrink-0 items-center gap-1.5">
          {strip.map((picture, index) => (
            <FilePicture
              className={cn(
                "h-full w-auto rounded-sm",
                index === strip.length - 1
                  ? "ring-2 ring-brand-500"
                  : "opacity-80 ring-1 ring-foreground/10",
              )}
              key={`${index.toString()}:${picture.place}`}
              picture={picture}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A file drawn small by the system: a picture, a page, a document's first page.
 * Nothing shows until the picture has loaded, and a new version takes the old
 * one's place only once it has, so the card never shows a picture loading or
 * one that failed.
 */
function FilePicture({
  className = "size-full object-cover object-top",
  picture: { place, version },
}: {
  className?: string;
  picture: WorkCardPicture;
}) {
  const { resolvedTheme } = useTheme();
  const src = getComputerThumbnailUrl({
    hostPath: place,
    size: 1024,
    theme: resolvedTheme,
    ...(version !== undefined && { version }),
  });
  const [shown, setShown] = useState<{ place: string; src: string }>();
  useEffect(() => {
    if (src === "") {
      return;
    }
    let isCurrent = true;
    const image = new Image();
    image.addEventListener("load", () => {
      if (isCurrent) {
        setShown({ place, src });
      }
    });
    image.src = src;
    return () => {
      isCurrent = false;
    };
  }, [place, src]);
  // Another file's picture never stands in for this one's.
  return shown?.place === place ? (
    <img alt="" className={className} draggable={false} src={shown.src} />
  ) : null;
}
