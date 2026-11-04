// Builds a recorded take into pages. Reads <take>/recording/ (events.jsonl,
// script.jsonl, assets.json, stills/) and writes beside it:
//
//   chapters.html   the whole take in one player, chapters in a rail
//   snippets.html   a loop per chapter
//   stills.html     each still as a picture, the page itself, and an outline
//   render.html     what render.mjs and film.mjs step through
//   data.js         the take, ready to replay anywhere
//   stills/         <name>.png, <name>.html, <name>.outline.yaml
//
// Ready to replay anywhere means the fonts are inside it, and this machine's
// paths and the signed-in account's photo are not.

import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path, { basename } from "node:path";
import { fileURLToPath } from "node:url";

import { launch, REPO_ROOT } from "./browser.mjs";

const VENDOR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../vendor",
);

const AVATAR =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="#4f7a68"/><circle cx="48" cy="38" r="17" fill="#d9e8df"/><path d="M16 92c4-20 18-30 32-30s28 10 32 30" fill="#d9e8df"/></svg>',
  );

/** This machine's drives, by the names Files shows for them (macOS). */
const DRIVES = (() => {
  try {
    return readdirSync("/Volumes").filter((name) => name !== "Macintosh HD");
  } catch {
    return [];
  }
})();

/**
 * What a shared file must not carry, shown or not: this machine's paths, its
 * home folder's and drives' names, and the account's photo. A clean room's
 * folder reads as a workspace in the home folder.
 */
