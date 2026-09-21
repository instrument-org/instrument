import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initializeTask } from "../lib/initialize-task";
import {
  getWorkspaceConfig,
  setWorkspaceConfig,
} from "../lib/workspace-config";
import { AbsolutePathSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { type TaskId, TaskIdSchema } from "../schemas/task-id";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import { mainAgent } from "./main";

// A task of its own per test: the session store is cached by task id, so a
// second task under one name in a fresh temp directory reuses the handle on
// the database the last one deleted.
let taskCount = 0;
let rootDir: string;

beforeEach(async () => {
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "main-agent-"));
});

afterEach(async () => {
  await fs.rm(rootDir, { force: true, recursive: true });
});

async function systemPromptFor(parentTaskId?: TaskId): Promise<string> {
  const taskId = TaskIdSchema.parse(`who-reads-you-${++taskCount}`);
  createMockTaskConfigForDir(path.join(rootDir, "tasks", taskId));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    defaultTaskTemplateDir: AbsolutePathSchema.parse(
      path.resolve(import.meta.dirname, "../../templates/default"),
    ),
  });
  const created = await initializeTask(
    {
      initialSettings: {
        kind: "task",
        name: "Who reads you",
        ...(parentTaskId ? { parentTaskId } : {}),
      },
      taskId,
      workspaceConfig: getWorkspaceConfig(),
    },
    {},
  );
  if (created.isErr()) {
    throw created.error;
  }
  const [system] = await mainAgent.getMessages({
    sessionId: StoreId.newSessionId(),
    taskId,
  });
  const text = system?.parts.find((part) => part.type === "text");
  if (text?.type !== "text") {
    throw new Error("The system message has no text");
  }
  return text.text;
}

describe("mainAgent.getMessages", () => {
  // A task the conversation's assistant started reports to it; a task the
  // user opened in the classic window is read by the user, who has to be
  // spoken to and shown files and sources in the reply.
  it("reports to the assistant only when a parent started the task", async () => {
    const started = await systemPromptFor(TaskIdSchema.parse("the-parent"));
    expect(started).toContain("Nobody is watching this transcript.");
    expect(started).toContain("Your last message is a receipt, not a report");
    expect(started).not.toContain("# Showing Files to the User");

    const opened = await systemPromptFor();
    expect(opened).toContain("The user is here");
    expect(opened).toContain("# Tone and Style");
    expect(opened).toContain("# Showing Files to the User");
    expect(opened).toContain("# Showing Sources to the User");
    expect(opened).not.toContain("Nobody is watching this transcript.");
    expect(opened).not.toContain("receipt");
  });

  it("indents each audience's sections into the prompt as prose", async () => {
    const opened = await systemPromptFor();
    // dedent strips the template's own indent; an interpolated block that
    // kept it would read as a code block.
    expect(opened).not.toMatch(/^ {2,}# /m);
    expect(opened).toMatch(/\n# Who reads you\nThe user is here/);
    expect(opened).toMatch(/\n# Showing Files to the User\nAny reply/);
  });

  // A task reaches services under the user's account, so it is told whose.
  it("tells the task the signed-in user's name in its context", async () => {
    const context = await contextFor({
      email: "ada@example.com",
      name: "Ada Lovelace",
    });
    expect(context).toContain("The user's name is Ada Lovelace");
  });
});

/** The context message's text for a task nobody started, with someone signed in. */
async function contextFor(user: {
  email: string;
  name: string;
}): Promise<string> {
  const taskId = TaskIdSchema.parse(`whose-work-${++taskCount}`);
  // The mock config replaces the whole config, so the account goes on after it.
  createMockTaskConfigForDir(path.join(rootDir, "tasks", taskId));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    defaultTaskTemplateDir: AbsolutePathSchema.parse(
      path.resolve(import.meta.dirname, "../../templates/default"),
    ),
    getUser: () => Promise.resolve(user),
  });
  const created = await initializeTask(
    {
      initialSettings: { kind: "task", name: "Whose work" },
      taskId,
      workspaceConfig: getWorkspaceConfig(),
    },
    {},
  );
  if (created.isErr()) {
    throw created.error;
  }
  const [, context] = await mainAgent.getMessages({
    sessionId: StoreId.newSessionId(),
    taskId,
  });
  return (
    context?.parts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n") ?? ""
  );
}
