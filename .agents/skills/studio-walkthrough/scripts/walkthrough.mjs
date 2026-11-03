#!/usr/bin/env node
// Studio walkthroughs, each step one command:
//
//   node walkthrough.mjs seed <seed.json>                  a clean room to start takes from
//   node walkthrough.mjs open <seed>                       the seed's clean room, booted, to look around in
//   node walkthrough.mjs take <name.walk.mjs> --seed <name> --out <take dir>
//   node walkthrough.mjs build <take dir>                  pages from a recording
//   node walkthrough.mjs film <take dir>                   the contact sheet
//   node walkthrough.mjs render <take dir> [--chapter <n>] [--plain] [--gif]
//   node walkthrough.mjs share <take dir> [--page snippets|chapters] [--title <t> --lede <line>]
//
// `seed` boots a fresh clean room with the developer's sign-ins, writes the
// seed's files, starts its chats with real agent turns, picks the model New
// starts with, and keeps the result. `take` puts that back, boots, runs the
// walk script, builds and films, and stops, so every take starts from the
// same place. `share` writes a page as one file, ready for the instrument-page
// skill's share.mjs; it publishes nothing itself.

import { execFileSync, spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { connect } from "node:net";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CHECKOUT_KEY } from "../../studio-chrome-devtools/scripts/studio-app.mjs";
import { REPO_ROOT } from "./browser.mjs";
import { buildTake, playerPage } from "./build.mjs";
import { filmTake } from "./film.mjs";
import { renderClip } from "./render.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DRIVE = path.join(
  REPO_ROOT,
  ".agents/skills/studio-chrome-devtools/scripts/studio-drive.mjs",
);
const CHAT_TURN = path.join(path.dirname(DRIVE), "chat-turn.mjs");
const PURPOSE = "walkthrough";

const args = process.argv.slice(2);
const [command, subject] = args;
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};

// --- where things are, as studio-drive keeps them -----------------------------

/** studio-drive's cache for this checkout (WORKSPACE_CACHE_ROOT there). */
const CACHE_ROOT = path.join(
  process.env.LOCALAPPDATA ??
    (process.platform === "darwin"
      ? path.join(homedir(), "Library", "Caches")
      : (process.env.XDG_CACHE_HOME ?? path.join(homedir(), ".cache"))),
  "instrument-studio-drive",
  CHECKOUT_KEY,
);
const roomDir = (room) => path.join(CACHE_ROOT, "clean-rooms", room);
const seedDir = (name) => path.join(CACHE_ROOT, "walkthrough-seeds", name);

/** The shared dev application data (devUserDataDir in studio-drive). */
function devUserDataDir() {
  const suffix = process.env.ELECTRON_DEV_USER_FOLDER_SUFFIX;
  const name = `Instrument (Dev${suffix ? ` (${suffix})` : ""})`;
  if (process.platform === "darwin") {
    return path.join(homedir(), "Library", "Application Support", name);
  }
  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA ?? path.join(homedir(), "AppData", "Roaming"),
      name,
    );
  }
  return path.join(
    process.env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config"),
    name,
  );
}

/** A clean room's machine folder, by its entry in the app's registry. */
function machineDirOf(room) {
  const userData = devUserDataDir();
  const registry = JSON.parse(
    readFileSync(path.join(userData, "workspaces.json"), "utf8"),
  );
  const entry = registry.workspaces.find(
    (e) => path.resolve(userData, e.path) === path.resolve(roomDir(room)),
  );
  if (!entry) throw new Error(`The app has not registered the clean room ${room}`);
  return path.join(userData, "machine", entry.id);
}

// --- driving ----------------------------------------------------------------

const drive = (...rest) =>
  execFileSync("node", [DRIVE, ...rest], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
  });

const runScript = (room, script, input) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      "node",
      [DRIVE, "run", script, "--quiet", "--clean-room", room, "--args", JSON.stringify(input)],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.on("close", () => {
      try {
        const result = JSON.parse(out);
        if (result.ok === false) {
          reject(new Error(`${path.basename(script)}: ${result.error} (at ${result.stoppedAt})`));
        } else resolve(result.value ?? result.result ?? result);
      } catch {
        reject(new Error(`${path.basename(script)} printed no result: ${out.slice(0, 400)}`));
      }
    });
  });

