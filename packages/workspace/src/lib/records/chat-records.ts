import fs from "node:fs/promises";
import { type Stopper } from "../../schemas/stop-notice";
import path from "node:path";
import { isMainThread } from "node:worker_threads";
import { isEqual, noop } from "radashi";

import {
  CUT_OFF_TOOL_CALL_ERROR_TEXT,
  INTERRUPTED_TOOL_CALL_ERROR_TEXT,
} from "../../constants";
import { type ChatId } from "../../schemas/chat-id";
import {
  type CardAnswer,
  type PermissionCard,
} from "../../schemas/permission-card";
import { type Session } from "../../schemas/session";
import { type SessionMessage } from "../../schemas/session/message";
import { SessionMessagePart } from "../../schemas/session/message-part";
import { type StoreId } from "../../schemas/store-id";
import { getCurrentDate } from "../get-current-date";
import { isToolPart } from "../is-tool-part";
import { recordChanged, recordMessageChanged } from "../record-changes";
import { chatDir } from "../record-folders";
import { getWorkspaceConfig } from "../workspace-config";
import { isArriving } from "./arriving";
import { blobPath, writeBlob } from "./blobs";
import { type DeviceId } from "./device-id";
import { writingChatRecords } from "./installed-records";

export { installChatRecords, writingChatRecords } from "./installed-records";
import { settingsFileName, parseRecordFileName } from "./file-names";
import {
  ChatFold,
  type FoldedChat,
  type FoldedSettings,
  type FoldedSession,
} from "./fold";
import {
  type LogWriter,
  type SettingsWriter,
  openLog,
  openSettingsFile,
} from "./open-log";
import { keepOwnLogCursor, ownLogCursor } from "./own-log-cursors";
import { type LoadBlob, partToRecord } from "./part-blobs";
import { localPart, portablePart } from "./part-paths";
import {
  type LogRecord,
  type SettingField,
  type SettingRecord,
  type SessionHeader,
} from "./record";
import { type Unsequenced } from "./record-writer";
import { sessionOf, startedTitle } from "./session-of";

/**
 * A chat's records as this process writes and reads them: one service per
 * process, on the main thread, the only writer of this device's logs and
 * settings files.
 *
 * Each chat it has open is folded once from its folder, and kept current
 * by its own appends. A write is queued in the same tick it is asked for,
 * so a read right after it sees it, and lands in the fold once its line is
 * in the file; until then it is pending. Reads are the fold with the
 * pending writes over it, plus what the running turn holds in memory and
 * never writes (`live`).
 *
 * - A write's promise settles once its line is in the file, and for a
 *   commit point (a user message, a tool call about to run or done, a
 *   finished step) once the file is synced too. A write that fails is
 *   dropped from what reads see, and its promise rejects with why.
 * - A chat is held in memory while anything pins it (`open`), and a few
 *   more stay after their last release, the least recently used going
 *   first. One with writes under way or a turn in memory always stays.
 * - The first time this process opens a chat, the calls this device left
 *   in flight and the step it left unfinished are settled as interrupted:
 *   no turn of this process can own them yet.
 * - Every write says what it changed through `record.changed`, as it is
 *   queued; a turn in memory says so at most every 100 ms.
 */

/** What starting a session writes in its log's header. */
export interface SessionStart {
  createdAt: Date;
  forkedAt?: StoreId.Message;
  handle?: string;
  id: StoreId.Session;
  parent?: StoreId.Session;
  startedAs?: string;
}

/** One of a session's settings: a field and what it is now. */
export type SettingChange<R = SettingRecord> = R extends SettingRecord
  ? Pick<R, "field" | "value">
  : never;

/** What a session's running turn holds that is never written. */
export interface LiveTurn {
  /** The reply under way, as it stands. */
  message?: SessionMessage.Type;
  /** Parts still streaming in, and calls whose input is still arriving, by id. */
  parts: ReadonlyMap<string, SessionMessagePart.Type>;
}

/** A session's running turn, as its writer holds it. */
export interface Live {
  /**
   * Ends one reply of the turn, or with no id the whole turn, writing
   * whatever it still holds as cut off: the words a reply had reached, and a
   * call whose input never finished arriving, as interrupted. A reply that
   * settled everything has nothing to write here.
   */
  clear(messageId?: StoreId.Message): Promise<void>;
  /** Takes a part out of the turn's memory, for one appended another way. */
  forget(partId: StoreId.Part): void;
  setMessage(message: SessionMessage.Type): void;
  setPart(part: SessionMessagePart.Type): void;
  /** Takes a part out of the turn's memory and appends it as settled. */
  settle(part: SessionMessagePart.Type): Promise<void>;
}

/** A chat as one read found it, for the views to be drawn from. */
export interface ChatRead {
  /** The fold, with the writes still on their way to disk over it. */
  chat: FoldedChat;
  /** Each session's running turn. */
  live: ReadonlyMap<StoreId.Session, LiveTurn>;
  /** Reads a blob the chat's records name. */
  load: LoadBlob;
}

/** Lets go of a chat `open` pinned. */
export type Release = () => void;

export interface ChatRecordsOptions {
  /** The app version a log this process starts names. */
  app: string;
  device: DeviceId;
  /** A chat's record folder. */
  dirOf: (chatId: ChatId) => string;
  /**
   * Whether commit points sync the file. Off only where nothing has to
   * survive a power cut (tests).
   */
  fsync?: boolean;
  /** How many chats nothing pins stay folded. */
  keepUnpinned?: number;
  now?: () => Date;
  /** Told of what fails where no caller is waiting: a sweep's writes, a sync on the way out. */
  onError?: (error: unknown) => void;
  /**
   * The workspace's folder on this computer, which a part's paths into it
   * are kept by their place in (`part-paths.ts`). None keeps every path as
   * it is given.
   */
  workspaceRoot?: string;
}

/** How often a turn in memory says it changed, at most. */
const LIVE_PUBLISH_MS = 100;

const KEEP_UNPINNED = 8;

type LogBody = Unsequenced<Exclude<LogRecord, SessionHeader>>;

interface Queued<T> {
  ticket: number;
  value: T;
}

/** What is queued for a session and not yet in the fold. */
interface PendingSession {
  /** The newest `at` of its queued log records, in ms. */
  at: number;
  header?: Queued<SessionStart & { app: string; at: Date }>;
  settings: Map<SettingField, Queued<Unsequenced<SettingRecord>>>;
  messages: Map<StoreId.Message, Queued<SessionMessage.Type>>;
  parts: Map<StoreId.Part, Queued<SessionMessagePart.Type>>;
  retracted: Map<StoreId.Message, number>;
  rollover?: Queued<NonNullable<FoldedSession["rollover"]>>;
  sites?: Queued<string[]>;
  stopped?: Queued<NonNullable<FoldedSession["stopped"]>>;
  cards: Map<string, Queued<PermissionCard>>;
  /** By ticket, in the order they were queued. */
  answers: Map<number, CardAnswer>;
}

/** One file this process appends to, and how far its writes reach. */
interface FileState<W> {
  /** Where the newest write to the file ended. */
  end: number;
  /** The file's name, once it is known: a log's is chosen as it opens. */
  name?: string;
  writer: Promise<W>;
}

