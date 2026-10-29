import { AIProviderTypeSchema } from "@instrument-org/shared";
import { z } from "zod";

import { DeviceIdSchema } from "../device-id";
import { EnvironmentChangeSchema } from "../environment";
import {
  AbsolutePathSchema,
  InWorkspacePathSchema,
  RelativePathSchema,
} from "../paths";
import { StopperSchema } from "../stop-notice";
import { StoreId } from "../store-id";
import { ToldAppsSchema, ToldDigestsSchema } from "../told";

export namespace SessionMessageDataPart {
  export const NameSchema = z.enum([
    "appEvent",
    "asks",
    "folderChanges",
    "permissionAnswer",
    "questionAnswer",
    "attachments",
    "backgroundProcesses",
    "browserStatus",
    "contextRollover",
    "dateChange",
    "environmentChange",
    "fileChanges",
    "fromChat",
    "intent",
    "jobEvent",
    "setupChanges",
    "setupNews",
    "signedIn",
    "skillMentions",
    "maxSteps",
    "memory",
    "messageGap",
    "modelChange",
    "outputLimit",
    "reply",
    "taskEvent",
    "toolResultsCleared",
    "chatContext",
    "topic",
    "unknown",
    "viewContext",
    "workspaceInstructions",
  ]);

  export type Name = z.output<typeof NameSchema>;

  /**
   * How often a part says something new, which is what decides whether
   * sending it again can repeat a fact the session already has.
   *
   * - `event`: something that happened on this turn. A repeat is impossible
   *   by construction.
   * - `diff`: what changed since the session was last told. Self-limiting:
   *   no change, no part. What it was last told is read from its history
   *   (`last-told.ts`): the baseline's metadata and the notes since, each
   *   carrying what it brought the model up to.
   * - `state`: the whole current picture, stored on every message whose
   *   writer could read it, an empty picture included once the session's
   *   history has had something in it (`goesUnsaid`): before that, an empty
   *   one and a missing one both say nothing. `stateNotes` is the one place
   *   that decides what of it the model hears: nothing when it reads as the
   *   last note said, and nothing for an empty picture before anything was
   *   said. Every message carrying the whole is what lets a fork or a
   *   rollover read the picture from the messages it kept.
   * - `unwritten`: nothing writes it. `fileChanges` and `chatContext` are
   *   retired, and `unknown` is what an unreadable payload becomes.
   */
  export type Cadence = "diff" | "event" | "state" | "unwritten";

  /**
   * Every part's cadence, which assembly reads rather than each note's author
   * remembering: a part declared `state` here cannot restate itself, and one
   * added without a line here does not compile.
   */
  export const CADENCE = {
    appEvent: "event",
    asks: "event",
    attachments: "event",
    backgroundProcesses: "diff",
    browserStatus: "state",
    chatContext: "unwritten",
    contextRollover: "event",
    dateChange: "event",
    environmentChange: "diff",
    fileChanges: "unwritten",
    folderChanges: "diff",
    fromChat: "event",
    intent: "event",
    jobEvent: "event",
    maxSteps: "event",
    memory: "diff",
    messageGap: "event",
    modelChange: "diff",
    outputLimit: "event",
    permissionAnswer: "event",
    questionAnswer: "event",
    reply: "event",
    setupChanges: "event",
    setupNews: "diff",
    signedIn: "event",
    skillMentions: "event",
    taskEvent: "event",
    toolResultsCleared: "event",
    topic: "state",
    unknown: "unwritten",
    viewContext: "state",
    workspaceInstructions: "state",
  } satisfies Record<Name, Cadence>;

  // Folders granted in the chat or taken back on this computer since the
  // session last heard -- attached to the user message that starts the next
  // turn so the model knows of a folder granted mid-conversation and stops
  // relying on one that has gone. The standing folder
  // list lives in the session context, which is written once and rebuilt at
  // most hourly, so this is what gets a change to the model the same turn.
  const ChangedFolderSchema = z.object({
    /**
     * The folder as the agent's shell spelled it when the note was written,
     * which is what the model is told. Absent on a note written before it
     * was kept.
     */
    agentPath: z.string().optional(),
    /**
     * The computer whose grant this is, on a folder added; see `ToldFolders`.
     * Absent on a note written before it was kept.
     */
    device: DeviceIdSchema.optional(),
    path: z.string(),
  });
  const FolderChangesDataPartSchema = z.object({
    added: z.array(ChangedFolderSchema),
    removed: z.array(ChangedFolderSchema),
  });

  export type FolderChangesDataPart = z.output<
    typeof FolderChangesDataPartSchema
  >;

  const FileAttachmentDataPartSchema = z.object({
    /**
     * Where the file was when the message was written, as the agent's shell
     * spelled it then, which is what the model is told: the same words on
     * every later request, wherever the chat is read. A file that has moved
     * since is found from the environment notes that follow. Absent on a
     * message written before it was kept.
     */
    agentPath: z.string().optional(),
    filename: z.string(),
    // A file the person attached is the file itself, so the agent reads and
    // edits what they pointed at: one in the workspace by its place there
    // (`workspace:/Notes/plan.md`), which holds on every computer the record
    // syncs to, and one outside it at its own absolute path. An absolute path
    // into the workspace is what earlier builds wrote, and is read as it is.
    // A relative path is a copy in the chat's `attachments/`, which is where
    // pasted bytes land.
    filePath: z.union([
      AbsolutePathSchema,
      InWorkspacePathSchema,
      RelativePathSchema,
    ]),
    mimeType: z.string(),
    // Attachments written before this field existed have none, and it is a
    // cache-buster for the asset URL: 0 costs those files nothing, since they
    // are not the ones being rewritten. Without a default the whole part fails
    // to read and the turn's uploads vanish from the transcript.
    modifiedAt: z.number().default(0),
    size: z.number(),
  });

  export type FileAttachmentDataPart = z.output<
    typeof FileAttachmentDataPartSchema
  >;

  // A folder the user sent with the message, shown with it. Each is granted
  // to the chat as it is sent, and the agent is told of it by the folder
  // changes note, so the model reads nothing from this.
  const SentFolderDataPartSchema = z.object({ path: z.string() });

