import { Hono } from "hono";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createProject } from "../../../lib/project";
import { updateTaskSettings } from "../../../lib/task-settings";
import { setTaskState } from "../../../lib/task-state-store";
import {
  getWorkspaceConfig,
  setWorkspaceConfig,
} from "../../../lib/workspace-config";
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
    await fs.writeFile(
      path.join(taskRoot, ".instrument", "task.db"),
      "private",
    );
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
    await fs.writeFile(path.join(photosRoot, "a cat.png"), "spaced image");
    await fs.writeFile(
      path.join(photosRoot, "Smith, John #2.png"),
      "punctuated image",
    );
    await fs.writeFile(path.join(taskRoot, "my notes.md"), "spaced task file");
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

    // A real project, because the mount is resolved from the task's live
    // projectId rather than from anything seeded into its state.
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      projectsDir: AbsolutePathSchema.parse(path.join(root, "projects")),
    });
    const project = await createProject({ name: "Acme" });
    if (project.isErr()) {
      throw project.error;
    }
    const projectRoot = path.join(root, "projects", "Acme");
    await fs.writeFile(path.join(projectRoot, "logo.png"), "project image");
    await updateTaskSettings(taskId, { projectId: project.value.id });

    await setTaskState(TaskDirSchema.parse(taskRoot), {
      attachedFolders: {
        photos: {
          access: "read-only",
          createdAt: 0,
          id: FolderAttachment.IdSchema.parse("photos-id"),
          mountName: "Photos",
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
    // The project mount is outside the task root like /mnt, so its paths have to
    // be recognized as already-virtual. Prefixing the task mount instead would
    // look for it at /task/project/logo.png and 404.
    ["/project/logo.png", "project image"],
  ])("serves %s from the workspace layout", async (pathname, expected) => {
    const response = await requestAsset(pathname);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe(expected);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("last-modified")).not.toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  // A client escapes a name before it ever sends the request, so the route sees
  // the escaped spelling and has to put it back before resolving a real file.
  // Reserved characters are the ones that get missed: they survive `decodeURI`,
  // and a folder the user picked is full of names that carry them.
  it.each([
    ["/my%20notes.md", "spaced task file"],
    ["/mnt/Photos/a%20cat.png", "spaced image"],
    ["/mnt/Photos/Smith%2C%20John%20%232.png", "punctuated image"],
  ])("serves the percent-encoded %s", async (pathname, expected) => {
    const response = await requestAsset(pathname);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe(expected);
  });

  it("rejects traversal spelled with escapes, which decoding would otherwise let through", async () => {
    const response = await requestAsset("/%2E%2E/%2E%2E/private/secret.txt");

    expect(response.status).toBe(404);
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
    const response = await requestAsset("/mnt/Photos/cat.png?version=123");

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

  // The virtual filesystem's private-dir mask is a just-bash decorator, so it
  // does not cover this route at all: without its own segment check, mounting
  // the project folder would publish the settings naming the project's folders
  // and the access granted to each over HTTP.
  it.each([
    "/project/.instrument/settings.json",
    // Same file on a case-insensitive filesystem. The mount point itself is
    // matched exactly, so only the private segment varies here; a path spelled
    // `/PROJECT/...` never reaches this mount in the first place.
    "/project/.INSTRUMENT/settings.json",
  ])("never serves the project's private settings at %s", async (pathname) => {
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