interface OpenChat {
  catchingUp: Map<string, Promise<unknown>>;
  /** Each file's queue of records still being made ready, so lines go in in call order. */
  chains: Map<string, Promise<unknown>>;
  dir: string;
  fold: ChatFold;
  id: ChatId;
  logs: Map<StoreId.Session, FileState<LogWriter>>;
  settings?: FileState<SettingsWriter>;
  pending: Map<StoreId.Session, PendingSession>;
  /**
   * Sessions whose log this device opens again before its next write to it,
   * since another device's records of them were folded in after it opened.
   */
  reopen: Set<StoreId.Session>;
  writes: Set<Promise<unknown>>;
}

interface ChatEntry {
  /** When it was last used, by a count that only goes up. */
  lastUsed: number;
  open?: OpenChat;
  pins: number;
  ready?: Promise<OpenChat>;
  /** Calls queued behind the chat's first fold. */
  waiting: number;
}

interface LiveThrottle {
  changed: Set<StoreId.Message>;
  published: number;
  timer?: ReturnType<typeof setTimeout>;
}

export class ChatRecords {
  readonly device: DeviceId;
  readonly #app: string;
  #chats = new Map<ChatId, ChatEntry>();
  readonly #dirOf: (chatId: ChatId) => string;
  #disposed = false;
  readonly #fsync: boolean;
  readonly #keepUnpinned: number;
  #live = new Map<ChatId, Map<StoreId.Session, LiveState>>();
  readonly #now: () => Date;
  readonly #onError: (error: unknown) => void;
  /** Chats whose interrupted calls this process has settled. */
  #swept = new Set<ChatId>();
  #throttles = new Map<string, LiveThrottle>();
  #ticket = 0;
  #uses = 0;
  readonly #workspaceRoot: string | undefined;

  constructor({
    app,
    device,
    dirOf,
    fsync = true,
    keepUnpinned = KEEP_UNPINNED,
    now = getCurrentDate,
    onError = noop,
    workspaceRoot,
  }: ChatRecordsOptions) {
    this.#workspaceRoot = workspaceRoot;
    this.#app = app;
    this.device = device;
    this.#dirOf = dirOf;
    this.#fsync = fsync;
    this.#keepUnpinned = keepUnpinned;
    this.#now = now;
    this.#onError = onError;
  }

