// Counts what a window of tab groups does while idle and while the person
// moves between groups and tabs: React commits and fibers, the components
// behind them and why, and RPC messages per procedure, per switch.
//
//   node studio-drive.mjs run perf-tab-groups.mjs --allow-reload --workspace documents
//   node studio-drive.mjs run perf-tab-groups.mjs --allow-reload --workspace documents --args '{"rounds":3}'
//
// The scene is five groups with eighteen tabs: Files (a folder, a file, Recents,
// This Mac), a chat and its task, the browser and a page, a group of the app's
// own screens (Settings, Apps, the chat list, What's new, Extensions, Skills,
// Memory), and an empty group up front. Every screen opens by plain `goto`,
// which files it into the group up, so the window has one window tab, as a
// person's does.
//
// Args: `rounds` (2) of switching, `idleSeconds` (30), `switchSettleMs` (1500),
// `watch` (component names whose renders are explained), `chat` (the fixture's
// red-and-blue-squares), `skip` (screen paths to leave out of the scene, for an
// A/B), `detail: true` for every switch's own numbers. Needs `--allow-reload`:
// the probe goes in ahead of the renderer's first script.

import path from "node:path";

import {
  appsHref,
  browserHref,
  chatHref,
  chatListHref,
  extensionsHref,
  filesHref,
  memoryHref,
  releaseNotesHref,
  settingsHref,
  skillsHref,
  taskHref,
} from "../../../../apps/studio/scripts/drive-routes.ts";
import { installProbe } from "./perf-screens.mjs";
import { REPO_ROOT, sleep } from "./studio-app.mjs";

const WATCH = [
  "WindowShell",
  "GroupView",
  "GroupSides",
  "GroupItem",
  "SideCard",
  "PaneTabs",
  "SideMotion",
  "TabStrip",
  "GroupSidebar",
  "FilesScreen",
  "FinderPlaces",
  "PlaceMenu",
  "CatalogTile",
  "Tile",
  "AppsHome",
];

export default async (app, args = {}) => {
  const w = app.words;
  const rounds = args.rounds ?? 2;
  const settleMs = args.switchSettleMs ?? 1500;
  const skip = new Set(args.skip ?? []);
  await installProbe(app);
  await app.waitFor("window.__studioDrive && window.__perfProbe", {
    timeout: 60_000,
  });
  await sleep(4000);

  const reset = async (watch = args.watch ?? WATCH) => {
    await app.eval("window.__perfProbe.reset()");
    await app.eval(`window.__perfProbe.watch(${JSON.stringify(watch)})`);
  };
  const snap = () =>
    app.eval("window.__perfProbe.snapshot({ components: 40, rpc: 20 })");
  const look = () => app.eval("window.__studioDrive.look()");
  const notes = [];

  // --- the scene ---
  // A fixture's window opens on a new chat and the group of the chat it last
  // had up, and keeps the groups a run makes, so a second run in one
  // instance would build its scene on top of the first's.
  const already = (await look()).groups.length;
  if (already > 2) {
    throw new Error(
      `The window already has ${already} tab groups. Stop the instance and boot it again on the fixture, which opens with none of a run's.`,
    );
  }
  const chat = args.chat ?? "red-and-blue-squares";
  const task = (await app.rpc("workspace.chats.tasks", { id: chat }))[0]?.id;
  const newGroup = async (label) => {
    const before = (await look()).groups.length;
    await w.press("Meta+n");
    await app
      .waitFor(`window.__studioDrive.look().groups.length > ${before}`, {
        label: `a new group for ${label}`,
        timeout: 3000,
      })
      .catch(() => notes.push(`Meta+n reused the empty group for ${label}`));
    await sleep(500);
  };
  const open = async (...addresses) => {
    for (const address of addresses) {
      if (skip.has(address.split("?")[0])) {
        continue;
      }
      await app.goto(address);
      await sleep(700);
    }
  };

  await newGroup("files");
  await open(
    filesHref({ path: "apps/studio/src/", root: REPO_ROOT }),
    filesHref({
      file: path.resolve(
        REPO_ROOT,
        ".agents/skills/studio-chrome-devtools/SKILL.md",
      ),
      path: "",
      root: "~",
    }),
    filesHref({ path: "", root: "recents:" }),
    filesHref({ path: "", root: "computer:" }),
  );
  await newGroup("chat");
  await open(chatHref(chat));
  if (task) {
    await open(taskHref(task, chat));
  }
  await newGroup("browser");
  await open(browserHref());
  await w.press("Meta+t");
  await w.omnibar.go(args.pageUrl ?? "https://example.com");
  await sleep(3000);
  await newGroup("screens");
  await open(
    settingsHref(),
    appsHref(),
    chatListHref(),
    releaseNotesHref(),
    extensionsHref(),
    skillsHref(),
    memoryHref(),
  );
  await newGroup("front");
  await sleep(args.settleMs ?? 6000);

  const scene = (await look()).groups.map((group) => ({
    isUp: group.isUp,
    tabs: group.sides.flatMap((side) =>
      side.tabs.map((tab) => tab.title || tab.address),
    ),
  }));
  const shape = {
    groups: scene.length,
    tabs: scene.reduce((sum, group) => sum + group.tabs.length, 0),
    windowTabs: (await app.state()).tabs.length,
    domNodes: await app.eval("document.getElementsByTagName('*').length"),
    webviews: await app.eval("document.querySelectorAll('webview').length"),
  };

  // --- idle ---
  await reset([]);
  await sleep((args.idleSeconds ?? 30) * 1000);
  const idle = await snap();

  // --- switching ---
  const measure = async (label, act) => {
    await reset();
    await act();
    await sleep(settleMs);
    return { label, ...(await snap()) };
  };
  const tree = JSON.stringify(await app.snapshot());
  const names = [...tree.matchAll(/button \\?"([^"\\]+?) tab group\\?"/g)].map(
    (match) => match[1],
  );
  const rows = names.map((name, index) => ({
    many: names.filter((each) => each === name).length > 1,
    name,
    nth: names.slice(0, index).filter((each) => each === name).length,
  }));
  const openRow = (row) =>
    row.many ? w.group(row.name).nth(row.nth).click() : w.group(row.name).open();

  const groupSwitches = [];
  for (let round = 0; round < rounds; round++) {
    for (const row of rows) {
      groupSwitches.push(
        await measure(`group ${row.name}#${row.nth}`, () => openRow(row)),
      );
    }
  }

  const tabSwitches = [];
  for (const kind of ["/settings", "/files"]) {
    const group = (await look()).groups.find((each) =>
      each.sides.some((side) =>
        side.tabs.some((tab) => tab.address.startsWith(kind)),
      ),
    );
    if (!group) {
      notes.push(`no group with a ${kind} tab`);
      continue;
    }
    const upTitle = group.sides[0].tabs.find((tab) => tab.isUp)?.title ?? "";
    const row = rows.find(
      (each) => each.name === upTitle || each.name.includes(upTitle),
    );
    if (row) {
      await openRow(row);
    }
    await sleep(settleMs);
    for (let round = 0; round < rounds; round++) {
      for (let index = 0; index < group.sides[0].tabs.length; index++) {
        tabSwitches.push(
          await measure(`tab ${kind} #${index}`, () => clickTab(app, index)),
        );
      }
    }
  }

  return {
    notes,
    shape,
    idle: {
      seconds: idle.seconds,
      commits: idle.commits,
      fibers: idle.fibersRendered,
      rpcOut: idle.rpcOut.messages,
      rpcIn: idle.rpcIn.messages,
    },
    groupSwitch: summary(groupSwitches),
    tabSwitch: summary(tabSwitches),
    ...(args.detail && {
      groupSwitches: groupSwitches.map(brief),
      tabSwitches: tabSwitches.map(brief),
    }),
    final: {
      domNodes: await app.eval("document.getElementsByTagName('*').length"),
      heapMb: (await snap()).heapMb,
    },
  };
};

