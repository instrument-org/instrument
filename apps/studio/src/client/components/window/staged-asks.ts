import { promptDraftRefAtom } from "@/client/atoms/prompt-value";
// Asks staged on files in this window: the places the person marked for
// Instrument, held in memory until a composer sends them, with the hooks each
// surface uses to stage, list, move and reveal them.
import {
  type ChatId,
  type SessionMessageDataPart,
} from "@instrument-org/workspace/client";
import { atom, useAtomValue, useSetAtom, useStore } from "jotai";
import { useContext, useEffect, useRef } from "react";

import { groupOnScreenAtom } from "./window-tabs";

import { WindowContext } from "./context";
import { mountOfHostPath } from "./file-tabs";
import { segmentsOf } from "./host-path";
import { chatOfGroup } from "./window-href";

/** The composer a staged ask was moved into: a chat's, or a draft's. */
export type AskDestination =
  | { draftId: string; kind: "draft" }
  | { chatId: ChatId; kind: "chat" };

/**
 * One place in a file the person marked for Instrument, waiting to be sent:
 * the file, where in it as a reader would say it, what is there, and what
 * they typed for it. It waits on its file's Ask until moved into a composer,
 * where it is a pill until that composer sends. Held in memory for the
 * window alone; nothing keeps them past a restart.
 */
export interface StagedAsk {
  /** What the surface knows about the place that its text alone does not say: that a script makes it, say. */
  context?: string;
  createdAt: number;
  /** The composer it was moved into; absent while it waits on its file's Ask. */
  destination?: AskDestination;
  /** The words or source at that place, trimmed; nothing for a whole file. */
  excerpt?: string;
  id: string;
  /** What the person typed for it, which may be nothing. */
  instruction: string;
  /** The file, by its path on this computer. */
  path: string;
  /** Where in the file: "lines 12-14", "Heading · line 40", "page 3", "whole file". */
  target: string;
}

/** The longest excerpt carried with an ask; past it the excerpt is cut, since the agent reads the file itself. */
const EXCERPT_MAX = 1500;

/** Every staged ask in the window, oldest first. */
export const stagedAsksAtom = atom<StagedAsk[]>([]);

/** The file whose Ask has its list of waiting asks open, if any: a pin on a page opens it too. */
export const askTrayAtom = atom<null | string>(null);

/** Staged asks as the message carries them, each file with the virtual path the agent reaches it by. */
export function asksPart(
  asks: readonly StagedAsk[],
  folders: Record<string, { mountName: string; path: string }>,
): SessionMessageDataPart.AsksDataPart | undefined {
  if (asks.length === 0) {
    return;
  }
  return {
    asks: asks.map((ask) => {
      const mount = mountOfHostPath(ask.path, folders);
      return {
        ...(ask.context ? { context: ask.context } : {}),
        ...(ask.excerpt ? { excerpt: ask.excerpt } : {}),
        file: {
          ...(mount === undefined ? {} : { mount }),
          name: fileNameOf(ask.path),
          path: ask.path,
        },
        instruction: ask.instruction.trim(),
        target: ask.target,
      };
    }),
  };
}

/** Staged asks as a person counts them: "1 comment", "3 comments". */
export function commentCount(count: number) {
  return count === 1 ? "1 comment" : `${count} comments`;
}

/** A file's name, from its path. */
export function fileNameOf(path: string) {
  return segmentsOf(path).at(-1) ?? path;
}

/** Lines as a reader says them: "line 3", "lines 3-5". */
export function linesLabel([first, last]: [number, number]) {
  return first === last ? `line ${first}` : `lines ${first}-${last}`;
}

/** Each of a file's asks with the number its marker wears, 1 up. */
export function numbered(asks: readonly StagedAsk[]) {
  const counts = new Map<string, number>();
  return asks.map((ask) => {
    const n = (counts.get(ask.path) ?? 0) + 1;
    counts.set(ask.path, n);
    return { ask, n };
  });
}

/** The asks moved into a composer, which it shows as pills and sends. */
export function useComposerAsks(destination: AskDestination) {
  const asks = useAtomValue(stagedAsksAtom);
  return asks.filter((ask) => isFor(ask, destination));
}

/** A file's staged asks, oldest first, wherever they wait: their order is their number. */
export function useFileAsks(path: string | undefined) {
  const asks = useAtomValue(stagedAsksAtom);
  return path === undefined ? [] : asks.filter((ask) => ask.path === path);
}

