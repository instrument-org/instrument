import { type FinderShown } from "@/client/atoms/window";
import { useTabId } from "@/client/hooks/use-active-tab";
import { atom, useSetAtom } from "jotai";
import { useEffect, useState } from "react";

import { type PageChromeSlots } from "./browser-tabs";
import { useGroupTab } from "./group-tab";

/**
 * Where a tab wants the window's page drawn: the element the page lies
 * over, the row its reload and controls go into, and whether the page is
 * what the tab shows right now. A tab with no page to show reports nothing.
 */
export interface PageSlot {
  chrome: PageChromeSlots | undefined;
  host: HTMLElement;
  isShown: boolean;
}

/**
 * What one tab's screen says about itself, by the tab it is drawn in: one of
 * the window's own tabs, or a group's tab beside a chat or in a draft's
 * band. Each fact is written by the screen that knows it, through
 * `useTabSurface`, and goes when that screen changes it or leaves.
 */
export interface TabSurface {
  /**
   * What the tab's Finder has in it, by host path, so a draft opened over
   * the tab, or with it up behind, names them as the chat will be told them,
   * whichever tab is up by the time it is sent. The window's own Files tabs
   * alone: a draft's band has a Finder of its own.
   */
  finder?: FinderShown;
  /** Where the window's page is drawn while this tab is up; one of the window's own tabs alone. */
  slot?: PageSlot;
}

/** Every tab's surface, by the tab's id; a tab with nothing to say is not named. In memory only, with the elements. */
export const tabSurfaceAtom = atom<Readonly<Record<string, TabSurface>>>({});

type Surfaces = Readonly<Record<string, TabSurface>>;
/** Each fact as said, for a screen saying it. */
type Facts = Required<TabSurface>;

/** The surfaces with one tab's fact set, or the same surfaces when it already is that value. */
export function putSurface<K extends keyof TabSurface>(
  surfaces: Surfaces,
  key: string,
  field: K,
  value: Facts[K],
): Surfaces {
  const was = surfaces[key];
  if (was?.[field] === value) {
    return surfaces;
  }
  return { ...surfaces, [key]: { ...was, [field]: value } };
}

/**
 * The surfaces with one tab's fact gone, when it is still the value given:
 * a screen arriving in the same tab as one leaves has said its own by then,
 * and is not cleared with it. A tab left with nothing is dropped.
 */
export function dropSurface<K extends keyof TabSurface>(
  surfaces: Surfaces,
  key: string,
  field: K,
  value: Facts[K],
): Surfaces {
  const was = surfaces[key];
  if (was?.[field] !== value) {
    return surfaces;
  }
  const { [field]: _gone, ...rest } = was;
  if (Object.keys(rest).length === 0) {
    const { [key]: _tab, ...others } = surfaces;
    return others;
  }
  return { ...surfaces, [key]: rest };
}

/**
 * How two values of each fact are told apart, since screens build a fresh
 * object for one on each render. A slot is its elements, compared by
 * identity; every other fact is plain data, compared by value.
 */
type SameFact = {
  [K in keyof Facts]: (a: Facts[K] | null, b: Facts[K] | null) => boolean;
};
const sameFact: SameFact = {
  finder: sameData,
  slot: (a, b) =>
    a !== null &&
    b !== null &&
    a.host === b.host &&
    a.isShown === b.isShown &&
    a.chrome === b.chrome,
};

function sameData(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Whether two values of a fact say the same thing, null being nothing said. */
export function sameSurface<K extends keyof TabSurface>(
  field: K,
  a: Facts[K] | null,
  b: Facts[K] | null,
): boolean {
  const same: SameFact[K] = sameFact[field];
  return a === b || same(a, b);
}

/**
 * Says one fact about the tab this screen is drawn in, for as long as the
 * screen is mounted and says it. Null says nothing and clears nothing: a
 * layout route with a child screen inside it passes null so the child's
 * answer stands.
 */
export function useTabSurface<K extends keyof TabSurface>(
  field: K,
  value: Facts[K] | null,
) {
  const setSurfaces = useSetAtom(tabSurfaceAtom);
  const groupTabId = useGroupTab()?.id;
  const appTabId = useTabId();
  const key = groupTabId ?? appTabId;
  // The value as first said, kept while each render says the same again,
  // so the effect below runs only when what is said changes.
  const [said, setSaid] = useState(value);
  if (said !== value && !sameSurface(field, said, value)) {
    setSaid(value);
  }
  useEffect(() => {
    if (said === null) {
      return;
    }
    setSurfaces((current) => putSurface(current, key, field, said));
    return () => {
      setSurfaces((current) => dropSurface(current, key, field, said));
    };
  }, [field, key, said, setSurfaces]);
}
