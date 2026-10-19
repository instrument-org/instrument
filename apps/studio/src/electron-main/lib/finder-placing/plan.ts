/**
 * Putting things into a folder from the Finder: a drop from outside the app
 * or a paste (copy), or a drag of the Finder's own rows (move). Planned here,
 * with no file system, from a snapshot of everything involved; carried out by
 * `execute.ts`, which only follows the plan, and journaled so one ⌘Z takes
 * all of it back.
 *
 * The types
 *
 * - `PlaceRequest`: the operation, the destination (its path and the identity
 *   of it and every folder above it), what is in it now, how its disk compares
 *   names, the sources in order (path, name, kind, identity, the folders above
 *   it, whether it is on the destination's disk), and the person's answer for
 *   each clash, by source path.
 * - `Clash`: a source whose name, compared the way the destination's disk
 *   compares names, is taken there: by an entry, or by an earlier source in
 *   the same request. `replaceable` says whether Replace may be answered.
 * - `Plan`: a refusal, when nothing may happen at all; otherwise one step per
 *   source, in order. A step skips the source (answered Skip, or already where
 *   it is going) or places it: how (rename on one disk, copy, or copy and then
 *   move the source to the Trash for a move onto another disk), the path it
 *   takes, the staging path a copy is written to first, and the entry it
 *   replaces. What undoes it is the journal entry the executor writes from
 *   the steps it carried out, since a copy's identity exists only once made.
 *
 * The invariants (each has a test in `execute.test.ts`)
 *
 * 1. Nothing that existed before is deleted. What is replaced, and the
 *    source of a move onto another disk, go to the Trash. The only thing ever
 *    removed is a staging copy this made itself.
 * 2. What is replaced goes to the Trash only once what takes its place is
 *    complete: a copy is written to a staging path in the destination and
 *    measured against its source first; a moved item is whole where it is.
 * 3. Every write into place is exclusive: it fails rather than take a name
 *    something else took after the plan, and that failure stops the rest.
 * 4. A failure puts the item in hand back as it was (what it replaced back
 *    out of the Trash, its staging copy removed) and stops, so every original
 *    byte is at its own path, in the destination, or in the Trash.
 * 5. What was done before a failure is journaled as one entry, and undo
 *    checks every piece before it moves any: all of it comes back, or none.
 * 6. Links are moved and copied as links and never followed; replacing one
 *    trashes the link. A package (an app, a library) is one item.
 * 7. Whatever the answers, nothing goes into itself, nothing replaces one of
 *    the sources or a folder holding one, and a source already in the
 *    destination is never moved onto itself.
 */

import { type Identity } from "../file-journal";

/** What a thing is, as placing it cares: a package is a folder that is one item. */
export type ItemKind = "file" | "folder" | "link" | "package";

/** The person's answer for a clash. */
export type Answer = "keepBoth" | "replace" | "skip";

type PlaceSource = {
  /** Above it, nearest first: the folder it is in, then each folder above that. */
  above: readonly Identity[];
  identity: Identity;
  kind: ItemKind;
  name: string;
  /** Whether it is on the destination's disk, where moving it is a rename. */
  onDestinationDisk: boolean;
  path: string;
};

/** Something already in the destination. */
export type PlaceEntry = { identity: Identity; kind: ItemKind; name: string };

/** How the destination's disk tells names apart. */
export type NameRules = {
  /** "Notes.txt" and "notes.txt" are two names. Off on the Mac's and Windows' default disks. */
  caseSensitive: boolean;
  /** "é" composed and "é" decomposed are two names. Off on the Mac's disks. */
  unicodeSensitive: boolean;
};

export type PlaceRequest = {
  answers: Readonly<Record<string, Answer>>;
  /** What the system's file manager calls the `n`th copy of a stem beside it. */
  copyName: (stem: string, n: number) => string;
  /** The destination's entries as they are now. */
  entries: readonly PlaceEntry[];
  folder: {
    /** It, then each folder above it, nearest first. */
    chain: readonly Identity[];
    path: string;
  };
  /** Joins a folder and a name the way this system writes paths. */
  join: (folder: string, name: string) => string;
  names: NameRules;
  op: "copy" | "move";
  sources: readonly PlaceSource[];
  /** Unique to this request, so staging names never meet another's. */
  token: string;
};

export type Clash = {
  kind: ItemKind;
  name: string;
  path: string;
  /** Whether Replace may be answered: not for an earlier source, one of the sources, or a folder holding one. */
  replaceable: boolean;
  with: { by: "entry" | "source"; kind: ItemKind };
};

export type Step =
  | { kind: "skip"; source: string; why: "already-there" | "answered" }
  | {
      how: "copy" | "copy-and-trash-source" | "rename";
      itemKind: ItemKind;
      kind: "place";
      /** What it takes the place of, by where it is and what it is. */
      replaces: null | { identity: Identity; path: string };
      source: string;
      sourceIdentity: Identity;
      /** Where a copy is written and measured before it goes into place; null for a rename. */
      staging: null | string;
      to: string;
    };

export type Plan = { refusal: string } | { steps: Step[] };

/** A name as the destination's disk compares it. */
function nameKey(
  name: string,
  { caseSensitive, unicodeSensitive }: NameRules,
) {
  const composed = unicodeSensitive ? name : name.normalize("NFC");
  return caseSensitive ? composed : composed.toLowerCase();
}

export function sameIdentity(left: Identity, right: Identity) {
  return left.dev === right.dev && left.ino === right.ino;
}

