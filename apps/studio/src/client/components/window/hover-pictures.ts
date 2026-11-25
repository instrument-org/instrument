import { type WindowTab } from "@/client/atoms/window";
import { atom } from "jotai";

import { type GroupLayout } from "./tab-model";

/** A picture on hand: when it was taken and what it is shown of. */
export interface HoverPicture {
  at: number;
  shows: string;
  url: string;
}

/** The pictures on hand, by key (`groupPictureKey`, `tabPictureKey`). */
export const hoverPicturesAtom = atom<ReadonlyMap<string, HoverPicture>>(
  new Map<string, HoverPicture>(),
);

export const groupPictureKey = (group: string) => `group:${group}`;
export const tabPictureKey = (tab: string) => `tab:${tab}`;

/** What a tab shows, which its picture is of: its address. */
export function tabShows(tab: WindowTab): string {
  return tab.kind === "page" ? (tab.url ?? tab.openedUrl ?? "") : tab.href;
}

/**
 * What a group's picture is shown of: the group, whatever its tabs have moved
 * on to since. A page whose address changes behind the group would otherwise
 * leave it without one.
 */
export const GROUP_SHOWS = "group";

/**
 * What a group has up: the tab up on each side. A capture that began with
 * one thing up and came back with another is told by it.
 */
export function groupShows(layout: GroupLayout): string {
  return JSON.stringify(
    layout.sides.map((side) => {
      const up = side.tabs.find((tab) => tab.id === side.up);
      return up ? [up.id, tabShows(up)] : [];
    }),
  );
}

/** The address of a key's picture, where there is one of what it shows. */
export function pictureUrl(
  pictures: ReadonlyMap<string, HoverPicture>,
  key: string,
  shows: string,
): string | undefined {
  const picture = pictures.get(key);
  return picture?.shows === shows ? picture.url : undefined;
}
