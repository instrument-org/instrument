// Checks that window tabs behind another go quiet. A window tab stays mounted
// while another is selected, so anything it polls or re-reads keeps going
// where nobody can see it. This opens one tab per kind of screen, puts a
// fresh new tab in front of them all, and counts every RPC frame the window
// sends and receives while nobody does anything.
//
//   node studio-drive.mjs run hidden-tabs-quiet.mjs --allow-reload --workspace documents
//   node studio-drive.mjs run hidden-tabs-quiet.mjs --allow-reload --args '{"idleSeconds":60}'
//
// Quiet means no request went out during the idle. Inbound frames are listed
// too: a live stream pushes only when what it watches changed, which on an
// idle fixture is nothing, so any there name a stream to look at. A request
// out fails the run (`quiet: false`, exit 1), so it works as a gate.
//
// Args: `idleSeconds` (30), `settleMs` after opening the tabs (6000),
// `baselineSeconds` (10, 0 to skip) for an idle taken first with only the
// window's opening tab behind the front one, which tells a hidden screen's
// traffic from the shell's or the front tab's own, `folder` and `path` for the
// Files tab (this checkout, `apps/studio/src/`), `file` for the one opened in
// a Files tab (this skill's SKILL.md, which the recents then list), and
// `pageUrl` for the browser tab (https://example.com).
//
// `--allow-reload` is required: the probe goes in ahead of the renderer's first
// script, so the run reloads the window to install it.

import path from "node:path";

import { installProbe } from "./perf-screens.mjs";
import { REPO_ROOT, sleep } from "./studio-app.mjs";
import { firstChat } from "./sweep-screens.mjs";

/** A file opened in a Files tab, under this checkout. */
const FILE = ".agents/skills/studio-chrome-devtools/SKILL.md";

export default async (app, args = {}) => {
  const idleMs = (args.idleSeconds ?? 30) * 1000;
  const baselineMs = (args.baselineSeconds ?? 10) * 1000;
  const settleMs = args.settleMs ?? 6000;

  await installProbe(app);
  await app.waitFor("window.__studioDrive && window.__perfProbe", {
    timeout: 60_000,
  });
  await sleep(3000);

  // A tab put up by `goto` with nothing behind it in front: a fresh new tab
  // is the plainest screen there is.
  const front = async () => {
    await app.goto("/new-tab", { label: "front: a fresh new tab", newTab: true });
    await app.waitFor(
      'document.querySelector("[data-app-tab-active] [role=combobox]")',
    );
  };
  const idle = async (ms) => {
    const before = await app.eval("window.__studioDrive.load()");
    await app.eval("window.__perfProbe.reset()");
    await app.eval(WATCH_FETCHES);
    await sleep(ms);
    const after = await app.eval("window.__studioDrive.load()");
    if (after.id !== before.id) {
      throw new Error(
        "The window reloaded during the idle (an edit under src/client), so its tabs are gone. Run again.",
      );
    }
    return {
      frames: await app.eval("window.__perfProbe.frames()"),
      hotUpdates: after.updates - before.updates,
      fetches: await app.eval("window.__idleFetches.slice(0, 50)"),
      seconds: ms / 1000,
    };
  };

  let baseline;
  if (baselineMs > 0) {
    await front();
    await sleep(2000);
    baseline = tally(await idle(baselineMs));
  }

  // What the screens stand on, read off the running app, so a parameterized
  // one is opened rather than skipped because an id written here went stale.
  const connected = await app.rpc("apps.list", {}).catch(() => undefined);
  const catalog = await app
    .rpcFirst("apps.live.catalog", {})
    .catch(() => undefined);
  const slug = connected?.apps?.[0]?.slug ?? catalog?.[0]?.slug;
  const chat = (await firstChat(app))?.id;
  const tasks = chat
    ? await app.rpc("workspace.chats.tasks", { id: chat })
    : [];
  const task = tasks[0]?.id;

  const folder = args.folder ?? REPO_ROOT;
  const folderPath = args.path ?? "apps/studio/src/";
  const screens = [
    {
      name: "Files at a folder, a few columns deep",
      route: `/files?${new URLSearchParams({ path: folderPath, root: folder })}`,
    },
    // Ahead of the recents, which it puts a file in.
    {
      name: "Files with a file open",
      route: `/files?${new URLSearchParams({ file: path.resolve(REPO_ROOT, args.file ?? FILE), path: "", root: "~" })}`,
    },
    { name: "Files › Recents", route: "/files?path=&root=recents%3A" },
    { name: "Files › This Computer", route: "/files?path=&root=computer%3A" },
    { name: "Browser start", route: "/browser" },
    { name: "Browser with a page", page: args.pageUrl ?? "https://example.com" },
    { name: "Apps", route: "/apps" },
    slug && { name: `App page (${slug})`, route: `/apps/${slug}` },
    { name: "Chats", route: "/chats" },
    chat && { name: "Chat with a transcript", route: `/chats/${chat}` },
    task && { name: "Task", route: `/tasks/${task}?chat=${chat}` },
    { name: "Extensions", route: "/extensions" },
    { name: "Release notes", route: "/release-notes" },
    { name: "New tab", route: "/new-tab" },
  ].filter(Boolean);

  await app.eval("window.__perfProbe.reset()");
  const opened = [];
  for (const screen of screens) {
    if (screen.page) {
      await app.goto("/new-tab", { label: `open ${screen.name}`, newTab: true });
      await app.click({ selector: "[data-app-tab-active] [role=combobox]" });
      await app.type(screen.page);
      await app.press("Enter");
      await app.waitFor(
        'window.__studioDrive.state().path?.startsWith("/sites/")',
        { label: "the page to open in the tab" },
      );
    } else {
      await app.goto(screen.route, { label: `open ${screen.name}`, newTab: true });
    }
    await sleep(800);
    const { path: at } = await app.state();
    // A route the router has no match for draws its not-found page, which
    // is quiet for the wrong reason.
    const notFound = await app.eval(
      `document.querySelector("[data-app-tab-active]")?.innerText.includes("Could not find page") ?? false`,
    );
    opened.push({ name: screen.name, at, ...(notFound && { notFound }) });
  }
  // Each screen's first reads, and the page's load, land before the count.
  await sleep(settleMs);
  // The probe has to have seen the screens' own first reads, or an idle
  // with nothing in it says the probe is blind rather than that the tabs
  // are quiet.
  const openingRequests = (await app.eval("window.__perfProbe.frames()")).filter(
    (frame) => frame.dir === "out" && frame.kind === "request",
  ).length;
  if (openingRequests === 0) {
    throw new Error(
      "The probe counted no requests while the screens opened, so it is not seeing the RPC port and an idle count would be empty for the wrong reason.",
    );
  }
  await front();
  await sleep(2000);
  const { tabs } = await app.state();

  const hidden = tally(await idle(idleMs));
  // A procedure that also went out with nothing but the window's opening tab
  // behind the front one is the shell's or the front tab's, not a hidden
  // screen's.
  if (baseline) {
    const shell = new Set(baseline.requests.map((entry) => entry.path));
    for (const entry of hidden.requests) {
      entry.alsoInBaseline = shell.has(entry.path);
    }
  }

  const quiet = hidden.requests.length === 0;
  if (!quiet) {
    process.exitCode = 1;
  }
  const skipped = [
    slug ? undefined : "no app in the list or the catalog, so no app page",
    chat ? undefined : "no chat, so no chat or task tab",
    task ? undefined : "no task in the first chat, so no task tab",
  ].filter(Boolean);
  return {
    ok: quiet,
    quiet,
    idleSeconds: hidden.seconds,
    requests: hidden.requests,
    inbound: hidden.inbound,
    ...(hidden.other.length > 0 && { other: hidden.other }),
    ...(hidden.fetches.length > 0 && { fetches: hidden.fetches }),
    ...(hidden.hotUpdates > 0 && {
      hotUpdates: `${hidden.hotUpdates} hot update(s) landed during the idle; traffic may be the remount, run again`,
    }),
    ...(baseline && { baseline }),
    opened,
    openingRequests,
    tabs: tabs.length,
    ...(skipped.length > 0 && { skipped }),
  };
};

