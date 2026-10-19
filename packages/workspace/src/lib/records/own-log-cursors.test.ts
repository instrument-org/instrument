import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AbsolutePathSchema } from "../../schemas/paths";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { closeWorkspaceDb } from "../workspace-db";
import { ChatRecords } from "./chat-records";
import { logFileName } from "./file-names";
import {
  CHAT,
  DEVICE_A,
  messageId,
  sessionId,
  userMessage,
} from "./test-records";

const session = sessionId(1);

let root: string;
let previous: ReturnType<typeof getWorkspaceConfig>;

beforeEach(async () => {
  root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "own-log-cursors-")),
  );
  previous = getWorkspaceConfig();
  setWorkspaceConfig({
    ...previous,
    workspaceDbFile: AbsolutePathSchema.parse(
      path.join(root, "machine", "workspace.db"),
    ),
  });
});

afterEach(async () => {
  closeWorkspaceDb();
  setWorkspaceConfig(previous);
  await fs.rm(root, { force: true, recursive: true });
});

/** One launch of this device: the records open, `run`, then quit. */
async function launch(run: (records: ChatRecords) => Promise<void>) {
  const records = new ChatRecords({
    app: "0.0.0-test",
    device: DEVICE_A,
    dirOf: () => path.join(root, "chats", CHAT),
    fsync: false,
  });
  try {
    await run(records);
  } finally {
    await records.dispose();
  }
}

function say(records: ChatRecords, n: number) {
  return records.appendMessage(
    CHAT,
    userMessage(session, messageId(n), new Date(n * 1000)),
  );
}

const log = () =>
  path.join(root, "chats", CHAT, logFileName(session, DEVICE_A));

describe("this device's log cursors", () => {
  it("carries on in the same log from one launch to the next", async () => {
    await launch(async (records) => {
      await records.startSession(CHAT, { createdAt: new Date(0), id: session });
      await say(records, 1);
    });
    await launch((records) => say(records, 2));

    expect(await fs.readdir(path.join(root, "chats", CHAT))).toEqual([
      logFileName(session, DEVICE_A),
    ]);
  });

  it("starts its next log rather than append to an older copy put back", async () => {
    await launch(async (records) => {
      await records.startSession(CHAT, { createdAt: new Date(0), id: session });
      await say(records, 1);
      await say(records, 2);
    });
    // A sync engine or a restored backup puts back the log as it was after
    // its first message.
    const bytes = await fs.readFile(log(), "utf8");
    const older = bytes.split("\n").slice(0, 2).join("\n") + "\n";
    await fs.writeFile(log(), older);

    await launch((records) => say(records, 3));

    expect(await fs.readFile(log(), "utf8")).toBe(older);
    expect(
      (await fs.readdir(path.join(root, "chats", CHAT))).toSorted(),
    ).toEqual([
      logFileName(session, DEVICE_A, 2),
      logFileName(session, DEVICE_A),
    ]);
  });
});