  /** A fold that reads a part's paths into the workspace as this computer's. */
  #newFold(): ChatFold {
    const root = this.#workspaceRoot;
    return new ChatFold(
      root === undefined ? undefined : (part) => localPart(part, root),
    );
  }

  /** Folds the chat if it is not yet, and keeps it until released. */
  async open(chatId: ChatId): Promise<Release> {
    const entry = this.#entry(chatId);
    entry.pins += 1;
    try {
      await this.#with(chatId, noop);
    } catch (error) {
      entry.pins -= 1;
      throw error;
    }
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      entry.pins -= 1;
      this.#trim();
    };
  }

  /**
   * Lets the chat go once its writes have landed and synced: for a chat
   * being trashed, or one whose folder is no longer one. A write after it
   * folds the chat again from its folder.
   */
  async close(chatId: ChatId): Promise<void> {
    this.#live.delete(chatId);
    this.#stopThrottles(chatId);
    const entry = this.#chats.get(chatId);
    this.#chats.delete(chatId);
    const chat = entry && (entry.open ?? (await entry.ready?.catch(noop)));
    if (chat) {
      await settled(chat);
      await this.#commitAll(chat);
    }
  }

  /** Lands and syncs every chat's writes, and takes no more. */
  async dispose(): Promise<void> {
    this.#disposed = true;
    for (const chatId of this.#live.keys()) {
      this.#stopThrottles(chatId);
    }
    this.#live.clear();
    const entries = [...this.#chats.values()];
    this.#chats.clear();
    await Promise.all(
      entries.map(async (entry) => {
        const chat = entry.open ?? (await entry.ready?.catch(noop));
        if (chat) {
          await settled(chat);
          await this.#commitAll(chat);
        }
      }),
    );
  }

  /**
   * Waits until every write of the chat already asked for has landed or
   * failed, so whatever reads the chat next finds them in its files. Writes
   * asked for after the call are not waited for.
   */
  async landed(chatId: ChatId): Promise<void> {
    const entry = this.#chats.get(chatId);
    const chat = entry && (entry.open ?? (await entry.ready?.catch(noop)));
    if (chat) {
      await Promise.allSettled(chat.writes);
    }
  }

  /**
   * Whether the chat has records written here that are not yet in its
   * files: a read of it then has them over what its files say.
   */
  isWriting(chatId: ChatId): boolean {
    const chat = this.#chats.get(chatId)?.open;
    return chat !== undefined && chat.pending.size > 0;
  }

  /**
   * How far the chat as held here has read each of its files, or nothing
   * for a chat not held, which a read folds from its files as they are.
   */
  readTo(chatId: ChatId): Map<string, number> | undefined {
    return this.#chats.get(chatId)?.open?.fold.readTo();
  }

  /** The chat as it stands: its fold with what is pending over it, and its running turns. */
  read(chatId: ChatId): Promise<ChatRead> {
    return this.#with(chatId, (chat) => ({
      chat: withPending(chat.fold.chat(), chat.pending, chat.id, this.device),
      live: this.#liveOf(chatId),
      load: (name) => fs.readFile(blobPath(chat.dir, name)),
    }));
  }

  /**
   * Folds in what other devices' files of the chat have gained since this
   * process folded it, for a chat held in memory: one that is not is folded
   * from its folder the next time it is read, so there is nothing to catch
   * up. A file of another device's that grew has only its new bytes folded.
   * One that shrank, which a file its device only appends to does only when
   * a sync engine replaces it, has the chat folded again from its folder.
   * One that went keeps what was folded of it: a sync engine evicting a file
   * to a placeholder takes it away until it is read again, and what it held
   * is still the chat's. This device's own files are its writes' to keep
   * current. Answers whether the chat was held.
   *
   * A session that changed has this device's log of it opened again before
   * the next write to it, behind the writes already queued, so a log that
   * carries on after another device's records starts anew saying so
   * (`openLog`).
   */
  async catchUp(chatId: ChatId): Promise<boolean> {
    const chat = this.#chats.get(chatId)?.open;
    if (!chat || this.#disposed) {
      return false;
    }
    const before = new Map(
      chat.fold.chat().sessions.map((session) => [session.id, session]),
    );
    const others = (await recordFiles(chat.dir)).filter(
      (name) => parseRecordFileName(name)?.device !== this.device,
    );
    let refold = false;
    for (const name of others) {
      if (refold) {
        break;
      }
      refold = (await grownInto(chat, name)) === "shrank";
    }
    if (refold) {
      const fold = this.#newFold();
      for (const name of await recordFiles(chat.dir)) {
        fold.add(name, await fs.readFile(path.join(chat.dir, name)));
      }
      chat.fold = fold;
    }
    for (const session of chat.fold.chat().sessions) {
      if (before.get(session.id) !== session && chat.logs.has(session.id)) {
        chat.reopen.add(session.id);
      }
    }
    return true;
  }

  /**
   * Starts a session's log with its header. A session the chat already
   * has, from this device or another, is left as it is.
   */
  startSession(chatId: ChatId, start: SessionStart): Promise<void> {
    return this.#with(chatId, (chat) => {
      if (knows(chat, start.id)) {
        return undefined;
      }
      const ticket = this.#nextTicket();
      const at = this.#now();
      const pending = pendingOf(chat, start.id);
      pending.at = Math.max(pending.at, at.getTime());
      pending.header = { ticket, value: { ...start, app: this.#app, at } };
      recordChanged(chat.id, "session");
      const file = this.#logFile(chat, start.id);
      const started = file.writer
        .then(() => caughtUp(chat, file))
        .finally(() => {
          unhold(chat, start.id, (session) => {
            if (session.header?.ticket === ticket) {
              delete session.header;
            }
          });
        });
      return this.#track(chat, started);
    });
  }

  /**
   * A session's row as records: its header the first time, and after that
   * only what changed, since one row stands for a header, a rollover, a stop
   * and the session's settings. A new session's header starts it as
   * `startedAs` when given, else as its row's title.
   */
  async saveSession(
    chatId: ChatId,
    saved: Session.Type,
    startedAs?: string,
  ): Promise<void> {
    const read = await this.read(chatId);
    const known = read.chat.sessions.find(({ id }) => id === saved.id);
    // A session just started has the title its header reads as and no
    // settings, so a row titled apart from that writes its title setting.
    let was: Settled;
    if (known) {
      was = sessionOf(known);
    } else {
      const header = {
        ...headerOf(saved),
        ...(startedAs !== undefined && { startedAs }),
      };
      await this.startSession(chatId, header);
      was = { title: startedTitle(header) };
    }
    if (
      saved.rolledOverAfterMessageId !== undefined &&
      (known?.rollover?.after !== saved.rolledOverAfterMessageId ||
        known.rollover.usableTokens !== saved.rolledOverUnderUsableTokens ||
        !isEqual(known.rollover.windows, saved.rolloverWindows))
    ) {
      await this.rollover(
        chatId,
        saved.id,
        saved.rolledOverAfterMessageId,
        saved.rolledOverUnderUsableTokens,
        saved.rolloverWindows,
      );
    }
    // A row re-saved with the stop it still reads with says nothing new, and
    // a row read once a turn retired the stop carries none; `stopped` tells
    // the two apart against the session as it reads when it writes.
    if (saved.stoppedBy !== undefined) {
      await this.stopped(chatId, saved.id, saved.stoppedBy);
    }
    for (const change of settingsBetween(was, saved)) {
      await this.setting(chatId, saved.id, change);
    }
  }

  appendMessage(chatId: ChatId, message: SessionMessage.Type): Promise<void> {
    return this.#with(chatId, (chat) =>
      this.#message(chat, message, isCommitMessage(message)),
    );
  }

  /** A message and its parts, which every read sees together. */
  appendMessageWithParts(
    chatId: ChatId,
    { parts, ...message }: SessionMessage.WithParts,
  ): Promise<void> {
    return this.#with(chatId, (chat) => {
      const strays = parts.filter(
        (part) =>
          part.metadata.sessionId !== message.metadata.sessionId ||
          part.metadata.messageId !== message.id,
      );
      if (strays.length > 0) {
        throw new Error(
          `Parts ${strays.map((part) => part.metadata.id).join(", ")} are not message ${message.id}'s`,
        );
      }
      // One sync after the last line, since the message and its parts are one commit.
      const commit =
        isCommitMessage(message) || parts.some((part) => isCommitPart(part));
      return Promise.all([
        this.#message(chat, message, commit && parts.length === 0),
        ...parts.map((part, index) =>
          this.#part(chat, part, commit && index === parts.length - 1),
        ),
      ]).then(noop);
    });
  }

  appendPart(chatId: ChatId, part: SessionMessagePart.Type): Promise<void> {
    return this.#with(chatId, (chat) =>
      this.#part(chat, part, isCommitPart(part)),
    );
  }

  /**
   * Hands `updater` the part as it stands, pending writes included, and
   * appends what it gives back, in the same tick: two updates asked for
   * together each build on the other, so a guard in the second sees the
   * first. A part given back unchanged writes nothing. Answers with the
   * part as it then is, or nothing for a part the chat does not have.
   */
  /**
   * The part as it stands, pending writes and the running turn included,
   * handed to `updater`, and what it gives back written. A result still
   * arriving goes to the turn's memory rather than to a record, so an output
   * a tool offered before its own is shown without being written.
   */
  updatePart(
    chatId: ChatId,
    ids: {
      messageId: StoreId.Message;
      partId: StoreId.Part;
      sessionId: StoreId.Session;
    },
    updater: (part: SessionMessagePart.Type) => SessionMessagePart.Type,
  ): Promise<SessionMessagePart.Type | undefined> {
    return this.#with(chatId, (chat) => {
      const current = currentPart(chat, this.#live.get(chatId), ids);
      if (!current) {
        return undefined;
      }
      const next = updater(current);
      if (next === current) {
        return current;
      }
      if (isArriving(next)) {
        this.live(chatId, ids.sessionId).setPart(next);
        return next;
      }
      // Queued first, then the turn's copy goes: the part is in one of the
      // two at every moment, and the arriving copy stops being drawn over the
      // one that settled. Without the second line a part this turn offered
      // before its own result keeps winning every read until the turn ends.
      const written = this.#part(chat, next, isCommitPart(next));
      this.live(chatId, ids.sessionId).forget(ids.partId);
      return written.then(() => next);
    });
  }

  /** Takes messages and their parts out of the session; their ids are never used again. */
  retract(
    chatId: ChatId,
    sessionId: StoreId.Session,
    messages: StoreId.Message[],
  ): Promise<void> {
    if (messages.length === 0) {
      return Promise.resolve();
    }
    return this.#with(chatId, (chat) => {
      const at = this.#now();
      return this.#log(chat, sessionId, {
        at,
        changed: () => {
          for (const id of messages) {
            recordMessageChanged(chat.id, { id, removed: true, sessionId });
          }
        },
        hold: (session, ticket) => {
          for (const id of messages) {
            session.retracted.set(id, ticket);
          }
          return (held) => {
            for (const id of messages) {
              if (held.retracted.get(id) === ticket) {
                held.retracted.delete(id);
              }
            }
          };
        },
        record: () => ({ t: "retract", at, messages }),
      });
    });
  }

  /**
   * Where the session's context window was last reset, and whether that
   * holds for each model asked since.
   */
  rollover(
    chatId: ChatId,
    sessionId: StoreId.Session,
    after: StoreId.Message,
    usableTokens?: number,
    windows?: Session.RolloverWindows,
  ): Promise<void> {
    const value = {
      after,
      ...(usableTokens !== undefined && { usableTokens }),
      ...(windows !== undefined && { windows }),
    };
    return this.#with(chatId, (chat) => {
      const at = this.#now();
      return this.#log(chat, sessionId, {
        at,
        changed: () => recordChanged(chat.id, "session"),
        hold: (session, ticket) => {
          session.rollover = { ticket, value };
          return (held) => {
            if (held.rollover?.ticket === ticket) {
              delete held.rollover;
            }
          };
        },
        record: () => ({ t: "rollover", at, ...value }),
      });
    });
  }

  /**
   * Who stopped the session's turn; it holds until a turn starts after it.
   * A stop by the same stopper the session already reads with, one that
   * still holds or was made from `asked` on, is this stop, and nothing is
   * written. Checked in the same tick that queues the record, against what
   * is queued too, so two callers recording one stop leave one record
   * whichever comes first.
   */
  stopped(
    chatId: ChatId,
    sessionId: StoreId.Session,
    by: Stopper,
    /** When the stop was asked for, where that was before now. */
    asked?: Date,
  ): Promise<void> {
    return this.#with(chatId, (chat) => {
      const read = withPending(
        chat.fold.chat(),
        chat.pending,
        chat.id,
        this.device,
      ).sessions.find(({ id }) => id === sessionId);
      const known = read?.stopped;
      if (
        read &&
        known?.by === by &&
        (sessionOf(read).stoppedBy === by ||
          (asked !== undefined && known.at >= asked))
      ) {
        return undefined;
      }
      const at = asked ?? this.#now();
      return this.#log(chat, sessionId, {
        at,
        changed: () => recordChanged(chat.id, "session"),
        hold: (session, ticket) => {
          session.stopped = { ticket, value: { at, by } };
          return (held) => {
            if (held.stopped?.ticket === ticket) {
              delete held.stopped;
            }
          };
        },
        record: () => ({ t: "stop", at, by }),
      });
    });
  }

  /** The hosts the session's browser has been on, the whole list. */
  sites(
    chatId: ChatId,
    sessionId: StoreId.Session,
    visited: string[],
  ): Promise<void> {
    return this.#with(chatId, (chat) => {
      const at = this.#now();
      return this.#log(chat, sessionId, {
        at,
        changed: () => recordChanged(chat.id, "session"),
        hold: (session, ticket) => {
          session.sites = { ticket, value: visited };
          return (held) => {
            if (held.sites?.ticket === ticket) {
              delete held.sites;
            }
          };
        },
        record: () => ({ t: "sites", at, visited }),
      });
    });
  }

  /** A permission card whole, as this device, the one it belongs to, has it now. */
  card(
    chatId: ChatId,
    sessionId: StoreId.Session,
    card: PermissionCard,
  ): Promise<void> {
    return this.#with(chatId, (chat) => {
      const at = this.#now();
      return this.#log(chat, sessionId, {
        at,
        changed: () => recordChanged(chat.id, "session"),
        hold: (session, ticket) => {
          session.cards.set(card.id, { ticket, value: card });
          return (held) => {
            if (held.cards.get(card.id)?.ticket === ticket) {
              held.cards.delete(card.id);
            }
          };
        },
        record: () => ({ t: "card", at, card }),
      });
    });
  }

  /** This device's answer to a permission card, whichever device it belongs to. */
  answer(
    chatId: ChatId,
    sessionId: StoreId.Session,
    answer: Pick<CardAnswer, "card" | "decision" | "askers">,
  ): Promise<void> {
    return this.#with(chatId, (chat) => {
      const at = this.#now();
      const value: CardAnswer = { ...answer, at, device: this.device };
      return this.#log(chat, sessionId, {
        at,
        changed: () => recordChanged(chat.id, "session"),
        hold: (session, ticket) => {
          session.answers.set(ticket, value);
          return (held) => {
            held.answers.delete(ticket);
          };
        },
        record: () => ({
          t: "answer",
          at,
          card: answer.card,
          decision: answer.decision,
          ...(answer.askers !== undefined && { askers: answer.askers }),
        }),
      });
    });
  }

  /**
   * One of a session's settings, in this device's settings file. A value the
   * session already has writes nothing, so it keeps the moment it was first
   * set.
   */
  setting(
    chatId: ChatId,
    sessionId: StoreId.Session,
    change: SettingChange,
  ): Promise<void> {
    return this.#with(chatId, (chat) => {
      requireSession(chat, sessionId);
      const current =
        chat.pending.get(sessionId)?.settings.get(change.field)?.value ??
        foldedSession(chat, sessionId)?.settings[change.field];
      if (current && isEqual(current.value, change.value)) {
        return undefined;
      }
      const ticket = this.#nextTicket();
      const record: Unsequenced<SettingRecord> = {
        ...change,
        at: this.#now(),
        device: this.device,
        session: sessionId,
        t: "set",
      };
      pendingOf(chat, sessionId).settings.set(change.field, {
        ticket,
        value: record,
      });
      recordChanged(chat.id, "session");
      const file = this.#settingsFile(chat);
      const written = this.#append(chat, "settings", file, () => record, false);
      return this.#track(
        chat,
        this.#landed(chat, sessionId, written, {
          changed: () => recordChanged(chat.id, "session"),
          release: (held) => {
            if (held.settings.get(change.field)?.ticket === ticket) {
              held.settings.delete(change.field);
            }
          },
        }),
      );
    });
  }

  /**
   * The session's running turn, held in memory for the window and never
   * written: a reply streaming in, a call whose input is still arriving.
   */
  live(chatId: ChatId, sessionId: StoreId.Session): Live {
    const turn = () => {
      const sessions =
        this.#live.get(chatId) ?? new Map<StoreId.Session, LiveState>();
      this.#live.set(chatId, sessions);
      const state: LiveState = sessions.get(sessionId) ?? { parts: new Map() };
      sessions.set(sessionId, state);
      return state;
    };
    const drop = () => {
      const sessions = this.#live.get(chatId);
      sessions?.delete(sessionId);
      if (sessions?.size === 0) {
        this.#live.delete(chatId);
      }
    };
    return {
      clear: async (messageId) => {
        const state = this.#live.get(chatId)?.get(sessionId);
        if (!state) {
          return;
        }
        const ends = (id: StoreId.Message) =>
          messageId === undefined || id === messageId;
        const held = [...state.parts.values()].filter((part) =>
          ends(part.metadata.messageId),
        );
        const ended = new Set(held.map((part) => part.metadata.messageId));
        for (const part of held) {
          state.parts.delete(part.metadata.id);
        }
        if (state.message && ends(state.message.id)) {
          ended.add(state.message.id);
          delete state.message;
        }
        if (!state.message && state.parts.size === 0) {
          drop();
        }
        for (const id of ended) {
          this.#liveChanged(chatId, sessionId, id);
        }
        // Whatever arrived and never settled is written as the turn left it,
        // so a reply cut off mid-word is still a reply the person can read.
        const cutOff = held.flatMap((part) => {
          const written = asCutOff(part, this.#now());
          return written ? [written] : [];
        });
        for (const part of cutOff) {
          await this.#with(chatId, (chat) =>
            this.#part(chat, part, isCommitPart(part)),
          );
        }
        this.#trim();
      },
      forget: (partId) => {
        const state = this.#live.get(chatId)?.get(sessionId);
        const held = state?.parts.get(partId);
        if (!state || !held) {
          return;
        }
        state.parts.delete(partId);
        if (!state.message && state.parts.size === 0) {
          drop();
        }
        this.#liveChanged(chatId, sessionId, held.metadata.messageId);
      },
      setMessage: (message) => {
        if (this.#disposed) {
          return;
        }
        turn().message = message;
        this.#liveChanged(chatId, sessionId, message.id);
      },
      setPart: (part) => {
        if (this.#disposed) {
          return;
        }
        turn().parts.set(part.metadata.id, part);
        this.#liveChanged(chatId, sessionId, part.metadata.messageId);
      },
      settle: (part) =>
        this.#with(chatId, (chat) => {
          // Queued first, so a part the chat cannot take stays in memory.
          const written = this.#part(chat, part, isCommitPart(part));
          const state = this.#live.get(chatId)?.get(sessionId);
          state?.parts.delete(part.metadata.id);
          if (state && !state.message && state.parts.size === 0) {
            drop();
          }
          return written;
        }),
    };
  }

  #message(
    chat: OpenChat,
    message: SessionMessage.Type,
    commit: boolean,
  ): Promise<void> {
    const sessionId = message.metadata.sessionId;
    const at = this.#now();
    return this.#log(chat, sessionId, {
      at,
      changed: () =>
        recordMessageChanged(chat.id, {
          id: message.id,
          removed: false,
          sessionId,
        }),
      commit,
      hold: (session, ticket) => {
        session.messages.set(message.id, { ticket, value: message });
        return (held) => {
          if (held.messages.get(message.id)?.ticket === ticket) {
            held.messages.delete(message.id);
          }
        };
      },
      record: () => ({ t: "message", at, message }),
    });
  }

  #part(
    chat: OpenChat,
    part: SessionMessagePart.Type,
    commit: boolean,
  ): Promise<void> {
    const { id, messageId, sessionId } = part.metadata;
    const at = this.#now();
    return this.#log(chat, sessionId, {
      at,
      changed: () =>
        recordMessageChanged(chat.id, {
          id: messageId,
          removed: false,
          sessionId,
        }),
      commit,
      hold: (session, ticket) => {
        session.parts.set(id, { ticket, value: part });
        return (held) => {
          if (held.parts.get(id)?.ticket === ticket) {
            held.parts.delete(id);
          }
        };
      },
      record: async () => ({
        t: "part",
        at,
        part: await partToRecord(
          this.#workspaceRoot === undefined
            ? part
            : portablePart(part, this.#workspaceRoot),
          (bytes, mediaType) => writeBlob(chat.dir, bytes, mediaType),
        ),
      }),
    });
  }

  /**
   * Queues a record for a session's log: held as pending in this tick,
   * announced, appended in call order, and let go once the fold has it or
   * the write failed.
   */
  #log(
    chat: OpenChat,
    sessionId: StoreId.Session,
    {
      at,
      changed,
      commit = false,
      hold,
      record,
    }: {
      at: Date;
      changed: () => void;
      commit?: boolean;
      hold: (
        session: PendingSession,
        ticket: number,
      ) => (held: PendingSession) => void;
      record: () => LogBody | Promise<LogBody>;
    },
  ): Promise<void> {
    requireSession(chat, sessionId);
    const pending = pendingOf(chat, sessionId);
    pending.at = Math.max(pending.at, at.getTime());
    const release = hold(pending, this.#nextTicket());
    changed();
    const file = this.#logFile(chat, sessionId);
    const written = this.#append(
      chat,
      `log ${sessionId}`,
      file,
      record,
      commit,
    );
    return this.#track(
      chat,
      this.#landed(chat, sessionId, written, { changed, release }),
    );
  }

  /** Lets a pending record go once its write settled, saying so again when it failed. */
  async #landed(
    chat: OpenChat,
    sessionId: StoreId.Session,
    written: Promise<void>,
    {
      changed,
      release,
    }: { changed: () => void; release: (held: PendingSession) => void },
  ): Promise<void> {
    try {
      await written;
    } catch (error) {
      unhold(chat, sessionId, release);
      changed();
      throw error;
    }
    unhold(chat, sessionId, release);
  }

  /**
   * Appends to a file behind every record queued for it before, making each
   * ready (its blobs written) in turn, and resolves once the line is in the
   * file and the fold, and synced when it is a commit point.
   */
  #append<R>(
    chat: OpenChat,
    key: string,
    file: FileState<{
      append(record: R): Promise<number>;
      commit(): Promise<void>;
    }>,
    record: () => Promise<R> | R,
    commit: boolean,
  ): Promise<void> {
    const queued = (chat.chains.get(key) ?? Promise.resolve()).then(
      async () => {
        const writer = await file.writer;
        // Not awaited, so the records queued behind it go in the same burst.
        return { writer, written: writer.append(await record()) };
      },
    );
    chat.chains.set(key, queued.catch(noop));
    return queued.then(async ({ writer, written }) => {
      await written;
      await caughtUp(chat, file);
      if (commit && this.#fsync) {
        await writer.commit();
      }
    });
  }

  #logFile(chat: OpenChat, sessionId: StoreId.Session): FileState<LogWriter> {
    const existing = chat.logs.get(sessionId);
    if (existing && !chat.reopen.has(sessionId)) {
      return existing;
    }
    chat.reopen.delete(sessionId);
    // Opened again once what was queued for the log it had has landed, so
    // its header says this device's newest records of the session were read.
    // Taken now: the write about to be queued waits on this, so it must not
    // be among what this waits on.
    const queued = new Set(chat.writes);
    const behind =
      existing &&
      (chat.chains.get(`log ${sessionId}`) ?? Promise.resolve())
        .then(() => Promise.allSettled(queued))
        .then(() => caughtUp(chat, existing))
        .catch(noop);
    const header = behind ? undefined : this.#header(chat, sessionId);
    const file: FileState<LogWriter> = {
      end: 0,
      writer: Promise.resolve(behind)
        .then(() => {
          // Where this device last left the log, read once what was queued
          // for it has landed, so one put back as an older copy is not
          // written on top of.
          const last = ownLogCursor(chat.id, sessionId);
          return openLog({
            dir: chat.dir,
            header: header ?? this.#header(chat, sessionId),
            ...(last && { last }),
            // Kept once the lines are on disk, so the row never says more
            // than a crash leaves of the file.
            onCommit: (cursor) => {
              if (file.name !== undefined) {
                keepOwnLogCursor(chat.id, sessionId, file.name, cursor);
              }
            },
            onWrite: (bytes, offset) => {
              wrote(chat, file, bytes, offset);
            },
          });
        })
        .then(async (writer) => {
          file.name = path.basename(writer.path);
          // A log this opened was started with its header before its name was known.
          await caughtUp(chat, file);
          return writer;
        }),
    };
    file.writer.catch(() => {
      // Opened again by the next write, rather than failing every one after.
      if (chat.logs.get(sessionId) === file) {
        chat.logs.delete(sessionId);
      }
    });
    chat.logs.set(sessionId, file);
    return file;
  }

  #settingsFile(chat: OpenChat): FileState<SettingsWriter> {
    if (chat.settings) {
      return chat.settings;
    }
    const file: FileState<SettingsWriter> = {
      end: 0,
      name: settingsFileName(this.device),
      writer: openSettingsFile(chat.dir, this.device, {
        onWrite: (bytes, offset) => {
          wrote(chat, file, bytes, offset);
        },
      }),
    };
    file.writer.catch(() => {
      if (chat.settings === file) {
        delete chat.settings;
      }
    });
    chat.settings = file;
    return file;
  }

  /** What this device's log of a session says first. */
  #header(chat: OpenChat, sessionId: StoreId.Session) {
    const queued = chat.pending.get(sessionId)?.header?.value;
    const folded = foldedSession(chat, sessionId);
    const start: SessionStart | undefined =
      queued ?? (folded && startOf(folded));
    if (!start) {
      throw new Error(`Chat ${chat.id} has no session ${sessionId}`);
    }
    const continues = chat.fold.continuesFor(sessionId);
    return {
      app: this.#app,
      chat: chat.id,
      createdAt: start.createdAt,
      device: this.device,
      id: start.id,
      ...(start.parent !== undefined && { parent: start.parent }),
      ...(start.forkedAt !== undefined && { forkedAt: start.forkedAt }),
      ...(start.handle !== undefined && { handle: start.handle }),
      ...(start.startedAs !== undefined && { startedAs: start.startedAs }),
      ...(Object.keys(continues).length > 0 && { continues }),
    };
  }

  /**
   * Runs `run` on the chat in this tick when it is folded and nothing is
   * queued behind its fold, and behind the fold otherwise, in call order
   * either way.
   */
  #with<T>(
    chatId: ChatId,
    run: (chat: OpenChat) => Promise<T> | T,
  ): Promise<T> {
    if (this.#disposed) {
      return Promise.reject(new Error("The chat records are closed"));
    }
    const entry = this.#entry(chatId);
    entry.lastUsed = ++this.#uses;
    if (entry.open && entry.waiting === 0) {
      try {
        return Promise.resolve(run(entry.open));
      } catch (error) {
        return Promise.reject(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }
    if (!entry.ready) {
      const ready = this.#load(chatId, entry);
      entry.ready = ready;
      // Folded again by the next call, rather than failing every one after.
      ready.catch(() => {
        if (entry.ready === ready) {
          delete entry.ready;
        }
      });
    }
    return this.#behind(entry, entry.ready, run);
  }

  /**
   * Runs `run` once the chat is folded. Every call waiting on the fold
   * resumes in the order it came, and runs in the tick it resumes in.
   */
  async #behind<T>(
    entry: ChatEntry,
    ready: Promise<OpenChat>,
    run: (chat: OpenChat) => Promise<T> | T,
  ): Promise<T> {
    entry.waiting += 1;
    let chat: OpenChat;
    try {
      chat = await ready;
    } finally {
      entry.waiting -= 1;
    }
    try {
      return await run(chat);
    } finally {
      // Held while it waited: whichever chat is least recently used may go now.
      this.#trim();
    }
  }

  #entry(chatId: ChatId): ChatEntry {
    const existing = this.#chats.get(chatId);
    if (existing) {
      return existing;
    }
    const entry: ChatEntry = { lastUsed: ++this.#uses, pins: 0, waiting: 0 };
    this.#chats.set(chatId, entry);
    return entry;
  }

  async #load(chatId: ChatId, entry: ChatEntry): Promise<OpenChat> {
    const dir = this.#dirOf(chatId);
    const fold = this.#newFold();
    for (const name of await recordFiles(dir)) {
      fold.add(name, await fs.readFile(path.join(dir, name)));
    }
    const chat: OpenChat = {
      catchingUp: new Map(),
      chains: new Map(),
      dir,
      fold,
      id: chatId,
      logs: new Map(),
      pending: new Map(),
      reopen: new Set(),
      writes: new Set(),
    };
    entry.open = chat;
    if (!this.#swept.has(chatId)) {
      this.#swept.add(chatId);
      this.#sweep(chat);
    }
    this.#trim();
    return chat;
  }

  /**
   * Settles what a process of this device's that is gone left in flight in
   * each session: the calls in its newest reply that never finished, as
   * interrupted, and the reply itself, as cut off. Another device's are its
   * own to settle, since that device may still be at work.
   */
  #sweep(chat: OpenChat): void {
    const now = this.#now();
    for (const session of chat.fold.chat().sessions) {
      const own = session.messages.findLast(
        (message) =>
          message.role === "assistant" &&
          session.writtenBy.get(message.id) === this.device,
      );
      if (own?.role !== "assistant") {
        continue;
      }
      const { parts, ...message } = own;
      for (const part of parts) {
        if (
          isToolPart(part) &&
          (part.state === "input-available" ||
            part.state === "input-streaming") &&
          session.writtenBy.get(part.metadata.id) === this.device
        ) {
          this.#part(
            chat,
            SessionMessagePart.coerce({
              ...part,
              errorText: INTERRUPTED_TOOL_CALL_ERROR_TEXT,
              metadata: { ...part.metadata, endedAt: now },
              state: "output-error",
            }),
            true,
          ).catch(this.#onError);
        }
      }
      if (message.metadata.finishedAt === undefined) {
        this.#message(
          chat,
          {
            ...message,
            metadata: {
              ...message.metadata,
              error: { kind: "aborted", message: "Aborted", reason: "unknown" },
              finishedAt: now,
              finishReason: "aborted",
            },
          },
          true,
        ).catch(this.#onError);
      }
    }
  }

  /** Lets go of the least recently used chats nothing holds, past the few kept. */
  #trim(): void {
    const idle = [...this.#chats]
      .filter(
        ([chatId, entry]) =>
          entry.open &&
          entry.pins === 0 &&
          entry.waiting === 0 &&
          entry.open.writes.size === 0 &&
          entry.open.pending.size === 0 &&
          !this.#live.has(chatId),
      )
      .toSorted(([, a], [, b]) => a.lastUsed - b.lastUsed);
    for (const [chatId, entry] of idle.slice(
      0,
      Math.max(0, idle.length - this.#keepUnpinned),
    )) {
      this.#chats.delete(chatId);
      if (entry.open) {
        this.#commitAll(entry.open).catch(this.#onError);
      }
    }
  }

  #track(chat: OpenChat, write: Promise<void>): Promise<void> {
    chat.writes.add(write);
    const done = () => {
      chat.writes.delete(write);
      this.#trim();
    };
    write.then(done, done);
    return write;
  }

  async #commitAll(chat: OpenChat): Promise<void> {
    if (!this.#fsync) {
      return;
    }
    const files = [
      ...chat.logs.values(),
      ...(chat.settings ? [chat.settings] : []),
    ];
    await Promise.all(
      files.map((file) =>
        file.writer.then(
          (writer) => writer.commit(),
          // A file that never opened has nothing written to sync; its writes
          // were told why.
          noop,
        ),
      ),
    );
  }

  #liveOf(chatId: ChatId): ReadonlyMap<StoreId.Session, LiveTurn> {
    const sessions = this.#live.get(chatId);
    return new Map(
      [...(sessions ?? [])].map(([sessionId, state]) => [
        sessionId,
        {
          ...(state.message && { message: state.message }),
          parts: new Map(state.parts),
        },
      ]),
    );
  }

  /** Says a turn in memory changed, at most once per `LIVE_PUBLISH_MS` per session. */
  #liveChanged(
    chatId: ChatId,
    sessionId: StoreId.Session,
    messageId: StoreId.Message,
  ): void {
    const key = `${chatId}\n${sessionId}`;
    const throttle = this.#throttles.get(key) ?? {
      changed: new Set(),
      published: Number.NEGATIVE_INFINITY,
    };
    this.#throttles.set(key, throttle);
    throttle.changed.add(messageId);
    if (throttle.timer) {
      return;
    }
    const publish = () => {
      delete throttle.timer;
      throttle.published = performance.now();
      for (const id of throttle.changed) {
        recordMessageChanged(chatId, { id, removed: false, sessionId });
      }
      throttle.changed.clear();
    };
    const wait = throttle.published + LIVE_PUBLISH_MS - performance.now();
    if (wait <= 0) {
      publish();
      return;
    }
    throttle.timer = setTimeout(publish, wait);
    throttle.timer.unref();
  }

  #stopThrottles(chatId: ChatId): void {
    for (const [key, throttle] of this.#throttles) {
      if (key.startsWith(`${chatId}\n`)) {
        clearTimeout(throttle.timer);
        this.#throttles.delete(key);
      }
    }
  }

  #nextTicket(): number {
    this.#ticket += 1;
    return this.#ticket;
  }
}

