import { type Session } from "../../schemas/session";
import { type SessionMessage } from "../../schemas/session/message";
import { type Stopper, StopperSchema } from "../../schemas/stop-notice";
import { type SessionMessagePart } from "../../schemas/session/message-part";
import { type StoreId } from "../../schemas/store-id";
import { type DeviceId, DeviceIdSchema } from "./device-id";
import {
  logFileName,
  logStem,
  settingsFileName,
  parseRecordFileName,
} from "./file-names";
import { ChatFold } from "./fold";
import {
  type LogRecord,
  type SettingRecord,
  parseLogLine,
  parseSettingLine,
  RECORD_FORMAT,
  recordLine,
  type SessionHeader,
} from "./record";
import { type Unsequenced } from "./record-writer";
import { type Random } from "./seeded-random";
import {
  assistantMessage,
  at,
  CHAT,
  messageId,
  partId,
  sessionId,
  textPart,
  toolPart,
  userMessage,
} from "./test-records";

/**
 * A sync engine for the records tests. Devices write their own logs and
 * settings files the way the app does, and carry a session on from one another as
 * far as they have received each other's files; the sync service between
 * them delivers files late, cut off mid-line, or not at all. Then
 * `planDeliveries` hands the finished files to one more device the way a
 * sync engine might: out of order, in pieces, again, as conflict copies,
 * or evicted to a placeholder for a while.
 *
 * Alongside the files it keeps what was written, without folding it, so a
 * fold can be checked against it: the last snapshot of everything, and
 * which records each writer had read, which says whether two devices
 * really carried a session on side by side.
 */

/** What was written to a session, as the generator wrote it. */
export interface SessionModel {
  /** Every record after a header: its log, and what its writer had read when it wrote it. */
  events: { id: string; known: ReadonlySet<string>; stem: string }[];
  forkedAt?: StoreId.Message;
  messages: Map<string, SessionMessage.Type>;
  parent?: StoreId.Session;
  parts: Map<string, SessionMessagePart.Type>;
  retracted: Set<string>;
  rollover?: {
    after: StoreId.Message;
    usableTokens?: number;
    windows?: Session.RolloverWindows;
  };
  sites?: string[];
  stopped?: { at: Date; by: Stopper };
  /** Newest `at` of any record in the session's logs. */
  updatedAt: number;
}

export interface SimulatedChat {
  /** Every device's own files, finished. */
  files: Map<string, Uint8Array>;
  /** Every setting any device wrote, as it reads back. */
  settings: SettingRecord[];
  sessions: Map<StoreId.Session, SessionModel>;
}

/** Whether two records of the session were written with neither writer having read the other. */
export function reallyForked(model: SessionModel): boolean {
  return model.events.some((a) =>
    model.events.some(
      (b) => a.stem < b.stem && !a.known.has(b.id) && !b.known.has(a.id),
    ),
  );
}

interface OwnLog {
  generation: number;
  header: SessionHeader;
  lastSeq: number;
  name: string;
}

class Device {
  readonly files = new Map<string, Uint8Array>();
  readonly id: DeviceId;
  /**
   * By session, every record of it this device has read or written, and
   * what those records' writers had read of it.
   */
  readonly known = new Map<string, Set<string>>();
  readonly logs = new Map<string, OwnLog>();
  settingsSeq = -1;
  readonly own = new Set<string>();
  readonly skew: number;

  constructor(id: DeviceId, skew: number) {
    this.id = id;
    this.skew = skew;
  }

  knownOf(session: string): Set<string> {
    const known = this.known.get(session) ?? new Set();
    this.known.set(session, known);
    return known;
  }

  fold(): ChatFold {
    const fold = new ChatFold();
    for (const [name, bytes] of this.files) {
      fold.add(name, bytes);
    }
    return fold;
  }