  export type SentFolderDataPart = z.output<typeof SentFolderDataPartSchema>;

  export const FileAttachmentsDataPartSchema = z.object({
    files: z.array(FileAttachmentDataPartSchema),
    folders: z.array(SentFolderDataPartSchema).optional(),
  });

  export type FileAttachmentsDataPart = z.output<
    typeof FileAttachmentsDataPartSchema
  >;

  /**
   * What this session still has running at the start of a turn.
   *
   * The registry is in memory and the transcript is not, so without this the
   * only record of `bg_1` is a tool result from an earlier turn that said it was
   * running then. A turn twenty minutes later cannot tell whether that is still
   * true, and after a restart it is definitely false -- which is why `ended`
   * exists rather than the part simply going absent.
   */
  const BackgroundProcessesDataPartSchema = z.object({
    /** Ids the session was told about that are no longer there. */
    ended: z.array(z.object({ command: z.string(), id: z.string() })),
    running: z.array(
      z.object({
        command: z.string(),
        id: z.string(),
        runningForMs: z.number(),
      }),
    ),
  });

  export type BackgroundProcessesDataPart = z.output<
    typeof BackgroundProcessesDataPartSchema
  >;

  /**
   * The tabs of the user's chat a session holds, each by the id
   * `agent-browser tab` takes, with where each stands and what it costs.
   * The figures are coarse (memory to 10 MB, CPU to a whole percent and left
   * out under one, the time left to five minutes) so the picture reads the
   * same from turn to turn while nothing much changes.
   */
  const BrowserStatusDataPartSchema = z.object({
    /** Tabs the app closed since the session was last told, and why. */
    closed: z
      .array(
        z.object({
          id: z.string(),
          reason: z.literal("tabCap"),
          title: z.string().optional(),
          url: z.string(),
        }),
      )
      .optional(),
    status: z.literal("tabs"),
    tabs: z.array(
      z.object({
        /** Its page stopped drawing until the next command or the user looking. */
        asleep: z.boolean().optional(),
        cpuPercent: z.number().optional(),
        id: z.string(),
        memoryMb: z.number().optional(),
        /** Whether the user's window draws it now. */
        onScreen: z.boolean().optional(),
        openedBy: z.enum(["handed", "task"]),
        /** The other tabs its process draws too, whose cost this is as well. */
        sharedWith: z.array(z.string()).optional(),
        title: z.string().optional(),
        /** Minutes until its page is unloaded unless it is used. */
        unloadsInMin: z.number().optional(),
        url: z.string(),
      }),
    ),
  });

  export type BrowserStatusDataPart = z.output<
    typeof BrowserStatusDataPartSchema
  >;

  /**
   * The point where assembly stopped sending the turns before it.
   *
   * Written on the message the boundary sits after, at the moment the boundary
   * is recorded, so it marks the same message assembly cuts at. It is the only
   * durable sign a rollover happened: the warning that precedes one is derived
   * per request and never persisted, and the boundary itself is a single id on
   * the session that nothing else records.
   *
   * `retainedUserMessages` is what carried across verbatim; `droppedMessages`
   * is everything before the boundary that did not, all of which is still on
   * disk. Both are counts of what the request carries, so they belong to
   * developer mode and to a recorded session rather than to the transcript: a
   * rollover is not a compaction, nothing is summarized, and there is no
   * faithful way to describe it to a reader mid-task that is not a description
   * of our request assembly. That treatment waits for the summarizing
   * compaction it would actually be about.
   *
   * `summary` is the model's own account of the conversation before the
   * boundary, on a rollover taken to keep a request under its model's price
   * step (`summarizeBeforePriceStep`): sent with the handoff notes on every
   * request after it, and `summaryUsage` what writing it took, its charge in
   * `raw` as the provider reported it. Both absent on a rollover taken
   * because the window was full.
   */
  const ContextRolloverDataPartSchema = z.object({
    droppedMessages: z.number().int().nonnegative(),
    retainedUserMessages: z.number().int().nonnegative(),
    summary: z.string().optional(),
    summaryUsage: z
      .object({
        cacheReadTokens: z.number().optional(),
        cacheWriteTokens: z.number().optional(),
        inputTokens: z.number().optional(),
        outputTokens: z.number().optional(),
        raw: z.unknown().optional(),
      })
      .optional(),
  });

  export type ContextRolloverDataPart = z.output<
    typeof ContextRolloverDataPartSchema
  >;

  /**
   * The point up to which assembly sends a placeholder for each tool result
   * rather than the result, and the long strings of each call's input
   * (`lib/tool-result-clearing.ts`): every call in a message up to and
   * including `through`. Written on the newest message when the clearing is
   * decided, and read back by every later request, so the history sent is the
   * same until the next one. `results` is how many calls were cleared, for
   * the developer card.
   */
  const ToolResultsClearedDataPartSchema = z.object({
    results: z.number().int().nonnegative(),
    through: StoreId.MessageSchema,
  });

  /**
   * The turn where this session started asking a different model, and the two
   * windows either side of the change.
   *
   * A session's model is a per-request choice, so nothing in the transcript
   * otherwise says when it moved. Every consequence of a move is then a fact
   * with no visible cause: an answer in a different register, a different
   * refusal, and a context budget measured against a window that changed under
   * it. Recording the move is what makes those legible, and it is the one piece
   * of context-window behavior that can be described to a reader without
   * reaching for a word we have not earned -- the model changed, and here is
   * what it changed from.
   *
   * The windows travel with it because they are what the change actually
   * costs. They are also the fact a later trigger needs: a move to a smaller
   * window is the case worth acting on, and it cannot be recognized from the
   * ids alone. Absent where the provider never reported one.
   *
   * The display name travels with it for the same reason the window does: it is
   * known now and only now. Resolving an id to a name at read time would show
   * whatever currently answers to that id, or nothing once a provider is
   * disconnected, which is exactly when a reader most wants to know what
   * answered. Optional, because a message recorded before this existed has no
   * name to recover; the id is the fallback and is always present.
   *
   * Diff cadence, so a session that never switches carries none of these, and a
   * session that switches once carries one rather than one per later turn.
   */
  const ModelChangeSideSchema = z.object({
    contextLength: z.number().int().positive().optional(),
    modelId: z.string(),
    name: z.string().optional(),
    // Who served it, so a move between two providers of one model reads as
    // a move at all, and the provider's mark it is drawn with.
    provider: AIProviderTypeSchema.optional(),
    providerName: z.string().optional(),
  });
  const ModelChangeDataPartSchema = z.object({
    from: ModelChangeSideSchema,
    to: ModelChangeSideSchema,
  });