interface LiveState {
  message?: SessionMessage.Type;
  parts: Map<string, SessionMessagePart.Type>;
}

let made: ChatRecords | undefined;

/**
 * This process's chat records, made from the workspace's config the first
 * time they are asked for, and again for a config that names another
 * device. Only the main thread writes or reads records.
 */
export function chatRecords(): ChatRecords {
  if (!isMainThread) {
    throw new Error("Chat records are written and read on the main thread");
  }
  const installed = writingChatRecords();
  if (installed) {
    return installed;
  }
  const config = getWorkspaceConfig();
  if (made?.device !== config.deviceId) {
    made?.dispose().catch(config.captureException);
    made = new ChatRecords({
      app: config.appVersion,
      device: config.deviceId,
      dirOf: chatDir,
      onError: (error) => {
        config.captureException(error);
      },
      workspaceRoot: config.rootDir,
    });
  }
  return made;
}

/** Whether a message is one whose line is synced once written. */
function isCommitMessage(message: SessionMessage.Type): boolean {
  return (
    message.role === "user" ||
    (message.role === "assistant" && message.metadata.finishedAt !== undefined)
  );
}

/** A call about to run, or done: what is synced before and after a tool acts. */
function isCommitPart(part: SessionMessagePart.Type): boolean {
  return (
    isToolPart(part) &&
    (part.state === "input-available" ||
      part.state === "output-available" ||
      part.state === "output-error")
  );
}

