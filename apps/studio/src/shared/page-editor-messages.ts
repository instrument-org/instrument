import { z } from "zod";

/**
 * What the page editor, running in a page tab's guest, says to the window,
 * and what the window says back. The guest sends on the channel its preload
 * owns; the window checks each message against this schema before acting on
 * it, since a guest is where a page's content runs.
 */
export const PageEditorGuestMessageSchema = z.discriminatedUnion("type", [
  /** The editor is up, holding the file at `version`. */
  z.object({ type: z.literal("hello"), version: z.string() }),
  /** Write `content` if the file is still at `baseVersion`; answered by a "reply" with the same id. */
  z.object({
    baseVersion: z.string(),
    content: z.string(),
    id: z.number(),
    type: z.literal("save"),
  }),
  /** Load the page again from `text`, handing `state` to the next boot. */
  z.object({ state: z.unknown(), text: z.string(), type: z.literal("reload") }),
  z.object({
    /** What the element's text alone does not say: a script makes or feeds it, and where. */
    context: z.string(),
    id: z.string(),
    instruction: z.string(),
    /** What the element is, as the editor names it: "Heading", "Button". */
    label: z.string(),
    lines: z.tuple([z.number(), z.number()]).nullable(),
    quote: z.string(),
    type: z.literal("ask"),
  }),
  /** Move the asks waiting in the page's dock into a chat. */
  z.object({ type: z.literal("move") }),
  z.object({ id: z.string(), type: z.literal("unstage") }),
  /** Done: back to the page as it is. */
  z.object({ type: z.literal("leave") }),
  /** Every write queued before the "flush" with this id is on its way. */
  z.object({ id: z.number(), type: z.literal("flushed") }),
  z.object({
    kind: z.string().nullable(),
    message: z.string(),
    type: z.literal("status"),
  }),
]);

export type PageEditorGuestMessage = z.output<
  typeof PageEditorGuestMessageSchema
>;

/**
 * What the window says to the editor: the file changed on disk to something
 * the editor did not write ("external"), commit what is being typed and
 * answer "flushed" once queued writes are sent ("flush"), a save's answer
 * ("reply"), scroll to an ask's element ("reveal"), the file's staged asks
 * ("staged"), and where the window draws the Edit control ("placement").
 */
export type PageEditorHostMessage =
  | { asks: PageEditorStagedAsk[]; moveLabel: string; type: "staged" }
  | { content: string; type: "external"; version: string }
  | { id: number; result: PageEditorSaveResult; type: "reply" }
  | { id: number; type: "flush" }
  | { id: string; type: "reveal" }
  | { placement: "pill" | "row"; type: "placement" };

/** A save's outcome: written, or refused because the file changed, with what is there now. */
export type PageEditorSaveResult =
  | { content: string; ok: false; version: string }
  | { ok: true; version: string };

/** One of the file's staged asks, as the page's pins number them. */
export interface PageEditorStagedAsk {
  id: string;
  /** Moved into a chat's composer, so it leaves the dock but keeps its pin until sent. */
  moved: boolean;
  n: number;
}
