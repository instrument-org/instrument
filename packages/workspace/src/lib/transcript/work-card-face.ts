import { type StepShows, type WebResult } from "./transcript-message";
import { type TurnStep } from "./turns-of";
import { type WorkCard } from "./work-card";

/**
 * The files a card shows by their picture once written, since the app draws
 * them as they look: a page, a drawing, a table.
 */
const PICTURED_EXTENSIONS = new Set(["csv", "htm", "html", "svg", "tsv"]);

/** The most pictures the strip under a card's newest shows, the newest among them. */
const STRIP_SHOWN = 6;

/** A file drawn small by the system, at where it is on this computer. */
export interface WorkCardPicture {
  place: string;
  /** When the file was last written, so a new version draws again. */
  version?: number;
}

/** One search result as a web card lists it. */
export interface WorkCardResult {
  host: string | undefined;
  /** It is the result being opened. */
  isOpening: boolean;
  title: string | undefined;
  url: string;
}

/** What pressing the card opens. */
type WorkCardOpen = { file: string } | { url: string };

/** What the card's bar says and what pressing it opens, whatever its kind. */
interface FaceBar {
  meta?: string;
  open?: WorkCardOpen;
  title: string;
}

/**
 * What a work card can show, one entry per kind and state, named
 * `<kind>/<state>`.
 */
interface WorkCardViews {
  /** The change an edit made: what went, if anything, and what came in. */
  "files/diff": { after: string; before?: string; path: string };
  "files/none": object;
  "files/picture": { picture: WorkCardPicture };
  /** A file's words as they stand. */
  "files/words": { path: string; words: string };
  /** A file's words as they arrive. */
  "files/writing": { path: string; words: string };
  "generated/generating": object;
  "generated/picture": { picture: WorkCardPicture };
  /** Before the newest is found. */
  "images/opening": object;
  /** The newest large, and with more than one, a strip of the latest under it, oldest first. */
  "images/pictures": { newest: WorkCardPicture; strip: WorkCardPicture[] };
  /** A browser's page: the picture of the tab the session drove last. */
  "page/picture": object;
  "web/nothing-found": { heading: string | undefined };
  /**
   * A page on its way: one of the results, marked among them, or a page not
   * among them, or one whose address has not come yet, named by the heading
   * alone.
   */
  "web/opening": { heading: string | undefined; results?: WorkCardResult[] };
  /** A page read, with its words once the call gave them. */
  "web/page": {
    heading: string | undefined;
    host: string | undefined;
    words?: string;
  };
  /** The newest search's results, none of them being opened. */
  "web/results": { heading: string | undefined; results: WorkCardResult[] };
  "web/searching": { heading: string | undefined };
}

export type WorkCardView = keyof WorkCardViews;

/** A work card's face in one view: its bar and what the view shows. */
export type WorkCardFaceOf<V extends WorkCardView> = FaceBar &
  WorkCardViews[V] & { view: V };

/** What a work card shows now, in one of its kind's views. */
export type WorkCardFace = {
  [V in WorkCardView]: WorkCardFaceOf<V>;
}[WorkCardView];

/** What a card's face needs from outside its steps. */
export interface WorkCardLookups {
  /** The tab the session drove last, for a page card. */
  drivenPage?: { title?: string; url?: string };
  /** Where each path the card names (`workCardPaths`) is on this computer, once known. */
  places: Readonly<Record<string, null | string | undefined>>;
}

type ShowsOf<K extends StepShows["kind"]> = Extract<StepShows, { kind: K }>;

const isAddress = (target: string) => /^[a-z]+:\/\//.test(target);

/** The paths a card names, as the calls spelled them. */
export function workCardPaths({ changedFile, steps }: WorkCard): string[] {
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
          return isAddress(shows.target) ? [] : [shows.target];
        }
        default: {
          return [];
        }
      }
    }),
  ];
}

/** What a work card shows now, worked out from its steps alone. */
export function workCardFace(
  card: WorkCard,
  { drivenPage, places }: WorkCardLookups,
): WorkCardFace {
  const placeOf = (path: string) => places[path] ?? undefined;
  switch (card.kind) {
    case "page": {
      return pageFace(card.steps, placeOf, drivenPage);
    }
    case "images": {
      return imagesFace(card.steps, placeOf);
    }
    case "generated": {
      return generatedFace(card.steps, placeOf);
    }
    case "web": {
      return webFace(card.steps);
    }
    case "files": {
      return filesFace(card, placeOf);
    }
  }
}

type PlaceOf = (path: string) => string | undefined;

function pageFace(
  steps: readonly TurnStep[],
  placeOf: PlaceOf,
  drivenPage: WorkCardLookups["drivenPage"],
): WorkCardFace {
  const pages = shownBy(steps, "page", "opened");
  const newest = pages.at(-1);
  const address = pages
    .flatMap((page) => (page.kind === "page" && page.url ? [page.url] : []))
    .at(-1);
  const target = newest?.kind === "opened" ? newest.target : undefined;
  const place = drivenPage?.url ?? address ?? target;
  return {
    ...(place && {
      open: isAddress(place)
        ? { url: place }
        : { file: placeOf(place) ?? place },
    }),
    title:
      drivenPage?.title ??
      hostOf(drivenPage?.url ?? address) ??
      (target ? baseName(target) : "A page"),
    view: "page/picture",
  };
}