function pendingOf(chat: OpenChat, sessionId: StoreId.Session): PendingSession {
  const existing = chat.pending.get(sessionId);
  if (existing) {
    return existing;
  }
  const session: PendingSession = {
    answers: new Map(),
    at: 0,
    cards: new Map(),
    settings: new Map(),
    messages: new Map(),
    parts: new Map(),
    retracted: new Map(),
  };
  chat.pending.set(sessionId, session);
  return session;
}

function unhold(
  chat: OpenChat,
  sessionId: StoreId.Session,
  release: (held: PendingSession) => void,
): void {
  const session = chat.pending.get(sessionId);
  if (!session) {
    return;
  }
  release(session);
  if (
    !session.header &&
    !session.rollover &&
    !session.sites &&
    !session.stopped &&
    session.settings.size === 0 &&
    session.messages.size === 0 &&
    session.parts.size === 0 &&
    session.retracted.size === 0
  ) {
    chat.pending.delete(sessionId);
  }
}

function knows(chat: OpenChat, sessionId: StoreId.Session): boolean {
  return (
    chat.pending.get(sessionId)?.header !== undefined ||
    foldedSession(chat, sessionId) !== undefined
  );
}

function requireSession(chat: OpenChat, sessionId: StoreId.Session): void {
  if (!knows(chat, sessionId)) {
    throw new Error(`Chat ${chat.id} has no session ${sessionId}`);
  }
}