  export type ModelChangeDataPart = z.output<typeof ModelChangeDataPartSchema>;

  // Attached to the synthetic assistant message written when a run stops after
  // reaching the max unattended step count. Hidden from the chat UI (the
  // "Resume the agent" alert is the visible affordance); surfaced to the model
  // as a system note on the next user turn so it knows the prior run was cut
  // off at the cap rather than finished.
  /**
   * A note for the agent beside the user's own words, which the transcript
   * shows only to developers: what the session machine adds to a message sent
   * while a turn was running (`withNote`).
   */
  export const IntentDataPartSchema = z.object({
    text: z.string().trim().min(1).max(2000),
  });

  export type IntentDataPart = z.output<typeof IntentDataPartSchema>;

  /**
   * Places in files the user marked and what they want changed at each,
   * gathered on the file before sending and carried beside their words, so
   * the request reads as a list of targets rather than quotes pasted into
   * the message. Each names the file by its path (and the path the
   * agent reaches it by, when a granted folder covers it), where in the file
   * in a reader's words, the words or source at that place, and what the
   * user typed for it, which may be nothing.
   */
  export const AsksDataPartSchema = z.object({
    asks: z
      .array(
        z.object({
          /** What the surface knows about the place that its text alone does not say: that a script makes it, say. */
          context: z.string().optional(),
          excerpt: z.string().optional(),
          file: z.object({
            mount: z.string().optional(),
            name: z.string(),
            path: z.string(),
          }),
          instruction: z.string(),
          /** Where in the file: "lines 12-14", "page 3", "Sales!A2:C3", "whole file". */
          target: z.string(),
        }),
      )
      .min(1),
  });

  export type AsksDataPart = z.output<typeof AsksDataPartSchema>;

  /**
   * The earlier message the user is replying to: which bubble, by its message
   * and part, so the transcript can draw the quote and find the original, and
   * the start of its words, which is all the model is shown. The model already
   * has the whole message in its history and knows it by no id, so the words
   * are how it tells which one is meant.
   */
  export const ReplyDataPartSchema = z.object({
    messageId: StoreId.MessageSchema,
    partId: StoreId.PartSchema,
    text: z.string().trim().min(1).max(1000),
  });

  export type ReplyDataPart = z.output<typeof ReplyDataPartSchema>;

  /**
   * What a turn did to the person's setup: the skills, apps and memories it
   * added, changed or removed, read off the turn's own writes
   * (`setup-changes.ts`), so each is the turn's doing and none is another
   * chat's or the person's. Attached to the turn's last assistant message,
   * where the chat tells the person, and where the skill catalog's
   * correction for the model comes from.
   */
  export const SetupChangesDataPartSchema = z.object({
    changes: z
      .array(
        z.object({
          change: z.enum(["added", "changed", "removed"]),
          kind: z.enum(["app", "memory", "skill", "topic"]),
          name: z.string(),
        }),
      )
      .min(1),
    /**
     * What the agent now knows of each app, memory and skill it changed, so
     * the next message's notes do not tell it what it did itself: an app by
     * its id, a memory by its name, a skill as `skill:<name>`, `null` for one
     * it took away. Absent where the turn changed none of them.
     */
    told: z
      .object({
        apps: z.record(z.string(), ToldAppsSchema.valueType.nullable()),
        memory: z.record(z.string(), z.string().nullable()),
        skills: z.record(z.string(), z.string().nullable()),
      })
      .partial()
      .optional(),
  });

  export type SetupChangesDataPart = z.output<
    typeof SetupChangesDataPartSchema
  >;

  /**
   * The workspace's skills that changed since this session last heard, by
   * anyone: another chat, the person, a program. Carried on the user's
   * message so the agent works from what is there now: its skill catalog was
   * written when the session began. Apps have their own (`data-appEvent`). A change the session's own
   * turn made is not repeated here; `setupChanges` told it already.
   */
  export const SetupNewsDataPartSchema = z.object({
    changes: z
      .array(
        z.object({
          // A removal is not news: calling for what is gone comes back not
          // found, beside what there is.
          change: z.enum(["added", "changed"]),
          kind: z.enum(["skill"]),
          name: z.string(),
        }),
      )
      .min(1),
    /** Every workspace skill the session now knows, by `skill:<name>` with its fingerprint. */
    told: ToldDigestsSchema,
  });

  export type SetupNewsDataPart = z.output<typeof SetupNewsDataPartSchema>;

  /**
   * Skills the user named in their message. Recorded so the model is told what
   * the mention syntax means and can decide which, if any, to load; loading
   * them automatically would make a message that names several skills drag all
   * of them into context whether or not they bear on the request.
   */
  export const SkillMentionsDataPartSchema = z.object({
    names: z.array(z.string()).min(1),
  });

  export type SkillMentionsDataPart = z.output<
    typeof SkillMentionsDataPartSchema
  >;

  const MaxStepsDataPartSchema = z.object({
    maxStepCount: z.number(),
  });

  export type MaxStepsDataPart = z.output<typeof MaxStepsDataPartSchema>;

  /**
   * A turn that ran out of room to write, as many times in a row as it was
   * given. `continuations` is how many replies the turn spent before it
   * stopped, so the note the next turn carries can say the model was cut off
   * again rather than once.
   */
  const OutputLimitDataPartSchema = z.object({
    continuations: z.number(),
  });

  export type OutputLimitDataPart = z.output<typeof OutputLimitDataPartSchema>;

