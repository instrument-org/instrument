import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { z } from "zod";

/**
 * The last step of a Claude Code session that finished, so a later request
 * can resume its transcript instead of replaying ours into a new one. Kept
 * beside Claude Code's own transcripts, one file per slot, and written only
 * when a step finishes: a step stopped or failed after it leaves the record
 * naming the step before, and a resume cuts the transcript back to `leaf`,
 * so whatever the stopped step left there is dropped.
 */
const ResumeRecordSchema = z.object({
  /** The tool calls the step ended on, waiting on our loop. */
  awaitingToolCallIds: z.array(z.string()),
  claudeSessionId: z.string(),
  /**
   * The transcript entry that ends the step's input, just before its reply:
   * where a task forked from this session at that step branches off.
   */
  forkPoint: z.string().optional(),
  /** The transcript entry the step's reply ended on. */
  leaf: z.string(),
  /** A fingerprint of each of our messages the step answered, in order. */
  seen: z.array(z.string()),
});

export type ResumeRecord = z.output<typeof ResumeRecordSchema>;

/**
 * The working folder every process runs in. Claude Code files a session's
 * transcript under it, so it has to stay the same for a resume to find one.
 */
export const SESSION_CWD = homedir();

function realCwd() {
  try {
    return realpathSync(SESSION_CWD);
  } catch {
    return SESSION_CWD;
  }
}

/**
 * Claude Code's config folder: the one named, or its default under the
 * user's real home, which is where it looks even when this process runs
 * with another `HOME` (as an eval's sandbox does).
 */
function configRoot(configDir: string | undefined) {
  return configDir ?? join(userInfo().homedir, ".claude");
}

function recordPath(configDir: string | undefined, slot: string) {
  const name = createHash("sha256").update(slot).digest("hex");
  return join(configRoot(configDir), "instrument-sessions", `${name}.json`);
}

/**
 * Where Claude Code keeps a session's transcript: its config folder's
 * `projects/`, under the working folder with every character but letters and
 * digits turned to `-`. Names past 200 characters are hashed in a way the
 * docs do not spell out, so those are not checked.
 */
function transcriptPath(
  configDir: string | undefined,
  claudeSessionId: string,
) {
  // Claude Code names the folder by the working folder's real path, which
  // differs where it runs through a symlink (macOS's /var is /private/var).
  const project = realCwd().replaceAll(/[^a-zA-Z0-9]/g, "-");
  return project.length > 200
    ? undefined
    : join(
        configRoot(configDir),
        "projects",
        project,
        `${claudeSessionId}.jsonl`,
      );
}

/** What a user or assistant entry of Claude Code's transcript must carry. */
const MessageEntrySchema = z.object({
  message: z.object({
    content: z.union([z.string(), z.array(z.object({ type: z.string() }))]),
    role: z.enum(["assistant", "user"]),
  }),
  type: z.enum(["assistant", "user"]),
  uuid: z.string().optional(),
});

/**
 * Why a Claude Code transcript cannot be gone on from at `wanted`, the entry
 * the caller goes on from, or nothing when it can: it has to read as a
 * conversation this build understands (every line JSON, every user and
 * assistant entry a message with content) and hold that entry. A last line
 * with no newline after it is a write a process ended in the middle of,
 * past anything a record names, and is left out. A transcript in a shape it
 * does not know (a newer Claude Code's, or a damaged one) can resume as an
 * empty conversation without a word from Claude Code, so it is refused here
 * and the session starts over from our own records instead.
 */
async function transcriptRefusal(file: string, wanted: string) {
  const text = await readFile(file, "utf8").catch(() => undefined);
  if (text === undefined) {
    return "missing" as const;
  }
  const lines = text.split("\n");
  // Empty when the file ends on a newline, else the unfinished write.
  lines.pop();
  let hasEntry = false;
  for (const line of lines) {
    if (line.length === 0) {
      continue;
    }
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      return "unreadable" as const;
    }
    const type: unknown =
      typeof entry === "object" && entry !== null
        ? Reflect.get(entry, "type")
        : undefined;
    if (type !== "user" && type !== "assistant") {
      continue;
    }
    const parsed = MessageEntrySchema.safeParse(entry);
    if (!parsed.success) {
      return "unreadable" as const;
    }
    hasEntry ||= parsed.data.uuid === wanted;
  }
  return hasEntry ? undefined : ("without the entry" as const);
}

/**
 * How long a read waits for a transcript to take the entry its record
 * names. Claude Code writes a step's entries a moment after it reports
 * them (about 100ms, measured on 2.1.306), so a record written as a step
 * ends can name an entry its transcript does not hold yet.
 */
const ENTRY_WAIT_MS = 1500;

/** A slot's record, or why it has none to resume. */
export type RecordRead = { missing: string } | { record: ResumeRecord };

/**
 * The slot's record, when it has one whose transcript is still there and
 * still reads as the conversation it was, or why it has none. The transcript
 * has to hold the entry the record is read for: its `leaf`, which resuming
 * the slot cuts back to, or for a task branching off, its `forkPoint`.
 */
export async function readResumeRecord(
  configDir: string | undefined,
  slot: string,
  {
    entryWaitMs = ENTRY_WAIT_MS,
    readFor = "resume",
  }: { entryWaitMs?: number; readFor?: "fork" | "resume" } = {},
): Promise<RecordRead> {
  const text = await readFile(recordPath(configDir, slot), "utf8").catch(
    () => undefined,
  );
  if (text === undefined) {
    return { missing: "no resume record" };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { missing: "a resume record that is not JSON" };
  }
  const parsed = ResumeRecordSchema.safeParse(json);
  if (!parsed.success) {
    return { missing: "a resume record in a shape this build does not read" };
  }
  const { claudeSessionId, forkPoint, leaf } = parsed.data;
  const file = transcriptPath(configDir, claudeSessionId);
  if (file === undefined) {
    return { record: parsed.data };
  }
  const entry = readFor === "fork" ? (forkPoint ?? leaf) : leaf;
  const deadline = Date.now() + entryWaitMs;
  let refusal = await transcriptRefusal(file, entry);
  while (refusal === "without the entry" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    refusal = await transcriptRefusal(file, entry);
  }
  switch (refusal) {
    case undefined: {
      return { record: parsed.data };
    }
    case "missing": {
      return { missing: `no transcript ${claudeSessionId}` };
    }
    case "unreadable": {
      return {
        missing: `transcript ${claudeSessionId}, which is not a conversation this build reads`,
      };
    }
    case "without the entry": {
      return {
        missing: `transcript ${claudeSessionId}, without the entry its record names`,
      };
    }
  }
}

export async function writeResumeRecord(
  configDir: string | undefined,
  slot: string,
  record: ResumeRecord,
) {
  const path = recordPath(configDir, slot);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(record));
}

/**
 * Forgets the slot's record. Done as a cold start begins, since the slot goes
 * on in a new transcript and the one the record names no longer matches it.
 */
export async function removeResumeRecord(
  configDir: string | undefined,
  slot: string,
) {
  await rm(recordPath(configDir, slot), { force: true });
}
