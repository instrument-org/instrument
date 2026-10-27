import { z } from "zod";

/**
 * The `_meta` key a Mac app's tool result carries when macOS kept Instrument
 * out of the app, beside `isError` and the words for it: the one signal the
 * app-call path raises the macOS card on, read only from the servers
 * Instrument bundles.
 */
export const MACOS_REFUSAL_META = "tryinstrument.com/macos-refusal";

const MacosRefusalSchema = z.object({
  /** The app macOS refused, by its bundle id. */
  bundleId: z.string().min(1),
  /**
   * `denied`: macOS said no (the privacy setting is off, or Automation was
   * refused). `timed-out`: an Apple Event waited until it timed out, which is
   * what one does while macOS's own prompt for the app is up.
   */
  reason: z.enum(["denied", "timed-out"]),
});

export type MacosRefusal = z.output<typeof MacosRefusalSchema>;

/** The refusal a tool result's `_meta` names, if it names one. */
export function macosRefusalIn(meta: unknown): MacosRefusal | undefined {
  const parsed = z
    .object({ [MACOS_REFUSAL_META]: MacosRefusalSchema })
    .safeParse(meta);
  return parsed.success ? parsed.data[MACOS_REFUSAL_META] : undefined;
}
