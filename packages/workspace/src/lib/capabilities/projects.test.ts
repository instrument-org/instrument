import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { chatFor } from "../../test/helpers/chat-record";
import { createMockChatConfig } from "../../test/helpers/mock-chat-config";
import { ChatReads } from "../chat-reads";
import { ChatWrites } from "../chat-writes";
import { markCardUndone } from "../chat/card-undone";
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
    expect(
      changes.map((change) => ({
        ...change,
        ...(change.project && { project: { ...change.project, id: "<id>" } }),
      })),
    ).toMatchInlineSnapshot(`
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
          "project": {
            "after": {
              "color": "#765fca",
              "icon": "cooking-pot",
              "name": "Remy",
            },
            "before": {
              "color": "#996d00",
              "emoji": "🐭",
              "name": "Remy",
            },
            "id": "<id>",
          },
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
    const { id } = await createProject({ name: "Old Habit" });
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
        project: {
          after: { icon: "bank", name: "Habits" },
          before: { name: "Old Habit" },
          id,
        },
      },
    ]);
  });

  it("records the look from before the turn's first change, under the old name", async () => {
    const { id } = await createProject({ name: "Plants" });
    const { changes } = await turn(
      "instrument projects set Plants --name Houseplants",
      "instrument projects set Houseplants --color deep-green",
      "instrument projects set Houseplants --icon plant",
    );
    expect(changes[0]?.project).toEqual({
      after: { color: "#218b30", icon: "plant", name: "Houseplants" },
      before: { name: "Plants" },
      id,
    });
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

describe("instrument projects create", () => {
  it("makes the project's folder and file with its front matter, and records it as made", async () => {
    const { changes, results } = await turn(
      'instrument projects create Kitchen --icon cooking-pot --color deep-violet --about "Recipes and meal plans"',
    );
    const kitchen = await project("Kitchen");
    expect(results[0]?.stdout).toBe(`Created Kitchen, id ${kitchen?.id}.\n`);
    const file = fs.readFileSync(
      path.join(getWorkspaceConfig().rootDir, "Projects/Kitchen/AGENTS.md"),
      "utf8",
    );
    expect(
      file.replace(/prj_\w+/, "<id>").replace(/created: .+/, "created: <at>"),
    ).toMatchInlineSnapshot(`
      "---
      id: <id>
      icon: cooking-pot
      color: "#765fca"
      about: Recipes and meal plans
      created: <at>
      ---
      "
    `);
    expect(changes).toEqual([
      {
        change: "added",
        kind: "project",
        name: "Kitchen",
        project: {
          after: { color: "#765fca", icon: "cooking-pot", name: "Kitchen" },
          id: kitchen?.id,
        },
      },
    ]);
  });

  it("refuses a name a project in use has", async () => {
    await createProject({ emoji: "🍳", name: "Kitchen" });
    const { changes, results } = await turn(
      "instrument projects create kitchen --icon sun",
    );
    expect(results[0]?.exitCode).not.toBe(0);
    expect(results[0]?.stderr).toMatchInlineSnapshot(`
      "instrument projects: there already is a project called Kitchen. instrument projects set changes it.
      "
    `);
    expect(await project("Kitchen")).toMatchObject({ emoji: "🍳" });
    expect(changes).toEqual([]);
  });

  it("brings back a retired project by that name, recorded as brought back", async () => {
    const { id } = await createProject({ name: "Garden" });
    await updateProject(id, { retired: true });
    const { changes } = await turn("instrument projects create Garden");
    expect((await project("Garden"))?.retired).toBeUndefined();
    expect(changes[0]).toMatchObject({
      change: "changed",
      fields: [{ after: false, before: true, field: "retired" }],
      project: { id },
    });
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

  it("deletes a project the turn made, keeping its folder", async () => {
    const { changes } = await turn("instrument projects create Pantry");
    expect(
      await undoProjectChanges(
        changes.map(({ fields, name, project: looks }) => ({
          fields: fields ?? [],
          name,
          ...(looks && { project: looks }),
        })),
      ),
    ).toEqual({ skipped: 0, undone: 1 });
    expect((await project("Pantry"))?.retired).toBe(true);
  });

  it("finds a project by its id when the person renamed it since", async () => {
    await createProject({ color: "#996d00", name: "Daily" });
    const { changes } = await turn(
      "instrument projects set Daily --color deep-violet",
    );
    const daily = await project("Daily");
    await updateProject(daily?.id ?? "", { name: "Mornings" });
    expect(
      await undoProjectChanges(
        changes.flatMap(({ fields, name, project: looks }) =>
          fields ? [{ fields, name, ...(looks && { project: looks }) }] : [],
        ),
      ),
    ).toEqual({ skipped: 0, undone: 1 });
    expect(await project("Mornings")).toMatchObject({ color: "#996d00" });
  });
});

describe("marking a changes card undone", () => {
  it("writes onto the card that its Undo put something back, once", async () => {
    await createProject({ name: "Plants" });
    const { changes } = await turn(
      "instrument projects set Plants --name Houseplants",
    );
    const messageId = StoreId.newMessageId();
    const partId = StoreId.newPartId();
    const ids = { messageId, sessionId: own.sessionId };
    (
      await ChatWrites.saveMessageWithParts(
        {
          id: messageId,
          metadata: {
            createdAt: new Date(),
            finishReason: "stop",
            modelId: "glm-5.3-flash",
            providerId: "openai-compatible",
            sessionId: own.sessionId,
          },
          parts: [
            {
              data: { changes },
              metadata: { ...ids, createdAt: new Date(), id: partId },
              type: "data-setupChanges",
            },
          ],
          role: "assistant",
        },
        own.chatId,
      )
    )._unsafeUnwrap();
    const card = { ...ids, chatId: own.chatId, partId };
    const undoneOf = async () => {
      const transcript = (
        await ChatReads.transcript({
          chatId: own.chatId,
          sessionId: own.sessionId,
        })
      )._unsafeUnwrap();
      const part = transcript
        .flatMap((message) => message.parts)
        .find((each) => each.metadata.id === partId);
      return part?.type === "data-setupChanges" ? part.data.undone : "missing";
    };
    await markCardUndone(card, { skipped: 0, undone: 0 });
    expect(await undoneOf()).toBeUndefined();
    await markCardUndone(card, { skipped: 1, undone: 2 });
    const first = await undoneOf();
    expect(first).toMatchObject({ skipped: 1 });
    await markCardUndone(card, { skipped: 0, undone: 1 });
    expect(await undoneOf()).toEqual(first);
  });
});
