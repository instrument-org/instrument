// Walk every screen of the app window and report the console errors, warnings
// and uncaught exceptions each one produced.
//
//   node studio-drive.mjs run <this file>
//   node studio-drive.mjs run <this file> --args '{"reload":true}'
//
// A screen is named on every problem it produced, because the same warning from
// two screens is two facts and the same warning twice from one screen is one.
//
// The parameterized screens -- an app, a task -- are addressed by ids read from
// the running app rather than written down here. An id written down is an id
// that stops existing, and the sweep would then walk an empty screen and report
// it as clean, which is the one answer worse than a crash.
//
// `--args '{"reload":true}'` reloads the renderer first, which is the only way
// to see what a screen logs while it mounts. It costs the wait, so it is off by
// default.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { sleep } from "./studio-app.mjs";

/** How long a screen is given to mount and settle before moving on. */
const SETTLE_MS = 1200;
/** How long a renderer reload is given before the walk starts. */
const RELOAD_MS = 8000;
/** Enough of a message to tell two apart, without pasting a whole stack. */
const KEY_LENGTH = 160;
const TEXT_LENGTH = 400;

export default async (app, args = {}) => {
  const problems = new Map();

  // Enabling the domain replays the console buffer, so the first thing to
  // arrive is whatever the window logged earlier -- an older run's errors, or a
  // person's. That is history rather than a finding, so nothing is recorded
  // until the walk starts. A reload is the exception: it clears the buffer, and
  // what replays afterwards is the mount-time output the reload was asked for.
  let screen = args.reload ? "(mount)" : null;

  const note = (kind, text) => {
    if (screen === null) {
      return;
    }
    const trimmed = text.replaceAll(/\s+/g, " ").trim().slice(0, TEXT_LENGTH);
    const key = `${screen} ${kind} ${trimmed.slice(0, KEY_LENGTH)}`;
    if (!problems.has(key)) {
      problems.set(key, { kind, screen, text: trimmed });
    }
  };

  app.cdp.on(({ method, params }) => {
    if (
      method === "Runtime.consoleAPICalled" &&
      (params.type === "error" || params.type === "warning")
    ) {
      note(
        params.type,
        params.args
          .map((argument) => argument.value ?? argument.description ?? "")
          .join(" "),
      );
    }
    if (method === "Runtime.exceptionThrown") {
      const { exception, text } = params.exceptionDetails;
      note("exception", `${text} ${exception?.description ?? ""}`);
    }
  });
  // Ahead of `Runtime.enable`, so the buffer this clears is not the one the
  // enable replays.
  if (args.reload) {
    await app.cdp.send("Page.enable");
    await app.cdp.send("Page.reload");
    await sleep(args.reloadMs ?? RELOAD_MS);
  }

  // Console output and uncaught exceptions are only emitted once the domain is
  // on. Everything else this script does works without it.
  await app.cdp.send("Runtime.enable");

  // A workspace with no connected app, no chat, or a chat with no task
  // sweeps the screens it does have rather than failing on the ones it does
  // not. A route that answers with an error is a finding, not an empty list.
  const apps = await app.rpc("apps.list", {}).catch(() => undefined);
  const slug = apps?.apps?.[0]?.slug;
  const chat = await firstChat(app);
  const tasks = chat
    ? await app.rpc("workspace.chats.tasks", { id: chat.id })
    : [];
  const taskId = tasks[0]?.id;

  const routes = [
    "/chats",
    "/files",
    "/browser",
    "/apps",
    slug && `/apps/${slug}`,
    chat && `/tasks?chat=${chat.id}`,
    taskId && `/tasks/${taskId}?chat=${chat.id}`,
    "/release-notes",
    // The inbox again last: a screen can leave something behind that only the
    // next navigation off it surfaces, and the last screen in the list never
    // gets one.
    "/chats",
  ].filter(Boolean);

  for (const route of routes) {
    screen = route;
    await app.goto(route);
    await sleep(args.settleMs ?? SETTLE_MS);
    // A route the router has no match for draws its not-found page and logs
    // nothing, which would otherwise read as a clean screen.
    if (
      await app.eval(
        `document.querySelector("[data-app-tab-active]")?.innerText.includes("Could not find page") ?? false`,
      )
    ) {
      note("not-found", `No route draws ${route}`);
    }
  }
  screen = "(after the walk)";

  const skipped = [
    slug ? undefined : "no connected app, so /apps/$slug",
    chat ? undefined : "no chat, so /tasks?chat=$chat",
    taskId ? undefined : "no task in the first chat, so /tasks/$id",
  ].filter(Boolean);

  return {
    clean: problems.size === 0,
    problems: [...problems.values()],
    walked: routes,
    ...(skipped.length > 0 && { skipped }),
  };
};

/**
 * The first chat on the workspace's disk, by its folder (the id its task
 * routes take) and the session the folder's settings name; none when the
 * workspace has no chat. Read from disk because nothing in the app lists
 * the chats in one call, and the task routes need one to stand on.
 */
async function firstChat(app) {
  const info = await app.rpc("debug.systemInfo", {});
  const root = info.find((entry) => entry.title === "Workspace Root")?.value;
  if (!root) {
    throw new Error("debug.systemInfo named no workspace root.");
  }
  const chatsDir = path.join(root, "chats");
  let names;
  try {
    names = readdirSync(chatsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .toSorted();
  } catch {
    return undefined;
  }
  for (const name of names) {
    try {
      const settings = JSON.parse(
        readFileSync(
          path.join(chatsDir, name, ".instrument", "settings.json"),
          "utf8",
        ),
      );
      if (typeof settings.chatSessionId === "string") {
        return { id: name, sessionId: settings.chatSessionId };
      }
    } catch {
      // A chat folder whose settings cannot be read is Storage's to list.
    }
  }
  return undefined;
}