  /**
   * Tasks a chat created that finished a turn since it last heard.
   *
   * The one way work comes back to the chat: a child never speaks in
   * this conversation, so its completion has to arrive as something the
   * chat reads on a turn of its own. Written on a user message with no
   * text, which starts that turn, so the model reads it as a note from the
   * harness rather than as something the user said.
   *
   * Event cadence: one part per wake. Several children finishing inside the
   * same moment are one part naming all of them, never one part for the newest,
   * because a wake that names only the last finisher loses the rest.
   */
  export const TaskEventDataPartSchema = z.object({
    events: z
      .array(
        z.object({
          /** How long the child's agent has been at work in total. */
          activeMs: z.number().nonnegative().optional(),
          /**
           * How many of the input tokens were cache reads, which cost a
           * fraction of the rest. Without it a long task's total reads as
           * money spent at full price.
           */
          cachedTokens: z.number().nonnegative().optional(),
          /**
           * How the turn ended when it ended without words, in the line the
           * task list shows for it: what it was stopped in the middle of, the
           * step limit it hit, or what the model error was. Absent when the
           * task said something, and on an overdue event.
           */
          ended: z.string().optional(),
          /**
           * The files the task named in the files fence of its last message,
           * in the paths the chat can open. What the task said it
           * made, not a reading of what its tools did: the card draws them as
           * chips, and the note carries the message itself.
           */
          files: z.array(z.string()).optional(),
          /**
           * The task's handle in its chat, `t1`, which the `task` command
           * takes. Absent on an event written before tasks had one, which
           * names the task by its session alone.
           */
          handle: z.string().optional(),
          /**
           * The step running as an overdue note is composed, in one line:
           * how long the turn has run, when it last called a tool, and what
           * it is doing this moment (writing with no tool call, or which tool
           * is running and for how long). What tells a step that is working
           * apart from one that will never end on its own.
           */
          inFlight: z.string().optional(),
          /**
           * What the child said it cannot go on without, one line each, read
           * from the needs fence of its last message. Present only when the
           * turn ended on one: the task is waiting on the chat or the user,
           * not finished.
           */
          needs: z.array(z.string()).optional(),
          /**
           * Whether sending the task on picks its turn up again: true when
           * the step limit, the output limit, a model error, or a timeout
           * ended it, which nobody decided. Absent for a stop.
           */
          resumable: z.boolean().optional(),
          /**
           * What the child left running in the background as its turn ended:
           * a server it started on purpose, or a scan it never stopped. Absent
           * when nothing was, and on an overdue event, whose turn is still
           * going.
           */
          running: z
            .array(
              z.object({
                command: z.string(),
                id: z.string(),
                runningForMs: z.number().nonnegative(),
              }),
            )
            .optional(),
          /**
           * Done and error end a turn, error being a model error rather than
           * a stop; overdue is a task still at work past the point the
           * chat should look, and says so once.
           */
          status: z.enum(["done", "error", "overdue"]),
          /**
           * Set when the turn did not finish because something stopped it.
           * `person`: the person stopped the task, from its page or the
           * chat's task list, and it is not the chat's to start again unless
           * they ask. `app`: the app quit while the task worked, which ended
           * its turn and everything it had running in the background; that
           * note is written as the app quits and starts no turn. A stop the
           * chat's agent made itself wakes nothing.
           */
          stoppedBy: StopperSchema.exclude(["agent"]).optional(),
          /**
           * The activities the child's agent set this turn, oldest first and
           * capped to the latest few. On an overdue event, so the conversation
           * reads where the task has been going rather than one snapshot.
           */
          steps: z.array(z.string()).optional(),
          /** What the child last said, shortened. Absent when it said nothing. */
          summary: z.string().optional(),
          /**
           * The window's tabs the child held that are still open as its turn
           * ended, by the id `tab` takes and the address each shows: where
           * a result that lives on a page is, so the chat can put that
           * page in front of the user rather than point at the task. Absent
           * when none are, and on an overdue event.
           */
          tabs: z
            .array(
              z.object({
                id: z.string(),
                openedBy: z.enum(["handed", "task"]),
                url: z.string().optional(),
              }),
            )
            .optional(),
          /** The task, by its session in the chat's store. */
          sessionId: StoreId.SessionSchema,
          title: z.string(),
          /** Input and output tokens the child has spent in total. */
          tokens: z.number().nonnegative().optional(),
        }),
      )
      .min(1),
  });

  export type TaskEventDataPart = z.output<typeof TaskEventDataPartSchema>;

  /**
   * Background processes a session started that ended on their own while it
   * was not working: what woke it, so the agent can say what came of a
   * command it left running when its turn ended. Written on a user message
   * with no text, like a task event, and only for an ending nobody asked for
   * (an exit, a failure, the age cap), never for a stop.
   *
   * Event cadence: one part per wake, naming every process that ended in the
   * same moment.
   */
  export const JobEventDataPartSchema = z.object({
    events: z
      .array(
        z.object({
          command: z.string(),
          durationMs: z.number().nonnegative(),
          /** Absent for a process that ended without reporting one. */
          exitCode: z.number().optional(),
          /** The process id `fg`, `jobs` and `kill` take, `bg_1`. */
          id: z.string(),
          /** Chat-folder-relative, holding everything it wrote. */
          logFilePath: z.string(),
          status: z.enum([
            "exited",
            "expired",
            "failed",
            "killed",
            "termination-uncertain",
          ]),
        }),
      )
      .min(1),
  });

  export type JobEventDataPart = z.output<typeof JobEventDataPartSchema>;

  /**
   * Words the chat's agent wrote to one of its tasks, rather than the user's:
   * the assignment a fork starts on (`assignment`), and what `instrument task send`
   * passes on later (`message`). Written on a user message with no text, so
   * the record says who spoke, and the transcript can draw it as one agent
   * writing to another. The model reads it as the text it carries, with the
   * fork's standing note ahead of an assignment.
   */
  export const FromChatDataPartSchema = z.object({
    kind: z.enum(["assignment", "message"]),
    text: z.string().trim().min(1),
  });

  export type FromChatDataPart = z.output<typeof FromChatDataPartSchema>;

  /**
   * Where each app on a sign-in card the agent put up stands, as the card
   * draws it: connected (as an account, when one is named), declined by the
   * user, a sign-in that ended without connecting, or still waiting. Written
   * when the note is, so the note reads the same on every later turn.
   */
  export const SignInProgressSchema = z
    .array(
      z.object({
        account: z.string().optional(),
        name: z.string(),
        slug: z.string(),
        standing: z.enum(["connected", "declined", "failed", "waiting"]),
      }),
    )
    .min(1);

