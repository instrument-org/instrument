import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  readResumeRecord,
  removeResumeRecord,
  SESSION_CWD,
  writeResumeRecord,
} from "./resume-record";

const record = {
  awaitingToolCallIds: [],
  claudeSessionId: "5f0c6c2e-8d1b-4f7a-9a51-0f6b2f1c3d4e",
  seen: ["a", "b"],
};

/** A user turn and a reply, as Claude Code writes its entries. */
const CONVERSATION = [
  {
    message: { content: [{ text: "hi", type: "text" }], role: "user" },
    type: "user",
  },
  {
    message: { content: [{ text: "hello", type: "text" }], role: "assistant" },
    type: "assistant",
  },
  { type: "last-prompt" },
];

async function withTranscript(
  configDir: string,
  entries: object[] = CONVERSATION,
) {
  const project = join(
    configDir,
    "projects",
    SESSION_CWD.replaceAll(/[^a-zA-Z0-9]/g, "-"),
  );
  await mkdir(project, { recursive: true });
  await writeFile(
    join(project, `${record.claudeSessionId}.jsonl`),
    entries.map((entry) => `${JSON.stringify(entry)}\n`).join(""),
  );
}

describe("resume records", () => {
  it("reads back what was written while the transcript is there", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "resume-record-"));
    await withTranscript(configDir);
    await writeResumeRecord(configDir, "ses_1:shape", record);

    expect(await readResumeRecord(configDir, "ses_1:shape")).toEqual(record);
    expect(await readResumeRecord(configDir, "ses_2:shape")).toBeUndefined();
  });

  it("has nothing to resume once Claude Code's transcript is gone", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "resume-record-"));
    await writeResumeRecord(configDir, "ses_1:shape", record);

    expect(await readResumeRecord(configDir, "ses_1:shape")).toBeUndefined();
  });

  it("refuses a transcript whose messages it cannot read", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "resume-record-"));
    // As a Claude Code that renamed a field would write it.
    await withTranscript(
      configDir,
      CONVERSATION.map(({ message, ...entry }) => ({ ...entry, msg: message })),
    );
    await writeResumeRecord(configDir, "ses_1:shape", record);

    expect(await readResumeRecord(configDir, "ses_1:shape")).toBeUndefined();
  });

  it("forgets a removed record", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "resume-record-"));
    await withTranscript(configDir);
    await writeResumeRecord(configDir, "ses_1:shape", record);
    await removeResumeRecord(configDir, "ses_1:shape");

    expect(await readResumeRecord(configDir, "ses_1:shape")).toBeUndefined();
  });
});