/** Stages an ask, returning its id: the one given, for a surface that names its own, or a new one. */
export function useStageAsk() {
  const setAsks = useSetAtom(stagedAsksAtom);
  return (ask: Omit<StagedAsk, "createdAt" | "id"> & { id?: string }) => {
    const id = ask.id ?? crypto.randomUUID();
    setAsks((current) => [
      ...current,
      {
        ...ask,
        createdAt: Date.now(),
        id,
        ...(ask.excerpt ? { excerpt: clipExcerpt(ask.excerpt) } : {}),
      },
    ]);
    return id;
  };
}

/** Changing what an ask says, moving asks into a composer and back, and taking them away. */
export function useStagedAskActions() {
  const setAsks = useSetAtom(stagedAsksAtom);
  return {
    moveTo: (ids: readonly string[], destination: AskDestination) => {
      setAsks((current) =>
        current.map((ask) =>
          ids.includes(ask.id) ? { ...ask, destination } : ask,
        ),
      );
    },
    remove: (ids: readonly string[]) => {
      setAsks((current) => current.filter((ask) => !ids.includes(ask.id)));
    },
    /** Puts what was moved into a composer back on its files' Ask, for a composer thrown away. */
    returnTo: (destination: AskDestination) => {
      setAsks((current) =>
        current.map((ask) => {
          if (!isFor(ask, destination)) {
            return ask;
          }
          const { destination: _moved, ...waiting } = ask;
          return waiting;
        }),
      );
    },
    setInstruction: (id: string, instruction: string) => {
      setAsks((current) =>
        current.map((ask) => (ask.id === id ? { ...ask, instruction } : ask)),
      );
    },
  };
}

/** An excerpt cut to what an ask carries. */
function clipExcerpt(text: string) {
  const trimmed = text.trim();
  return trimmed.length > EXCERPT_MAX
    ? `${trimmed.slice(0, EXCERPT_MAX)}…`
    : trimmed;
}

/** Whether an ask was moved into this composer. */
function isFor(ask: StagedAsk, destination: AskDestination) {
  const at = ask.destination;
  return destination.kind === "draft"
    ? at?.kind === "draft" && at.draftId === destination.draftId
    : at?.kind === "chat" && at.chatId === destination.chatId;
}

/**
 * The surfaces that can bring an ask's place into view, by file: the editor
 * or viewer showing the file registers itself while it is up.
 */
const revealers = new Map<string, (id: string) => void>();

/** Brings an ask's place into view in the file's editor, when the file is on screen. */
export function revealAsk(ask: StagedAsk) {
  revealers.get(ask.path)?.(ask.id);
}

/** Registers how a surface brings one of its file's asks into view, for as long as it is up. */
export function useAskRevealer(
  path: string | undefined,
  reveal: ((id: string) => void) | null,
) {
  const latest = useRef(reveal);
  useEffect(() => {
    latest.current = reveal;
  });
  const isOn = reveal !== null;
  useEffect(() => {
    if (path === undefined || !isOn) {
      return;
    }
    const run = (id: string) => {
      latest.current?.(id);
    };
    revealers.set(path, run);
    return () => {
      if (revealers.get(path) === run) {
        revealers.delete(path);
      }
    };
  }, [path, isOn]);
}

/**
 * Moving a file's waiting asks into a composer, as pills: the chat beside
 * the file when one is up, otherwise a new draft (or, inside a draft window,
 * that draft). What the button that does it says, and whether there is
 * anywhere to move them at all.
 */
export function useMoveAsks() {
  const appWindow = useContext(WindowContext);
  const store = useStore();
  const chat = useChatBeside();
  const { moveTo } = useStagedAskActions();
  const canMove = chat !== undefined || appWindow?.moveAsksToDraft;
  return {
    canMove: Boolean(canMove),
    /** The button's words for `count` comments: "Add 3 comments to chat". */
    label: (count: number) =>
      `Add ${commentCount(count)} to ${chat === undefined ? "new chat" : "chat"}`,
    move: (ids: string[]) => {
      if (chat === undefined) {
        appWindow?.moveAsksToDraft?.(ids);
      } else {
        moveTo(ids, { chatId: chat, kind: "chat" });
        const editor = store.get(
          promptDraftRefAtom({ chatId: chat, scope: "chat" }),
        );
        editor?.focus();
        editor?.moveCaretToEnd();
      }
    },
  };
}

/**
 * The chat up beside what is on screen, whose composer takes what a file's
 * Ask moves; with none, a new draft takes it.
 */
function useChatBeside(): ChatId | undefined {
  return chatOfGroup(useAtomValue(groupOnScreenAtom));
}