/** Stops the clean room's instance and waits for its port to come free, so a boot straight after finds it free. */
async function stop(room) {
  let port;
  try {
    port = Number(
      execFileSync("node", [DRIVE, "port", "--clean-room", room], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim(),
    );
  } catch {
    return; // Nothing running.
  }
  drive("stop", "--clean-room", room);
  for (let tries = 0; tries < 50; tries++) {
    const listening = await new Promise((resolve) => {
      const socket = connect({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
    if (!listening) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`The clean room ${room} still holds port ${port} after stopping`);
}

const boot = (room, ...more) =>
  JSON.parse(drive("boot", "--purpose", PURPOSE, "--clean-room", room, ...more));

// --- commands -----------------------------------------------------------------

async function seed(file) {
  const spec = JSON.parse(readFileSync(file, "utf8"));
  const name = spec.name ?? path.basename(file).replace(/\.seed\.json$|\.json$/, "");
  const room = spec.room ?? PURPOSE;
  await stop(room);
  const booted = boot(room, "--fresh", "--with-sign-ins");
  // A file's text, or "@<path>" to copy one beside the seed file (a picture).
  for (const [relative, content] of Object.entries(spec.files ?? {})) {
    const target = path.join(booted.cleanRoom, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    if (content.startsWith("@")) {
      cpSync(path.resolve(path.dirname(file), content.slice(1)), target);
    } else writeFileSync(target, content);
  }
  const { models } = JSON.parse(drive("rpc", "gateway.models.list", "{}", "--clean-room", room));
  const chatModel = models.find((m) => m.name === (spec.chatModel ?? "Claude"));
  if (!chatModel) {
    throw new Error(`No model named ${spec.chatModel ?? "Claude"}: is the clean room signed in? (${models.map((m) => m.name).join(", ")})`);
  }
  const turns = await Promise.all(
    (spec.chats ?? []).map((prompt) =>
      runScript(room, CHAT_TURN, { model: chatModel.uri ?? chatModel.id, prompt }),
    ),
  );
  if (spec.newChatModel) {
    await runScript(room, path.join(HERE, "set-new-chat-model.mjs"), { model: spec.newChatModel });
  }
  await stop(room);
  const keep = seedDir(name);
  rmSync(keep, { force: true, recursive: true });
  mkdirSync(keep, { recursive: true });
  cpSync(roomDir(room), path.join(keep, "workspace"), { recursive: true });
  cpSync(`${roomDir(room)}-home`, path.join(keep, "home"), { recursive: true });
  cpSync(machineDirOf(room), path.join(keep, "machine"), { recursive: true });
  writeFileSync(path.join(keep, "seed.json"), JSON.stringify({ ...spec, name, room }, null, 2));
  return { chats: turns.map((t) => t.chat), room, seed: name };
}

/** Puts a seed back in its clean room and boots it. */
async function open(seedName) {
  const keep = seedDir(seedName);
  if (!existsSync(keep)) throw new Error(`No seed ${seedName}: make it with walkthrough.mjs seed`);
  const { room } = JSON.parse(readFileSync(path.join(keep, "seed.json"), "utf8"));
  await stop(room);
  // Back to the seed: the workspace, its work folder and its machine folder.
  const machine = machineDirOf(room);
  for (const [from, to] of [
    ["workspace", roomDir(room)],
    ["home", `${roomDir(room)}-home`],
    ["machine", machine],
  ]) {
    rmSync(to, { force: true, recursive: true });
    cpSync(path.join(keep, from), to, { recursive: true });
  }
  const booted = boot(room);
  return { cleanRoom: booted.cleanRoom, drive: `node ${DRIVE} <command> --clean-room ${room}`, room };
}

async function take(walk, { out, seedName }) {
  const { cleanRoom, room } = await open(seedName);
  const dir = path.resolve(out);
  rmSync(path.join(dir, "recording"), { force: true, recursive: true });
  mkdirSync(path.join(dir, "recording"), { recursive: true });
  let recorded;
  try {
    recorded = await runScript(room, path.resolve(walk), {
      build: execFileSync("git", ["-C", REPO_ROOT, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(),
      out: path.join(dir, "recording"),
      workspace: cleanRoom,
    });
  } finally {
    await stop(room);
  }
  const built = await buildTake(dir);
  const filmed = await filmTake(dir);
  return { ...recorded, built, filmed, take: dir };
}

function share(takeDir, page, { lede, title } = {}) {
  const dir = path.resolve(takeDir);
  const data = readFileSync(path.join(dir, "data.js"), "utf8");
  const parsed = JSON.parse(readFileSync(path.join(dir, "walkthrough.json"), "utf8"));
  // The posters go inside too, smaller: the page has no folder beside it.
  let inline = data;
  for (const chapter of parsed.chapters) {
    if (!chapter.still) continue;
    const jpeg = execFileSync(
      "ffmpeg",
      ["-loglevel", "error", "-i", path.join(dir, chapter.still), "-vf", "scale=1240:-1", "-q:v", "4", "-f", "mjpeg", "-"],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    inline = inline.replaceAll(
      `"${chapter.still}"`,
      `"data:image/jpeg;base64,${jpeg.toString("base64")}"`,
    );
  }
  mkdirSync(path.join(dir, "share"), { recursive: true });
  const file = path.join(dir, "share", `${page}.html`);
  writeFileSync(
    file,
    playerPage({
      data: inline,
      mount:
        page === "chapters"
          ? 'Walkthrough.mountChapters(document.getElementById("app"), window.WALKTHROUGH)'
          : `Walkthrough.mountSnippets(document.getElementById("app"), window.WALKTHROUGH, ${JSON.stringify({ alone: true, lede, title })})`,
      title: title ?? `${parsed.title}, ${page === "chapters" ? "in chapters" : "as snippets"}`,
    }),
  );
  const bytes = readFileSync(file).byteLength;
  return {
    file,
    megabytes: Math.round((bytes / 1024 / 1024) * 10) / 10,
    publish: `node ${path.relative(process.cwd(), path.join(REPO_ROOT, "registry/skills/instrument-page/share.mjs"))} ${path.relative(process.cwd(), file)}`,
  };
}

const commands = {
  build: () => buildTake(path.resolve(subject)),
  film: () => filmTake(path.resolve(subject)),
  open: () => open(subject),
  render: () =>
    renderClip(path.resolve(subject), {
      chapter: flag("--chapter") ? Number(flag("--chapter")) : undefined,
      gif: args.includes("--gif"),
      plain: args.includes("--plain"),
    }),
  seed: () => seed(path.resolve(subject)),
  share: () =>
    share(subject, flag("--page", "snippets"), {
      lede: flag("--lede"),
      title: flag("--title"),
    }),
  take: () =>
    take(subject, { out: flag("--out", "take"), seedName: flag("--seed") }),
};

if (!commands[command] || !subject) {
  console.error(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 9).join("\n"));
  process.exit(1);
}
try {
  console.log(JSON.stringify(await commands[command](), null, 2));
} catch (error) {
  console.error(`walkthrough: ${error.message}`);
  process.exit(1);
}
