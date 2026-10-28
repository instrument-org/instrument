import { APP_NAME } from "@instrument-org/shared";

import {
  DOCUMENT_EXTENSIONS,
  type FileType,
  MEDIA_EXTENSIONS,
} from "../client/lib/get-file-type";

/**
 * Every extension a viewer opens, by the viewer that opens it: what the
 * Finder's and Explorer's Open With offer Instrument for. Read by the
 * installers' build and, on Windows, by the app, which registers them itself.
 */
export const VIEWED_EXTENSIONS: Record<string, FileType> = {
  ...DOCUMENT_EXTENSIONS,
  ...MEDIA_EXTENSIONS,
  htm: "html",
  html: "html",
  markdown: "markdown",
  md: "markdown",
  mdown: "markdown",
  mdx: "markdown",
  mkd: "markdown",
};

/**
 * The extensions Windows offers Instrument for. Text and JSON are named here
 * because Windows has no content type that covers them the way macOS does.
 */
export const WINDOWS_EXTENSIONS = [
  ...Object.keys(VIEWED_EXTENSIONS),
  "json",
  "txt",
].toSorted();

// The class every Windows extension's Open With list names.
export const WINDOWS_PROG_ID = `${APP_NAME}.File`;
