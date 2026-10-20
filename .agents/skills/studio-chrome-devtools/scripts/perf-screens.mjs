// Measures what the app window does at boot, while idle, and on each screen,
// in counts that hold still on a busy computer: React commits and the
// components behind them, RPC messages and bytes per procedure, and DOM
// mutations, with long animation frames beside them. See perf-probe-page.js.
//
//   node studio-drive.mjs run perf-screens.mjs --allow-reload --workspace documents
//   node studio-drive.mjs run perf-screens.mjs --allow-reload --args '{"idleSeconds":5,"chats":["<id>"]}'
//
// `--allow-reload` is required: the probe has to be in place before the
// renderer's first script, so the run reloads the window to install it.
// Args: `idleSeconds` (15), `settleMs` per screen (1500), `routes` to walk,
// `chats` to open by id, `idleFiles: false` to skip Files' idle window, and
// `watch`, component names to record why they rendered.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sleep } from "./studio-app.mjs";

const PROBE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "perf-probe-page.js",
);

export default async (app, args = {}) => {
  const idleMs = (args.idleSeconds ?? 15) * 1000;
  const settleMs = args.settleMs ?? 1500;
  const reloadAt = await installProbe(app);
  await app.waitFor("window.__studioDrive && window.__perfProbe", {
    timeout: 60_000,
  });
  const readyMs = Date.now() - reloadAt;
  await sleep(4000);

  const snap = (options) =>
    app.eval(`window.__perfProbe.snapshot(${JSON.stringify(options ?? {})})`);
  const reset = async () => {
    await app.eval("window.__perfProbe.reset()");
    if (args.watch) {
      await app.eval(`window.__perfProbe.watch(${JSON.stringify(args.watch)})`);
    }
  };

  const results = {
    boot: { readyMs, load: await app.eval(LOAD_TIMING), ...(await snap()) },
  };

  // Anything that happens while nobody does anything is a finding.
  await app.goto("/chats");
  await sleep(settleMs);
  await reset();
  await sleep(idleMs);
  results.idleChats = await snap();

  results.screens = {};
  for (const route of args.routes ?? [
    "/files",
    "/browser",
    "/apps",
    "/chats",
  ]) {
    await reset();
    await app.goto(route);
    await sleep(settleMs);
    results.screens[route] = await snap({ components: 8, rpc: 5 });
  }

  if (args.idleFiles !== false) {
    await app.goto("/files");
    await sleep(settleMs);
    await reset();
    await sleep(idleMs);
    results.idleFiles = await snap({ components: 8, rpc: 6 });
  }

  for (const chat of args.chats ?? []) {
    await reset();
    await app.goto(`/chats/${chat}`);
    await sleep(settleMs * 2);
    results[`open ${chat}`] = await snap({ components: 10, rpc: 8 });
  }
  return results;
};

/** Puts the probe ahead of the renderer's scripts and reloads; when it reloaded. */
export async function installProbe(app) {
  await app.cdp.send("Page.enable");
  await app.cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: readFileSync(PROBE, "utf8"),
  });
  const reloadAt = Date.now();
  await app.cdp.send("Page.reload");
  return reloadAt;
}

/** Load milestones and how much script the window loaded to reach them. */
const LOAD_TIMING = `(() => {
  const navigation = performance.getEntriesByType("navigation")[0];
  const paint = Object.fromEntries(
    performance.getEntriesByType("paint").map((entry) => [entry.name, Math.round(entry.startTime)]),
  );
  const scripts = performance
    .getEntriesByType("resource")
    .filter((entry) => entry.initiatorType === "script" || entry.name.endsWith(".js"));
  return {
    domContentLoaded: Math.round(navigation.domContentLoadedEventEnd),
    ...paint,
    scripts: scripts.length,
    scriptKb: Math.round(scripts.reduce((sum, entry) => sum + (entry.decodedBodySize || 0), 0) / 1024),
  };
})()`;