  export type SignInProgress = z.output<typeof SignInProgressSchema>;

  /**
   * Apps the `connect_app` call behind a card named that never reached the
   * card (no folder, an unwritten guide), each with why, as the call told it.
   */
  export const NotOnCardSchema = z
    .array(z.object({ reason: z.string(), slug: z.string() }))
    .min(1);

  export type NotOnCard = z.output<typeof NotOnCardSchema>;

  /**
   * An app the user acted on outside the conversation: a sign-in finished in
   * the browser, a key saved on a card, a decline, a disconnect from the
   * app's page. Like a task event, it wakes the chat on a text-less
   * user message, so the agent learns without anyone typing, and it draws as
   * a product-event line in the transcript.
   */
  export const AppEventDataPartSchema = z
    .object({
      /**
       * Carried on a message the user wrote, for changes made outside the
       * conversation since the agent's last turn, rather than waking the chat.
       */
      carried: z.boolean().optional(),
      /**
       * What the session was last told of the apps' connections was read on
       * another computer, so this tells each app's connection on this one, from
       * `apps`, as where things stand here rather than as changes.
       */
      otherComputer: z.literal(true).optional(),
      events: z.array(
        z.object({
          /** The account the app is signed in as, when it is named. */
          account: z.string().optional(),
          /** A line of detail: how many tools, what went wrong. */
          detail: z.string().optional(),
          event: z.enum([
            "added",
            "changed",
            "connected",
            "declined",
            "disconnected",
            "failed",
            "removed",
          ]),
          name: z.string(),
          /**
           * For a sign-in of the app's own that did not connect: how it
           * ended, and the service's site, where signing in on the web is
           * the next step.
           */
          signIn: z
            .object({
              ended: z.enum(["canceled", "expired", "failed", "refused"]),
              web: z.string().optional(),
            })
            .optional(),
          slug: z.string(),
          /** For a web app, the site the work happens on. */
          web: z.string().optional(),
        }),
      ),
      /** Every app as the chat's agent knows them once told this. */
      apps: ToldAppsSchema,
      /**
       * For a wake about an app asked for on a card with others, every app
       * on that card as it stands. The card wakes the chat once, when no app
       * on it is waiting, or early for a sign-in that did not connect.
       */
      signIns: SignInProgressSchema.optional(),
      /**
       * For a wake about a card, the apps its call named that never reached
       * the card, so the reply can say they were not connected.
       */
      notOnCard: NotOnCardSchema.optional(),
    })
    .refine((data) => data.events.length > 0 || data.otherComputer === true, {
      message: "An app note tells an event, or the apps on another computer",
    });

  export type AppEventDataPart = z.output<typeof AppEventDataPartSchema>;

  /**
   * The person's answer to a card the agent's work raised: a folder that asks
   * first, an app it may not use, or a tab of theirs it asked to work in.
   * Like an app event, it wakes the session that ran into it, or joins its
   * turn if it is still going. `gone` is a tab closed before the answer.
   */
  export const PermissionAnswerDataPartSchema = z.object({
    answer: z.enum(["allowed", "always", "declined", "gone"]),
    kind: z.enum(["app", "folder", "tab"]),
    /** A tab's page as the card showed it. */
    page: z.object({ title: z.string(), url: z.string() }).optional(),
    /** The folder's path, the app's name, or the tab's id. */
    target: z.string(),
    /**
     * Where the yes went when it was not to Instrument's own rules: Windows'
     * ransomware protection, which now lets the app's programs change the
     * folder, or macOS's own prompt, which lets the app into one of the
     * Mac's apps for every chat.
     */
    through: z.enum(["macos", "windows-protection"]).optional(),
  });

  export type PermissionAnswerDataPart = z.output<
    typeof PermissionAnswerDataPartSchema
  >;

  /**
   * The person signed in to Instrument while the session waited on it: an
   * image nothing connected could make, which their account makes. Like a
   * permission answer, it wakes the session that asked.
   */
  export const SignedInDataPartSchema = z.object({
    /** What the session was waiting to do. */
    waitedFor: z.literal("image"),
  });

  export type SignedInDataPart = z.output<typeof SignedInDataPartSchema>;

  const QuestionNoteSchema = z.string().trim().min(1).optional();

  /**
   * One question's answer on a card: what the person picked (a choice's
   * label, or their own words), or that they skipped it.
   */
  export const QuestionReplySchema = z.union([
    z.object({ skipped: z.literal(true) }),
    z.object({ picked: z.array(z.string().trim().min(1)).min(1) }),
  ]);

  export type QuestionReply = z.output<typeof QuestionReplySchema>;

  /**
   * The person's answer to a `choose` card: a reply per question, in the
   * order they were asked, and the one note they wrote with them.
   */
  export const QuestionCardAnswerSchema = z.object({
    note: QuestionNoteSchema,
    replies: z.array(QuestionReplySchema).min(1),
  });

  export type QuestionCardAnswer = z.output<typeof QuestionCardAnswerSchema>;

  /** An answer as earlier builds wrote it, to a card's one question. */
  const OneQuestionAnswerSchema = z.union([
    z.object({ declined: z.literal(true), note: QuestionNoteSchema }),
    z.object({
      note: QuestionNoteSchema,
      selectedChoice: z.string().trim().min(1),
    }),
  ]);

  function fromOneQuestionAnswer(
    answer: z.output<typeof OneQuestionAnswerSchema>,
  ): QuestionCardAnswer {
    return {
      ...(answer.note === undefined ? {} : { note: answer.note }),
      replies: [
        "declined" in answer
          ? { skipped: true }
          : { picked: [answer.selectedChoice] },
      ],
    };
  }

  /** A card's answer as stored, read in the current shape whichever build wrote it. */
  export const StoredQuestionCardAnswerSchema = z.union([
    QuestionCardAnswerSchema,
    OneQuestionAnswerSchema.transform(fromOneQuestionAnswer),
  ]);

