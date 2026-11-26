// Counts what one ⌘T costs in a window of many tab groups: React commits and
// fibers, the components behind them, RPC per procedure, long animation
// frames, and the time from the press to the new tab's box painted.
//
//   node studio-drive.mjs run perf-new-tab.mjs --allow-reload --quiet --workspace documents
//   node studio-drive.mjs run perf-new-tab.mjs --allow-reload --quiet --workspace documents --args '{"groups":10}'
//
// The scene is `groups` (30) tab groups, each a Files tab on an HTML file and,
// in every other group and the last, a web page on one, the shape of a window kept open
// for a day of reviewing pages. Then, in the last group, `switches` (8)
// clicks between its Files tab and its page, timed to the last DOM change
// before 200 ms of none, and from its Files tab
// `presses` (8) single ⌘T each closed again with ⌘W, ⌘T on a new tab already
// up, and a burst of `burst` (5) ⌘T `burstGapMs` (80) apart. Then back to
// groups by their sidebar rows: three recent ones, still drawn behind the one
// up, and six from the middle of the list, let go, timed to the last DOM
// change before 200 ms of none.
//
// Args: `groups`, `presses`, `burst`, `burstGapMs`, `settleMs` (1200),
// `watch` (component names whose renders are explained), `components` (30)
// listed per press, `scene: false` to measure the window as it is, `only`
// (a list of "press", "tabSwitch", "onNewTab", "burst", "returns") to take
// some of them. Needs `--allow-reload`: the probe goes in
// ahead of the renderer's first script.

import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { filesHref } from "../../../../apps/studio/scripts/drive-routes.ts";
import { installProbe } from "./perf-screens.mjs";
import { sleep } from "./studio-app.mjs";

const WATCH = [
  "NewChatView",
  "PromptInput",
  "PromptEditor",
  "GroupView",
  "GroupSides",
  "GroupItem",
  "SideCard",
  "TabStrip",
  "GroupSidebar",
  "WindowShell",
];

/** How many new tab screens the window's groups have, in the page. */
const NEW_TABS = `window.__studioDrive.look().groups.reduce((sum, group) =>
  sum + group.sides.reduce((n, side) => n + side.tabs.filter((tab) => tab.address.startsWith("/chats") && !tab.address.startsWith("/chats/")).length, 0), 0)`;

/**
 * Resolves, in the page, at the first frame after the window shows one more
 * new tab box than `before`, with the ms since `window.__pressAt`.
 */
const PAINTED = (before) => `new Promise((resolve) => {
  const tick = () => {
    if ((${NEW_TABS}) > ${before}) {
      requestAnimationFrame(() => resolve(Math.round(performance.now() - window.__pressAt)));
    } else if (performance.now() - window.__pressAt > 5000) {
      resolve(null);
    } else {
      requestAnimationFrame(tick);
    }
  };
  tick();
})`;

/** Starts timing a change: the window's DOM watched from now. */
const QUIET_START = `(() => {
  window.__quiet?.disconnect();
  window.__changeAt = performance.now();
  window.__lastMutation = window.__changeAt;
  window.__quiet = new MutationObserver(() => { window.__lastMutation = performance.now(); });
  window.__quiet.observe(document.body, { attributes: true, childList: true, subtree: true });
})()`;

/** The ms from the change's start to its last DOM mutation before 200 ms of none. */
const QUIET_END = `new Promise((resolve) => {
  const check = () => {
    const now = performance.now();
    if (now - window.__lastMutation > 200 || now - window.__changeAt > 8000) {
      window.__quiet.disconnect();
      resolve(Math.round(window.__lastMutation - window.__changeAt));
    } else {
      setTimeout(check, 50);
    }
  };
  check();
})`;

