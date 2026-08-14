import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TASKS_DIR_NAME } from "../constants";
import { StoreId } from "../schemas/store-id";
import { type TaskId, TaskIdSchema } from "../schemas/task-id";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import { encodeBrowserTargetId } from "../types";
import { recordBrowserClosed, recordBrowserUse } from "./browser-state";
import { createBrowserStatusPart } from "./create-browser-status-part";
import { disposeSessionsStoreStorage } from "./session-store-storage";
import { taskDir } from "./task-dir-utils";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

const id = TaskIdSchema.parse("browser-status-part-test");
const sessionId = StoreId.newSessionId();

let taskId: TaskId;
let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "browser-status-part-test-"));
  const tasksDir = path.join(root, TASKS_DIR_NAME);
  taskId = createMockTaskConfigForDir(path.join(tasksDir, id));
  await fs.mkdir(taskDir(taskId), { recursive: true });
});

afterEach(async () => {
  await disposeSessionsStoreStorage(id);
  await fs.rm(root, { force: true, recursive: true });
});

describe("createBrowserStatusPart", () => {
  it("skips an unchanged target the agent already used", async () => {
    const target = {
      id: encodeBrowserTargetId(taskId, sessionId),
      title: "Example",
      type: "page" as const,
      url: "https://example.com",
    };
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      browser: {
        ...getWorkspaceConfig().browser,
        listTargets: () => Promise.resolve([target]),
      },
    });
    await recordBrowserUse({
      sessionId,
      taskId,
      title: target.title,
      url: target.url,
    });

    await expect(
      createBrowserStatusPart({
        createdAt: new Date(),
        messageId: StoreId.newMessageId(),
        sessionId,
        taskId,
      }),
    ).resolves.toBeUndefined();
  });

  it("skips a target that has never left the blank page", async () => {
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      browser: {
        ...getWorkspaceConfig().browser,
        listTargets: () =>
          Promise.resolve([
            {
              id: encodeBrowserTargetId(taskId, sessionId),
              title: "about:blank",
              type: "page" as const,
              url: "about:blank",
            },
          ]),
      },
    });

    await expect(
      createBrowserStatusPart({
        createdAt: new Date(),
        messageId: StoreId.newMessageId(),
        sessionId,
        taskId,
      }),
    ).resolves.toBeUndefined();
  });

  it("skips a closed browser that never held a page", async () => {
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      browser: {
        ...getWorkspaceConfig().browser,
        listTargets: () => Promise.resolve([]),
      },
    });
    await recordBrowserUse({ sessionId, taskId, url: "about:blank" });

    await expect(
      createBrowserStatusPart({
        createdAt: new Date(),
        messageId: StoreId.newMessageId(),
        sessionId,
        taskId,
      }),
    ).resolves.toBeUndefined();
  });

  it("reports a teardown that a blank replacement tab is hiding", async () => {
    // What the user sees after coming back to a reaped browser: the panel
    // rebuilt a tab, so the target list looks healthy and says nothing about
    // the page the model was working in.
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      browser: {
        ...getWorkspaceConfig().browser,
        listTargets: () =>
          Promise.resolve([
            {
              id: encodeBrowserTargetId(taskId, sessionId),
              title: "about:blank",
              type: "page" as const,
              url: "about:blank",
            },
          ]),
      },
    });
    await recordBrowserUse({
      sessionId,
      taskId,
      title: "Example",
      url: "https://example.com",
    });
    await recordBrowserClosed({ sessionId, taskId });

    const part = await createBrowserStatusPart({
      createdAt: new Date(),
      messageId: StoreId.newMessageId(),
      sessionId,
      taskId,
    });

    expect(part?.type === "data-browserStatus" ? part.data : undefined)
      .toMatchInlineSnapshot(`
      {
        "previousTarget": {
          "title": "Example",
          "url": "https://example.com",
        },
        "status": "closed",
      }
    `);
  });

  it("reports a restored page as reopened, not as still open", async () => {
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      browser: {
        ...getWorkspaceConfig().browser,
        listTargets: () =>
          Promise.resolve([
            {
              id: encodeBrowserTargetId(taskId, sessionId),
              title: "Example",
              type: "page" as const,
              url: "https://example.com",
            },
          ]),
      },
    });
    await recordBrowserUse({
      sessionId,
      taskId,
      title: "Example",
      url: "https://example.com",
    });
    await recordBrowserClosed({ sessionId, taskId });

    const part = await createBrowserStatusPart({
      createdAt: new Date(),
      messageId: StoreId.newMessageId(),
      sessionId,
      taskId,
    });

    expect(part?.type === "data-browserStatus" ? part.data : undefined)
      .toMatchInlineSnapshot(`
      {
        "status": "reopened",
        "target": {
          "title": "Example",
          "url": "https://example.com",
        },
      }
    `);
  });

  it("announces a teardown once, not on every message after it", async () => {
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      browser: {
        ...getWorkspaceConfig().browser,
        listTargets: () =>
          Promise.resolve([
            {
              id: encodeBrowserTargetId(taskId, sessionId),
              title: "Example",
              type: "page" as const,
              url: "https://example.com",
            },
          ]),
      },
    });
    await recordBrowserUse({
      sessionId,
      taskId,
      title: "Example",
      url: "https://example.com",
    });
    await recordBrowserClosed({ sessionId, taskId });

    const args = {
      createdAt: new Date(),
      messageId: StoreId.newMessageId(),
      sessionId,
      taskId,
    };
    const first = await createBrowserStatusPart(args);
    expect(
      first?.type === "data-browserStatus" ? first.data.status : undefined,
    ).toBe("reopened");
    // Same page, nothing new to say: the marker was consumed by the first
    // message rather than heading every one until the browser is used again.
    await expect(createBrowserStatusPart(args)).resolves.toBeUndefined();
  });

  it("keeps the last real page when a command lands on a blank target", async () => {
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      browser: {
        ...getWorkspaceConfig().browser,
        listTargets: () => Promise.resolve([]),
      },
    });
    await recordBrowserUse({
      sessionId,
      taskId,
      title: "Example",
      url: "https://example.com",
    });
    // A command that only reads state opens a target without a page. Recording
    // that as the last page would leave a teardown with nothing to name.
    await recordBrowserUse({
      sessionId,
      taskId,
      title: "about:blank",
      url: "about:blank",
    });

    const part = await createBrowserStatusPart({
      createdAt: new Date(),
      messageId: StoreId.newMessageId(),
      sessionId,
      taskId,
    });

    expect(part?.type === "data-browserStatus" ? part.data : undefined)
      .toMatchInlineSnapshot(`
      {
        "previousTarget": {
          "title": "Example",
          "url": "https://example.com",
        },
        "status": "closed",
      }
    `);
  });

  it("reports a closed browser by the last real page it held", async () => {
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      browser: {
        ...getWorkspaceConfig().browser,
        listTargets: () => Promise.resolve([]),
      },
    });
    await recordBrowserUse({
      sessionId,
      taskId,
      title: "Example",
      url: "https://example.com",
    });

    const part = await createBrowserStatusPart({
      createdAt: new Date(),
      messageId: StoreId.newMessageId(),
      sessionId,
      taskId,
    });

    expect(part?.type === "data-browserStatus" ? part.data : undefined)
      .toMatchInlineSnapshot(`
      {
        "previousTarget": {
          "title": "Example",
          "url": "https://example.com",
        },
        "status": "closed",
      }
    `);
  });
});
