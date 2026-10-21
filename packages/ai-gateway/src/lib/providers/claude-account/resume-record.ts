import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { z } from "zod";

/**
 * What a Claude Code session that outlives its process last saw of ours, so
 * a later request can resume it instead of replaying our transcript into a
 * new one. Kept beside Claude Code's own transcripts, one file per slot.
 */
const ResumeRecordSchema = z.object({
  awaitingToolCallIds: z.array(z.string()),
  claudeSessionId: z.string(),
  /**
   * The transcript entry that ends the last step's input, just before its
   * reply: where a task forked from this session at that step branches off.
   */
  forkPoint: z.string().optional(),
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
});

/**
 * Whether a Claude Code transcript reads as a conversation this build
 * understands: every line JSON, every user and assistant entry a message
 * with content, and at least one of them. A reply is not required: a task
 * forks its chat's transcript at the input of a step still running. A
 * transcript in a shape it does not know (a newer Claude Code's, or a
 * damaged one) can resume as an empty conversation without a word from
 * Claude Code, so it is refused here and the session starts over from our
 * own records instead.
 */
async function transcriptLooksResumable(file: string) {
  const text = await readFile(file, "utf8").catch(() => undefined);
  if (text === undefined) {
    return false;
  }
  let messages = 0;
  for (const line of text.split("\n")) {
    if (line.length === 0) {
      continue;
    }
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      return false;
    }
    const type: unknown =
      typeof entry === "object" && entry !== null
        ? Reflect.get(entry, "type")
        : undefined;
    if (type !== "user" && type !== "assistant") {
      continue;
    }
    if (!MessageEntrySchema.safeParse(entry).success) {
      return false;
    }
    messages += 1;
  }
  return messages > 0;
}

/** A slot's record, or why it has none to resume. */
export type RecordRead = { missing: string } | { record: ResumeRecord };

/**
 * The slot's record, when it has one whose transcript is still there and
 * still reads as the conversation it was, or why it has none.
 */
export async function readResumeRecord(
  configDir: string | undefined,
  slot: string,
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
  const file = transcriptPath(configDir, parsed.data.claudeSessionId);
  if (file !== undefined && !(await transcriptLooksResumable(file))) {
    return {
      missing: `transcript ${parsed.data.claudeSessionId} missing or not a conversation this build reads`,
    };
  }
  return { record: parsed.data };
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
 * Forgets the slot's record. Done as a step starts, since the transcript
 * moves past what the record says the moment the step's input is sent, and
 * a process that dies mid-step must not be resumed as if it had not.
 */
export async function removeResumeRecord(
  configDir: string | undefined,
  slot: string,
) {
  await rm(recordPath(configDir, slot), { force: true });
}