export default async (app, args = {}) => {
  const w = app.words;
  const settleMs = args.settleMs ?? 1200;
  await installProbe(app);
  await app.waitFor("window.__studioDrive && window.__perfProbe", {
    timeout: 60_000,
  });
  await sleep(3000);

  const look = () => app.eval("window.__studioDrive.look()");
  const reset = async (watch = args.watch ?? WATCH) => {
    await app.eval("window.__perfProbe.reset()");
    await app.eval(`window.__perfProbe.watch(${JSON.stringify(watch)})`);
  };
  const snap = () =>
    app.eval(
      `window.__perfProbe.snapshot({ components: ${args.components ?? 30}, rpc: 15 })`,
    );

  // --- the scene ---
  if (args.scene !== false) {
    const dir = path.join(os.tmpdir(), "perf-new-tab-pages");
    mkdirSync(dir, { recursive: true });
    const groups = args.groups ?? 30;
    for (let index = 0; index < groups; index++) {
      const file = path.join(dir, `page-${index}.html`);
      writeFileSync(
        file,
        `<!doctype html><title>Page ${index}</title><h1>Page ${index}</h1>${"<p>Lorem ipsum dolor sit amet.</p>".repeat(40)}`,
      );
      await w.press("Meta+n");
      await sleep(300);
      await app.goto(filesHref({ file, path: "", root: "~" }));
      await sleep(400);
      if (index % 2 === 0 || index === groups - 1) {
        await w.press("Meta+t");
        await w.omnibar.go(pathToFileURL(file).href);
        await sleep(400);
      }
    }
    // The last group, up, has its Files tab up and a page beside it.
    await clickTab(app, 0);
    await sleep(3000);
  }

  const before = await look();
  const shape = {
    groups: before.groups.length,
    tabs: before.groups.reduce(
      (sum, group) =>
        sum + group.sides.reduce((n, side) => n + side.tabs.length, 0),
      0,
    ),
    domNodes: await app.eval("document.getElementsByTagName('*').length"),
    webviews: await app.eval("document.querySelectorAll('webview').length"),
    drawnSides: await app.eval(
      "document.querySelectorAll('[data-group-side]').length",
    ),
  };

  const pressAndPaint = async () => {
    const shown = await app.eval(NEW_TABS);
    await app.eval("window.__pressAt = performance.now()");
    await app.rpc("debug.drive.pressKey", {
      keyCode: "t",
      modifiers: ["meta"],
    });
    return app.eval(PAINTED(shown));
  };
  const one = async (label) => {
    await reset();
    const paintMs = await pressAndPaint();
    await sleep(settleMs);
    return { label, paintMs, ...(await snap()) };
  };

  const only = new Set(
    args.only ?? ["press", "tabSwitch", "onNewTab", "burst", "returns"],
  );

  // --- single presses from a Files tab, each closed again ---
  const presses = [];
  for (let index = 0; only.has("press") && index < (args.presses ?? 8); index++) {
    presses.push(await one(`press ${index}`));
    await w.press("Meta+w");
    await sleep(600);
  }

  // --- the page's tab and the Files tab's, clicked in turn ---
  const tabSwitches = [];
  for (let index = 0; only.has("tabSwitch") && index < (args.switches ?? 8); index++) {
    await reset();
    await app.eval(QUIET_START);
    await clickTab(app, index % 2 === 0 ? 1 : 0);
    const settledMs = await app.eval(QUIET_END);
    await sleep(settleMs);
    tabSwitches.push({ label: `switch ${index}`, paintMs: settledMs, ...(await snap()) });
  }

  // --- ⌘T with a new tab already up ---
  const onNewTab = [];
  if (only.has("onNewTab")) {
    await w.press("Meta+t");
    await sleep(settleMs);
    for (let index = 0; index < 4; index++) {
      onNewTab.push(await one(`on new tab ${index}`));
    }
    for (let index = 0; index < 5; index++) {
      await w.press("Meta+w");
      await sleep(300);
    }
  }

  // --- a burst ---
  let burst;
  if (only.has("burst")) {
    await reset();
    const burstStart = Date.now();
    for (let index = 0; index < (args.burst ?? 5); index++) {
      await app.rpc("debug.drive.pressKey", {
        keyCode: "t",
        modifiers: ["meta"],
      });
      await sleep(args.burstGapMs ?? 80);
    }
    await sleep(settleMs);
    burst = { wallMs: Date.now() - burstStart, ...(await snap()) };
    for (let index = 0; index < (args.burst ?? 5); index++) {
      await w.press("Meta+w");
      await sleep(300);
    }
  }

  // --- back to a group: recent ones, still drawn, and old ones, let go ---
  const tree = JSON.stringify(await app.snapshot());
  const names = [...tree.matchAll(/button \\?"([^"\\]+?) tab group\\?"/g)].map(
    (match) => match[1],
  );
  const half = Math.floor(names.length / 2);
  const picks = !only.has("returns") ? [] : [
    ...names.slice(1, 4).map((name) => ["recent", name]),
    ...names.slice(half, half + 6).map((name) => ["old", name]),
  ];
  const returns = [];
  for (const [kind, name] of picks) {
    await reset();
    await app.eval(QUIET_START);
    await w.group(name).open();
    const settledMs = await app.eval(QUIET_END);
    await sleep(settleMs);
    returns.push({
      label: `${kind} ${name}`,
      kind,
      paintMs: settledMs,
      ...(await snap()),
    });
  }

  return {
    shape,
    press: summary(presses),
    tabSwitch: summary(tabSwitches),
    onNewTab: summary(onNewTab),
    ...(burst && { burst: brief(burst) }),
    returnRecent: summary(returns.filter((each) => each.kind === "recent")),
    returnOld: summary(returns.filter((each) => each.kind === "old")),
    ...(args.detail && { presses: presses.map(brief) }),
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
    paintMs: each.paintMs,
    commits: each.commits,
    fibers: each.fibersRendered,
    rpcOut: each.rpcOut.messages,
    rpcIn: each.rpcIn.messages,
    kbIn: each.rpcIn.kb,
    longFrames: each.longFrames.count,
    longFrameMs: each.longFrames.totalMs,
    blockingMs: each.longFrames.blockingMs,
    top: each.topComponents.slice(0, 12),
    rpcOutTop: each.rpcOut.top,
    rpcInTop: each.rpcIn.top,
  };
}

function summary(runs) {
  const spread = (values) => {
    const sorted = values.filter((each) => each !== null).sort((a, b) => a - b);
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
    paintMs: spread(runs.map((run) => run.paintMs)),
    commits: spread(runs.map((run) => run.commits)),
    fibers: spread(runs.map((run) => run.fibersRendered)),
    rpcOut: spread(runs.map((run) => run.rpcOut.messages)),
    rpcIn: spread(runs.map((run) => run.rpcIn.messages)),
    kbIn: spread(runs.map((run) => run.rpcIn.kb)),
    longFrames: spread(runs.map((run) => run.longFrames.count)),
    longFrameMs: spread(runs.map((run) => run.longFrames.totalMs)),
    components: per(60, (run) => run.topComponents),
    rpcOutTop: per(12, (run) =>
      run.rpcOut.top.map((row) => `${row.n} ${row.path}`),
    ),
    rpcInTop: per(12, (run) =>
      run.rpcIn.top.map((row) => `${row.n} ${row.path}`),
    ),
    why,
  };
}
