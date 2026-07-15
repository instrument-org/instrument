import { Hono } from "hono";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setTaskState } from "../../../lib/task-state-store";
import { FolderAttachment } from "../../../schemas/folder-attachment";
import { AbsolutePathSchema, TaskDirSchema } from "../../../schemas/paths";
import { type TaskId } from "../../../schemas/task-id";
import { createMockTaskConfigForDir } from "../../../test/helpers/mock-task-config";
import { getWorkspaceServerPort } from "../url";
import { assetsRoute } from "./assets";

describe("assetsRoute", () => {
  let app: Hono;
  let root: string;
  let styleModifiedAt: number;
  let taskId: TaskId;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "assets-route-"));
    const taskRoot = path.join(root, "tasks", "asset-task");
    const photosRoot = path.join(root, "Photos");
    const privateRoot = path.join(root, "private");
    taskId = createMockTaskConfigForDir(taskRoot);

    await fs.mkdir(taskRoot, { recursive: true });
    await fs.mkdir(photosRoot);
    await fs.mkdir(privateRoot);
    await fs.mkdir(path.join(taskRoot, "escaped-index"));
    await fs.writeFile(path.join(taskRoot, "index.html"), "task index");
    await fs.writeFile(path.join(taskRoot, "style.css"), "task styles");
    await fs.mkdir(path.join(taskRoot, ".instrument"), { recursive: true });
    await fs.writeFile(path.join(taskRoot, ".instrument", "task.db"), "private");
    // A sibling that merely shares the `.instrument` prefix is a normal task
    // file and must still be served (the deny rule is the exact dir, not a glob).
    await fs.mkdir(path.join(taskRoot, ".instrument-notes"));
    await fs.writeFile(
      path.join(taskRoot, ".instrument-notes", "readme.txt"),
      "public sibling",
    );
    const styleStats = await fs.stat(path.join(taskRoot, "style.css"));
    styleModifiedAt = styleStats.mtimeMs;
    await fs.writeFile(path.join(photosRoot, "cat.png"), "mounted image");
    await fs.writeFile(path.join(privateRoot, "secret.txt"), "secret");
    await fs.symlink(
      path.join(privateRoot, "secret.txt"),
      path.join(photosRoot, "escaped.txt"),
    );
    await fs.symlink(privateRoot, path.join(taskRoot, "escaped"));
    await fs.symlink(
      path.join(privateRoot, "secret.txt"),
      path.join(taskRoot, "escaped-index", "index.html"),
    );

    await setTaskState(TaskDirSchema.parse(taskRoot), {
      attachedFolders: {
        photos: {
          createdAt: 0,
          id: FolderAttachment.IdSchema.parse("photos-id"),
          name: "Photos",
          path: AbsolutePathSchema.parse(photosRoot),
          source: "user",
        },
      },
    });

    app = new Hono();
    app.route("/", assetsRoute);
    app.all("/*", (c) => c.text("next route", 418));
  });

  afterEach(async () => {
    await fs.rm(root, { force: true, recursive: true });
  });

  it.each([
    ["/", "task index"],
    ["/style.css", "task styles"],
    ["/mnt/Photos/cat.png", "mounted image"],
  ])("serves %s from the workspace layout", async (pathname, expected) => {
    const response = await requestAsset(pathname);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe(expected);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("last-modified")).not.toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("caches a task file only when its live mtime matches the version", async () => {
    const matching = await requestAsset(
      `/style.css?version=${styleModifiedAt}`,
    );
    const stale = await requestAsset("/style.css?version=1");

    expect(matching.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(stale.headers.get("cache-control")).toBe("no-store");
  });

  it("keeps mounted files no-store even when a version is provided", async () => {
    const response = await requestAsset(
      "/mnt/Photos/cat.png?version=123",
    );

    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each([
    "/escaped/secret.txt",
    "/escaped-index/",
    "/mnt/Photos/escaped.txt",
  ])("rejects a symlink escape at %s", async (pathname) => {
    const response = await requestAsset(pathname);
    expect(response.status).toBe(404);
  });

  it("does not accept writes on the asset origin", async () => {
    const response = await requestAsset("/style.css", { method: "POST" });
    expect(response.status).toBe(404);
  });

  it.each([
    "/.instrument",
    "/.instrument/task.db",
    // Case-insensitive filesystems (macOS, Windows) resolve this to the same
    // private file, so the deny rule must be case-insensitive too.
    "/.INSTRUMENT/task.db",
  ])("never serves private task metadata at %s", async (pathname) => {
    const response = await requestAsset(pathname);
    expect(response.status).toBe(404);
  });

  it("still serves a task file that only shares the .instrument prefix", async () => {
    const response = await requestAsset("/.instrument-notes/readme.txt");
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("public sibling");
  });

  it("leaves the bare task origin to the app routes", async () => {
    const host = `${taskId}.localhost:${getWorkspaceServerPort()}`;
    const response = await app.request(`http://${host}/`, {
      headers: { host },
    });

    expect(response.status).toBe(418);
  });

  function requestAsset(pathname: string, init?: RequestInit) {
    const host = `assets.${taskId}.localhost:${getWorkspaceServerPort()}`;
    return app.request(`http://${host}${pathname}`, {
      ...init,
      headers: { host, origin: "http://localhost" },
    });
  }
});