function imagesFace(
  steps: readonly TurnStep[],
  placeOf: PlaceOf,
): WorkCardFace {
  const images = shownBy(steps, "image");
  const newest = images.at(-1);
  const place = newest?.path && placeOf(newest.path);
  const bar = {
    meta: images.length > 1 ? `${images.length.toString()} images` : "Opened",
    ...(place && { open: { file: place } }),
    title: newest?.path ? baseName(newest.path) : "An image",
  };
  if (!place) {
    return { ...bar, view: "images/opening" };
  }
  return {
    ...bar,
    newest: pictureOf(place, newest?.modifiedAt),
    strip:
      images.length > 1
        ? images.slice(-STRIP_SHOWN).flatMap((image) => {
            const stripPlace = image.path && placeOf(image.path);
            return stripPlace ? [pictureOf(stripPlace, image.modifiedAt)] : [];
          })
        : [],
    view: "images/pictures",
  };
}

function generatedFace(
  steps: readonly TurnStep[],
  placeOf: PlaceOf,
): WorkCardFace {
  const newest = shownBy(steps, "generated").at(-1);
  const place = newest?.path && placeOf(newest.path);
  const title = newest?.path ? baseName(newest.path) : "An image";
  // The tool writes each partial frame over the file, so the picture fills
  // in as it is made.
  return place
    ? {
        open: { file: place },
        picture: pictureOf(place, newest?.modifiedAt),
        title,
        view: "generated/picture",
      }
    : { title, view: "generated/generating" };
}

function webFace(steps: readonly TurnStep[]): WorkCardFace {
  const searches = shownBy(steps, "search");
  const search = searches.at(-1);
  // A fetch's address comes last in its call, and until it has, the search
  // it follows stays up: there is nothing yet to say of the page.
  const fetch =
    steps.at(-1)?.shows?.kind === "fetch"
      ? shownBy(steps, "fetch").at(-1)
      : undefined;
  const found = searches.reduce((sum, each) => sum + each.total, 0);
  const counted =
    found > 0
      ? `${found.toString()} ${found === 1 ? "result" : "results"}`
      : undefined;
  const query = search?.query;
  const results = search?.results ?? [];
  const url = fetch?.url;
  if (fetch === undefined || url === undefined) {
    const heading = query ?? (fetch ? "Opening a page" : "Searching");
    const bar = {
      heading,
      ...(counted && { meta: counted }),
      title:
        fetch && !search ? "Opening a page" : (query ?? "Searching the web"),
    };
    if (results.length > 0) {
      return {
        ...bar,
        results: results.map((result) => resultOf(result)),
        view: "web/results",
      };
    }
    if (fetch) {
      return { ...bar, view: "web/opening" };
    }
    return {
      ...bar,
      view: search?.status === "done" ? "web/nothing-found" : "web/searching",
    };
  }
  const host = hostOf(url);
  const open = url ? { open: { url } } : {};
  if (fetch.status === "done") {
    const meta = host ?? counted;
    return {
      heading: fetch.title ?? host,
      host,
      ...(meta && { meta }),
      ...open,
      title: fetch.title ?? host ?? "Page",
      view: "web/page",
      ...(fetch.words !== undefined && { words: fetch.words }),
    };
  }
  const opening = `Opening ${host ?? "the page"}`;
  const isAResult = results.some((result) => sameAddress(result.url, url));
  return {
    heading: isAResult ? (query ?? "Opening a page") : opening,
    ...(counted && { meta: counted }),
    ...open,
    ...(isAResult && {
      results: results.map((result) => resultOf(result, url)),
    }),
    title: opening,
    view: "web/opening",
  };
}

function filesFace(
  { changedFile, steps }: WorkCard,
  placeOf: PlaceOf,
): WorkCardFace {
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
  const bar = {
    ...(meta && { meta }),
    ...(place && { open: { file: place } }),
    title: path ? baseName(path) : "A file",
  };
  if (written?.after !== undefined) {
    return {
      ...bar,
      after: written.after,
      ...(written.before && { before: written.before }),
      path: written.path,
      view: "files/diff",
    };
  }
  if (
    written?.words !== undefined &&
    !(written.status === "done" && place && isPictured(written.path))
  ) {
    return {
      ...bar,
      path: written.path,
      view: written.status === "writing" ? "files/writing" : "files/words",
      words: written.words,
    };
  }
  if (place) {
    return {
      ...bar,
      picture: pictureOf(place, written?.modifiedAt),
      view: "files/picture",
    };
  }
  return { ...bar, view: "files/none" };
}

function pictureOf(place: string, version: number | undefined) {
  return { place, ...(version !== undefined && { version }) };
}

function resultOf({ title, url }: WebResult, opening?: string) {
  return {
    host: hostOf(url),
    isOpening: opening !== undefined && sameAddress(url, opening),
    title,
    url,
  };
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

const baseName = (path: string) => path.split(/[/\\]/).pop() ?? path;

const extensionOf = (path: string) =>
  /\.([^./\\]+)$/.exec(path)?.[1]?.toLowerCase();

const isPictured = (path: string) =>
  PICTURED_EXTENSIONS.has(extensionOf(path) ?? "");

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

/** Two addresses for one page, whatever their fragment or a trailing slash. */
function sameAddress(one: string, other: string): boolean {
  const plain = (url: string) => url.replace(/#.*$/, "").replace(/\/+$/, "");
  return plain(one) === plain(other);
}
