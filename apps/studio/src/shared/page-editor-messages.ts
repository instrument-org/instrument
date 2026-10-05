import { z } from "zod";

import {
  type EditorRequest,
  type EditorResponse,
} from "./page-editor-requests";

/**
 * What the page editor, running in a page tab's guest, says to the window,
 * and what the window says back. The guest sends on the channel its preload
 * owns; the window checks each message against this schema before acting on
 * it, since a guest is where a page's content runs. Questions either side
 * asks of the other, and their answers, go as `request` and `response` (see
 * `page-editor-requests.ts`).
 */
export const PageEditorGuestMessageSchema = z.discriminatedUnion("type", [
  /** The editor is up, holding the file at `version`. */
  z.object({ type: z.literal("hello"), version: z.string() }),
  /** Write `content` if the file is still at `baseVersion`; answered with a {@link PageEditorSaveResult}. */
  z.object({
    id: z.number(),
    request: z.object({
      baseVersion: z.string(),
      content: z.string(),
      kind: z.literal("save"),
    }),
    type: z.literal("request"),
  }),
  /** The editor's answer to the window's flush: every write queued before it is on its way. */
  z.object({
    error: z.string().optional(),
    id: z.number(),
    result: z.null().optional(),
    type: z.literal("response"),
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
  z.object({
    kind: z.string().nullable(),
    message: z.string(),
    type: z.literal("status"),
  }),
]);

export type PageEditorGuestMessage = z.output<
  typeof PageEditorGuestMessageSchema
>;

/** What the editor asks the window: write the file. */
export interface PageEditorSaveRequest {
  baseVersion: string;
  content: string;
  kind: "save";
}

/** What the window asks the editor: commit what is being typed, and answer once every write queued before it is on its way. */
export interface PageEditorFlushRequest {
  kind: "flush";
}

/**
 * What the window says to the editor: the file changed on disk to something
 * the editor did not write ("external"), the window's own question
 * ("request", a flush), the answer to the editor's save ("response"), scroll
 * to an ask's element ("reveal"), the file's staged asks ("staged"), and
 * where the window draws the Edit control ("placement").
 */
export type PageEditorHostMessage =
  | { asks: PageEditorStagedAsk[]; moveLabel: string; type: "staged" }
  | { content: string; type: "external"; version: string }
  | { id: string; type: "reveal" }
  | { placement: "pill" | "row"; type: "placement" }
  | EditorRequest<PageEditorFlushRequest>
  | EditorResponse<PageEditorSaveResult>;

/** A save's outcome: written, or refused because the file changed, with what is there now. */
export type PageEditorSaveResult =
  | { content: string; ok: false; version: string }
  | { ok: true; version: string };

/** One of the file's staged asks, as the page's pins number them and the dock's list names them. */
export interface PageEditorStagedAsk {
  id: string;
  /** What the person typed for it, which may be nothing. */
  instruction: string;
  /** Moved into a chat's composer, so it leaves the dock but keeps its pin until sent. */
  moved: boolean;
  n: number;
  /** Where on the page, as the window says it: "Heading · line 12". */
  target: string;
}
