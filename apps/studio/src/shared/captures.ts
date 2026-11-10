import { APP_PROTOCOL } from "@instrument-org/shared";
import { z } from "zod";

/**
 * Developer captures: a picture of the window taken the moment the shortcut is
 * pressed, kept in one folder every build shares (`~/.instrument/captures/`),
 * with what was on screen recorded inside the PNG so a capture says where it
 * came from wherever it is dragged.
 */

/** The app protocol's host the window loads a capture's picture from. */
export const CAPTURES_HOST = "captures";

/** A capture's file name: what the captures host serves, and nothing else. */
export const CAPTURE_NAME_PATTERN =
  /^Instrument [\d-]+ at [\d.]+(?: \d+)?\.png$/;

/** Which build took a capture, and which one is running: compared to flag a capture sent from another. */
const CaptureBuildSchema = z.object({
  /** The git branch an unpackaged build runs from. */
  branch: z.string().optional(),
  /** The commit an unpackaged build runs from, short. */
  commit: z.string().optional(),
  env: z.enum(["development", "preview", "production"]),
  /** A preview's name, or the worktree a development build runs from. */
  name: z.string().optional(),
  version: z.string(),
});

export type CaptureBuild = z.output<typeof CaptureBuildSchema>;

/** An element on screen when the capture was taken, in the picture's pixels. */
const CaptureElementSchema = z.object({
  h: z.number(),
  label: z.string(),
  w: z.number(),
  x: z.number(),
  y: z.number(),
});

export type CaptureElement = z.output<typeof CaptureElementSchema>;

/** What the window says about itself when a capture is taken. */
export const CaptureContextSchema = z.object({
  chatId: z.string().optional(),
  chatTitle: z.string().optional(),
  /** Every sizable element on screen, in on-screen CSS pixels. */
  elements: z.array(CaptureElementSchema).max(4000),
  /** The screen the active tab shows: "Chat", "Files", "Settings". */
  screen: z.string(),
  theme: z.enum(["dark", "light"]),
  viewport: z.object({ height: z.number(), width: z.number() }),
  workspace: z.string().optional(),
  zoom: z.number(),
});

export type CaptureContext = z.output<typeof CaptureContextSchema>;

/** What a capture's PNG carries about itself. */
export const CaptureMetaSchema = z.object({
  build: CaptureBuildSchema,
  chatId: z.string().optional(),
  chatTitle: z.string().optional(),
  /** Set once the capture was cropped or marked up. */
  edited: z.boolean().optional(),
  elements: z.array(CaptureElementSchema),
  os: z.object({ arch: z.string(), platform: z.string(), release: z.string() }),
  screen: z.string(),
  takenAt: z.number(),
  theme: z.enum(["dark", "light"]),
  window: z.object({ height: z.number(), width: z.number() }),
  workspace: z.string().optional(),
  zoom: z.number(),
});

export type CaptureMeta = z.output<typeof CaptureMetaSchema>;

/** A capture as the window lists it. */
const CaptureSchema = z.object({
  meta: CaptureMetaSchema.optional(),
  /** Its file name in the captures folder. */
  name: z.string(),
  /** Changes whenever the file does, so a picture shown is never a stale one. */
  stamp: z.number(),
});

export type Capture = z.output<typeof CaptureSchema>;

/** A capture's picture as the window loads it. */
export function captureUrl(capture: Pick<Capture, "name" | "stamp">) {
  return `${APP_PROTOCOL}://${CAPTURES_HOST}/${encodeURIComponent(capture.name)}?v=${capture.stamp}`;
}

/** The build a capture came from, short enough for a label on its picture. */
export function buildLabel(build: CaptureBuild) {
  if (build.env === "development") {
    return ["dev", build.name ?? build.branch].filter(Boolean).join(" ");
  }
  if (build.env === "preview") {
    return ["preview", build.name].filter(Boolean).join(" ");
  }
  return build.version;
}

/** The build a capture came from, in full, for a line under it. */
export function buildDescription(build: CaptureBuild) {
  const where = [...new Set([build.name, build.branch])]
    .filter(Boolean)
    .join(", ");
  return [
    build.version,
    build.env === "production" ? undefined : build.env,
    where || undefined,
    build.commit && `(${build.commit})`,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Whether two builds are the same one, as far as a report about either is concerned. */
export function isSameBuild(a: CaptureBuild, b: CaptureBuild) {
  return (
    a.env === b.env &&
    a.version === b.version &&
    a.name === b.name &&
    a.commit === b.commit
  );
}

/** The report file listing the captures a feedback report carries, beside the images. */
export const CAPTURES_REPORT_PATH = "captures/captures.json";
