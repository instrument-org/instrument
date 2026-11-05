import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { type SessionMessagePart } from "../../schemas/session/message-part";
import { StoreId } from "../../schemas/store-id";
import { type ChatId } from "../../schemas/chat-id";
import { ChatWrites } from "../chat-writes";
import { getWorkspaceConfig } from "../workspace-config";
import { type FileTouch } from "./file-changes";

type StepFacts = SessionMessageDataPart.StepFactsDataPart;
type AppRow = StepFacts["apps"][number];

/** How often a running call's facts are sent on, however fast its script goes. */
const WRITE_EVERY_MS = 250;
/** Rows one call keeps; a pathological script's further ones are dropped. */
const MAX_APP_ROWS = 32;

/**
 * Fewer changed files than this are a script and its notes, not the work a
 * `counts` label is about.
 */
const MIN_FILES_COUNTED = 5;

/** A label's last word when what it counts is reading. */
const READ_WORDS =
  /\b(?:checked|fetched|found|listed|loaded|looked|read|reviewed|scanned|searched)$/i;

interface Ledger {
  apps: Map<string, AppRow>;
  chatId: ChatId;
  createdAt: Date;
  files: FileTouch[];
  hosts: Set<string>;
  label: string | undefined;
  messageId: StoreId.Message;
  moreFiles: number | undefined;
  partId: StoreId.Part;
  sessionId: StoreId.Session;
  step: StoreId.Part;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/**
 * Keyed by the shell call's part, which every capability call it makes already
 * knows, so a script's calls count from any process and after the call has
 * moved to the background.
 */
const ledgers = new Map<StoreId.Part, Ledger>();

/** Starts keeping what a shell call does. */
export function openStepFacts({
  chatId,
  label,
  messageId,
  sessionId,
  step,
}: {
  chatId: ChatId;
  /** What the agent said each thing it works through counts as, for `counts`. */
  label: string | undefined;
  messageId: StoreId.Message;
  sessionId: StoreId.Session;
  step: StoreId.Part;
}): void {
  ledgers.set(step, {
    apps: new Map(),
    chatId,
    createdAt: new Date(),
    files: [],
    hosts: new Set(),
    label: label?.trim() || undefined,
    messageId,
    moreFiles: undefined,
    partId: StoreId.newPartId(),
    sessionId,
    step,
    timer: undefined,
  });
}

export function recordAppCall(
  step: StoreId.Part,
  {
    app,
    failed,
    ms,
    tool,
  }: { app: string; failed: boolean; ms: number; tool: string },
): void {
  const ledger = ledgers.get(step);
  if (!ledger) {
    return;
  }
  const key = `${app}\0${tool}`;
  const row = ledger.apps.get(key);
  if (row) {
    row.calls += 1;
    row.failed += failed ? 1 : 0;
    row.ms += ms;
  } else if (ledger.apps.size < MAX_APP_ROWS) {
    ledger.apps.set(key, { app, calls: 1, failed: failed ? 1 : 0, ms, tool });
  }
  soon(ledger);
}

/** The pages each session's tabs were last seen on. */
const pagesSeen = new Map<StoreId.Session, Set<string>>();

/**
 * The sites a call's browser commands reached: the pages among its session's
 * tabs that this call moved to. A task holding eight tabs is not on all eight
 * sites at every step.
 */
export function recordStepPages(
  step: StoreId.Part,
  sessionId: StoreId.Session,
  urls: readonly string[],
) {
  const seen = pagesSeen.get(sessionId) ?? new Set<string>();
  pagesSeen.set(sessionId, new Set(urls));
  const ledger = ledgers.get(step);
  if (!ledger) {
    return;
  }
  const before = ledger.hosts.size;
  for (const url of urls) {
    const host = seen.has(url) ? undefined : hostOf(url);
    if (host) {
      ledger.hosts.add(host);
    }
  }
  if (ledger.hosts.size !== before) {
    soon(ledger);
  }
}

function hostOf(url: string): string | undefined {
  try {
    const { hostname, protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:"
      ? hostname.replace(/^www\./, "")
      : undefined;
  } catch {
    return undefined;
  }
}

/** Ends what a call's facts can still gain, and writes them. */
export function settleStepFacts(
  step: StoreId.Part,
  {
    files,
    moreFiles,
  }: { files?: readonly FileTouch[]; moreFiles?: number } = {},
): void {
  const ledger = ledgers.get(step);
  if (!ledger) {
    return;
  }
  clearTimeout(ledger.timer);
  ledgers.delete(step);
  ledger.files = [...(files ?? [])];
  ledger.moreFiles = moreFiles;
  write(ledger, true);
}

/** Lets go of a call's facts with nothing written, for a call that never ran. */
export function dropStepFacts(step: StoreId.Part): void {
  const ledger = ledgers.get(step);
  if (ledger) {
    clearTimeout(ledger.timer);
    ledgers.delete(step);
  }
}

function soon(ledger: Ledger) {
  ledger.timer ??= setTimeout(() => {
    ledger.timer = undefined;
    if (ledgers.get(ledger.step) === ledger) {
      write(ledger, false);
    }
  }, WRITE_EVERY_MS);
  ledger.timer.unref();
}

function write(ledger: Ledger, settled: boolean) {
  const apps = [...ledger.apps.values()].map((row) => ({ ...row }));
  const hosts = [...ledger.hosts];
  const counts = countedAs(ledger.label, apps, ledger.files);
  // Most shell calls did nothing to report, and write no record to say so.
  if (
    apps.length === 0 &&
    hosts.length === 0 &&
    counts.length === 0 &&
    ledger.files.length === 0
  ) {
    return;
  }
  const part: SessionMessagePart.DataPart = {
    data: {
      apps,
      counts,
      files: ledger.files,
      hosts,
      ...(ledger.moreFiles !== undefined && { moreFiles: ledger.moreFiles }),
      settled,
      step: ledger.step,
    },
    metadata: {
      createdAt: ledger.createdAt,
      id: ledger.partId,
      messageId: ledger.messageId,
      sessionId: ledger.sessionId,
    },
    type: "data-stepFacts",
  };
  void ChatWrites.savePart(part, ledger.chatId).match(
    () => undefined,
    (error) => {
      getWorkspaceConfig().captureException(error);
    },
  );
}

const readOnlyTools = new Map<string, Set<string>>();

/** Whether an app's tools still need listing for which of them only read. */
export function knowsReadOnlyTools(app: string): boolean {
  return readOnlyTools.has(app);
}

export function noteReadOnlyTools(app: string, tools: readonly string[]): void {
  readOnlyTools.set(app, new Set(tools));
}

/** Whether a call only read: a server's own mark, or a GET. */
function onlyReads({ app, tool }: { app: string; tool: string }): boolean {
  return tool === "GET" || (readOnlyTools.get(app)?.has(tool) ?? false);
}

/**
 * What a call's `counts` label comes to, from what it really did. The number
 * is never the agent's. It draws only where one tool's calls can stand for
 * the label: the one tool that changes something, the busiest read for a
 * label about reading, or with no app call the files it changed. A label
 * nothing backs draws nothing.
 */
export function countedAs(
  label: string | undefined,
  apps: readonly AppRow[],
  files: readonly FileTouch[],
): StepFacts["counts"] {
  if (label === undefined) {
    return [];
  }
  const done = (rows: readonly AppRow[]) =>
    Math.max(0, ...rows.map((row) => row.calls - row.failed));
  const writes = apps.filter((row) => !onlyReads(row));
  const changed = files.filter((file) => file.change !== "read").length;
  let count = 0;
  if (writes.length === 1) {
    count = done(writes);
  } else if (writes.length === 0 && apps.length > 0) {
    count = READ_WORDS.test(label) ? done(apps) : 0;
  } else if (apps.length === 0 && changed >= MIN_FILES_COUNTED) {
    count = changed;
  }
  return count > 0 ? [{ count, label }] : [];
}

/** Which app call a capability's input is, for the two that reach an app. */
export function appCallOf(
  capability: string,
  input: Readonly<Record<string, unknown>>,
): undefined | { app: string; tool: string } {
  const { app, method, tool } = input;
  if (typeof app !== "string") {
    return undefined;
  }
  if (capability === "apps.call" && typeof tool === "string") {
    return { app, tool };
  }
  if (capability === "apps.request" && typeof method === "string") {
    return { app, tool: method };
  }
  return undefined;
}
