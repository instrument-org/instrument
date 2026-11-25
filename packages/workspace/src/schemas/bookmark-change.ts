import { z } from "zod";

/** A bookmark or a folder as it stood on one side of a change. */
export const BookmarkSideSchema = z.object({
  /** The folder a bookmark was filed in, by id. */
  folder: z.string().optional(),
  kind: z.enum(["bookmark", "folder"]),
  /** Where it sorted among the others in its place. */
  order: z.number(),
  /** Where it was, as the app names it: `All Bookmarks`, `Bookmarks bar/Work`. */
  place: z.string(),
  /** The root it was in: the bar, or All Bookmarks. */
  root: z.enum(["all", "bar"]),
  title: z.string(),
  /** A bookmark's address. */
  url: z.string().optional(),
});

export type BookmarkSide = z.output<typeof BookmarkSideSchema>;

/** A bookmark or folder a turn added, changed or removed, as it stood on either side: null where it was not kept. */
export const BookmarkChangeSchema = z.object({
  after: BookmarkSideSchema.nullable(),
  before: BookmarkSideSchema.nullable(),
  id: z.string(),
});

export type BookmarkChange = z.output<typeof BookmarkChangeSchema>;