  const QuestionAnswerContextSchema = z.object({
    /** The `choose` call it answers, by its part's id. */
    partId: StoreId.PartSchema,
    /**
     * The apps on the chat's sign-in cards that still wait on the person,
     * with the rest of each card as it stands, so the agent knows where the
     * sign-ins are without saying so.
     */
    signIns: SignInProgressSchema.optional(),
  });

  /**
   * What the person answered on a card the chat's agent put up with
   * `choose`. Like a permission answer, it wakes the chat, or joins its turn
   * if it is still going. Earlier builds wrote one question's answer, which
   * reads as a card of one.
   */
  export const QuestionAnswerDataPartSchema = z.union([
    QuestionAnswerContextSchema.extend({
      answer: QuestionCardAnswerSchema,
      /** The card's questions, in the order the replies answer them. */
      questions: z.array(z.string()).min(1),
    }),
    QuestionAnswerContextSchema.extend({
      answer: OneQuestionAnswerSchema,
      question: z.string(),
    }).transform(({ answer, question, ...rest }) => ({
      ...rest,
      answer: fromOneQuestionAnswer(answer),
      questions: [question],
    })),
  ]);

  export type QuestionAnswerDataPart = z.output<
    typeof QuestionAnswerDataPartSchema
  >;

  /**
   * What the user was looking at when they sent the message: the folder open
   * in the window's folder view and what was selected in it.
   * Event cadence, written by the surface that sent the message and only when
   * it had a folder on screen.
   */
  /** The task at work in a tab, stamped when the message is stored. */
  const TabHolderSchema = z.object({ id: z.string(), title: z.string() });

  /** The page the window's browser shows: its address and title, what is selected on it, and where the cursor is. */
  const ViewedPageSchema = z.object({
    /** Where the user's cursor is on the page: the focused control, described. */
    focus: z.string().optional(),
    selection: z.string().optional(),
    /** The tab on screen, by its id. */
    tab: z.string().optional(),
    /**
     * Whether that tab is the person's own, outside the chat: one the chat
     * may ask them for (`window request`), not one it may name or hand a task.
     */
    theirs: z.boolean().optional(),
    /** The chat's other tabs, on screen or not. */
    tabs: z
      .array(
        z.object({
          heldBy: TabHolderSchema.optional(),
          id: z.string(),
          title: z.string(),
          url: z.string(),
        }),
      )
      .optional(),
    title: z.string(),
    url: z.string(),
  });

  const ViewedTaskSchema = z.object({
    id: z.string(),
    status: z.enum(["working", "done"]),
    /** What the task is doing this moment, in its agent's own label. */
    step: z.string().optional(),
    title: z.string(),
  });

  /**
   * One chip the composer showed over the words as they were sent, which the
   * transcript draws again over the message: a page, a screen of the app's
   * (an app's front, a folder by its route), files and folders by path, or
   * another chat the user had open.
   */
  const SentChipSchema = z.discriminatedUnion("kind", [
    z.object({ id: z.string(), kind: z.literal("chat"), title: z.string() }),
    z.object({ kind: z.literal("page"), title: z.string(), url: z.string() }),
    z.object({
      kind: z.literal("screen"),
      title: z.string(),
      url: z.string(),
    }),
    z.object({
      items: z
        .array(z.object({ kind: z.enum(["file", "folder"]), path: z.string() }))
        .min(1),
      kind: z.literal("paths"),
    }),
  ]);

  export type SentChip = z.output<typeof SentChipSchema>;

  /**
   * What the window had on screen when the message was sent: which screen,
   * and what was on it. One record for every screen, written by the screen
   * itself, so "this", "here" and "these" in the message can be resolved
   * against what the user was actually looking at and nothing else.
   */
  export const ViewContextDataPartSchema = z.object({
    /** The chips over the words as they were sent, in their order; for the transcript, not the agent. */
    attached: z.array(SentChipSchema).optional(),
    /**
     * Another chat the user had open, by its id and title: named and nothing
     * more, since its pages and tabs are that chat's own.
     */
    chat: z.object({ id: z.string(), title: z.string() }).optional(),
    /** The app whose page is up on the Apps screen, and where it stands. */
    app: z
      .object({
        name: z.string(),
        /** The service's origin, for its icon. */
        site: z.string().optional(),
        /**
         * The record open in the page's inspector, as the read that fetches
         * it again: a pointer the agent can follow, never the record itself.
         */
        reading: z
          .object({ args: z.string(), title: z.string(), tool: z.string() })
          .optional(),
        slug: z.string(),
        /** Connected, or what is missing, in the words the Apps screen uses. */
        standing: z.string(),
      })
      .optional(),
    /**
     * Files and folders the person picked to go with the message by name,
     * from a menu or a button over them, rather than by having them on
     * screen: each by its path, and by its path again as `mount` when a
     * granted folder covers it, which is what the chat lists as sent.
     */
    chosen: z
      .array(
        z.object({
          /** Its path as the agent's shell spelled it when the message was stored, which the model is told. */
          agentPath: z.string().optional(),
          kind: z.enum(["file", "folder"]),
          mount: z.string().optional(),
          name: z.string(),
          path: z.string(),
        }),
      )
      .optional(),
    /** A file open on This Mac, as the person writes its path. */
    file: z
      .object({
        /** Its path as the agent's shell spelled it when the message was stored, which the model is told. */
        agentPath: z.string().optional(),
        /** Its path when a granted folder covers it, which the chat lists as sent. */
        mount: z.string().optional(),
        name: z.string(),
        path: z.string(),
      })
      .optional(),
    /** The folder on screen on This Mac, or the folder a file on screen sits in. */
    folder: z
      .object({
        /** As the person writes it: `~/Documents/Instrument`. */
        display: z.string(),
        /** Its path when a granted folder covers it, which the chat lists as sent. */
        mount: z.string().optional(),
        /** The names selected in it, a folder's with a trailing slash. */
        selected: z.array(z.string()).default([]),
      })
      .optional(),
    page: ViewedPageSchema.optional(),
    /** Every tab the window has open, on screen or not, for `tab` and "--tab" to name; the strip's order. */
    tabs: z
      .array(
        z.object({
          /** A page's address, a file's path, or a screen's route. */
          at: z.string(),
          heldBy: TabHolderSchema.optional(),
          /** The tab's id, which `tab` names it by and a page's tab is handed to a task by. */
          id: z.string().optional(),
          title: z.string(),
        }),
      )
      .optional(),
    /** The screen up in the window, by the name the sidebar gives it. */
    screen: z.enum([
      "apps",
      "browser",
      // Another chat, which `chat` names.
      "chat",
      "computer",
      // The chat's own conversation, with nothing else in view beside it.
      "conversation",
      "file",
      "home",
      // No screen is called this; messages already stored may still name it.
      "skills",
      "task",
      "tasks",
    ]),
    /** The one task open on the Tasks screen. */
    task: ViewedTaskSchema.optional(),
    /** The tasks listed on the Tasks screen. */
    tasks: z.array(ViewedTaskSchema).optional(),
    /** The screen's address in the window, the way a browser has one. */
    url: z.string().optional(),
  });