/** A real click on the i-th tab of the group up's strip. */
async function clickTab(app, index) {
  const box = await app.eval(`(() => {
    const tab = [...document.querySelectorAll("[data-group-up] [role=tab]")]
      .filter((each) => each.getBoundingClientRect().width > 0)[${index}];
    if (!tab) return null;
    const r = tab.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  if (!box) {
    throw new Error(`The group up has no tab #${index} in its strip.`);
  }
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
    await app.cdp.send("Input.dispatchMouseEvent", {
      type,
      ...box,
      ...(type !== "mouseMoved" && { button: "left", clickCount: 1 }),
    });
  }
}

function brief(each) {
  return {
    label: each.label,
    commits: each.commits,
    fibers: each.fibersRendered,
    rpcOut: each.rpcOut.messages,
    rpcIn: each.rpcIn.messages,
    kbIn: each.rpcIn.kb,
  };
}

/** Median, low and high of the counts, and per-switch averages of who rendered and what went over the wire. */
function summary(runs) {
  if (runs.length === 0) {
    return { n: 0 };
  }
  const spread = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return {
      median: sorted[Math.floor(sorted.length / 2)],
      min: sorted[0],
      max: sorted.at(-1),
    };
  };
  const per = (rows, pick) => {
    const sums = new Map();
    for (const run of runs) {
      for (const row of pick(run) ?? []) {
        const [n, ...rest] = String(row).split(" ");
        const key = rest.join(" ");
        sums.set(key, (sums.get(key) ?? 0) + Number(n));
      }
    }
    return [...sums]
      .sort((a, b) => b[1] - a[1])
      .slice(0, rows)
      .map(([name, n]) => `${Math.round((n / runs.length) * 10) / 10} ${name}`);
  };
  const why = {};
  for (const run of runs) {
    for (const [name, counts] of Object.entries(run.why ?? {})) {
      why[name] ??= {};
      for (const [reason, n] of Object.entries(counts)) {
        why[name][reason] = (why[name][reason] ?? 0) + n;
      }
    }
  }
  return {
    n: runs.length,
    commits: spread(runs.map((run) => run.commits)),
    fibers: spread(runs.map((run) => run.fibersRendered)),
    rpcOut: spread(runs.map((run) => run.rpcOut.messages)),
    kbIn: spread(runs.map((run) => run.rpcIn.kb)),
    longFrames: spread(runs.map((run) => run.longFrames.count)),
    components: per(25, (run) => run.topComponents),
    rpcInTop: per(10, (run) =>
      run.rpcIn.top.map((row) => `${row.n} ${row.path}`),
    ),
    kbInTop: per(10, (run) =>
      run.rpcIn.top.map((row) => `${row.kb} ${row.path}`),
    ),
    rpcOutTop: per(10, (run) =>
      run.rpcOut.top.map((row) => `${row.n} ${row.path}`),
    ),
    why,
  };
}