/** A name split where a numbered or copied name goes in: before a file's extension, at a folder's end. */
function stemAndExtension(name: string, kind: ItemKind) {
  const dot = name.lastIndexOf(".");
  return kind === "folder" || dot <= 0
    ? { extension: "", stem: name }
    : { extension: name.slice(dot), stem: name.slice(0, dot) };
}

/**
 * Whether a source is already in the destination: in the folder itself, or
 * there under another name or spelling of its name (a hard link, or a name
 * the disk does not tell apart from it).
 */
const isAlreadyThere = (source: PlaceSource, request: PlaceRequest) => {
  const [inside] = source.above;
  const [folder] = request.folder.chain;
  return (
    (inside !== undefined &&
      folder !== undefined &&
      sameIdentity(inside, folder)) ||
    request.entries.some((entry) =>
      sameIdentity(entry.identity, source.identity),
    )
  );
};

/**
 * The sources whose names are taken in the destination, in order, for the
 * person to answer before anything is touched. One already in the
 * destination (`isAlreadyThere`) is not asked about: a move leaves it where
 * it is, and a copy of it takes the name the system gives a copy, as the
 * Finder does.
 */
export function clashesOf(request: PlaceRequest): Clash[] {
  const taken = new Map<
    string,
    { by: "entry" | "source"; identity: Identity; kind: ItemKind }
  >();
  for (const entry of request.entries) {
    taken.set(nameKey(entry.name, request.names), { ...entry, by: "entry" });
  }
  const clashes: Clash[] = [];
  for (const source of request.sources) {
    if (isAlreadyThere(source, request)) {
      continue;
    }
    const key = nameKey(source.name, request.names);
    const there = taken.get(key);
    if (there) {
      clashes.push({
        kind: source.kind,
        name: source.name,
        path: source.path,
        replaceable:
          there.by === "entry" && !isGuarded(there.identity, request),
        with: { by: there.by, kind: there.kind },
      });
    }
    taken.set(key, {
      by: "source",
      identity: source.identity,
      kind: source.kind,
    });
  }
  return clashes;
}

/** Whether something in the destination is one of the sources, or holds one. */
function isGuarded(identity: Identity, request: PlaceRequest) {
  return request.sources.some(
    (source) =>
      sameIdentity(source.identity, identity) ||
      source.above.some((folder) => sameIdentity(folder, identity)),
  );
}

export function planPlacing(request: PlaceRequest): Plan {
  const { answers, folder, names, op, sources } = request;
  for (const source of sources) {
    if (folder.chain.some((each) => sameIdentity(each, source.identity))) {
      return { refusal: `“${source.name}” can’t go into itself.` };
    }
  }
  const clashes = new Map(
    clashesOf(request).map((clash) => [clash.path, clash]),
  );
  for (const clash of clashes.values()) {
    const answer = answers[clash.path];
    if (answer === undefined) {
      return {
        refusal: `Something named “${clash.name}” is already there. Try again to choose what happens to it.`,
      };
    }
    if (answer === "replace" && !clash.replaceable) {
      return {
        refusal:
          clash.with.by === "source"
            ? `“${clash.name}” can’t replace another item you’re putting there.`
            : `“${clash.name}” can’t be replaced, since it is one of the items you’re putting there or holds one.`,
      };
    }
  }

  const entriesByKey = new Map(
    request.entries.map((entry) => [nameKey(entry.name, names), entry]),
  );
  const taken = new Set(entriesByKey.keys());
  const firstFree = (nameFor: (n: number) => string, from: number) => {
    for (let n = from; n < 10_000; n += 1) {
      const name = nameFor(n);
      if (!taken.has(nameKey(name, names))) {
        return name;
      }
    }
    throw new Error("No free name");
  };

  const steps: Step[] = sources.map((source, index): Step => {
    const { extension, stem } = stemAndExtension(source.name, source.kind);
    const inDestination = isAlreadyThere(source, request);
    if (inDestination && op === "move") {
      return { kind: "skip", source: source.path, why: "already-there" };
    }
    const clash = inDestination ? undefined : clashes.get(source.path);
    const answer = clash ? answers[source.path] : undefined;
    if (answer === "skip") {
      return { kind: "skip", source: source.path, why: "answered" };
    }
    const replaced =
      answer === "replace"
        ? entriesByKey.get(nameKey(source.name, names))
        : undefined;
    const name = inDestination
      ? firstFree((n) => `${request.copyName(stem, n)}${extension}`, 1)
      : clash && !replaced
        ? firstFree((n) => `${stem} ${n.toString()}${extension}`, 2)
        : source.name;
    taken.add(nameKey(name, names));
    const how =
      op === "copy"
        ? "copy"
        : source.onDestinationDisk
          ? "rename"
          : "copy-and-trash-source";
    return {
      how,
      itemKind: source.kind,
      kind: "place",
      replaces: replaced
        ? {
            identity: replaced.identity,
            path: request.join(folder.path, replaced.name),
          }
        : null,
      source: source.path,
      sourceIdentity: source.identity,
      staging:
        how === "rename"
          ? null
          : request.join(
              folder.path,
              `${STAGING_PREFIX}${request.token}-${index.toString()}`,
            ),
      to: request.join(folder.path, name),
    };
  });
  return { steps };
}

/** How a staging copy's name starts, which is all that may ever be removed. */
export const STAGING_PREFIX = ".instrument-placing-";