  export type ViewContextDataPart = z.output<typeof ViewContextDataPartSchema>;

  /**
   * The local calendar date a session moved onto, as `yyyy-MM-dd`, written to
   * the first user message sent on a later day than the one the session context
   * records. The session context is a startup snapshot and is never rewritten,
   * so this is how a session that runs past midnight learns what day it is
   * without invalidating everything cached behind that snapshot. Recorded at
   * send time from a single clock read; no timer watches for the rollover.
   */
  const DateChangeDataPartSchema = z.object({
    date: z.string(),
  });

  export type DateChangeDataPart = z.output<typeof DateChangeDataPartSchema>;

  /**
   * The facts about the computer that differ from what the session was last
   * told, each at its new value, written to the user message sent after the
   * change: the chat moved to another computer, the OS updated, the time zone
   * or a folder moved. Never rewrites the baseline that told the old values.
   */
  const EnvironmentChangeDataPartSchema = EnvironmentChangeSchema;

  export type EnvironmentChangeDataPart = z.output<
    typeof EnvironmentChangeDataPartSchema
  >;

  /**
   * Whole minutes since the user last wrote in this chat, written to a
   * message they sent after a long enough silence to mean they went away and
   * came back.
   *
   * The date correction above is the only other thing that says time has
   * passed, and it answers a different question: it fires on a calendar
   * rollover, so a session running through midnight gets one after two minutes
   * and a session idle from morning to night gets none. This is the gap itself,
   * measured only against messages the user actually sent -- a task finishing
   * three minutes ago is the app talking to itself and would otherwise mask a
   * day of silence.
   *
   * Stored as the number rather than as words or as the timestamp to subtract
   * from: the wording is the renderer's to change, and a duration fixed at send
   * time cannot drift the way `now - then` would every time the transcript is
   * rebuilt.
   */
  const MessageGapDataPartSchema = z.object({
    minutes: z.number(),
  });

  export type MessageGapDataPart = z.output<typeof MessageGapDataPartSchema>;

  /**
   * The user's other chats at the moment a new chat opened, newest first:
   * each one's title, topics, latest line, and when it last moved, on the
   * root message of a chat an earlier build opened. Nothing writes it and
   * the model is not shown it; the agent reads earlier chats' records itself
   * when the user refers to earlier work.
   * Kept so those stored messages still parse, and shown only on the
   * developer view of the transcript.
   */
  const ChatContextDataPartSchema = z.object({
    chats: z.array(
      z.object({
        at: z.number(),
        /** The chat's id, which a link to the chat carries; a session id on a note stored before chats had ids of their own, and absent on one stored before the agent could link one. */
        id: z.string().optional(),
        latest: z.string().optional(),
        title: z.string(),
        /** Topic names, since the agent reads names and never ids. */
        topics: z.array(z.string()),
      }),
    ),
    sentAt: z.number(),
  });

  export type ChatContextDataPart = z.output<typeof ChatContextDataPartSchema>;

  /**
   * What the conversation's agent remembers about the user, on a chat's
   * user message when memory changed since the chat was last told: the
   * whole of it the first time, and after that only what was saved,
   * corrected, or forgotten since. Each memory is its first line, the chat
   * it was learned in, and when. Diff cadence: attached only on a change.
   * `sentAt` is what "when" is measured from.
   */
  const MemoryDataPartSchema = z.object({
    /** Names forgotten since the chat was last told; only on a change. */
    forgotten: z.array(z.string()).default([]),
    /**
     * The whole of memory up to the note's ceiling, or, on a change, only the
     * memories saved or corrected since the chat was last told.
     */
    memories: z.array(
      z.object({
        at: z.number(),
        /** The title of the chat it was learned in, when a chat saved it. */
        from: z.string().optional(),
        name: z.string(),
        /** The first line, cut to a note's width; the whole is read by name. */
        text: z.string(),
      }),
    ),
    /** How many memories a whole note left out past its ceiling. */
    more: z.number().int().nonnegative().default(0),
    sentAt: z.number(),
    /** Whether the note carries the whole of memory or the change since the chat was last told. */
    tells: z.enum(["whole", "changes"]).default("whole"),
    /** What memory held when the note was written, a digest per name (`memoryDigests`): what the chat now knows. */
    told: ToldDigestsSchema,
  });

  export type MemoryDataPart = z.output<typeof MemoryDataPartSchema>;

  /**
   * The topic the chat is filed under, on every user message sent in a chat:
   * its name, mark, and the line saying what goes there, or `null` for none.
   * State cadence, so a chat filed once is told once.
   */
  const TopicDataPartSchema = z.object({
    topic: z
      .object({
        about: z.string().optional(),
        emoji: z.string().optional(),
        /** The paths of the topic's folders in the chat. */
        folders: z.array(z.string()).optional(),
        /** The topic's instructions as they stood when the message was sent. */
        instructions: z.string().optional(),
        name: z.string(),
      })
      .nullable(),
  });

  export type TopicDataPart = z.output<typeof TopicDataPartSchema>;