/** Frames per procedure and kind: requests out, stream and response frames in. */
function tally({ fetches, frames, hotUpdates, seconds }) {
  const groups = new Map();
  for (const frame of frames) {
    const key = `${frame.dir} ${frame.kind} ${frame.path}`;
    const group = groups.get(key) ?? {
      dir: frame.dir,
      kind: frame.kind,
      path: frame.path,
      n: 0,
      bytes: 0,
      atMs: [],
    };
    group.n++;
    group.bytes += frame.bytes;
    if (group.atMs.length < 8) {
      group.atMs.push(frame.at);
    }
    groups.set(key, group);
  }
  const sorted = [...groups.values()].sort((a, b) => b.n - a.n);
  const pick = (test) =>
    sorted.filter(test).map(({ dir: _dir, ...group }) => group);
  return {
    seconds,
    hotUpdates,
    fetches,
    requests: pick((group) => group.dir === "out" && group.kind === "request"),
    inbound: pick((group) => group.dir === "in"),
    // Aborts and client stream frames: a subscription closed or fed while
    // idle, which a screen remounting would also show.
    other: pick((group) => group.dir === "out" && group.kind !== "request"),
  };
}

/**
 * Resources the page fetches from here on, outside the RPC port: an image or
 * a file read over a URL. An observer rather than the resource buffer, which
 * stops taking entries once it is full.
 */
const WATCH_FETCHES = `(() => {
  window.__idleFetchObserver?.disconnect();
  const since = performance.now();
  window.__idleFetches = [];
  window.__idleFetchObserver = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      window.__idleFetches.push({
        at: Math.round(entry.startTime - since),
        kind: entry.initiatorType,
        name: entry.name.slice(0, 160),
      });
    }
  });
  window.__idleFetchObserver.observe({ type: "resource" });
})()`;
