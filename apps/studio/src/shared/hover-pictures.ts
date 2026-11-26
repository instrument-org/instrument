import { APP_PROTOCOL } from "@instrument-org/shared";

/** Where a tab's or a group's hover picture is served (`hover-pictures.ts` in the main process). */
export const HOVER_PICTURE_HOST = "hover-picture";

/**
 * A kept picture's file name: whose it is, what it shows and when it was
 * taken, so a name is never served with other bytes. What the host serves,
 * and nothing else.
 */
export const HOVER_PICTURE_NAME_PATTERN =
  /^([0-9a-f]+)\.([0-9a-f]+)\.(\d+)\.jpg$/;

export function hoverPictureUrl(file: string): string {
  return `${APP_PROTOCOL}://${HOVER_PICTURE_HOST}/${file}`;
}
