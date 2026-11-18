import {
  isPagePath,
  type StepShows,
  writtenFileShows,
} from "./transcript-message";
import { type TurnStep } from "./turns-of";
import { type WorkCard } from "./work-card";

/** The most pictures the strip under a card's newest shows, the newest among them. */
const STRIP_SHOWN = 6;

/** A file drawn small by the system, at where it is on this computer. */
export interface WorkCardPicture {
  place: string;
  /** When the file was last written, so a new version draws again. */
  version?: number;
}

/** What the caption under the card says, whatever its kind. */
interface FaceCaption {
  meta?: string;
  title: string;
}

/**
 * What a work card can show, one entry per kind and state, named
 * `<kind>/<state>`.
 */
interface WorkCardViews {
  /** A file the card has nothing yet to show of but its name. */
  "files/none": { path: string | undefined };
  /**
   * A page's file drawn as a page: from its source while a call writes it
   * whole, then from the file on disk, each later write of it drawn again in
   * place.
   */
  "files/page": {
    /** The call writing it has not finished. */
    isWriting: boolean;
    path: string;
    /** Where it is on this computer, once known. */
    place?: string;
    /** Its whole source so far, while a call writing it whole is going. */
    source?: string;
    /** When the call last wrote it, once it has said. */
    version?: number;
  };
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
  "page/picture": {
    /** A call of the card's is still going: with no address yet, the one bringing the page up. */
    isGoing: boolean;
    url: string | undefined;
  };
}

export type WorkCardView = keyof WorkCardViews;

/** A work card's face in one view: its caption and what the view shows. */
export type WorkCardFaceOf<V extends WorkCardView> = FaceCaption &
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
      return pageFace(card.steps, drivenPage);
    }
    case "images": {
      return imagesFace(card.steps, placeOf);
    }
    case "generated": {
      return generatedFace(card.steps, placeOf);
    }
    case "files": {
      return filesFace(card, placeOf);
    }
  }
}

type PlaceOf = (path: string) => string | undefined;

function pageFace(
  steps: readonly TurnStep[],
  drivenPage: WorkCardLookups["drivenPage"],
): WorkCardFace {
  const address = shownBy(steps, "page")
    .flatMap((page) => (page.url ? [page.url] : []))
    .at(-1);
  const url = drivenPage?.url ?? address;
  // With no address yet, the call is still bringing the page up.
  const isGoing = steps.some(
    (step) => step.status !== "done" && step.status !== "failed",
  );
  return {
    isGoing,
    title:
      drivenPage?.title ??
      hostOf(url) ??
      (isGoing ? "Opening a page" : "Browser"),
    url,
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
  const caption = {
    meta: images.length > 1 ? `${images.length.toString()} images` : "Opened",
    title: newest?.path ? baseName(newest.path) : "An image",
  };
  if (!place) {
    return { ...caption, view: "images/opening" };
  }
  return {
    ...caption,
    newest: pictureOf(place, newest?.modifiedAt),
    strip: stripOf(images, placeOf),
    view: "images/pictures",
  };
}

/**
 * The latest pictures under the newest, oldest first, once more than the
 * newest is found: a strip of one would only repeat it.
 */
function stripOf(
  images: readonly ShowsOf<"image">[],
  placeOf: PlaceOf,
): WorkCardPicture[] {
  const strip = images.slice(-STRIP_SHOWN).flatMap((image) => {
    const place = image.path && placeOf(image.path);
    return place ? [pictureOf(place, image.modifiedAt)] : [];
  });
  return strip.length > 1 ? strip : [];
}

function generatedFace(
  steps: readonly TurnStep[],
  placeOf: PlaceOf,
): WorkCardFace {
  const newest = shownBy(steps, "generated").at(-1);
  const place = newest?.path && placeOf(newest.path);
  // The tool writes each partial frame over the file, so the picture fills
  // in as it is made.
  return place
    ? {
        picture: pictureOf(place, newest?.modifiedAt),
        title: newest?.path ? baseName(newest.path) : "An image",
        view: "generated/picture",
      }
    : { title: "Generating the image", view: "generated/generating" };
}

function filesFace(
  { changedFile, steps }: WorkCard,
  placeOf: PlaceOf,
): WorkCardFace {
  const written = shownBy(steps, "file").at(-1);
  const path = changedFile?.path ?? written?.path;
  const place = path && placeOf(path);
  const isWriting = written !== undefined && written.status !== "done";
  const isNew = changedFile?.isNew ?? written?.isNew;
  const meta = isWriting
    ? "Writing"
    : isNew === undefined
      ? undefined
      : isNew
        ? "New file"
        : "Updated";
  const caption = {
    ...(meta && { meta }),
    title: path ? baseName(path) : "A file",
  };
  if (path && isPagePath(path)) {
    return {
      ...caption,
      isWriting,
      path,
      ...(place && { place }),
      ...(written?.source !== undefined && { source: written.source }),
      ...(written?.modifiedAt !== undefined && {
        version: written.modifiedAt,
      }),
      view: "files/page",
    };
  }
  // A drawing or a table written is shown by its picture, and by nothing
  // until it is found.
  if (
    written?.words !== undefined &&
    !(written.status === "done" && writtenFileShows(written.path) === "picture")
  ) {
    return {
      ...caption,
      path: written.path,
      view: written.status === "writing" ? "files/writing" : "files/words",
      words: written.words,
    };
  }
  if (place) {
    return {
      ...caption,
      picture: pictureOf(place, written?.modifiedAt),
      view: "files/picture",
    };
  }
  return { ...caption, path, view: "files/none" };
}

function pictureOf(place: string, version: number | undefined) {
  return { place, ...(version !== undefined && { version }) };
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
