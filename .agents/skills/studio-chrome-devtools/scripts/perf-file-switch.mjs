// Times walking a folder's HTML files in Files, the folder beside the file's
// page, with the window's other tab groups held as they are: each ↓ shows the
// next file. For comparing a window of many groups with one of a few.
//
//   node studio-drive.mjs run perf-file-switch.mjs --allow-reload --quiet --workspace documents --args '{"folder":"/abs/folder"}'
//
// Args: `folder` (required), `presses` (12), `warm` (true: shows every group
// once first, as a day of use does, so hidden groups hold what they would),
// `settleMs` (600), `idleMs` (10000: a quiet stretch at the end, for what the
// window does with nobody acting).

import { execFileSync } from "node:child_process";

import { installProbe } from "./perf-screens.mjs";
import { sleep } from "./studio-app.mjs";

const QUIET_START = `(() => {
  window.__quiet?.disconnect();
  window.__changeAt = performance.now();
  window.__lastMutation = window.__changeAt;
  window.__quiet = new MutationObserver(() => { window.__lastMutation = performance.now(); });
  window.__quiet.observe(document.body, { attributes: true, childList: true, subtree: true });
})()`;

const QUIET_END = `new Promise((resolve) => {
  const check = () => {
    const now = performance.now();
    if (now - window.__lastMutation > 200 || now - window.__changeAt > 8000) {
      window.__quiet.disconnect();
      resolve(Math.round(window.__lastMutation - window.__changeAt));
    } else {
      setTimeout(check, 25);
    }
  };
  check();
})`;

/** Resolves at the first frame the page on screen is a new address and done loading, with ms since the press. */
const SHOWN = (before) => `new Promise((resolve) => {
  const tick = () => {
    const view = document.querySelector("webview[data-page-on-screen]");
    let url = "";
    let loading = true;
    try { url = view?.getURL() ?? ""; loading = view?.isLoading() ?? true; } catch {}
    if (url && url !== ${JSON.stringify(before)} && !loading) {
      requestAnimationFrame(() => resolve(Math.round(performance.now() - window.__pressAt)));
    } else if (performance.now() - window.__pressAt > 10000) {
      resolve(null);
    } else {
      requestAnimationFrame(tick);
    }
  };
  tick();
})`;

const SHOWN_URL = `(() => { try { return document.querySelector("webview[data-page-on-screen]")?.getURL() ?? ""; } catch { return ""; } })()`;

/** CPU seconds so far of each of this checkout's Electron processes, summed by kind. */
function cpuByKind(match) {
  const out = execFileSync("ps", ["-ww", "-axo", "pid=,time=,command="], { encoding: "utf8", maxBuffer: 1 << 26 });
  const sums = {};
  const renderers = [];
  for (const line of out.split("\n")) {
    if (!line.includes(match)) continue;
    const [, time, command] = line.trim().match(/^\d+\s+(\S+)\s+(.*)$/) ?? [];
    if (!time) continue;
    const [min, sec] = time.split(":");
    const seconds = Number(min) * 60 + Number(sec);
    const kind = command.match(/--type=(\S+)/)?.[1] ?? "main";
    if (kind === "renderer") {
      renderers.push(seconds);
      continue;
    }
    sums[kind] = Math.round(((sums[kind] ?? 0) + seconds) * 100) / 100;
  }
  // The window's renderer is the one that has worked the most; the rest are pages.
  renderers.sort((a, b) => b - a);
  sums.window = renderers[0] ?? 0;
  sums.pages = Math.round(renderers.slice(1).reduce((a, b) => a + b, 0) * 100) / 100;
  sums.pageProcesses = renderers.length - 1;
  return sums;
}
const minus = (a, b) => Object.fromEntries(Object.keys(a).map((k) => [k, Math.round((a[k] - (b[k] ?? 0)) * 100) / 100]));

