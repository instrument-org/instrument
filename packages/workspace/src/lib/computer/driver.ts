import { APP_NAME } from "@instrument-org/shared";
import { execa } from "execa";
import { DefenseInDepthBox } from "just-bash";
import { noop } from "radashi";
import { z } from "zod";

import { type ChatId } from "../../schemas/chat-id";
import { CapabilityFailure } from "../capabilities/define";
import { getWorkspaceConfig } from "../workspace-config";

/** Longest one driver call may run, past the deadlines it was given itself. */
const DRIVER_TIMEOUT_MS = 60_000;

const EnvelopeSchema = z.object({
  data: z.unknown().optional(),
  error: z
    .object({
      code: z.string(),
      details: z.looseObject({ kind: z.string().optional() }).optional(),
      disposition: z
        .object({ delivery: z.string().optional(), retry: z.string() })
        .optional(),
      message: z.string(),
    })
    .optional(),
  ok: z.boolean(),
});

/**
 * What to do about a driver's refusal, in this command's own words. The
 * driver's suggestions name its own commands, which the agent does not have.
 */
const NEXT_STEP: Record<string, string> = {
  ACTION_NOT_SUPPORTED:
    "This element has no route that leaves the person's pointer alone. Look for another control, or ask the person before trying --headed.",
  AMBIGUOUS_TARGET:
    "Identical elements make this ref unsafe. Take a new snapshot, and act on a control that is unique in the window.",
  APP_UNRESPONSIVE: "The app isn't answering. Check its state before retrying.",
  PERM_DENIED:
    "macOS isn't letting Instrument do this. Tell the person they can check it in Settings › Computer Use, and stop.",
  POLICY_DENIED:
    "This takes the person's pointer and focus. Pass --headed only once they've said that's fine.",
  SNAPSHOT_NOT_FOUND: "Take a new snapshot and use its refs.",
  STALE_REF:
    "That element is gone or changed. Take a new snapshot and use its refs.",
  WINDOW_NOT_FOUND:
    "The app has no window to read. Use `instrument computer windows` to see what it has.",
};

/** A refusal as the agent reads it, saying whether the action may have landed. */
function refusalText({
  code,
  disposition,
  message,
}: {
  code: string;
  disposition?: { retry: string };
  message: string;
}): string {
  // The driver's way past this is a flag the agent isn't given.
  if (message.includes("--force")) {
    return "That shortcut is refused here, since it could quit an app or log the person out.";
  }
  const mayHaveLanded =
    disposition !== undefined && disposition.retry !== "safe";
  return [
    message.endsWith(".") ? message : `${message}.`,
    NEXT_STEP[code],
    mayHaveLanded
      ? "It may have landed: read the app's state before doing this again."
      : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(" ");
}

/** What the driver answers, its data on success and its refusal thrown. */
async function execDriver(
  args: readonly string[],
  signal?: AbortSignal,
): Promise<unknown> {
  const host = getWorkspaceConfig().computerUse;
  if (host === undefined) {
    throw new CapabilityFailure(
      "this computer has no driver for its desktop apps.",
    );
  }
  // A command runs while its script does, where just-bash keeps timers from
  // being set; execa's timeout sets one.
  const result = await DefenseInDepthBox.runTrustedAsync(() =>
    execa(host.binaryPath, args, {
      ...(signal === undefined ? {} : { cancelSignal: signal }),
      env: { AGENT_DESKTOP_HOME: host.stateDir() },
      reject: false,
      stdin: "ignore",
      timeout: DRIVER_TIMEOUT_MS,
    }),
  );
  const parsed = EnvelopeSchema.safeParse(parseJson(result.stdout));
  if (!parsed.success) {
    throw new CapabilityFailure(
      result.timedOut
        ? "the driver took too long and was stopped. Check the app's state before retrying."
        : `the driver failed: ${String(result.stderr || result.shortMessage)}`,
    );
  }
  const { data, error, ok } = parsed.data;
  if (!ok) {
    throw new CapabilityFailure(
      refusalText(
        error ?? { code: "UNKNOWN", message: "the driver reported a failure" },
      ),
    );
  }
  return data;
}

const SessionStartedSchema = z.object({ session_id: z.string() });

/** Each chat's driver session this run, which keeps its snapshots apart. */
const sessions = new Map<ChatId, Promise<string>>();

/** Sessions an earlier run left behind are stale past this, in seconds. */
const STALE_SESSION_SECONDS = 3600;

/**
 * A chat's session, started the first time it needs one. A session is what the
 * agent's cursor belongs to, so it gets one of the driver's own rather than a
 * bare name. Traces stay off: they would keep what the windows showed. A run
 * that didn't end its sessions, by crashing, leaves them for the first start of
 * the next to clear away.
 */
function sessionOf(chatId: ChatId, signal?: AbortSignal): Promise<string> {
  const known = sessions.get(chatId);
  if (known !== undefined) {
    return known;
  }
  if (sessions.size === 0) {
    void execDriver([
      "session",
      "gc",
      "--older-than",
      String(STALE_SESSION_SECONDS),
    ]).catch(noop);
  }
  const started = execDriver(
    ["session", "start", "--no-trace", "--name", APP_NAME],
    signal,
  ).then((data) => SessionStartedSchema.parse(data).session_id);
  sessions.set(chatId, started);
  // A later call starts afresh rather than inheriting one failure for good.
  started.catch(() => {
    sessions.delete(chatId);
  });
  return started;
}

/**
 * One driver command for `chatId`, in its session, its data on success and its
 * refusal thrown as a failure. Refused as a whole where the host carries no
 * driver.
 */
export async function runDriver(
  args: readonly string[],
  { chatId, signal }: { chatId: ChatId; signal?: AbortSignal },
): Promise<unknown> {
  const session = await sessionOf(chatId, signal);
  return execDriver([...args, "--session", session], signal);
}

/** The chats whose cursor is already showing. */
const cursorShown = new Set<ChatId>();

/** How long the cursor takes to cross to a target, short to long, in ms. */
const CURSOR_TRAVEL_MS = "30,120";

/**
 * Shows the agent's own cursor from a chat's first action, so the person can
 * see something is at work on their desktop. It draws over the screen and never
 * touches their pointer, and an action goes ahead if it can't be drawn.
 */
export async function showCursor({
  chatId,
  signal,
}: {
  chatId: ChatId;
  signal?: AbortSignal;
}): Promise<void> {
  if (cursorShown.has(chatId)) {
    return;
  }
  cursorShown.add(chatId);
  await runDriver(
    [
      "cursor-overlay",
      "enable",
      "--label",
      APP_NAME,
      "--travel-ms",
      CURSOR_TRAVEL_MS,
    ],
    { chatId, ...(signal === undefined ? {} : { signal }) },
  ).catch(noop);
}

/**
 * Ends this run's sessions as the app quits: the only thing that stops an
 * agent's cursor, whose process outlives the driver call that started it, and
 * what lets the next run clear away the snapshots they kept.
 */
export async function endComputerSessions(): Promise<void> {
  const started = [...sessions.values()];
  sessions.clear();
  cursorShown.clear();
  await Promise.allSettled(
    started.map(async (session) =>
      execDriver(["session", "end", await session]),
    ),
  );
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
