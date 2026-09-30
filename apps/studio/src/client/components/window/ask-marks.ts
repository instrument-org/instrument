// The numbered markers a live editor (Markdown or code) draws where a staged
// ask points, kept in step with its edits and with the window's asks.
import { useEffect } from "react";

import { numbered, useAskRevealer, useFileAsks } from "./staged-asks";

/** A staged ask's place in an editor's text, kept in step with edits, and the number it wears (0 until the window numbers it). */
export interface AskMark {
  from: number;
  id: string;
  n: number;
  to: number;
}

/** What an editor that marks staged asks in its text offers. */
export interface AskMarkHost {
  addAskMark: (id: string, from: number, to: number, quote?: string) => void;
  askMarks: () => { from: number; id: string; to: number }[];
  revealAskMark: (id: string) => void;
  setAskNumbers: (numbers: { id: string; n: number }[]) => void;
}

/**
 * Where each staged ask's mark last stood, by the ask's id, and the words it
 * covered: an editor unmounted by a tab switch puts its marks back from here
 * when it comes up again, where the words still read the same.
 */
const placed = new Map<string, { from: number; quote: string; to: number }>();

/**
 * An editor's ask marks after one change: moved through its edits by `map`
 * when the text changed, then with `add` put in (in place of a mark of the
 * same ask) and `numbers` applied (a mark whose ask has none goes).
 */
export function stepAskMarks(
  marks: AskMark[],
  {
    add,
    map,
    numbers,
  }: {
    add?: AskMark;
    map?: (pos: number, assoc: -1 | 1) => number;
    numbers?: readonly { id: string; n: number }[];
  },
): AskMark[] {
  let next = map
    ? marks.map((mark) => {
        const from = map(mark.from, 1);
        return { ...mark, from, to: Math.max(from, map(mark.to, -1)) };
      })
    : marks;
  if (add) {
    next = [...next.filter((mark) => mark.id !== add.id), add];
  }
  if (numbers) {
    const byId = new Map(numbers.map(({ id, n }) => [id, n]));
    next = next.flatMap((mark) => {
      const n = byId.get(mark.id);
      return n === undefined ? [] : [{ ...mark, n }];
    });
  }
  return next;
}

/**
 * Keeps an editor's markers in step with the file's staged asks: numbered in
 * order, gone when their ask is sent or removed, put back when the editor
 * mounts again, and brought into view when a pill is pressed.
 */
export function useAskMarks(path: string, host: AskMarkHost | null) {
  const asks = useFileAsks(path);
  const numbers = numbered(asks).map(({ ask, n }) => ({ id: ask.id, n }));
  const key = numbers.map(({ id, n }) => `${id}:${n}`).join(",");

  useEffect(() => {
    if (!host) {
      return;
    }
    for (const { id } of numbers) {
      const place = placed.get(id);
      if (place) {
        host.addAskMark(id, place.from, place.to, place.quote);
      }
    }
    return () => {
      for (const mark of host.askMarks()) {
        const place = placed.get(mark.id);
        if (place) {
          placed.set(mark.id, { ...place, from: mark.from, to: mark.to });
        }
      }
    };
    // Once per editor: later changes to the asks are the effect below's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host]);

  useEffect(() => {
    host?.setAskNumbers(numbers);
    // `key` is `numbers` as a value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, key]);

  useAskRevealer(
    path,
    host
      ? (id) => {
          host.revealAskMark(id);
        }
      : null,
  );

  return {
    /** Marks a newly staged ask's place. */
    mark: (id: string, from: number, to: number, quote: string) => {
      placed.set(id, { from, quote, to });
      host?.addAskMark(id, from, to, quote);
    },
  };
}
