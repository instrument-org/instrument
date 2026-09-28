// Walk every screen of the 2.0 window and report the console errors, warnings
// and uncaught exceptions each one produced.
//
//   node studio-drive.mjs run <this file> --window orchestrator
//   node studio-drive.mjs run <this file> --window orchestrator --args '{"reload":true}'
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

import { sleep } from "./studio-app.mjs";

/** How long a screen is given to mount and settle before moving on. */
const SETTLE_MS = 1200;
/** How long a renderer reload is given before the walk starts. */
const RELOAD_MS = 8000;
/** Enough of a message to tell two apart, without pasting a whole stack. */
const KEY_LENGTH = 160;
const TEXT_LENGTH = 400;

export default async (app, args = {}) => {
  if (app.window !== "orchestrator") {
    throw new Error(
      "This sweep walks the 2.0 window's screens. Pass --window orchestrator.",
    );
  }

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

  // Both are best-effort: a workspace with no connected app or no task should
  // sweep the screens it does have rather than fail on the two it does not.
  const [apps, tasks] = await Promise.all([
    app.rpc("apps.list", {}).catch(() => undefined),
    app.rpc("workspace.task.list", {}).catch(() => undefined),
  ]);
  const slug = apps?.apps?.[0]?.slug;
  const taskId = (Array.isArray(tasks) ? tasks : tasks?.tasks)?.[0]?.id;

  const routes = [
    "/orchestrator/home",
    "/orchestrator/computer",
    "/orchestrator/apps",
    slug && `/orchestrator/apps/${slug}`,
    "/orchestrator/tasks",
    taskId && `/orchestrator/tasks/${taskId}`,
    // Home again last: a screen can leave something behind that only the next
    // navigation off it surfaces, and the last screen in the list never gets one.
    "/orchestrator/home",
  ].filter(Boolean);

  for (const route of routes) {
    screen = route;
    await app.goto(route);
    await sleep(args.settleMs ?? SETTLE_MS);
  }
  screen = "(after the walk)";

  const skipped = [
    slug ? undefined : "no connected app, so /orchestrator/apps/$slug",
    taskId ? undefined : "no task, so /orchestrator/tasks/$id",
  ].filter(Boolean);

  return {
    clean: problems.size === 0,
    problems: [...problems.values()],
    walked: routes,
    ...(skipped.length > 0 && { skipped }),
  };
};
