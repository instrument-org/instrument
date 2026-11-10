import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { chatFor } from "../../test/helpers/chat-record";
import { createMockChatConfig } from "../../test/helpers/mock-chat-config";
import { createProject, listProjects, updateProject } from "../chat/projects";
import { undoProjectChanges } from "../chat/undo-project-changes";
import { createLocalBashEnv } from "../create-bash-env";
import {
  beginSetupChangeTracking,
  consumeSetupChanges,
} from "../setup-changes";
import { withTurnContext } from "../turn-context";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";

// No session has a live agent here.
vi.mock(import("../workspace-actor-ref"), () => ({
  getWorkspaceActorRef: () =>
    ({
      getSnapshot: () => ({
        context: { sessionRefsByChatId: { get: () => [] } },
      }),
    }) as never,
  setWorkspaceActorRef: vi.fn(),
}));

let counter = 0;
const roots: string[] = [];
let own: { chatId: ChatId; sessionId: StoreId.Session };

beforeEach(async () => {
  createMockChatConfig(
    ChatIdSchema.parse(`projects-command-${Date.now()}-${(counter += 1)}`),
  );
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "projects-command-"));
  roots.push(root);
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    chatsDir: AbsolutePathSchema.parse(path.join(root, "chats")),
    legacyTasksDir: WorkspaceDirSchema.parse(path.join(root, "tasks")),
    rootDir: WorkspaceDirSchema.parse(root),
  });
  const sessionId = StoreId.newSessionId();
  own = {
    chatId: await chatFor(sessionId, ChatIdSchema.parse("organizer")),
    sessionId,
  };
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

/** Runs commands in the chat's shell as one turn, and answers what the turn changed. */
async function turn(...commands: string[]) {
  const key = { id: own.chatId, sessionId: own.sessionId };
  beginSetupChangeTracking(key);
  const bash = await createLocalBashEnv({ ...own, role: "chat" });
  const results = [];
  for (const command of commands) {
    results.push(await withTurnContext(key, () => bash.exec(command)));
  }
  return { changes: await consumeSetupChanges(key), results };
}

async function project(name: string) {
  return (await listProjects()).find((each) => each.name === name);
}

describe("instrument projects set", () => {
  it("sets an icon in place of the emoji and a palette color, and records both", async () => {
    await createProject({ color: "#996d00", emoji: "🐭", name: "Remy" });
    const { changes, results } = await turn(
      "instrument projects set Remy --icon cooking-pot --color deep-violet",
    );
    expect(results[0]?.stdout).toMatchInlineSnapshot(`
      "Changed Remy: color deep-gold → deep-violet, emoji 🐭 → none, icon none → cooking-pot.
      "
    `);
    expect(await project("Remy")).toMatchObject({
      color: "#765fca",
      icon: "cooking-pot",
    });
    expect((await project("Remy"))?.emoji).toBeUndefined();
    expect(changes).toMatchInlineSnapshot(`
      [
        {
          "change": "changed",
          "fields": [
            {
              "after": "#765fca",
              "before": "#996d00",
              "field": "color",
            },
            {
              "after": null,
              "before": "🐭",
              "field": "emoji",
            },
            {
              "after": "cooking-pot",
              "before": null,
              "field": "icon",
            },
          ],
          "kind": "project",
          "name": "Remy",
        },
      ]
    `);
  });

  it("keeps the first value from before when a field is set twice in a turn", async () => {
    await createProject({ icon: "sun", name: "Daily" });
    const { changes } = await turn(
      "instrument projects set Daily --icon moon-stars",
      "instrument projects set Daily --icon coffee",
    );
    expect(changes[0]?.fields).toEqual([
      { after: "coffee", before: "sun", field: "icon" },
    ]);
  });

  it("follows a rename, recording it under the new name", async () => {
    await createProject({ name: "Old Habit" });
    const { changes } = await turn(
      'instrument projects set "Old Habit" --name Habits --icon bank',
    );
    expect(changes).toEqual([
      {
        change: "changed",
        fields: [
          { after: "Habits", before: "Old Habit", field: "name" },
          { after: "bank", before: null, field: "icon" },
        ],
        kind: "project",
        name: "Habits",
      },
    ]);
  });

  it.each([
    ["an icon outside the set", "--icon cactus"],
    ["a color outside the palette", "--color '#ff00ff'"],
    ["an icon and an emoji at once", "--icon sun --emoji 🌞"],
  ])("refuses %s and writes nothing", async (_, flags) => {
    await createProject({ emoji: "🌵", name: "Hard Times" });
    const { changes, results } = await turn(
      `instrument projects set "Hard Times" ${flags}`,
    );
    expect(results[0]?.exitCode).not.toBe(0);
    expect(results[0]?.stderr).toMatchSnapshot();
    expect(await project("Hard Times")).toMatchObject({ emoji: "🌵" });
    expect(changes).toEqual([]);
  });
});

