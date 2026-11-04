import { execa } from "execa";
import { DefenseInDepthBox } from "just-bash";
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

/**
 * The name a chat's snapshots are kept under, in the only spelling the driver
 * takes: letters, digits, `-` and `_`, up to 64.
 */
function sessionName(chatId: ChatId): string {
  return chatId.replaceAll(/[^\w-]/g, "_").slice(0, 64);
}

/** A refusal as the agent reads it, saying whether the action may have landed. */
export function refusalText({
  code,
  disposition,
  message,
}: {
  code: string;
  disposition?: { retry: string };
  message: string;
}): string {
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

/**
 * One driver command for `chatId`, its data on success and its refusal thrown
 * as a failure. Refused as a whole where the host carries no driver.
 */
export async function runDriver(
  args: readonly string[],
  { chatId, signal }: { chatId: ChatId; signal?: AbortSignal },
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
    execa(host.binaryPath, [...args, "--session", sessionName(chatId)], {
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
        : `the driver failed: ${result.stderr || result.shortMessage}`,
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

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