function foldedSession(
  chat: OpenChat,
  sessionId: StoreId.Session,
): FoldedSession | undefined {
  return chat.fold.chat().sessions.find(({ id }) => id === sessionId);
}

function startOf(session: FoldedSession): SessionStart {
  return {
    createdAt: session.createdAt,
    id: session.id,
    ...(session.parent !== undefined && { parent: session.parent }),
    ...(session.forkedAt !== undefined && { forkedAt: session.forkedAt }),
    ...(session.handle !== undefined && { handle: session.handle }),
    ...(session.startedAs !== undefined && { startedAs: session.startedAs }),
  };
}

/** What a session's log header says, from the row it was first written as. */
function headerOf(session: Session.Type): SessionStart {
  return {
    createdAt: session.createdAt,
    ...(session.forkedAtMessageId !== undefined && {
      forkedAt: session.forkedAtMessageId,
    }),
    ...(session.handle !== undefined && { handle: session.handle }),
    id: session.id,
    ...(session.parentId !== undefined && { parent: session.parentId }),
    startedAs: session.title,
  };
}

/** The settings a session row carries, each in the shape its record holds. */
type Settled = Pick<
  Session.Type,
  | "archivedAt"
  | "starredAt"
  | "title"
  | "titleSettledAt"
  | "topic"
  | "unreadAt"
  | "unreadByUser"
