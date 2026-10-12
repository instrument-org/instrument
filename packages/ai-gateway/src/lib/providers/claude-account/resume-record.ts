import { createHash } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
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
  seen: z.array(z.string()),
});

export type ResumeRecord = z.output<typeof ResumeRecordSchema>;

/**
 * The working folder every process runs in. Claude Code files a session's
 * transcript under it, so it has to stay the same for a resume to find one.
 */
export const SESSION_CWD = homedir();

function configRoot(configDir: string | undefined) {
  return configDir ?? join(homedir(), ".claude");
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
async function transcriptExists(
  configDir: string | undefined,
  claudeSessionId: string,
) {
  const project = SESSION_CWD.replaceAll(/[^a-zA-Z0-9]/g, "-");
  if (project.length > 200) {
    return true;
  }
  const file = join(
    configRoot(configDir),
    "projects",
    project,
    `${claudeSessionId}.jsonl`,
  );
  return access(file).then(
    () => true,
    () => false,
  );
}

/** The slot's record, when it has one whose transcript is still there. */
export async function readResumeRecord(
  configDir: string | undefined,
  slot: string,
): Promise<ResumeRecord | undefined> {
  const text = await readFile(recordPath(configDir, slot), "utf8").catch(
    () => undefined,
  );
  if (text === undefined) {
    return undefined;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  const parsed = ResumeRecordSchema.safeParse(json);
  if (!parsed.success) {
    return undefined;
  }
  return (await transcriptExists(configDir, parsed.data.claudeSessionId))
    ? parsed.data
    : undefined;
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