  append(name: string, line: string): number {
    const bytes = this.files.get(name) ?? new Uint8Array();
    // The writer's newline repair after a line a crash cut short.
    const repair = bytes.length > 0 && bytes.at(-1) !== 0x0a ? "\n" : "";
    const grown = Buffer.concat([bytes, Buffer.from(repair + line)]);
    this.files.set(name, grown);
    this.own.add(name);
    return grown.length;
  }
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** How many things the devices do between them in one simulated chat. */
const STEPS = 40;

export function simulateChat(random: Random): SimulatedChat {
  const devices: Device[] = [];
  const deviceCount = random.int(2, 3);
  while (devices.length < deviceCount) {
    const id = DeviceIdSchema.parse(
      `dev_${Array.from({ length: 8 }, () => CROCKFORD.charAt(random.int(0, 31))).join("")}`,
    );
    if (!devices.some((device) => device.id === id)) {
      devices.push(new Device(id, random.int(-30, 30)));
    }
  }
  const sessions = new Map<StoreId.Session, SessionModel>();
  const settings: SettingRecord[] = [];
  /** Where each record's line ends in its file, to tell what a cut-off copy holds. */
  const lineEnds = new Map<
    string,
    { end: number; event: string; session: StoreId.Session }[]
  >();
  const knownBy = new Map<string, ReadonlySet<string>>();
  let tick = 0;
  let ids = 0;
  const nextId = () => (ids += 1);
  const clock = (device: Device) => at(tick + device.skew);

  const newSession = (fields: Partial<SessionModel> = {}): StoreId.Session => {
    const id = sessionId(nextId());
    sessions.set(id, {
      events: [],
      messages: new Map(),
      parts: new Map(),
      retracted: new Set(),
      updatedAt: 0,
      ...fields,
    });
    return id;
  };

  /** The device's log of the session, started anew when it has read more of others' than its header says. */
  const logFor = (device: Device, session: StoreId.Session): OwnLog => {
    const continues = device.fold().continuesFor(session);
    const current = device.logs.get(session);
    const readMore = Object.entries(continues).some(
      ([stem, seq]) =>
        !stem.startsWith(device.id) &&
        seq > (current?.header.continues?.[stem] ?? -1),
    );
    if (current && !readMore) {
      return current;
    }
    const model = sessions.get(session);
    const generation = (current?.generation ?? 0) + 1;
    const header: SessionHeader = {
      t: "session",
      seq: 0,
      at: clock(device),
      format: RECORD_FORMAT,
      id: session,
      chat: CHAT,
      createdAt: at(0),
      device: device.id,
      app: "fake-sync",
      ...(model?.parent === undefined
        ? {}
        : { handle: "t1", parent: model.parent }),
      ...(model?.forkedAt === undefined ? {} : { forkedAt: model.forkedAt }),
      ...(Object.keys(continues).length > 0 && { continues }),
    };
    const log = {
      generation,
      header,
      lastSeq: 0,
      name: logFileName(session, device.id, generation),
    };
    device.append(log.name, recordLine(header));
    noteAt(session, header.at);
    device.logs.set(session, log);
    return log;
  };

  const noteAt = (session: StoreId.Session, when: Date) => {
    const model = sessions.get(session);
    if (model) {
      model.updatedAt = Math.max(model.updatedAt, when.getTime());
    }
  };

  const write = (
    device: Device,
    session: StoreId.Session,
    records: Unsequenced<Exclude<LogRecord, SessionHeader>>[],
  ) => {
    const log = logFor(device, session);
    const model = sessions.get(session);
    for (const record of records) {
      log.lastSeq += 1;
      const line = recordLine({ ...record, seq: log.lastSeq });
      const end = device.append(log.name, line);
      const event = `${log.name}#${log.lastSeq}`;
      const known = new Set(device.knownOf(session));
      knownBy.set(event, known);
      device.knownOf(session).add(event);
      lineEnds.set(log.name, [
        ...(lineEnds.get(log.name) ?? []),
        { end, event, session },
      ]);
      const parsed = parseLogLine(line);
      if (!model || !parsed) {
        throw new Error(
          `The simulation wrote a record that does not read: ${line}`,
        );
      }
      model.events.push({
        id: event,
        known,
        stem: logStem(device.id, log.generation),
      });
      apply(model, parsed);
    }
  };

  /** The other device's files, all of them or as far as the sync service got. */
  const receive = (to: Device, from: Device, whole: boolean) => {
    for (const name of from.own) {
      const full = from.files.get(name) ?? new Uint8Array();
      const had = to.files.get(name)?.length ?? 0;
      const size = Math.max(
        had,
        whole || random.chance(0.6)
          ? full.length
          : random.int(had, full.length),
      );
      to.files.set(name, full.subarray(0, size));
      for (const { end, event, session } of lineEnds.get(name) ?? []) {
        if (end <= size) {
          const known = to.knownOf(session);
          known.add(event);
          for (const earlier of knownBy.get(event) ?? []) {
            known.add(earlier);
          }
        }
      }
    }
  };

  const chatSession = newSession();
  const first = devices[0];
  if (!first) {
    throw new Error("No devices");
  }
  write(first, chatSession, turn(first, chatSession));

  for (; tick < STEPS; tick++) {
    const device = random.pick(devices);
    // Mostly a device has everything the others wrote by the time it is
    // used; otherwise it works from whatever has arrived.
    if (random.chance(0.6)) {
      for (const other of devices) {
        if (other !== device) {
          receive(device, other, true);
        }
      }
    }
    const fold = device.fold();
    const chat = fold.chat();
    const known = chat.sessions.filter(({ id }) => sessions.has(id));
    const action = random.int(0, 99);
    const target = known.length > 0 ? random.pick(known) : undefined;
    if (action < 30 && target) {
      write(device, target.id, turn(device, target.id));
    } else if (action < 45 && target) {
      write(device, target.id, [change(device, target)]);
    } else if (action < 55 && target) {
      const setting = settingFor(device, target.id);
      device.settingsSeq += 1;
      const line = recordLine({ ...setting, seq: device.settingsSeq });
      device.append(settingsFileName(device.id), line);
      const parsed = parseSettingLine(line);
      if (parsed) {
        settings.push(parsed);
      }
    } else if (action < 85) {
      const from = random.pick(devices.filter((other) => other !== device));
      receive(device, from, false);
    } else if (action < 90 && target) {
      const log = device.logs.get(target.id);
      const [torn] = turn(device, target.id);
      if (log && torn) {
        // A crash in the middle of a write leaves the start of a line, and
        // the seq it would have had stays taken.
        log.lastSeq += 1;
        const line = recordLine({ ...torn, seq: log.lastSeq });
        device.append(log.name, line.slice(0, random.int(1, line.length - 2)));
      }
    } else if (action < 95 && target && sessions.size < 3 && !target.parent) {
      const forkedAt = target.messages.at(-1)?.id;
      if (forkedAt) {
        const task = newSession({ forkedAt, parent: target.id });
        write(device, task, turn(device, task));
      }
    }
  }

  const files = new Map<string, Uint8Array>();
  for (const device of devices) {
    for (const name of device.own) {
      files.set(name, device.files.get(name) ?? new Uint8Array());
    }
  }
  return { files, sessions, settings };

  function turn(
    device: Device,
    session: StoreId.Session,
  ): Unsequenced<Exclude<LogRecord, SessionHeader>>[] {
    const when = clock(device);
    const message = messageId(nextId());
    if (random.chance(0.5)) {
      return [
        {
          t: "message",
          at: when,
          message: userMessage(session, message, when),
        },
        {
          t: "part",
          at: when,
          part: textPart(
            session,
            message,
            partId(nextId()),
            `asked at ${tick}`,
            when,
          ),
        },
      ];
    }
    const call = partId(nextId());
    return [
      {
        t: "message",
        at: when,
        message: assistantMessage(session, message, when, {
          finishReason: "tool-calls",
        }),
      },
      {
        t: "part",
        at: when,
        part: toolPart({
          createdAt: when,
          id: call,
          message,
          session,
          state: "input-available",
        }),
      },
      {
        t: "part",
        at: when,
        part: toolPart({
          createdAt: when,
          id: call,
          message,
          more: { endedAt: when, output: { stdout: `${tick}\n` } },
          session,
          state: "output-available",
        }),
      },
    ];
  }

  function change(
    device: Device,
    session: ReturnType<ChatFold["chat"]>["sessions"][number],
  ): Unsequenced<Exclude<LogRecord, SessionHeader>> {
    const when = clock(device);
    const message =
      session.messages.length > 0 ? random.pick(session.messages) : undefined;
    const part =
      message && message.parts.length > 0
        ? random.pick(message.parts)
        : undefined;
    switch (random.int(0, 5)) {
      case 0:
        if (part?.type === "text") {
          return {
            t: "part",
            at: when,
            part: { ...part, text: `${part.text}, edited at ${tick}` },
          };
        }
        if (message?.role === "assistant") {
          const { parts: _parts, ...stored } = message;
          return {
            t: "message",
            at: when,
            message: {
              ...stored,
              metadata: {
                ...stored.metadata,
                finishedAt: when,
                finishReason: "stop",
              },
            },
          };
        }
        break;
      case 1:
        if (message) {
          return {
            t: "retract",
            at: when,
            messages: [message.id],
          };
        }
        break;
      case 2:
        if (message) {
          return {
            t: "rollover",
            at: when,
            after: message.id,
            usableTokens: random.int(1, 9) * 1000,
          };
        }
        break;
      case 3:
        return {
          t: "stop",
          at: when,
          by: random.pick(StopperSchema.options),
        };
      default:
        break;
    }
    return {
      t: "sites",
      at: when,
      visited: random.chance(0.2) ? [] : [`site-${tick}.example`],
    };
  }

  function settingFor(
    device: Device,
    session: StoreId.Session,
  ): Unsequenced<SettingRecord> {
    // Some settings share one moment across devices, so ties are broken.
    const when = random.chance(0.3) ? at(1000) : clock(device);
    const base = { t: "set", at: when, session, device: device.id } as const;
    switch (random.int(0, 4)) {
      case 0:
        return {
          ...base,
          field: "title",
          value: { auto: random.chance(0.5), text: `Title ${tick}` },
        };
      case 1:
        return { ...base, field: "starred", value: random.chance(0.5) };
      case 2:
        return {
          ...base,
          field: "unread",
          value: random.chance(0.5)
            ? null
            : random.chance(0.5)
              ? "marked"
              : "new",
        };
      case 3:
        return {
          ...base,
          field: "topic",
          value: random.chance(0.5) ? null : "work",
        };
      default:
        return {
          ...base,
          field: "model",
          value: random.pick([
            "openai/gpt-6.1-sol?provider=chatgpt-account&providerConfigId=a",
            "anthropic/claude-opus-5.5?provider=openrouter&providerConfigId=b",
          ]),
        };
    }
  }

  function apply(model: SessionModel, record: LogRecord) {
    model.updatedAt = Math.max(model.updatedAt, record.at.getTime());
    switch (record.t) {
      case "session":
        break;
      case "message":
        model.messages.set(record.message.id, record.message);
        break;
      case "part":
        model.parts.set(record.part.metadata.id, record.part);
        break;
      case "retract":
        for (const id of record.messages) {
          model.retracted.add(id);
        }
        break;
      case "rollover":
        model.rollover = {
          after: record.after,
          ...(record.usableTokens === undefined
            ? {}
            : { usableTokens: record.usableTokens }),
          ...(record.windows === undefined ? {} : { windows: record.windows }),
        };
        break;
      case "stop":
        model.stopped = { at: record.at, by: record.by };
        break;
      case "sites":
        model.sites = record.visited;
        break;
      // The fake devices raise no cards.
      case "card":
      case "answer":
        break;
    }
  }
}

/** One change to the folder a sync engine keeps on the device that reads the chat. */
export type Delivery =
  /** The file as far as `size`, which may end mid-line. */
  | { kind: "grow"; name: string; size: number }
  /** A conflict copy of the file as far as `size`. */
  | { copy: string; kind: "copy"; name: string; size: number }
  /** The file evicted to a placeholder, which reads as missing until it grows again. */
  | { kind: "evict"; name: string }
  /** The same bytes delivered again. */
  | { kind: "again"; name: string };

const COPY_SUFFIXES = [
  (n: number) => ` ${n + 1}`,
  (n: number) => ` (Jeremy's conflicted copy 2026-10-${10 + n})`,
  (n: number) => `-DEVICE-${n}`,
  (n: number) => `.sync-conflict-20261014-12000${n}-ABCD123`,
];

/**
 * Every file delivered in full in the end, by way of pieces, repeats,
 * conflict copies and evictions, and in an order that interleaves files.
 */
export function planDeliveries(
  random: Random,
  files: Map<string, Uint8Array>,
): Delivery[] {
  const perFile = [...files].map(([name, bytes]) => {
    const sizes = Array.from({ length: random.int(0, 3) }, () =>
      random.int(0, bytes.length),
    ).toSorted((a, b) => a - b);
    const plan: Delivery[] = [];
    let copies = 0;
    for (const size of [...sizes, bytes.length]) {
      if (random.chance(0.1)) {
        plan.push({ kind: "evict", name });
      }
      plan.push({ kind: "grow", name, size });
      if (random.chance(0.1)) {
        plan.push({ kind: "again", name });
      }
      if (random.chance(0.15)) {
        const suffix = random.pick(COPY_SUFFIXES)(copies);
        copies += 1;
        plan.push({
          copy: name.replace(/\.jsonl$/, `${suffix}.jsonl`),
          kind: "copy",
          name,
          size: random.int(0, bytes.length),
        });
      }
    }
    return plan;
  });
  const deliveries: Delivery[] = [];
  for (;;) {
    const waiting = perFile.filter((plan) => plan.length > 0);
    if (waiting.length === 0) {
      return deliveries;
    }
    const next = random.pick(waiting).shift();
    if (next) {
      deliveries.push(next);
    }
  }
}

/**
 * The files a folder holds, each cut back to its last whole line, under the
 * name of the file it is a copy of: what a fold of the folder should read.
 */
export function wholeLines(
  truth: Map<string, Uint8Array>,
  folder: Iterable<[string, Uint8Array]>,
): { bytes: Uint8Array; name: string }[] {
  const lengths = new Map<string, number>();
  for (const [name, bytes] of folder) {
    const parsed = parseRecordFileName(name);
    if (!parsed) {
      continue;
    }
    const original =
      parsed.kind === "log"
        ? logFileName(parsed.session, parsed.device, parsed.generation)
        : settingsFileName(parsed.device);
    const whole = bytes.lastIndexOf(0x0a) + 1;
    lengths.set(original, Math.max(lengths.get(original) ?? 0, whole));
  }
  return [...lengths].map(([name, length]) => ({
    bytes: (truth.get(name) ?? new Uint8Array()).subarray(0, length),
    name,
  }));
}
