import { z } from "zod";

/**
 * One thing the person did in the app, as the action log or the app's
 * history keeps it. Only what happens in Instrument is ever recorded: the
 * app's own screens, the files and folders opened or changed through it, the
 * chats read in it, the pages visited in its browser, and what it showed
 * them. A field is the place's own name or path as the person sees it, never
 * content.
 */
const At = z.iso.datetime();

const PathsSchema = z.array(z.string()).min(1);

/** A page the person (not an agent) visited in the app's browser. */
const PageSchema = z.object({
  at: At,
  kind: z.literal("page"),
  title: z.string().optional(),
  url: z.string(),
});

/** A file the person opened in one of the app's tabs. */
const FileSchema = z.object({
  at: At,
  kind: z.literal("file"),
  path: z.string(),
});

/** A file the person opened in another app from Instrument, and that app's name when it is known. */
const OpenWithSchema = z.object({
  app: z.string().optional(),
  at: At,
  kind: z.literal("open-with"),
  path: z.string(),
});

const LOGGED = [
  /** A folder shown in Files, with what was selected in it once the selection settled. */
  z.object({
    at: At,
    kind: z.literal("folder"),
    path: z.string(),
    selected: z.array(z.string()).optional(),
  }),
  /** A file the person saved an edit to in the app. */
  z.object({ at: At, kind: z.literal("edit"), path: z.string() }),
  /** Files moved or copied from one folder into another, by name. */
  z.object({
    at: At,
    from: z.string(),
    kind: z.enum(["move", "copy"]),
    names: PathsSchema,
    to: z.string(),
  }),
  z.object({
    at: At,
    from: z.string(),
    kind: z.literal("rename"),
    to: z.string(),
  }),
  z.object({ at: At, kind: z.literal("trash"), paths: PathsSchema }),
  z.object({ at: At, kind: z.literal("new-folder"), path: z.string() }),
  /** Another chat the person read, by its id and title. */
  z.object({
    at: At,
    id: z.string(),
    kind: z.literal("chat"),
    title: z.string(),
  }),
  /** A file the person downloaded in the app's browser, where it landed. */
  z.object({
    at: At,
    kind: z.literal("download"),
    path: z.string(),
    url: z.string().optional(),
  }),
  /** Something that happened with a connected app: "sign-in failed". */
  z.object({
    at: At,
    did: z.string(),
    kind: z.literal("app"),
    name: z.string(),
  }),
  /** An error or warning the app showed the person, in its own words. */
  z.object({
    at: At,
    kind: z.literal("error"),
    message: z.string(),
    where: z.string().optional(),
  }),
  /** One of the app's own screens: "Settings › Models", "Apps". */
  z.object({ at: At, kind: z.literal("screen"), name: z.string() }),
  /** A setting the person changed, by its label, and what it became. */
  z.object({
    at: At,
    kind: z.literal("setting"),
    name: z.string(),
    value: z.string(),
  }),
  /**
   * Where the log stopped writing a kind for the rest of a minute, or
   * everything for the rest of a day, and how much it left out.
   */
  z.object({
    at: At,
    dropped: z.number().int().min(1),
    kind: z.literal("capped"),
    of: z.string(),
  }),
] as const;

/**
 * One line of the action log. Pages and files opened are not among them:
 * the app's history keeps those (`readPersonHistory` on the workspace's
 * config), and the readers put the two together.
 */
export const LoggedActionSchema = z.discriminatedUnion("kind", [...LOGGED]);

export type LoggedAction = z.output<typeof LoggedActionSchema>;

/** What the person did, as every reader of it answers: the action log's lines and the history's pages and files. */
export const ActionSchema = z.discriminatedUnion("kind", [
  ...LOGGED,
  PageSchema,
  FileSchema,
  OpenWithSchema,
]);

export type Action = z.output<typeof ActionSchema>;

/** A page visited or a file opened, as the app's history answers them. */
export type HistoryAction = Exclude<Action, LoggedAction>;

/** An action as a capture point reports it to the log, which stamps the time. */
export type ActionInput = LoggedAction extends infer A
  ? A extends { at: string }
    ? Omit<A, "at">
    : never
  : never;
