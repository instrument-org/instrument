import { err, ok, type Result } from "neverthrow";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CHATS_FOLDER_NAME } from "../../constants";
import { ChatIdSchema } from "../../schemas/chat-id";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { recordChatFolderName } from "../chat-folders/own-folder";
import {
  nameKey,
  namesBeside,
  numberedTitle,
  RECENT_TITLES,
  untakenTitle,
} from "./chat-name";
import { type Chat } from "./chats";

const chats = vi.hoisted(() => ({ value: [] as Partial<Chat>[] }));

vi.mock(import("./chats"), async (importOriginal) => ({
  ...(await importOriginal()),
  listChats: () => Promise.resolve(chats.value as Chat[]),
}));

/** A titler that answers each call in turn, and the names each call was handed back. */
function titler(...answers: Result<string, string>[]) {
  const rejected: (string | undefined)[] = [];
  return {
    ask: (name?: string) => {
      rejected.push(name);
      return Promise.resolve(answers.shift() ?? err("no more answers"));
    },
    rejected,
  };
}

const taken = new Set(["Weather", "Weather 2", "q3 report"].map(nameKey));

describe("untakenTitle", () => {
  it("asks again once for a taken name, then numbers the first answer", async () => {
    const cases = {
      "a free name is kept, and asked for once": [
        ok("Sailing birthday card for dad"),
      ],
      "a taken name goes back once": [ok("Weather"), ok("Weather for Friday")],
      "a second taken name numbers the first, past the numbers in use": [
        ok("weather"),
        ok("Weather"),
      ],
      "a failed second try numbers the first": [
        ok("Q3 report"),
        err("budget spent"),
      ],
      "a name compares by the folder it makes": [
        ok("Weather?"),
        ok("Weather: Friday"),
      ],
      "a failed first try is the answer": [err("unnameable")],
    };
    const outcomes: Record<string, unknown> = {};
    for (const [name, answers] of Object.entries(cases)) {
      const { ask, rejected } = titler(...answers);
      const title = await untakenTitle({ ask, taken });
      outcomes[name] = {
        rejected,
        title: title.isOk() ? title.value : title.error,
      };
    }
    expect(outcomes).toMatchInlineSnapshot(`
      {
        "a failed first try is the answer": {
          "rejected": [
            undefined,
          ],
          "title": "unnameable",
        },
        "a failed second try numbers the first": {
          "rejected": [
            undefined,
            "Q3 report",
          ],
          "title": "Q3 report 2",
        },
        "a free name is kept, and asked for once": {
          "rejected": [
            undefined,
          ],
          "title": "Sailing birthday card for dad",
        },
        "a name compares by the folder it makes": {
          "rejected": [
            undefined,
            "Weather?",
          ],
          "title": "Weather: Friday",
        },
        "a second taken name numbers the first, past the numbers in use": {
          "rejected": [
            undefined,
            "weather",
          ],
          "title": "weather 3",
        },
        "a taken name goes back once": {
          "rejected": [
            undefined,
            "Weather",
          ],
          "title": "Weather for Friday",
        },
      }
    `);
  });
});

describe("numberedTitle", () => {
  it("cuts the words to leave room for the number under the cap", () => {
    const long = "a".repeat(79);
    expect(
      numberedTitle(long, new Set([nameKey(long)])).length,
    ).toMatchInlineSnapshot(`80`);
  });
});

describe("namesBeside", () => {
  const roots: string[] = [];
  afterEach(() => {
    chats.value = [];
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { force: true, recursive: true });
    }
  });

  function workspace(folders: string[]) {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-name-"));
    roots.push(rootDir);
    for (const folder of folders) {
      fs.mkdirSync(path.join(rootDir, CHATS_FOLDER_NAME, folder), {
        recursive: true,
      });
    }
    return {
      rootDir: WorkspaceDirSchema.parse(rootDir),
      workspaceMachineDir: AbsolutePathSchema.parse(
        path.join(rootDir, "machine"),
      ),
    };
  }

  const id = (name: string) => ChatIdSchema.parse(name);

  it("shows the newest titled chats and takes every name but the chat's own", async () => {
    const config = workspace(["What's the weather", "Weather", "Old notes"]);
    await recordChatFolderName(
      config.workspaceMachineDir,
      id("this"),
      "What's the weather",
    );
    chats.value = [
      {
        archived: false,
        id: id("this"),
        title: "What's the weather",
        titled: false,
        updatedAt: 9,
      },
      {
        archived: false,
        id: id("a"),
        title: "Weather",
        titled: true,
        updatedAt: 1,
      },
      {
        archived: true,
        id: id("b"),
        title: "Weather today",
        titled: true,
        updatedAt: 3,
      },
      {
        archived: false,
        id: id("c"),
        title: "Plant watering tracker app",
        titled: true,
        updatedAt: 2,
      },
      {
        archived: false,
        id: id("d"),
        title: "Untitled first words",
        titled: false,
        updatedAt: 4,
      },
    ];
    const beside = await namesBeside(id("this"), config);
    expect({
      recent: beside.recent,
      taken: [...beside.taken].toSorted(),
    }).toMatchInlineSnapshot(`
      {
        "recent": [
          "Plant watering tracker app",
          "Weather",
        ],
        "taken": [
          "old notes",
          "plant watering tracker app",
          "weather",
          "weather today",
        ],
      }
    `);
  });

  it(`shows at most ${RECENT_TITLES.toString()} titles`, async () => {
    chats.value = Array.from({ length: RECENT_TITLES + 5 }, (_, index) => ({
      archived: false,
      id: id(`chat-${index.toString()}`),
      title: `Chat ${index.toString()}`,
      titled: true,
      updatedAt: index,
    }));
    const beside = await namesBeside(id("this"), workspace([]));
    expect([beside.recent.length, beside.recent[0], beside.taken.size])
      .toMatchInlineSnapshot(`
      [
        20,
        "Chat 24",
        25,
      ]
    `);
  });
});