describe("instrument projects retire and unretire", () => {
  it("takes a project out of the list and puts it back", async () => {
    await createProject({ name: "Day Planning" });
    const retired = await turn("instrument projects retire 'Day Planning'");
    expect(retired.changes[0]?.fields).toEqual([
      { after: true, before: false, field: "retired" },
    ]);
    expect((await turn("instrument projects list")).results[0]?.stdout).toBe(
      "There are no projects yet.\n",
    );
    await turn("instrument projects unretire 'Day Planning'");
    expect((await project("Day Planning"))?.retired).toBeUndefined();
  });
});

describe("instrument projects icons", () => {
  it("finds icons for the words given, best fit first", async () => {
    const { results } = await turn("instrument projects icons kitchen cooking");
    expect(results[0]?.stdout).toMatchInlineSnapshot(`
      "  cooking-pot  (Everyday)
      "
    `);
  });
});

describe("instrument projects list", () => {
  it("lists each project with its mark and its color by name", async () => {
    await createProject({ color: "#82c7f0", icon: "bird", name: "X Growth" });
    await createProject({ emoji: "📚", name: "Reading" });
    const listed = (await turn("instrument projects list")).results[0]?.stdout;
    expect(listed?.replaceAll(/prj_\w+/g, "<id>")).toMatchInlineSnapshot(`
      "  X Growth  <id>  icon bird  color pale-blue
        Reading  <id>  emoji 📚
      "
    `);
  });
});

describe("undoing a turn's project changes", () => {
  it("puts back the emoji, color and name, and leaves what the person changed since", async () => {
    await createProject({ color: "#996d00", emoji: "🐭", name: "Remy" });
    await createProject({ color: "#d4bc79", emoji: "📚", name: "Reading" });
    const { changes } = await turn(
      "instrument projects set Remy --icon cooking-pot --color deep-violet --name Kitchen",
      "instrument projects set Reading --color pale-violet",
    );
    // The person picks another color for Reading before undoing.
    const reading = await project("Reading");
    await updateProject(reading?.id ?? "", { color: "#82c7f0" });
    const recorded = changes.flatMap((change) =>
      change.fields ? [{ fields: change.fields, name: change.name }] : [],
    );
    expect(await undoProjectChanges(recorded)).toEqual({
      skipped: 1,
      undone: 4,
    });
    expect(await project("Remy")).toMatchObject({
      color: "#996d00",
      emoji: "🐭",
    });
    expect((await project("Remy"))?.icon).toBeUndefined();
    expect(await project("Reading")).toMatchObject({ color: "#82c7f0" });
  });

  it("brings a deleted project back", async () => {
    await createProject({ name: "Events" });
    const { changes } = await turn("instrument projects retire Events");
    await undoProjectChanges(
      changes.flatMap((change) =>
        change.fields ? [{ fields: change.fields, name: change.name }] : [],
      ),
    );
    expect((await project("Events"))?.retired).toBeUndefined();
  });
});
