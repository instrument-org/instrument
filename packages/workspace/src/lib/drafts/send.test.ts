import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import { type SessionMessage } from "../../schemas/session/message";
import { logFileName } from "../records/file-names";
import { recordLine } from "../records/record";
import {
  DEVICE_A,
  header,
  messageId,
  messageRecord,
  sessionId,
} from "../records/test-records";
import { workspaceLayout } from "../workspace-layout";
import { type DraftFile } from "./draft-file";
import {
  ensureDraftFolder,
  findDraft,
  readDrafts,
  writeDraftFile,
} from "./draft-folder";
import { finishSentDrafts } from "./send";

/**
 * A send, step by step, with the app stopped between each: the person must
 * lose nothing wherever it stops, and the next launch must either finish the
 * send or leave a draft that can be sent again.
 *
 * Over a real folder, since what is being checked is what is on disk after
 * each step.
 */

const CHAT = ChatIdSchema.parse("2026-10-14-quiet-dishwashers");
const ZONE = "America/New_York";
const WORDS = "Find a quiet dishwasher under $900.";

let rootDir: string;

beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "drafts-send-"));
});

afterEach(() => {
  fs.rmSync(rootDir, { force: true, recursive: true });
});

function draft(more: Partial<DraftFile> = {}): DraftFile {
  const created = new Date("2026-10-14T18:22:04.000Z");
  return { created, id: "d1", updated: created, words: WORDS, ...more };
}

/**
 * Step 1 of a send: the draft, with a file dropped into its folder, which
 * goes with it without a line naming it, as the person left it when they
 * pressed Send.
 */
function waitingDraft(more: Partial<DraftFile> = {}) {
  const made = ensureDraftFolder({
    draft: draft(more),
    rootDir,
    timeZone: ZONE,
  });
  fs.writeFileSync(path.join(made.dir, "sink.png"), "the bytes");
  return made;
}

/**
 * Step 2 of a send: the draft names the chat it is going into, as the app's
 * draft store writes it when it claims the draft.
 */
function pointAtChat(draftId: string) {
  const found = findDraft(rootDir, draftId);
  if (found) {
    writeDraftFile(found.file, {
      ...found.draft,
      sending: CHAT,
      updated: new Date(),
    });
  }
}

/**
 * Step 3 of a send: the chat's records hold the message, which names the
 * draft it came from. Written as the records are written, a line in a log.
 */
function messageNaming(fromDraft: string | undefined, chatId: ChatId = CHAT) {
  const dir = path.join(workspaceLayout(rootDir).chatsDir, chatId);
  fs.mkdirSync(dir, { recursive: true });
  const session = sessionId(1);
  const named: SessionMessage.User = {
    id: messageId(1),
    metadata: {
      createdAt: new Date(),
      ...(fromDraft === undefined ? {} : { fromDraft }),
      sessionId: session,
    },
    role: "user",
  };
  fs.writeFileSync(
    path.join(dir, logFileName(session, DEVICE_A)),
    recordLine(header(1, { device: DEVICE_A, id: session })) +
      recordLine(messageRecord(2, named)),
  );
}

/** What is left in `Drafts/`, by draft id and words. */
function drafts(): { id: string; words: string }[] {
  return readDrafts(rootDir).map((entry) => ({
    id: entry.draft.id,
    words: entry.draft.words,
  }));
}

/** Whether what was pasted into the draft is still beside it. */
function pastedStillThere(dir: string): boolean {
  return fs.existsSync(path.join(dir, "sink.png"));
}