>;

/**
 * The settings the row moved: each one as its record holds it, left out
 * where the records already say the same thing. A setting whose value has
 * not changed is never rewritten, so it keeps the moment it was set, which
 * is the date the row keeps beside it.
 */
function settingsBetween(was: Settled, now: Session.Type): SettingChange[] {
  const changes: SettingChange[] = [];
  if (
    was.title !== now.title ||
    (was.titleSettledAt === undefined) !== (now.titleSettledAt === undefined)
  ) {
    changes.push({
      field: "title",
      value: { auto: now.titleSettledAt === undefined, text: now.title },
    });
  }
  if ((was.archivedAt === undefined) !== (now.archivedAt === undefined)) {
    changes.push({ field: "archived", value: now.archivedAt !== undefined });
  }
  if ((was.starredAt === undefined) !== (now.starredAt === undefined)) {
    changes.push({ field: "starred", value: now.starredAt !== undefined });
  }
  if (
    (was.unreadAt === undefined) !== (now.unreadAt === undefined) ||
    (was.unreadByUser === true) !== (now.unreadByUser === true)
  ) {
    changes.push({
      field: "unread",
      value:
        now.unreadAt === undefined
          ? null
          : now.unreadByUser === true
            ? "marked"
            : "new",
    });
  }
  if ((was.topic ?? null) !== (now.topic ?? null)) {
    changes.push({ field: "topic", value: now.topic ?? null });
  }
  return changes;
}

/**
 * A part the turn still held when it ended, as the records keep it: the words
 * or thinking a reply had reached, done where it stopped, and a call whose
 * input never finished arriving, as interrupted. A preliminary output is
 * nothing on its own, so it is left behind with the call it was standing in
 * for, which the sweep on the next open finishes.
 */
function asCutOff(
  part: SessionMessagePart.Type,
  now: Date,
): SessionMessagePart.Type | undefined {
  if (isToolPart(part)) {
    return part.state === "input-streaming"
      ? SessionMessagePart.coerce({
          ...part,
          errorText: CUT_OFF_TOOL_CALL_ERROR_TEXT,
          metadata: { ...part.metadata, endedAt: now },
          state: "output-error",
        })
      : undefined;
  }
  if (part.type !== "text" && part.type !== "reasoning") {
    return part;
  }
  return part.text.trimEnd() === ""
    ? undefined
    : {
        ...part,
        metadata: { ...part.metadata, endedAt: now },
        state: "done",
        text: part.text.trimEnd(),
      };
}

/** The parts of a folded session by id, built once per folded session. */
const partIndexes = new WeakMap<
  FoldedSession,
  Map<string, SessionMessagePart.Type>
>();

/**
 * The part as it stands: the write still on its way to disk, then the turn's
 * own memory, then the fold. In that order because each is newer than the one
 * after it -- a part that settles leaves memory as its write is queued, and a
 * part still arriving has no write of its own -- so the newest snapshot of a
 * part is the one an update builds on.
 */
function currentPart(
  chat: OpenChat,
  live: ReadonlyMap<StoreId.Session, LiveState> | undefined,
  ids: { partId: StoreId.Part; sessionId: StoreId.Session },
): SessionMessagePart.Type | undefined {
  const queued = chat.pending.get(ids.sessionId)?.parts.get(ids.partId);
  if (queued) {
    return queued.value;
  }
  const arriving = live?.get(ids.sessionId)?.parts.get(ids.partId);
  if (arriving) {
    return arriving;
  }
  const session = foldedSession(chat, ids.sessionId);
  if (!session) {
    return undefined;
  }
  let index = partIndexes.get(session);
  if (!index) {
    index = new Map(
      session.messages.flatMap((message) =>
        message.parts.map((part) => [part.metadata.id, part] as const),
      ),
    );
    partIndexes.set(session, index);
  }
  return index.get(ids.partId);
}