export default async (app, args = {}) => {
  const match = args.match ?? "Electron.tg-perf-hidden-groups";
  const w = app.words;
  await installProbe(app);
  await app.waitFor("window.__studioDrive && window.__perfProbe", { timeout: 60_000 });
  await sleep(3000);

  const sidebarWasOpen = await w.sidebar.isOpen();
  if (!sidebarWasOpen) {
    await w.sidebar.toggle();
  }
  const tree = JSON.stringify(await app.snapshot());
  const names = [...tree.matchAll(/button \\?"([^"\\]+?) tab group\\?"/g)].map((m) => m[1]);
  // The sidebar's rows in order, each with which of its name it is.
  const rows = names.map((name, index) => ({
    name,
    nth: names.slice(0, index).filter((each) => each === name).length,
  }));
  const rowButton = ({ name, nth }) => w.find("button", `${name} tab group`).nth(nth);
  const upIndex = (await app.eval("window.__studioDrive.look()")).groups.findIndex((group) => group.isUp);
  if (args.warm !== false) {
    // Each group up once, the way a day of use leaves them, then back.
    for (const [index, row] of rows.entries()) {
      if (index === upIndex) continue;
      await rowButton(row).click().catch(() => {});
      await sleep(400);
    }
    if (rows[upIndex]) {
      await rowButton(rows[upIndex]).click();
    }
    await sleep(2000);
  }
  if (!sidebarWasOpen) {
    await w.sidebar.toggle();
  }

  await app.goto(`/files?path=&root=${encodeURIComponent(args.folder)}&view=list`);
  await sleep(1500);
  const box = await app.eval(`(() => {
    const option = document.querySelector("[data-group-up] [role=option]");
    if (!option) return null;
    const r = option.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  if (!box) {
    throw new Error("The folder shows no files.");
  }
  await app.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...box });
  for (const clickCount of [1, 2]) {
    for (const type of ["mousePressed", "mouseReleased"]) {
      await app.cdp.send("Input.dispatchMouseEvent", { type, ...box, button: "left", clickCount });
    }
  }
  await sleep(2500);

  const settleMs = args.settleMs ?? 600;
  const runs = [];
  const cpuBefore = cpuByKind(match);
  for (let index = 0; index < (args.presses ?? 12); index++) {
    await app.eval("window.__perfProbe.reset()");
    if (args.watch) {
      await app.eval(`window.__perfProbe.watch(${JSON.stringify(args.watch)})`);
    }
    const before = await app.eval(SHOWN_URL);
    await app.eval(QUIET_START);
    await app.eval("window.__pressAt = performance.now()");
    await app.rpc("debug.drive.pressKey", { keyCode: "Down", modifiers: [] });
    const shownMs = await app.eval(SHOWN(before));
    const quietMs = await app.eval(QUIET_END);
    await sleep(settleMs);
    const snap = await app.eval("window.__perfProbe.snapshot({ components: 25, rpc: 12 })");
    runs.push({
      shownMs,
      quietMs,
      commits: snap.commits,
      fibers: snap.fibersRendered,
      rpcOut: snap.rpcOut.messages,
      rpcIn: snap.rpcIn.messages,
      longFrameMs: snap.longFrames.totalMs,
      top: snap.topComponents.slice(0, 15),
      rpcOutTop: snap.rpcOut.top,
      rpcInTop: snap.rpcIn.top,
      why: snap.why,
    });
  }

  const cpuPresses = minus(cpuByKind(match), cpuBefore);
  let trace;
  if (args.trace) {
    // What the window's main thread spent the presses on, by trace event.
    const events = [];
    const done = new Promise((resolve) => {
      app.cdp.on((message) => {
        if (message.method === "Tracing.dataCollected") {
          events.push(...message.params.value);
        } else if (message.method === "Tracing.tracingComplete") {
          resolve();
        }
      });
    });
    await app.cdp.send("Tracing.start", {
      categories: "devtools.timeline,disabled-by-default-devtools.timeline,v8",
      transferMode: "ReportEvents",
    });
    for (let index = 0; index < 3; index++) {
      const before = await app.eval(SHOWN_URL);
      await app.eval("window.__pressAt = performance.now()");
      await app.rpc("debug.drive.pressKey", { keyCode: "Down", modifiers: [] });
      await app.eval(SHOWN(before));
      await sleep(settleMs);
    }
    await app.cdp.send("Tracing.end");
    await done;
    const busy = new Map();
    for (const event of events) {
      if (event.ph === "X" && event.name === "RunTask") {
        busy.set(event.tid, (busy.get(event.tid) ?? 0) + (event.dur ?? 0));
      }
    }
    const main = [...busy].sort((a, b) => b[1] - a[1])[0]?.[0];
    const byName = new Map();
    for (const event of events) {
      if (event.tid === main && event.ph === "X" && event.dur) {
        byName.set(event.name, (byName.get(event.name) ?? 0) + event.dur);
      }
    }
    // And by function, from a sampled profile of three more.
    await app.cdp.send("Profiler.enable");
    await app.cdp.send("Profiler.setSamplingInterval", { interval: 200 });
    await app.cdp.send("Profiler.start");
    for (let index = 0; index < 3; index++) {
      const before = await app.eval(SHOWN_URL);
      await app.eval("window.__pressAt = performance.now()");
      await app.rpc("debug.drive.pressKey", { keyCode: "Down", modifiers: [] });
      await app.eval(SHOWN(before));
      await sleep(settleMs);
    }
    const { profile } = await app.cdp.send("Profiler.stop");
    const self = new Map();
    const total = profile.endTime - profile.startTime;
    const counts = new Map();
    for (const id of profile.samples) counts.set(id, (counts.get(id) ?? 0) + 1);
    const perSample = total / profile.samples.length;
    for (const node of profile.nodes) {
      const { functionName, url, lineNumber } = node.callFrame;
      const file = url.split("/").pop()?.split("?")[0] ?? "";
      const key = `${functionName || "(anon)"} ${file}:${lineNumber + 1}`;
      self.set(key, (self.get(key) ?? 0) + (counts.get(node.id) ?? 0) * perSample);
    }
    // Inclusive time by function, through the tree.
    const byId = new Map(profile.nodes.map((node) => [node.id, node]));
    const inclusive = new Map();
    const totalOf = (node) => {
      let sum = (counts.get(node.id) ?? 0) * perSample;
      for (const child of node.children ?? []) sum += totalOf(byId.get(child));
      const { functionName, url, lineNumber } = node.callFrame;
      const key = `${functionName || "(anon)"} ${url.split("/").pop()?.split("?")[0] ?? ""}:${lineNumber + 1}`;
      inclusive.set(key, (inclusive.get(key) ?? 0) + sum);
      return sum;
    };
    totalOf(profile.nodes[0]);
    const top = (map, n) => [...map].filter(([k]) => !k.startsWith("(idle)") && !k.startsWith("(root)") && !k.startsWith("(program)")).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, us]) => `${Math.round(us / 3000)} ${k}`);
    const profiled = { self: top(self, 30), inclusive: top(inclusive, 60) };
    trace = {
      profiled,
      runTaskMs: Math.round((busy.get(main) ?? 0) / 3000),
      perPressMs: Object.fromEntries(
        [...byName]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 25)
          .map(([name, dur]) => [name, Math.round(dur / 3000)]),
      ),
    };
  }
  // A quiet stretch: what the window sends and renders with nobody acting.
  await app.eval("window.__perfProbe.reset()");
  const cpuIdleStart = cpuByKind(match);
  await sleep(args.idleMs ?? 10_000);
  const cpuIdle = minus(cpuByKind(match), cpuIdleStart);
  const idle = await app.eval("window.__perfProbe.snapshot({ components: 15, rpc: 12 })");

  const spread = (values) => {
    const sorted = values.filter((v) => v !== null && v !== undefined).sort((a, b) => a - b);
    return { median: sorted[Math.floor(sorted.length / 2)], min: sorted[0], max: sorted.at(-1) };
  };
  return {
    shape: {
      groups: names.length,
      webviews: await app.eval("document.querySelectorAll('webview').length"),
      drawnSides: await app.eval("document.querySelectorAll('[data-group-side]').length"),
      domNodes: await app.eval("document.getElementsByTagName('*').length"),
      heapMb: await app.eval("Math.round(performance.memory.usedJSHeapSize / 1048576)"),
    },
    shownMs: spread(runs.map((r) => r.shownMs)),
    quietMs: spread(runs.map((r) => r.quietMs)),
    commits: spread(runs.map((r) => r.commits)),
    fibers: spread(runs.map((r) => r.fibers)),
    rpcOut: spread(runs.map((r) => r.rpcOut)),
    rpcIn: spread(runs.map((r) => r.rpcIn)),
    longFrameMs: spread(runs.map((r) => r.longFrameMs)),
    sample: runs[Math.floor(runs.length / 2)],
    raw: runs.map((r) => [r.shownMs, r.quietMs, r.commits, r.fibers, r.rpcOut, r.rpcIn]),
    cpuPresses,
    cpuIdle,
    trace,
    idle: {
      commits: idle.commits,
      fibers: idle.fibersRendered,
      rpcOut: idle.rpcOut.messages,
      rpcIn: idle.rpcIn.messages,
      top: idle.topComponents.slice(0, 10),
      rpcInTop: idle.rpcIn.top,
      rpcOutTop: idle.rpcOut.top,
    },
  };
};