  /**
   * Retired, and read anyway.
   *
   * The directory watcher that wrote this is gone, and so is the change card it
   * fed: what a reply hands over is now what the reply names in its ` ```files `
   * fence. Nothing writes this part, and nothing should.
   *
   * It is still parsed because tasks from before the fence hold it, and it is
   * the only record those conversations have of what a turn produced. Dropping
   * the schema does not delete the payload -- it survives in `chat.db` either
   * way -- it just makes the part unreadable, which costs those transcripts
   * their file links for no gain.
   *
   * Deliberately narrower than what was written. The payload also carried
   * `filename`, `mimeType`, `modifiedAt` and `size`; the first two come from the
   * path and the last two were the freshness machinery this replaced, so they
   * are dropped on read and this schema says how much of the idea survives.
   *
   * Parsed element-wise so one malformed entry costs that entry rather than the
   * whole part: this is old data, written by code nobody is fixing.
   *
   * **Safe to delete once tasks predating the fence are not worth reading.**
   * Added 2026-08-11; revisit in a couple of months. Deleting it means deleting
   * this schema, its `NameSchema` member, and the renderer's case -- all three
   * of which the exhaustiveness checks will point at.
   */
  const RetiredFileChangeSchema = z.object({
    filePath: RelativePathSchema,
    status: z.enum(["added", "deleted", "modified"]),
  });

  const FileChangesDataPartSchema = z.object({
    files: z
      .array(z.unknown())
      .transform((entries) =>
        entries.flatMap((entry) => {
          const parsed = RetiredFileChangeSchema.safeParse(entry);
          return parsed.success ? [parsed.data] : [];
        }),
      )
      .catch([]),
  });

  export type FileChangesDataPart = z.output<typeof FileChangesDataPartSchema>;

  /**
   * What a data part becomes when it cannot be read as the type it claims.
   *
   * Two ways in, both of them a chat outliving a schema: a type this build has
   * no schema for at all (a part a retired feature wrote), and a payload
   * written before a field the schema now describes. The part is kept rather
   * than dropped, because `attachments` is a data part too and silently
   * losing a turn's uploads is a worse answer than a row saying something
   * could not be read.
   *
   * Nothing writes one. It exists only on the way out of the store.
   */
  const UnknownDataPartSchema = z.object({
    originalType: z.string(),
    reason: z.string(),
  });

  export type UnknownDataPart = z.output<typeof UnknownDataPartSchema>;

  /** The root AGENTS.md snapshot for this turn, bounded before it is stored. */
  const WorkspaceInstructionsDataPartSchema = z.object({
    file: z.string(),
    /** Absent when the file is missing or empty, including after removal. */
    instructions: z.string().optional(),
  });

  export type WorkspaceInstructionsDataPart = z.output<
    typeof WorkspaceInstructionsDataPartSchema
  >;

  const DataPartsSchema = z.object({
    [NameSchema.enum.appEvent]: AppEventDataPartSchema,
    [NameSchema.enum.asks]: AsksDataPartSchema,
    [NameSchema.enum.folderChanges]: FolderChangesDataPartSchema,
    [NameSchema.enum.permissionAnswer]: PermissionAnswerDataPartSchema,
    [NameSchema.enum.questionAnswer]: QuestionAnswerDataPartSchema,
    [NameSchema.enum.attachments]: FileAttachmentsDataPartSchema,
    [NameSchema.enum.backgroundProcesses]: BackgroundProcessesDataPartSchema,
    [NameSchema.enum.browserStatus]: BrowserStatusDataPartSchema,
    [NameSchema.enum.chatContext]: ChatContextDataPartSchema,
    [NameSchema.enum.topic]: TopicDataPartSchema,
    [NameSchema.enum.contextRollover]: ContextRolloverDataPartSchema,
    [NameSchema.enum.dateChange]: DateChangeDataPartSchema,
    [NameSchema.enum.environmentChange]: EnvironmentChangeDataPartSchema,
    [NameSchema.enum.fileChanges]: FileChangesDataPartSchema,
    [NameSchema.enum.fromChat]: FromChatDataPartSchema,
    [NameSchema.enum.intent]: IntentDataPartSchema,
    [NameSchema.enum.jobEvent]: JobEventDataPartSchema,
    [NameSchema.enum.maxSteps]: MaxStepsDataPartSchema,
    [NameSchema.enum.memory]: MemoryDataPartSchema,
    [NameSchema.enum.messageGap]: MessageGapDataPartSchema,
    [NameSchema.enum.modelChange]: ModelChangeDataPartSchema,
    [NameSchema.enum.outputLimit]: OutputLimitDataPartSchema,
    [NameSchema.enum.reply]: ReplyDataPartSchema,
    [NameSchema.enum.setupChanges]: SetupChangesDataPartSchema,
    [NameSchema.enum.setupNews]: SetupNewsDataPartSchema,
    [NameSchema.enum.signedIn]: SignedInDataPartSchema,
    [NameSchema.enum.skillMentions]: SkillMentionsDataPartSchema,
    [NameSchema.enum.taskEvent]: TaskEventDataPartSchema,
    [NameSchema.enum.toolResultsCleared]: ToolResultsClearedDataPartSchema,
    [NameSchema.enum.unknown]: UnknownDataPartSchema,
    [NameSchema.enum.viewContext]: ViewContextDataPartSchema,
    [NameSchema.enum.workspaceInstructions]:
      WorkspaceInstructionsDataPartSchema,
  });
  export type DataParts = z.output<typeof DataPartsSchema>;

  /**
   * Reads a stored payload as the type its part claims, or says why it cannot.
   *
   * This is the only place a persisted data payload meets the schema that
   * describes it. Everything downstream is handed the parsed value, so a field
   * added since the part was written arrives with the default the schema already
   * gives it rather than as undefined behind a type that promises otherwise.
   */
  export function parseDataPayload(
    name: string,
    data: unknown,
  ): { ok: false; reason: string } | { ok: true; value: unknown } {
    // `unknown` is a name like any other here, and deliberately so: parts are
    // coerced on the way out of the store and again by the rpc output schema, so
    // an already-wrapped part meets this twice. Excluding it would re-wrap the
    // wrapper on the second pass and lose the type it was reporting.
    const parsed = NameSchema.safeParse(name);
    if (!parsed.success) {
      return { ok: false, reason: `no schema for data-${name}` };
    }

    const result = DataPartsSchema.shape[parsed.data].safeParse(data);

    return result.success
      ? { ok: true, value: result.data }
      : { ok: false, reason: z.prettifyError(result.error) };
  }
}
