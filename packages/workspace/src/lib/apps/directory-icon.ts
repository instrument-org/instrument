import fs from "node:fs/promises";
import { z } from "zod";

import { AppSlugSchema } from "./manifest";

/**
 * The directory's own icons, shipped with the app so a service is drawn with
 * its mark before anyone sets it up and without asking its site. One file per
 * directory slug, `<slug>.svg` or `<slug>.png`, beside the `manifest.json`
 * that says where each came from. `scripts/refresh-directory-icons.ts`
 * fetches them from the manifest; nothing at runtime reads the manifest.
 *
 * Drawn after the app's own icon and its Mac app's, and before its site's
 * favicon, which stays the answer for an entry with no file here.
 */
export const DIRECTORY_ICONS_DIR_NAME = "directory-icons";

export const DIRECTORY_ICON_MANIFEST_FILE_NAME = "manifest.json";

const PinnedSourceSchema = z.object({
  /** The light-theme file in the collection, relative to its root. */
  path: z.string(),
  /** The same mark drawn for a dark background, when the collection has one. */
  dark: z.string().optional(),
  /** A commit for a GitHub collection, a version for an npm one. */
  version: z.string(),
});

const DirectoryIconEntrySchema = z
  .discriminatedUnion("source", [
    PinnedSourceSchema.extend({ source: z.literal("svgl") }),
    PinnedSourceSchema.extend({ source: z.literal("logos") }),
    PinnedSourceSchema.extend({ source: z.literal("thesvg") }),
    PinnedSourceSchema.extend({ source: z.literal("lobe-icons") }),
    PinnedSourceSchema.extend({ source: z.literal("dashboard-icons") }),
    /** `path` is the icon's name in the `@iconify-json/logos` set. */
    PinnedSourceSchema.extend({ source: z.literal("iconify-logos") }),
    /** The App Store app whose artwork is the icon, by track id. */
    z.object({ id: z.number().int(), source: z.literal("app-store") }),
    /** A file the service's own site serves: its apple-touch-icon or SVG favicon. */
    z.object({ source: z.literal("site"), url: z.url() }),
  ])
  .and(
    z.object({
      /**
       * The collection's license for the file, or `trademark` for art taken
       * from the service itself. A license covers the file, never the mark.
       */
      license: z.string(),
      /** Why this entry was chosen by hand over what the source order gives. */
      override: z.string().optional(),
    }),
  );

export const DirectoryIconManifestSchema = z.record(
  AppSlugSchema,
  DirectoryIconEntrySchema,
);

export type DirectoryIconEntry = z.output<typeof DirectoryIconEntrySchema>;

/** The file an icon is written to, by what it is. */
export function directoryIconFileName(slug: string, kind: "png" | "svg") {
  return `${slug}.${kind}`;
}

/** A shipped icon's file name: a slug, then what kind of image it is. */
export const DIRECTORY_ICON_FILE_PATTERN =
  /^([a-z0-9][a-z0-9-]*)\.(?:png|svg)$/;

/**
 * Every icon the directory ships, as the file each slug's is in. One read of
 * the folder: the files are fixed for the life of a build, so a caller keeps
 * the answer rather than asking per slug. Anything else in the folder (the
 * manifest) is not an icon and is left out.
 */
export async function readDirectoryIcons(
  iconsDir: string,
): Promise<Map<string, string>> {
  const icons = new Map<string, string>();
  for (const file of await fs.readdir(iconsDir)) {
    const slug = DIRECTORY_ICON_FILE_PATTERN.exec(file)?.[1];
    // A slug with both keeps the SVG, which is sharp at every size.
    if (slug && !icons.get(slug)?.endsWith(".svg")) {
      icons.set(slug, file);
    }
  }
  return icons;
}