describe("a send stopped between its steps", () => {
  it("leaves the draft whole when it stops before the draft names its chat", async () => {
    const made = waitingDraft();

    expect(await finishSentDrafts({ chatsDir: chatsDir(), rootDir })).toEqual({
      finished: [],
      left: [],
    });
    expect(drafts()).toEqual([{ id: "d1", words: WORDS }]);
    expect(pastedStillThere(made.dir)).toBe(true);
  });

  it("leaves the draft to be sent again when it stops before the message", async () => {
    const made = waitingDraft();
    pointAtChat("d1");

    const finished = await finishSentDrafts({ chatsDir: chatsDir(), rootDir });

    expect(finished.finished).toEqual([]);
    expect(finished.left).toMatchInlineSnapshot(`
      [
        {
          "id": "d1",
          "reason": "2026-10-14-quiet-dishwashers holds no message from it",
        },
      ]
    `);
    expect(drafts()).toEqual([{ id: "d1", words: WORDS }]);
    expect(pastedStillThere(made.dir)).toBe(true);
    // And it is no longer on its way: the person sends it again, or not.
    expect(findDraft(rootDir, "d1")?.draft.sending).toBeUndefined();
  });

  it("finishes the send when it stops after the message, before the folder goes", async () => {
    const made = waitingDraft();
    pointAtChat("d1");
    messageNaming("d1");

    expect(await finishSentDrafts({ chatsDir: chatsDir(), rootDir })).toEqual({
      finished: ["d1"],
      left: [],
    });
    expect(drafts()).toEqual([]);
    expect(fs.existsSync(made.dir)).toBe(false);
  });

  it("has nothing left to do when the send finished", async () => {
    waitingDraft();
    pointAtChat("d1");
    messageNaming("d1");
    await finishSentDrafts({ chatsDir: chatsDir(), rootDir });

    expect(await finishSentDrafts({ chatsDir: chatsDir(), rootDir })).toEqual({
      finished: [],
      left: [],
    });
    expect(fs.readdirSync(path.join(rootDir, "Drafts"))).toEqual([]);
  });

  it("comes to the same place however often a launch runs it", async () => {
    waitingDraft();
    waitingDraft({ id: "d2", words: "And a quiet fridge." });
    pointAtChat("d1");
    messageNaming("d1");

    const once = await finishSentDrafts({ chatsDir: chatsDir(), rootDir });
    const left = drafts();
    const again = await finishSentDrafts({ chatsDir: chatsDir(), rootDir });

    expect(once.finished).toEqual(["d1"]);
    expect(again.finished).toEqual([]);
    expect(drafts()).toEqual(left);
    expect(left).toEqual([{ id: "d2", words: "And a quiet fridge." }]);
  });
});

describe("finishing the sends a launch finds", () => {
  it("finishes only the draft the message names, of several for one chat", async () => {
    waitingDraft();
    waitingDraft({ id: "d2", words: "Queued for after." });
    waitingDraft({ id: "d3", words: "And this one too." });
    for (const id of ["d1", "d2", "d3"]) {
      pointAtChat(id);
    }
    messageNaming("d2");

    expect(
      (await finishSentDrafts({ chatsDir: chatsDir(), rootDir })).finished,
    ).toEqual(["d2"]);
    expect(drafts().map((entry) => entry.id)).toEqual(["d1", "d3"]);
  });

  it("leaves a draft whose chat holds another draft's message", async () => {
    waitingDraft();
    pointAtChat("d1");
    messageNaming("some-other-draft");

    expect(
      (await finishSentDrafts({ chatsDir: chatsDir(), rootDir })).finished,
    ).toEqual([]);
    expect(drafts()).toEqual([{ id: "d1", words: WORDS }]);
  });

  it("leaves a draft whose chat has messages from no draft at all", async () => {
    waitingDraft();
    pointAtChat("d1");
    messageNaming(undefined);

    expect(
      (await finishSentDrafts({ chatsDir: chatsDir(), rootDir })).finished,
    ).toEqual([]);
    expect(drafts()).toEqual([{ id: "d1", words: WORDS }]);
  });

  it("leaves a draft whose chat was deleted, so it can be salvaged", async () => {
    waitingDraft();
    pointAtChat("d1");

    const finished = await finishSentDrafts({ chatsDir: chatsDir(), rootDir });

    expect(finished.finished).toEqual([]);
    expect(drafts()).toEqual([{ id: "d1", words: WORDS }]);
  });

  it("never reads a draft that names no chat as sent", async () => {
    waitingDraft();
    messageNaming("d1");

    expect(await finishSentDrafts({ chatsDir: chatsDir(), rootDir })).toEqual({
      finished: [],
      left: [],
    });
    expect(drafts()).toEqual([{ id: "d1", words: WORDS }]);
  });

  it("says so and leaves the draft where its chat's records cannot be read", async () => {
    waitingDraft();
    pointAtChat("d1");
    const dir = path.join(chatsDir(), CHAT);
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    // A folder's place taken by a file is the shape of a record folder this
    // cannot read at all.
    fs.writeFileSync(dir, "not a folder");

    const finished = await finishSentDrafts({ chatsDir: chatsDir(), rootDir });

    expect(finished.finished).toEqual([]);
    expect(finished.left[0]?.reason).toContain(
      "its chat's records could not be read",
    );
    expect(drafts()).toEqual([{ id: "d1", words: WORDS }]);
  });

  it("leaves a draft pointed at something that is no chat's id", async () => {
    const made = waitingDraft();
    writeDraftFile(made.file, { ...made.draft, chat: "../elsewhere" });

    const finished = await finishSentDrafts({ chatsDir: chatsDir(), rootDir });

    expect(finished.left).toMatchInlineSnapshot(`
      [
        {
          "id": "d1",
          "reason": "elsewhere holds no message from it",
        },
      ]
    `);
    expect(drafts()).toEqual([{ id: "d1", words: WORDS }]);
  });
});

function chatsDir(): string {
  return workspaceLayout(rootDir).chatsDir;
}
