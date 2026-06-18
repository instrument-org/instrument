import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { AbsolutePathSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { ProjectSubdomainSchema } from "../schemas/subdomains";
import { createMockAppConfig } from "../test/helpers/mock-app-config";
import { type WorkspaceConfig } from "../types";
import {
  beginTurnChangeTracking,
  consumeTurnChanges,
  getCurrentProjectFiles,
} from "./project-file-watcher";

const subdomain = ProjectSubdomainSchema.parse("watcher-test");

let root: string;
let appDir: string;
let workspaceConfig: WorkspaceConfig;

async function setupTask() {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "watcher-test-"));
  const projectsDir = path.join(root, "projects");
  appDir = path.join(projectsDir, subdomain);
  await fs.mkdir(path.join(appDir, "sub"), { recursive: true });
  workspaceConfig = {
    ...createMockAppConfig(subdomain).workspaceConfig,
    projectsDir: AbsolutePathSchema.parse(projectsDir),
  };
}

function trackedPaths() {
  return (getCurrentProjectFiles(subdomain) ?? []).map((file) =>
    String(file.filePath),
  );
}

afterEach(async () => {
  // Release any lingering watcher so it doesn't outlive the test.
  await consumeTurnChanges({ sessionId: StoreId.newSessionId(), subdomain });
  await fs.rm(root, { force: true, recursive: true });
});

describe("project file watcher turn tracking", () => {
  it("classifies added, modified, and deleted files across a turn", async () => {
    await setupTask();
    await fs.writeFile(path.join(appDir, "a.txt"), "a");
    await fs.writeFile(path.join(appDir, "sub", "b.txt"), "b");

    const sessionId = StoreId.newSessionId();
    await beginTurnChangeTracking({ sessionId, subdomain, workspaceConfig });

    expect(trackedPaths()).toEqual(["a.txt", "sub/b.txt"]);

    await fs.writeFile(path.join(appDir, "a.txt"), "aaaa");
    await fs.writeFile(path.join(appDir, "c.txt"), "c");
    await fs.rm(path.join(appDir, "sub", "b.txt"));

    const { changes } = await consumeTurnChanges({ sessionId, subdomain });
    expect(
      changes.map(({ filePath, status }) => ({
        filePath: String(filePath),
        status,
      })),
    ).toEqual([
      { filePath: "a.txt", status: "modified" },
      { filePath: "c.txt", status: "added" },
      { filePath: "sub/b.txt", status: "deleted" },
    ]);

    // The turn held the only watcher ref, so consuming disposes it.
    expect(getCurrentProjectFiles(subdomain)).toBeUndefined();
  }, 15_000);

  it("reports no changes for a turn that touches nothing", async () => {
    await setupTask();
    await fs.writeFile(path.join(appDir, "a.txt"), "a");

    const sessionId = StoreId.newSessionId();
    await beginTurnChangeTracking({ sessionId, subdomain, workspaceConfig });

    const { changes } = await consumeTurnChanges({ sessionId, subdomain });
    expect(changes).toEqual([]);
    expect(getCurrentProjectFiles(subdomain)).toBeUndefined();
  }, 15_000);

  it("ignores files created and deleted within the same turn", async () => {
    await setupTask();
    await fs.writeFile(path.join(appDir, "a.txt"), "a");

    const sessionId = StoreId.newSessionId();
    await beginTurnChangeTracking({ sessionId, subdomain, workspaceConfig });

    const ephemeral = path.join(appDir, "ephemeral.txt");
    await fs.writeFile(ephemeral, "x");
    await fs.rm(ephemeral);

    const { changes } = await consumeTurnChanges({ sessionId, subdomain });
    expect(changes).toEqual([]);
  }, 15_000);
});