export const scrub = (text) => {
  let out = text
    .replaceAll(
      /https:\/\/lh3\.googleusercontent\.com\/[^"'\s)\\]+/g,
      AVATAR,
    )
    .replaceAll(REPO_ROOT, "/app")
    .replaceAll(homedir(), "/Users/you")
    .replaceAll(
      /\/Users\/you\/(?:Library\/Caches|\.cache)\/instrument-studio-drive\/[0-9a-f]+\/clean-rooms\/[^/"\\]+/g,
      "/Users/you/Instrument",
    )
    .replaceAll(new RegExp(`\\b${basename(homedir())}\\b`, "g"), "you");
  for (const drive of DRIVES) out = out.replaceAll(drive, "Drive");
  return out;
};

/**
 * Test ids are for tests and no style reads them, but content blockers hide
 * elements by them (one hides any whose id starts with "app", which takes
 * Studio's whole page), so a shared take carries none. Clears them from every
 * serialized node and attribute change in a recording, in place.
 */
const withoutTestIds = (value) => {
  if (Array.isArray(value)) {
    for (const item of value) withoutTestIds(item);
  } else if (value && typeof value === "object") {
    const { attributes } = value;
    if (attributes && typeof attributes === "object" && !Array.isArray(attributes)) {
      delete attributes["data-testid"];
    }
    for (const inner of Object.values(value)) withoutTestIds(inner);
  }
  return value;
};

const esc = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const clock = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * The recorded styles' fonts cut down to the ones the take carries: a face
 * whose first source was inlined keeps only that, and a face the app never
 * drew with goes. Their other sources name the dev server on this machine,
 * which a shared page must never ask for (a browser elsewhere blocks it as
 * insecure, and Safari then waits on the font forever).
 */
function withOnlyCarriedFonts(json) {
  return json.replaceAll(/@font-face\s*\{[^{}]*\}/g, (face) => {
    const sources = [...face.matchAll(/url\((['"]?)([^'")]+)\1\)\s*(format\([^)]*\))?/g)];
    const carried = sources.find((m) => m[2].startsWith("data:"));
    if (!carried) return "";
    return face.replace(/src:[^;]*;/, `src: ${carried[0]};`);
  });
}

/** A page of the player: its stylesheet and script inline, the take beside it or inside it. */
export function playerPage({ data, mount, title }) {
  const css = readFileSync(path.join(VENDOR, "player.css"), "utf8");
  const js = readFileSync(path.join(VENDOR, "player.js"), "utf8");
  const take = data
    ? `<script>${data.replaceAll("</script", "<\\/script")}</script>`
    : '<script src="data.js"></script>';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${css}</style>
</head>
<body>
<div id="app"></div>
${take}
<script>${js.replaceAll("</script", "<\\/script")}</script>
<script>${mount}</script>
</body>
</html>
`;
}

export async function buildTake(take) {
  const recording = path.join(take, "recording");
  const lines = (f) =>
    readFileSync(path.join(recording, f), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
  const recorded = lines("events.jsonl");
  const scriptRaw = lines("script.jsonl");
  const assets = JSON.parse(
    readFileSync(path.join(recording, "assets.json"), "utf8"),
  );

  // --- events ---------------------------------------------------------------
  const rrweb = recorded.filter((e) => e.src === "rrweb").map((e) => e.e);
  const t0 = rrweb[0].timestamp;
  // Fonts go inside the styles that name them, once each. A picture can be
  // named many times over a take, so it is kept once and named by a token
  // the player swaps for it.
  let eventsJson = JSON.stringify(withoutTestIds(rrweb));
  const pictures = [];
  for (const [url, dataUrl] of Object.entries(assets)) {
    if (/^data:font\/|\.(woff2?|ttf|otf)(\?|$)/.test(dataUrl.slice(0, 20)) || /\.(woff2?|ttf|otf)(\?|$)/.test(url)) {
      eventsJson = eventsJson.replaceAll(url, dataUrl);
    } else {
      const token = `wt-asset:${pictures.length}`;
      pictures.push(dataUrl);
      eventsJson = eventsJson.replaceAll(JSON.stringify(url).slice(1, -1), token);
    }
  }
  eventsJson = scrub(withOnlyCarriedFonts(eventsJson));

  // --- the script track, on the recording's clock -----------------------------
  const script = scriptRaw.map((e) => ({ ...e, t: e.t - t0 }));
  const begin = script.find((e) => e.kind === "begin");
  const end =
    script.find((e) => e.kind === "end")?.t ?? rrweb.at(-1).timestamp - t0;
  const stills = script.filter((e) => e.kind === "still");
  const marks = script.filter((e) => e.kind === "chapter");
  const chapters = marks.map((c, i) => {
    const from = i === 0 ? 0 : Math.max(0, c.t - 150);
    const to = i + 1 < marks.length ? marks[i + 1].t - 150 : end;
    // A still is noted once written, a moment after it was taken.
    const inside = stills.filter((s) => s.t - 400 >= from && s.t - 400 < to);
    const poster =
      inside.find((s) => s.poster) ?? inside.at(-1) ?? stills[0] ?? null;
    return {
      caption: c.caption,
      from,
      still: poster ? `stills/${poster.name}.png` : null,
      title: c.title,
      to,
    };
  });

  // An agent's answer arriving: sent with Enter, then nothing to do but wait
  // until the next still, which a take takes once the answer is in.
  const warps = [];
  for (const send of script.filter(
    (e) => e.kind === "key" && e.combo === "Enter",
  )) {
    const answered = stills.find((s) => s.t > send.t);
    if (answered && answered.t - send.t > 6000) {
      warps.push({ from: send.t + 2200, rate: 3, to: answered.t - 1600 });
    }
  }

  const data = {
    chapters,
    duration: end,
    stills: stills.map((s) => ({ caption: s.caption, name: s.name, t: s.t })),
    title: begin?.title ?? "Walkthrough",
    viewport: begin?.viewport ?? { h: 840, w: 1240 },
    warps,
  };
  const dataJs = `window.WALKTHROUGH = ${JSON.stringify({ ...data, script })};\nwindow.WALKTHROUGH.pictures = ${JSON.stringify(pictures)};\nwindow.WALKTHROUGH.events = ${eventsJson};\n`;
  writeFileSync(path.join(take, "data.js"), dataJs);
  writeFileSync(
    path.join(take, "walkthrough.json"),
    `${JSON.stringify(data, null, 2)}\n`,
  );

  // --- stills -------------------------------------------------------------------
  mkdirSync(path.join(take, "stills"), { recursive: true });
  for (const f of readdirSync(path.join(recording, "stills"))) {
    const from = path.join(recording, "stills", f);
    const to = path.join(take, "stills", f);
    if (f.endsWith(".html")) {
      const html = readFileSync(from, "utf8").replaceAll(/\sdata-testid="[^"]*"/g, "");
      writeFileSync(to, scrub(html));
    }
    else if (f.endsWith(".png")) copyFileSync(from, to);
  }
  // Each still's screen as roles and names, read from the still itself: the
  // few hundred words an agent needs rather than the whole page.
  const browser = await launch();
  const page = await browser.newPage({ viewport: data.viewport && { height: data.viewport.h, width: data.viewport.w } });
  const outlines = {};
  for (const s of data.stills) {
    await page.goto(`file://${path.join(take, "stills", `${s.name}.html`)}`, {
      waitUntil: "domcontentloaded",
    });
    outlines[s.name] = await page.locator("body").ariaSnapshot();
    writeFileSync(
      path.join(take, "stills", `${s.name}.outline.yaml`),
      `${outlines[s.name]}\n`,
    );
  }
  await browser.close();

  // --- pages --------------------------------------------------------------------
  const title = data.title;
  writeFileSync(
    path.join(take, "chapters.html"),
    playerPage({
      mount:
        'Walkthrough.mountChapters(document.getElementById("app"), window.WALKTHROUGH)',
      title: `${title}, in chapters`,
    }),
  );
  writeFileSync(
    path.join(take, "snippets.html"),
    playerPage({
      mount:
        'Walkthrough.mountSnippets(document.getElementById("app"), window.WALKTHROUGH)',
      title: `${title}, as snippets`,
    }),
  );
  writeFileSync(
    path.join(take, "render.html"),
    playerPage({
      mount: "Walkthrough.mountRender(window.WALKTHROUGH)",
      title: "render",
    }),
  );
  writeFileSync(
    path.join(take, "stills.html"),
    stillsPage({ data, outlines, take }),
  );
  return { chapters, duration: end, stills: data.stills.length, warps };
}

/** The stills page: each still as a picture, the page itself, and its outline. */
function stillsPage({ data, outlines, take }) {
  const kb = (f) => Math.round(statSync(path.join(take, f)).size / 1024);
  const cards = data.stills.map((s, i) => {
    const outline = outlines[s.name];
    const chapter =
      data.chapters.findLast((c) => c.from <= s.t - 400) ?? data.chapters[0];
    const prompt = [
      `Screen: ${s.caption} (Instrument Studio, "${data.title}" walkthrough, chapter "${chapter?.title}", at ${clock(s.t)}).`,
      `The page as it was, styles and fonts inside, opens in any browser: stills/${s.name}.html`,
      `A picture of it: stills/${s.name}.png`,
      `What is on screen, as roles and names:`,
      outline,
    ].join("\n");
    return `
  <article class="pc-card">
    <div class="pc-view">
      <img src="stills/${esc(s.name)}.png" alt="${esc(s.caption)}" loading="lazy">
      <div class="pc-live" hidden><iframe data-src="stills/${esc(s.name)}.html" title="${esc(s.caption)}"></iframe></div>
    </div>
    <div class="pc-meta">
      <div class="pc-n">${i + 1} · ${esc(chapter?.title ?? "")} · ${clock(s.t)}</div>
      <h2>${esc(s.caption)}</h2>
      <div class="pc-tabs">
        <button class="on" data-view="picture">Picture <small>${kb(`stills/${s.name}.png`)} KB</small></button>
        <button data-view="live">Live page <small>${kb(`stills/${s.name}.html`)} KB</small></button>
        <button data-view="outline">Outline <small>${(outline.length / 1024).toFixed(1)} KB</small></button>
      </div>
      <pre class="pc-outline" hidden>${esc(outline)}</pre>
      <div class="pc-actions">
        <button class="pc-copy" data-prompt="${esc(prompt)}">Copy for agent</button>
        <a href="stills/${esc(s.name)}.html" target="_blank">Open the page</a>
      </div>
    </div>
  </article>`;
  });
  const { h, w } = data.viewport;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(data.title)}, as stills</title>
<style>
:root { color-scheme: dark; }
body { margin: 0; background: #101211; color: #e8ece9; font: 15px/1.45 Inter, -apple-system, system-ui, sans-serif; }
main { max-width: 1400px; margin: 0 auto; padding: 24px; display: flex; flex-direction: column; gap: 28px; }
.pc-card { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(280px, 1fr); gap: 20px; align-items: start; }
.pc-view { position: relative; aspect-ratio: ${w} / ${h}; border-radius: 12px; overflow: hidden; background: #000; box-shadow: 0 0 0 1px #262b28; }
.pc-view img { width: 100%; height: 100%; display: block; }
.pc-live { position: absolute; inset: 0; container-type: inline-size; }
.pc-live iframe { width: ${w}px; height: ${h}px; border: 0; transform-origin: 0 0; transform: scale(calc(100cqw / ${w}px)); }
.pc-n { color: #8fd1b6; font-size: 12.5px; letter-spacing: .04em; text-transform: uppercase; }
h2 { font-size: 20px; margin: 4px 0 14px; letter-spacing: -.01em; }
.pc-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
.pc-tabs button, .pc-copy { background: #1d211f; color: #e8ece9; border: 1px solid #343a37; border-radius: 8px; padding: 6px 11px; font: inherit; font-size: 14px; cursor: pointer; }
.pc-tabs button.on { border-color: #5fae90; background: #1a2420; }
.pc-tabs small { color: #8a938e; margin-left: 4px; }
.pc-outline { margin: 12px 0 0; max-height: 360px; overflow: auto; background: #0b0d0c; border: 1px solid #262b28; border-radius: 8px; padding: 10px 12px; font: 12px/1.45 ui-monospace, Menlo, monospace; white-space: pre-wrap; color: #c9d1cc; }
.pc-actions { display: flex; gap: 14px; align-items: center; margin-top: 14px; }
.pc-copy { background: #5fae90; border-color: #5fae90; color: #08110d; font-weight: 600; }
.pc-actions a { color: #8fd1b6; }
[hidden] { display: none !important; }
@media (max-width: 900px) { .pc-card { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<main>${cards.join("\n")}</main>
<script>
for (const card of document.querySelectorAll(".pc-card")) {
  const live = card.querySelector(".pc-live");
  const outline = card.querySelector(".pc-outline");
  for (const b of card.querySelectorAll(".pc-tabs button")) {
    b.onclick = () => {
      card.querySelectorAll(".pc-tabs button").forEach((x) => x.classList.toggle("on", x === b));
      live.hidden = b.dataset.view !== "live";
      outline.hidden = b.dataset.view !== "outline";
      if (!live.hidden) { const f = live.querySelector("iframe"); if (!f.src) f.src = f.dataset.src; }
    };
  }
  card.querySelector(".pc-copy").onclick = async (e) => {
    await navigator.clipboard.writeText(e.target.dataset.prompt);
    e.target.textContent = "Copied";
    setTimeout(() => (e.target.textContent = "Copy for agent"), 1500);
  };
}
</script>
</body>
</html>
`;
}