/** Folds a write's bytes when they start where the fold stopped; a catch-up reads them otherwise. */
function wrote(
  chat: OpenChat,
  file: FileState<unknown>,
  bytes: Uint8Array,
  offset: number,
): void {
  file.end = Math.max(file.end, offset + bytes.length);
  if (
    file.name !== undefined &&
    chat.fold.cursor(file.name).offset === offset
  ) {
    chat.fold.add(file.name, bytes);
  }
}

/**
 * Reads another device's file into the fold from where the fold stopped:
 * `grew` when it had bytes past that, `kept` when it had none or is gone,
 * and `shrank` when it is shorter than what was folded.
 */
function grownInto(
  chat: OpenChat,
  name: string,
): Promise<"grew" | "kept" | "shrank"> {
  const previous = chat.catchingUp.get(name) ?? Promise.resolve();
  const next = previous.then(async () => {
    const start = chat.fold.cursor(name).offset;
    let handle: fs.FileHandle;
    try {
      handle = await fs.open(path.join(chat.dir, name), "r");
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return "kept";
      }
      throw error;
    }
    try {
      const { size } = await handle.stat();
      if (size < start) {
        return "shrank";
      }
      if (size === start) {
        return "kept";
      }
      const bytes = Buffer.alloc(size - start);
      await handle.read(bytes, 0, bytes.length, start);
      chat.fold.add(name, bytes);
      return "grew";
    } finally {
      await handle.close();
    }
  });
  chat.catchingUp.set(name, next.catch(noop));
  return next;
}

/** Reads the file into the fold from where the fold stopped, when its writes reach past that. */
async function caughtUp(
  chat: OpenChat,
  file: FileState<unknown>,
): Promise<void> {
  const { name } = file;
  if (name === undefined || chat.fold.cursor(name).offset >= file.end) {
    return;
  }
  const previous = chat.catchingUp.get(name) ?? Promise.resolve();
  const next = previous.then(async () => {
    const start = chat.fold.cursor(name).offset;
    const handle = await fs.open(path.join(chat.dir, name), "r");
    try {
      const { size } = await handle.stat();
      if (size <= start) {
        return;
      }
      const bytes = Buffer.alloc(size - start);
      await handle.read(bytes, 0, bytes.length, start);
      // A write folded while this read may have moved the fold on.
      const now = chat.fold.cursor(name).offset;
      if (now < size) {
        chat.fold.add(name, bytes.subarray(now - start));
      }
    } finally {
      await handle.close();
    }
  });
  chat.catchingUp.set(name, next.catch(noop));
  await next;
}

async function settled(chat: OpenChat): Promise<void> {
  while (chat.writes.size > 0) {
    await Promise.allSettled(chat.writes);
  }
}

async function recordFiles(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir)).filter(
      (name) => parseRecordFileName(name) !== undefined,
    );
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

/** The fold with what is queued over it, sessions only queued so far included. */
function withPending(
  chat: FoldedChat,
  pending: ReadonlyMap<StoreId.Session, PendingSession>,
  chatId: ChatId,
  device: DeviceId,
): FoldedChat {
  if (pending.size === 0) {
    return chat;
  }
  const sessions = new Map(
    chat.sessions.map((session) => [session.id, session]),
  );
  for (const [sessionId, queued] of pending) {
    const base =
      sessions.get(sessionId) ??
      (queued.header && startedSession(chatId, queued.header.value));
    if (base) {
      sessions.set(sessionId, overlaid(base, queued, device));
    }
  }
  return {
    sessions: [...sessions.values()].toSorted((a, b) => byId(a.id, b.id)),
  };
}

function startedSession(
  chatId: ChatId,
  {
    app,
    at,
    createdAt,
    forkedAt,
    handle,
    id,
    parent,
    startedAs,
  }: SessionStart & {
    app: string;
    at: Date;
  },
): FoldedSession {
  return {
    app,
    chat: chatId,
    createdAt,
    forked: false,
    ...(forkedAt !== undefined && { forkedAt }),
    ...(handle !== undefined && { handle }),
    id,
    messages: [],
    ...(parent !== undefined && { parent }),
    settings: {},
    ...(startedAs !== undefined && { startedAs }),
    updatedAt: at,
    writtenBy: new Map(),
  };
}

function overlaid(
  session: FoldedSession,
  queued: PendingSession,
  device: DeviceId,
): FoldedSession {
  const messages = new Map(
    session.messages.map((message) => [message.id, message]),
  );
  const writtenBy = new Map(session.writtenBy);
  for (const { value } of queued.messages.values()) {
    messages.set(value.id, {
      ...value,
      parts: messages.get(value.id)?.parts ?? [],
    });
    writtenBy.set(value.id, device);
  }
  const partsByMessage = new Map<StoreId.Message, SessionMessagePart.Type[]>();
  for (const { value } of queued.parts.values()) {
    const list = partsByMessage.get(value.metadata.messageId) ?? [];
    list.push(value);
    partsByMessage.set(value.metadata.messageId, list);
  }
  for (const [messageId, parts] of partsByMessage) {
    const message = messages.get(messageId);
    if (!message) {
      continue;
    }
    const merged = new Map(
      message.parts.map((part) => [part.metadata.id, part]),
    );
    for (const part of parts) {
      merged.set(part.metadata.id, part);
      writtenBy.set(part.metadata.id, device);
    }
    messages.set(messageId, {
      ...message,
      parts: [...merged.values()].toSorted((a, b) =>
        byId(a.metadata.id, b.metadata.id),
      ),
    });
  }
  for (const id of queued.retracted.keys()) {
    for (const part of messages.get(id)?.parts ?? []) {
      writtenBy.delete(part.metadata.id);
    }
    messages.delete(id);
    writtenBy.delete(id);
  }
  let settings = session.settings;
  for (const { value } of queued.settings.values()) {
    settings = withSetting(settings, value);
  }
  return {
    ...session,
    settings,
    messages: [...messages.values()].toSorted((a, b) => byId(a.id, b.id)),
    ...(queued.rollover && { rollover: queued.rollover.value }),
    ...(queued.sites && { sites: queued.sites.value }),
    ...(queued.stopped && { stopped: queued.stopped.value }),
    ...cardsOverlaid(session, queued),
    updatedAt: new Date(Math.max(session.updatedAt.getTime(), queued.at)),
    writtenBy,
  };
}

/** A session's cards and answers with this device's queued ones over them. */
function cardsOverlaid(
  session: FoldedSession,
  queued: PendingSession,
): Pick<FoldedSession, "answers" | "cards"> {
  if (queued.cards.size === 0 && queued.answers.size === 0) {
    return {};
  }
  const cards = new Map((session.cards ?? []).map((card) => [card.id, card]));
  for (const { value } of queued.cards.values()) {
    cards.set(value.id, value);
  }
  return {
    answers: [...(session.answers ?? []), ...queued.answers.values()],
    cards: [...cards.values()],
  };
}

function withSetting(
  settings: FoldedSettings,
  setting: Unsequenced<SettingRecord>,
): FoldedSettings {
  switch (setting.field) {
    case "archived":
      return { ...settings, archived: setting };
    case "model":
      return { ...settings, model: setting };
    case "starred":
      return { ...settings, starred: setting };
    case "title":
      return { ...settings, title: setting };
    case "topic":
      return { ...settings, topic: setting };
    case "unread":
      return { ...settings, unread: setting };
  }
}

function byId(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}
